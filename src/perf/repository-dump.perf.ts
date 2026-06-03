// Copyright Epic Games, Inc. All Rights Reserved.

/**
 * Performance test for native vs. fluent API event handling.
 *
 * Run `pnpm build` first to refresh dist/, then `pnpm test:perf`.
 *
 * Measures the cost of consuming LORE_EVENT_REPOSITORY_STATE_DUMP_NODE events
 * across four SDK access patterns:
 *   1. raw native callback (@lore-vcs/sdk/native)
 *   2. fluent callback + waitAsync
 *   3. fluent asyncIter
 *   4. fluent collectAsync
 * Two variants per mode:
 *   A. accumulate event.data.size only
 *   B. accumulate name.length, typeData.length, and every numeric field to trigger
 *      also string parsing for the events
 *
 * Each (mode, variant) pair runs in its OWN child process so peak RSS can be
 * attributed cleanly per access pattern. Within one child: warmup + N_RUNS
 * measured rounds. The parent orchestrates 4 modes × 2 variants = 8 children
 * sequentially. The shared setup (create repo + stage 100k files + commit) is
 * done once in the parent; children re-open the existing repo via globalArgs.
 *
 * Trade-off: we lose per-round cross-mode interleaving (a system blip during
 * one child only affects that mode's numbers). In exchange the per-mode peak
 * RSS is no longer polluted by previous modes' allocations.
 *
 * To eliminate disk-cache variance, point the repo at a ramdisk by exporting
 * LORE_PERF_REPO_PARENT before running. Defaults to os.tmpdir() otherwise.
 *
 *   # Linux — /dev/shm is already tmpfs, no setup needed:
 *   LORE_PERF_REPO_PARENT=/dev/shm pnpm test:perf
 *
 *   # macOS — create a 4 GB ramdisk once, reuse across runs, then eject:
 *   diskutil erasevolume APFS perfdisk $(hdiutil attach -nomount ram://8388608)
 *   LORE_PERF_REPO_PARENT=/Volumes/perfdisk pnpm test:perf
 *   diskutil eject /Volumes/perfdisk
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { lore as loreFluent } from "@lore-vcs/sdk";
import { lore as loreNative } from "@lore-vcs/sdk/native";
import { LoreEventTag } from "@lore-vcs/sdk/types/enums";
import type { LoreGlobalArgs } from "@lore-vcs/sdk/types/args";
import type { LoreEventFFI, LoreEvent } from "@lore-vcs/sdk/types/events";

const __filename = fileURLToPath(import.meta.url);

const FILE_COUNT = 100_000;
const FILES_PER_LEAF_DIR = 100;
// 100_000 / 100 = 1000 leaf dirs, organized as 10 top × 100 sub.
const TOP_DIRS = 10;
const SUB_DIRS = 100;

const N_RUNS = 10;
// Idle wait between every run (including before the first measurement) to let
// the SoC re-evaluate the workload and any async cleanup settle. Short enough
// to not meaningfully cool the chip — that needs seconds — but enough to break
// up the boost/throttle feedback loop on unconstrained runs.
const COOLDOWN_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NODE_TAG = LoreEventTag.REPOSITORY_STATE_DUMP_NODE;

type Mode =
  | "native"
  | "fluent-callback"
  | "fluent-asyncIter"
  | "fluent-collectAsync";
const MODES: Mode[] = [
  "native",
  "fluent-callback",
  "fluent-asyncIter",
  "fluent-collectAsync",
];

type Variant = "A" | "B";
const VARIANTS: Variant[] = ["A", "B"];

interface Pass {
  events: number;
  accumulatedSize: number;
  ms: number;
  // Current RSS sampled at the end of the timed window (bytes). Not part of
  // the timed measurement — sampled after `t1` so the syscall cost doesn't
  // inflate `ms`. For modes that materialize all events (Collect) this is a
  // good proxy for peak; for streaming modes (Callback/AsyncIter) the true
  // peak may have occurred mid-run and already been GC'd, so this is an
  // under-estimate. The child's peakRssBytes captures the actual high-water
  // mark across the whole child process.
  rssBytes: number;
  // Variant B extras (always present, zero for variant A):
  nameLenTotal: number;
  typeDataLenTotal: number;
  numericTotal: number;
}

interface ChildResult {
  mode: Mode;
  variant: Variant;
  passes: Pass[];
  peakRssBytes: number;
}

interface VariantResult {
  variant: Variant;
  perMode: Record<Mode, ChildResult>;
}

const REPO_PARENT_DIR = process.env.LORE_PERF_REPO_PARENT ?? os.tmpdir();

const createTempRepoDir = () =>
  fs.mkdtempSync(path.join(REPO_PARENT_DIR, "lore-js-sdk-perf-"));

const cleanTempDir = (dir: string) => {
  try {
    fs.rmSync(dir, {
      recursive: true,
      maxRetries: 3,
      retryDelay: 500,
      force: true,
    });
  } catch (e) {
    console.error("Failed to remove temporary directory", dir, e);
  }
};

const pad6 = (n: number) => n.toString().padStart(6, "0");
const pad2 = (n: number) => n.toString().padStart(2, "0");

function createFiles(repoPath: string) {
  for (let top = 0; top < TOP_DIRS; top++) {
    for (let sub = 0; sub < SUB_DIRS; sub++) {
      fs.mkdirSync(path.join(repoPath, pad2(top), pad2(sub)), {
        recursive: true,
      });
    }
  }
  for (let n = 0; n < FILE_COUNT; n++) {
    const top = Math.floor(n / 10_000);
    const sub = Math.floor(n / FILES_PER_LEAF_DIR) % SUB_DIRS;
    const name = pad6(n);
    fs.writeFileSync(
      path.join(repoPath, pad2(top), pad2(sub), `${name}.txt`),
      name
    );
  }
}

// --- accumulators / runners (used by child) --------------------------------

type Accumulator = {
  state: {
    events: number;
    accumulatedSize: number;
    nameLenTotal: number;
    typeDataLenTotal: number;
    numericTotal: number;
  };
  consumeA: (data: { size: number }) => void;
  consumeB: (data: {
    name: string;
    typeData: string;
    id: number;
    parent: number;
    sibling: number;
    mode: number;
    size: number;
    flags: number;
  }) => void;
};

function makeAccumulator(): Accumulator {
  const state = {
    events: 0,
    accumulatedSize: 0,
    nameLenTotal: 0,
    typeDataLenTotal: 0,
    numericTotal: 0,
  };
  return {
    state,
    consumeA: (data) => {
      state.events += 1;
      state.accumulatedSize += data.size;
    },
    consumeB: (data) => {
      state.events += 1;
      state.accumulatedSize += data.size;
      state.nameLenTotal += data.name.toString().length;
      state.typeDataLenTotal += data.typeData.toString().length;
      state.numericTotal +=
        data.id +
        data.parent +
        data.sibling +
        data.mode +
        data.size +
        data.flags;
    },
  };
}

// Current RSS in bytes. macOS: process.memoryUsage().rss is documented as
// bytes on all platforms. Sampled outside the timed window so the call itself
// doesn't inflate ms.
const currentRssBytes = (): number => process.memoryUsage().rss;

function passFromState(state: Accumulator["state"], ms: number): Pass {
  return {
    events: state.events,
    accumulatedSize: state.accumulatedSize,
    nameLenTotal: state.nameLenTotal,
    typeDataLenTotal: state.typeDataLenTotal,
    numericTotal: state.numericTotal,
    ms,
    rssBytes: currentRssBytes(),
  };
}

async function runNative(
  globalArgs: LoreGlobalArgs,
  variant: Variant
): Promise<Pass> {
  const acc = makeAccumulator();
  const consume = variant === "A" ? acc.consumeA : acc.consumeB;
  const t0 = performance.now();
  const rc = await loreNative.repositoryDump(
    globalArgs,
    {},
    {
      callback: (event: LoreEventFFI) => {
        if (event.tag === NODE_TAG) {
          consume(event.data);
        }
      },
    }
  );
  const ms = performance.now() - t0;
  if (rc !== 0) throw new Error(`native repositoryDump rc=${rc}`);
  return passFromState(acc.state, ms);
}

async function runFluentCallback(
  globalArgs: LoreGlobalArgs,
  variant: Variant
): Promise<Pass> {
  const acc = makeAccumulator();
  const consume = variant === "A" ? acc.consumeA : acc.consumeB;
  const t0 = performance.now();
  await loreFluent
    .repositoryDump(globalArgs, {})
    .filterByType(NODE_TAG)
    .callback((event) => {
      if (event.tag === NODE_TAG) {
        consume(event.data);
      }
    })
    .waitAsync();
  const ms = performance.now() - t0;
  return passFromState(acc.state, ms);
}

async function runFluentAsyncIter(
  globalArgs: LoreGlobalArgs,
  variant: Variant
): Promise<Pass> {
  const acc = makeAccumulator();
  const consume = variant === "A" ? acc.consumeA : acc.consumeB;
  const t0 = performance.now();
  for await (const event of loreFluent
    .repositoryDump(globalArgs, {})
    .filterByType(NODE_TAG)
    .asyncIter()) {
    if (event.tag === NODE_TAG) {
      consume(event.data);
    }
  }
  const ms = performance.now() - t0;
  return passFromState(acc.state, ms);
}

async function runFluentCollectAsync(
  globalArgs: LoreGlobalArgs,
  variant: Variant
): Promise<Pass> {
  const acc = makeAccumulator();
  const consume = variant === "A" ? acc.consumeA : acc.consumeB;
  const t0 = performance.now();
  const events: LoreEvent[] = await loreFluent
    .repositoryDump(globalArgs, {})
    .filterByType(NODE_TAG)
    .collectAsync();
  for (const event of events) {
    if (event.tag === NODE_TAG) {
      consume(event.data);
    }
  }
  const ms = performance.now() - t0;
  return passFromState(acc.state, ms);
}

async function runMode(
  mode: Mode,
  variant: Variant,
  globalArgs: LoreGlobalArgs
): Promise<Pass> {
  switch (mode) {
    case "native":
      return runNative(globalArgs, variant);
    case "fluent-callback":
      return runFluentCallback(globalArgs, variant);
    case "fluent-asyncIter":
      return runFluentAsyncIter(globalArgs, variant);
    case "fluent-collectAsync":
      return runFluentCollectAsync(globalArgs, variant);
  }
}

// --- formatting helpers ---------------------------------------------------

function fmtMs(ms: number): string {
  return `${ms.toFixed(1).padStart(7)}ms`;
}

function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function stats(values: number[]): { min: number; mean: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, mean: sum / values.length, max };
}

const fmtMb = (bytes: number): string =>
  `${(bytes / 1024 / 1024).toFixed(1).padStart(6)} MB`;

// Parent logs to stdout. Child logs progress to stderr so child stdout stays
// clean for the JSON result.
function logParent(msg: string) {
  // eslint-disable-next-line no-console
  console.log(msg);
}
function logChild(msg: string) {
  process.stderr.write(msg + "\n");
}

// --- child path -----------------------------------------------------------

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function runChild(): Promise<void> {
  const mode = parseArg("--mode") as Mode;
  const variant = parseArg("--variant") as Variant;
  const repositoryPath = parseArg("--repo");

  if (!mode || !variant || !repositoryPath) {
    throw new Error(
      "child requires --mode <M> --variant <V> --repo <PATH> args"
    );
  }
  if (!MODES.includes(mode)) throw new Error(`bad --mode ${mode}`);
  if (!VARIANTS.includes(variant)) throw new Error(`bad --variant ${variant}`);

  const globalArgs: LoreGlobalArgs = {
    offline: true,
    correlationId: `perf-child-${mode}-${variant}`,
    repositoryPath,
  };

  const tag = `[mode=${padRight(mode, 22)} variant=${variant}]`;

  // Force a full V8 GC. Only available when the process was started with
  // --expose-gc (the parent passes this flag when spawning children).
  // Forcing GC between rounds prevents each round's transient garbage from
  // leaking into the next round's peakRSS, giving a clean per-round peak.
  const gc = (globalThis as { gc?: () => void }).gc;
  const forceGc = () => {
    if (gc) gc();
  };

  // Warmup: one untimed round. Pays the FFI bindings + lazy struct decoder
  // + first-time disk reads cost. Discarded.
  await sleep(COOLDOWN_MS);
  const warm = await runMode(mode, variant, globalArgs);
  logChild(
    `${tag} warmup    time=${fmtMs(warm.ms)}  events=${warm.events}  rss=${fmtMb(warm.rssBytes)}`
  );
  forceGc();

  const passes: Pass[] = [];
  for (let round = 1; round <= N_RUNS; round++) {
    await sleep(COOLDOWN_MS);
    const p = await runMode(mode, variant, globalArgs);
    passes.push(p);
    logChild(
      `${tag} round=${round.toString().padStart(2)} time=${fmtMs(p.ms)}  events=${p.events}  rss=${fmtMb(p.rssBytes)}`
    );
    forceGc();
  }

  // process.resourceUsage().maxRSS is documented as KB on all platforms
  // (Node normalizes). Multiply by 1024 to get bytes.
  const peakRssBytes = process.resourceUsage().maxRSS * 1024;

  const result: ChildResult = { mode, variant, passes, peakRssBytes };
  // One JSON line on stdout. Write synchronously via a fd write to avoid the
  // process.exit() truncation problem; using `console.log` + falling off the
  // bottom of main() also works since the event loop drains stdout, but
  // explicit write is clearer.
  process.stdout.write(JSON.stringify(result) + "\n");
}

// --- parent path ----------------------------------------------------------

async function spawnChild(
  mode: Mode,
  variant: Variant,
  repositoryPath: string
): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        // Expose global.gc() in the child so it can force a full V8 GC
        // between rounds. Keeps each round's peakRSS uncontaminated by
        // transient garbage held over from the previous round.
        "--expose-gc",
        __filename,
        "--child",
        "--mode",
        mode,
        "--variant",
        variant,
        "--repo",
        repositoryPath,
      ],
      {
        // child stdout is captured for JSON; stderr inherits parent's stderr
        // so per-round progress lines flow through to the user.
        stdio: ["ignore", "pipe", "inherit"],
        env: {
          ...process.env,
          // Pin the child to a single libuv worker thread. koffi runs
          // lore_* calls on libuv workers via fn.async; each worker that
          // executes the lib develops its own macOS libmalloc per-thread
          // arena that retains freed pages. With the default of 4 workers
          // the rotating arenas plateau at ~450 MB RSS for repository_dump,
          // which masks the per-mode differences we actually want to
          // measure here. Pinning to 1 worker drops the noise floor to
          // ~258 MB and makes the relative cost of native vs fluent paths
          // visible. See src/perf/scaling-probe.perf.ts for the
          // characterization that established this.
          UV_THREADPOOL_SIZE: "1",
        },
      }
    );

    let stdoutBuf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`child for ${mode}/${variant} exited with code ${code}`));
        return;
      }
      try {
        const trimmed = stdoutBuf.trim();
        const result = JSON.parse(trimmed) as ChildResult;
        resolve(result);
      } catch (e) {
        reject(
          new Error(
            `failed to parse child JSON for ${mode}/${variant}: ${e}; raw=${stdoutBuf.slice(0, 500)}`
          )
        );
      }
    });
  });
}

async function setupParent(): Promise<{
  globalArgs: LoreGlobalArgs;
  repositoryPath: string;
}> {
  const repositoryPath = createTempRepoDir();
  const globalArgs: LoreGlobalArgs = {
    offline: true,
    correlationId: "perf-repository-dump",
    repositoryPath,
  };

  logParent(
    `setup: repo at ${repositoryPath}` +
      (process.env.LORE_PERF_REPO_PARENT
        ? ` (parent from LORE_PERF_REPO_PARENT)`
        : ` (parent from os.tmpdir())`)
  );

  const tCreate = performance.now();
  await loreFluent
    .repositoryCreate(globalArgs, { repositoryUrl: randomUUID() })
    .waitAsync();
  logParent(
    `setup: repositoryCreate done (${fmtMs(performance.now() - tCreate)})`
  );

  const tFiles = performance.now();
  createFiles(repositoryPath);
  logParent(
    `setup: created ${FILE_COUNT} files in ${TOP_DIRS * SUB_DIRS} leaf dirs (${fmtMs(
      performance.now() - tFiles
    )})`
  );

  const tStage = performance.now();
  await loreFluent
    .fileStage(globalArgs, { paths: [repositoryPath] })
    .waitAsync();
  logParent(`setup: fileStage done (${fmtMs(performance.now() - tStage)})`);

  const tCommit = performance.now();
  await loreFluent
    .revisionCommit(globalArgs, { message: "perf setup" })
    .waitAsync();
  logParent(`setup: revisionCommit done (${fmtMs(performance.now() - tCommit)})`);

  const tFlush = performance.now();
  await loreFluent.repositoryFlush(globalArgs, {}).waitAsync();
  logParent(`setup: repositoryFlush done (${fmtMs(performance.now() - tFlush)})`);

  return { globalArgs, repositoryPath };
}

async function teardownParent(
  globalArgs: LoreGlobalArgs,
  repositoryPath: string
) {
  try {
    await loreFluent.repositoryFlush(globalArgs, {}).waitAsync();
  } catch (e) {
    console.error("teardown: repositoryFlush failed", e);
  }
  cleanTempDir(repositoryPath);
}

function checkConsistency(result: VariantResult): void {
  const allPasses: { mode: Mode; round: number; pass: Pass }[] = [];
  for (const mode of MODES) {
    result.perMode[mode].passes.forEach((pass, i) => {
      allPasses.push({ mode, round: i + 1, pass });
    });
  }
  if (allPasses.length === 0) return;
  const ref = allPasses[0].pass;
  for (const { mode, round, pass } of allPasses) {
    if (pass.events !== ref.events) {
      logParent(
        `  WARN variant ${result.variant} ${mode} round${round}: events=${pass.events} differs from reference ${ref.events}`
      );
    }
    if (pass.accumulatedSize !== ref.accumulatedSize) {
      logParent(
        `  WARN variant ${result.variant} ${mode} round${round}: accumulatedSize=${pass.accumulatedSize} differs from reference ${ref.accumulatedSize}`
      );
    }
    if (result.variant === "B") {
      if (
        pass.nameLenTotal !== ref.nameLenTotal ||
        pass.typeDataLenTotal !== ref.typeDataLenTotal ||
        pass.numericTotal !== ref.numericTotal
      ) {
        logParent(
          `  WARN variant B ${mode} round${round}: heavy-field accumulators differ from reference (nameLen=${pass.nameLenTotal}/${ref.nameLenTotal} typeDataLen=${pass.typeDataLenTotal}/${ref.typeDataLenTotal} numeric=${pass.numericTotal}/${ref.numericTotal})`
        );
      }
    }
  }
}

function printSummary(result: VariantResult): void {
  logParent(
    `\n=== Variant ${result.variant} ${
      result.variant === "A"
        ? "(event.size only)"
        : "(name.length + typeData.length + numeric fields)"
    } — summary over ${N_RUNS} runs per mode (each mode in its own child process) ===`
  );

  const perMode = MODES.map((mode) => {
    const child = result.perMode[mode];
    const times = child.passes.map((p) => p.ms);
    return {
      mode,
      time: stats(times),
      childPeakRss: child.peakRssBytes,
      events: child.passes[0]?.events ?? 0,
      passes: child.passes,
    };
  });
  const fastestMean = Math.min(...perMode.map((s) => s.time.mean));

  for (const s of perMode) {
    const ratio = (s.time.mean / fastestMean).toFixed(2);
    const totalEvents = s.passes.reduce((acc, p) => acc + p.events, 0);
    const totalMs = s.passes.reduce((acc, p) => acc + p.ms, 0);
    const eps = Math.round((totalEvents * 1000) / totalMs);
    logParent(
      `mode=${padRight(s.mode, 24)} events=${s.events}  min=${fmtMs(s.time.min)}  mean=${fmtMs(s.time.mean)}  max=${fmtMs(s.time.max)}  ev/s=${eps.toLocaleString("en-US").padStart(9)}  peakRSS=${fmtMb(s.childPeakRss)}  (mean ${ratio}x)`
    );
  }
}

async function runParent() {
  const { globalArgs, repositoryPath } = await setupParent();
  try {
    const results: VariantResult[] = [];
    for (const variant of VARIANTS) {
      logParent(
        `\n--- Variant ${variant} ${
          variant === "A"
            ? "(event.size only)"
            : "(name.length + typeData.length + numeric fields)"
        }: running each mode in its own child process ---`
      );
      const perMode = {} as Record<Mode, ChildResult>;
      for (const mode of MODES) {
        // Cooldown between children so the previous one's tail GC etc. has
        // time to settle before the next child starts measuring.
        await sleep(COOLDOWN_MS);
        const result = await spawnChild(mode, variant, repositoryPath);
        perMode[mode] = result;
      }
      results.push({ variant, perMode });
    }
    for (const r of results) checkConsistency(r);
    for (const r of results) printSummary(r);
  } finally {
    await teardownParent(globalArgs, repositoryPath);
  }
}

// --- entry point ----------------------------------------------------------

async function main() {
  if (process.argv.includes("--child")) {
    await runChild();
  } else {
    await runParent();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
