// Copyright Epic Games, Inc. All Rights Reserved.

/**
 * Two-phase scaling probe.
 *
 * Phase 1 (parent): build a repo with FILE_COUNT files, stage + commit. The
 * resulting committed state is kept on disk for phase 2.
 *
 * Phase 2 (child): in a fresh process, open the existing repo and run a
 * single native repository_dump with a do-nothing callback. Report peak RSS.
 * This isolates "open + dump only" from the setup memory blowup that taints
 * the single-process probe.
 *
 * Goal: see how JS native peak RSS scales with FILE_COUNT — linear scaling
 * implies per-event koffi/V8 cost dominates; flat scaling implies a fixed
 * lib structure cost. The same question for the Go SDK at the same file
 * counts gives an apples-to-apples picture.
 *
 * Usage:
 *   node --expose-gc src/perf/scaling-probe.perf.ts                # default scan
 *   FILE_COUNTS=1000,10000,100000 node --expose-gc src/perf/scaling-probe.perf.ts
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
import type { LoreEventFFI } from "@lore-vcs/sdk/types/events";

const __filename = fileURLToPath(import.meta.url);

const NODE_TAG = LoreEventTag.REPOSITORY_STATE_DUMP_NODE;

const fmtMb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const fmtMs = (ms: number) => `${ms.toFixed(1).padStart(7)} ms`;
const pad2 = (n: number) => n.toString().padStart(2, "0");
const pad6 = (n: number) => n.toString().padStart(6, "0");

// ---------------------------------------------------------------------------
// child mode: open existing repo, dump once with do-nothing callback
// ---------------------------------------------------------------------------

async function childMain(repoPath: string, fileCount: number, dumpCount: number) {
  const globalArgs: LoreGlobalArgs = {
    offline: true,
    correlationId: "scaling-probe-child",
    repositoryPath: repoPath,
  };

  const muBefore = process.memoryUsage();
  const perDumpRss: number[] = [];
  let totalEvents = 0;
  let totalMs = 0;

  for (let i = 0; i < dumpCount; i++) {
    let nodeCount = 0;
    const t0 = performance.now();
    const rc = await loreNative.repositoryDump(globalArgs, {}, {
      callback: (event: LoreEventFFI) => {
        if (event.tag === NODE_TAG) nodeCount++;
      },
    });
    const ms = performance.now() - t0;
    if (rc !== 0) throw new Error(`dump ${i} rc=${rc}`);
    if ((globalThis as { gc?: () => void }).gc) {
      (globalThis as { gc?: () => void }).gc!();
    }
    perDumpRss.push(process.memoryUsage().rss);
    totalEvents += nodeCount;
    totalMs += ms;
  }

  const muAfter = process.memoryUsage();
  const peakRssBytes = process.resourceUsage().maxRSS * 1024;

  const eventsPerDump = totalEvents / dumpCount;

  const result = {
    fileCount,
    dumpCount,
    eventsPerDump,
    avgDumpMs: totalMs / dumpCount,
    peakRssBytes,
    rssBefore: muBefore.rss,
    rssAfter: muAfter.rss,
    perDumpRss,
    heapTotalAfter: muAfter.heapTotal,
    externalAfter: muAfter.external,
  };
  process.stdout.write(JSON.stringify(result) + "\n");
}

// ---------------------------------------------------------------------------
// parent: build N repos, spawn one child per repo, collect results
// ---------------------------------------------------------------------------

function createFiles(repoPath: string, count: number) {
  const leafSize = 100;
  const dirsNeeded = Math.ceil(count / leafSize);
  const top = Math.ceil(Math.sqrt(dirsNeeded));
  const sub = Math.ceil(dirsNeeded / top);
  for (let t = 0; t < top; t++) {
    for (let s = 0; s < sub; s++) {
      fs.mkdirSync(path.join(repoPath, pad2(t), pad2(s)), { recursive: true });
    }
  }
  for (let n = 0; n < count; n++) {
    const t = Math.floor(n / leafSize / sub);
    const s = Math.floor(n / leafSize) % sub;
    const name = pad6(n);
    fs.writeFileSync(
      path.join(repoPath, pad2(t), pad2(s), `${name}.txt`),
      name
    );
  }
}

interface ChildResult {
  fileCount: number;
  dumpCount: number;
  eventsPerDump: number;
  avgDumpMs: number;
  peakRssBytes: number;
  rssBefore: number;
  rssAfter: number;
  perDumpRss: number[];
  heapTotalAfter: number;
  externalAfter: number;
}

async function buildRepo(fileCount: number): Promise<string> {
  const parentDir = process.env.LORE_PERF_REPO_PARENT ?? os.tmpdir();
  const repoPath = fs.mkdtempSync(path.join(parentDir, `lore-scaling-${fileCount}-`));
  const globalArgs: LoreGlobalArgs = {
    offline: true,
    correlationId: "scaling-probe-setup",
    repositoryPath: repoPath,
  };

  console.log(`[parent] building repo with ${fileCount} files at ${repoPath}`);
  const t0 = performance.now();
  await loreFluent
    .repositoryCreate(globalArgs, { repositoryUrl: randomUUID() })
    .waitAsync();
  createFiles(repoPath, fileCount);
  await loreFluent.fileStage(globalArgs, { paths: [repoPath] }).waitAsync();
  await loreFluent
    .revisionCommit(globalArgs, { message: "scaling setup" })
    .waitAsync();
  await loreFluent.repositoryFlush(globalArgs, {}).waitAsync();
  console.log(`[parent] setup done in ${fmtMs(performance.now() - t0)}`);
  return repoPath;
}

function spawnChild(repoPath: string, fileCount: number, dumpCount: number): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--expose-gc",
        __filename,
        "--child",
        "--repo",
        repoPath,
        "--file-count",
        String(fileCount),
        "--dump-count",
        String(dumpCount),
      ],
      {
        stdio: ["ignore", "pipe", "inherit"],
        env: process.env,
      }
    );
    let buf = "";
    child.stdout.on("data", (c: Buffer) => (buf += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`child exited ${code}; out=${buf.slice(0, 500)}`));
        return;
      }
      try {
        resolve(JSON.parse(buf.trim()) as ChildResult);
      } catch (e) {
        reject(new Error(`parse failed: ${e}; raw=${buf.slice(0, 500)}`));
      }
    });
  });
}

async function parentMain() {
  const counts = (process.env.FILE_COUNTS ?? "100000")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0);
  const dumpCounts = (process.env.DUMP_COUNTS ?? "1,2,5,11,20")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0);

  const results: ChildResult[] = [];
  const repos: string[] = [];
  try {
    for (const fc of counts) {
      const repo = await buildRepo(fc);
      repos.push(repo);
      for (const dc of dumpCounts) {
        const r = await spawnChild(repo, fc, dc);
        results.push(r);
        const trail = r.perDumpRss
          .map((rss) => fmtMb(rss).replace(" MB", ""))
          .join(" → ");
        console.log(
          `[parent] fileCount=${fc.toString().padStart(7)}  dumps=${dc.toString().padStart(2)}  avgDump=${fmtMs(r.avgDumpMs)}  peakRSS=${fmtMb(r.peakRssBytes)}  rssBefore=${fmtMb(r.rssBefore)}  rssAfter=${fmtMb(r.rssAfter)}  trail(MB)=${trail}`
        );
      }
    }

    console.log("\n=== Scaling summary ===");
    console.log(
      "fileCount  | dumps | avgDumpMs | peakRSS    | rssBefore  | rssAfter   | growthPerDump"
    );
    for (const r of results) {
      // Approx per-dump RSS growth (after first dump, since first dump pays
      // one-time costs). If only one dump, growth = (rssAfter - rssBefore).
      let growthPerDump: number;
      if (r.perDumpRss.length >= 2) {
        const first = r.perDumpRss[0];
        const last = r.perDumpRss[r.perDumpRss.length - 1];
        growthPerDump = (last - first) / (r.perDumpRss.length - 1);
      } else {
        growthPerDump = r.rssAfter - r.rssBefore;
      }
      console.log(
        `${r.fileCount.toString().padStart(9)}  | ${r.dumpCount.toString().padStart(5)} | ${r.avgDumpMs.toFixed(1).padStart(8)}  | ${fmtMb(r.peakRssBytes).padStart(10)}  | ${fmtMb(r.rssBefore).padStart(10)}  | ${fmtMb(r.rssAfter).padStart(10)}  | ${fmtMb(growthPerDump).padStart(10)}`
      );
    }
  } finally {
    for (const r of repos) {
      try {
        fs.rmSync(r, { recursive: true, force: true, maxRetries: 3 });
      } catch (e) {
        console.error("cleanup failed for", r, e);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--child")) {
    const repoIdx = args.indexOf("--repo");
    const fcIdx = args.indexOf("--file-count");
    const dcIdx = args.indexOf("--dump-count");
    if (repoIdx < 0 || fcIdx < 0 || dcIdx < 0) {
      throw new Error("child requires --repo PATH --file-count N --dump-count M");
    }
    const repo = args[repoIdx + 1];
    const fileCount = Number(args[fcIdx + 1]);
    const dumpCount = Number(args[dcIdx + 1]);
    await childMain(repo, fileCount, dumpCount);
  } else {
    await parentMain();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
