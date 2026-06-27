// Copyright Epic Games, Inc. All Rights Reserved.

import * as fs from "fs";
import * as path from "path";

import {
  expect,
  test,
  describe,
  beforeEach,
  afterEach,
  beforeAll,
} from "vitest";
import { randomUUID } from "crypto";
import { lore } from "@lore-vcs/sdk";
import { LoreEventTag, LoreLogLevel } from "@lore-vcs/sdk/types/enums";
import {
  isEventType,
  LoreEvent,
  LoreEventFFITyped,
  LoreJSStringDecodeMode,
  LoreRevisionCommitRevisionEvent,
  LoreRevisionHistoryEntryEvent,
} from "@lore-vcs/sdk/types/events";
import { cleanTempDir, createTempDir } from "./temp-dir.js";
import { LoreGlobalArgs } from "../dist/types/args/index.js";

describe("lore-js-sdk-fluent", () => {
  let repositoryPath: string;
  let globalArgs: LoreGlobalArgs;

  beforeAll(() => {
    lore.logConfigure({
      level: LoreLogLevel.DEBUG,
    });
  });

  beforeEach(async () => {
    repositoryPath = createTempDir();
    globalArgs = {
      offline: true,
      correlationId: "test-correlation-id",
      repositoryPath,
    };
    await lore
      .repositoryCreate(globalArgs, {
        repositoryUrl: randomUUID(),
      })
      .collectAsync();
  });

  afterEach(async () => {
    await lore.repositoryFlush({}, {}).waitAsync();
    cleanTempDir(repositoryPath);
  });

  const stageRandomFile = async () => {
    const testFilePath = path.join(repositoryPath, randomUUID() + ".txt");
    fs.writeFileSync(testFilePath, randomUUID());

    const stageEvents = await lore
      .fileStage(globalArgs, {
        paths: [testFilePath],
      })
      .filterByType(LoreEventTag.FILE_STAGE_END)
      .collectAsync();

    return {
      testFilePath,
      stageEndEvent: stageEvents[0],
    };
  };

  const commit = async () => {
    const commitRes = await lore
      .revisionCommit(globalArgs, {
        message: "test",
      })
      .filterByType(LoreEventTag.REVISION_COMMIT_END)
      .collectAsync();

    return {
      commitEndEvent: commitRes[0],
    };
  };

  test("collect should work", async () => {
    await stageRandomFile();
    await commit();

    const events = await lore
      .repositoryStatus(globalArgs, { scan: true })
      .filterByType(
        LoreEventTag.REPOSITORY_STATUS_FILE,
        LoreEventTag.REPOSITORY_STATUS_REVISION
      )
      .collectAsync();

    expect(events.length).toBeGreaterThan(0);
    expect(
      events.find((event) =>
        isEventType(event, LoreEventTag.REPOSITORY_STATUS_REVISION)
      )?.data.branchName
    ).toBe("main");
  });

  test("callback should work", async () => {
    await stageRandomFile();
    await commit();

    const events: LoreRevisionHistoryEntryEvent[] = [];
    let revisionNumber = -1;
    await lore
      .revisionHistory(globalArgs, {})
      .callback((event) => {
        if (event.tag === LoreEventTag.REVISION_HISTORY_ENTRY) {
          revisionNumber = event.data.revisionNumber;
          events.push(event.clone());
        }
      })
      .waitAsync();

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].data.revisionNumber).toBe(1);
    expect(revisionNumber).toBe(1);
  });

  test("stringDecodeMode(LAZY) should make string values inaccessible outside the callback", async () => {
    await stageRandomFile();
    await commit();

    const statusEvents: LoreEventFFITyped<LoreEventTag.REPOSITORY_STATUS_REVISION>[] =
      [];
    await lore
      .repositoryStatus(globalArgs, { scan: true })
      .filterByType(LoreEventTag.REPOSITORY_STATUS_REVISION)
      .stringDecodeMode(LoreJSStringDecodeMode.LAZY)
      .callback((event) => {
        if (event.tag === LoreEventTag.REPOSITORY_STATUS_REVISION) {
          // Touch the event payload but NOT the lazily decoded branchName
          // string. The backing FFI string pointer is only valid for the
          // duration of the callback, so the string is never realized in JS
          // land.
          void event.data;
          statusEvents.push(event);
        }
      })
      .waitAsync();

    // With LAZY decoding the FFI string pointer is freed once the callback
    // returns, so branchName can no longer be decoded to "main" outside it.
    // (With the DEFAULT eager mode this would read back as "main".)
    expect(statusEvents.length).toBeGreaterThan(0);
    expect(statusEvents[0]?.data.branchName).not.toBe("main");
  });

  test("callback with filter should work", async () => {
    await stageRandomFile();
    await commit();

    const events: LoreRevisionHistoryEntryEvent[] = [];
    await lore
      .revisionHistory(globalArgs, {})
      .filterByType(LoreEventTag.REVISION_HISTORY_ENTRY)
      .callback((event) => {
        if (event.tag === LoreEventTag.REVISION_HISTORY_ENTRY) {
          events.push(event.clone());
        }
      })
      .waitAsync();

    expect(events.length).toBe(1);
    expect(events[0].data.revisionNumber).toBe(1);
  });

  test("async iterator with filter should work", async () => {
    await stageRandomFile();
    await commit();

    const events: LoreEvent[] = [];

    // async iterator
    for await (const event of lore
      .revisionHistory(globalArgs, {})
      .filterByType(LoreEventTag.REVISION_HISTORY_ENTRY)
      .asyncIter()) {
      events.push(event);
    }
    expect(events.length).toBe(1);
    expect(
      events.find((event) =>
        isEventType(event, LoreEventTag.REVISION_HISTORY_ENTRY)
      )?.data.revisionNumber
    ).toBe(1);
  });

  test("breaking out of asynciterator should work", async () => {
    await stageRandomFile();
    await commit();

    let count = 0;

    // async iterator break
    for await (const event of lore
      .repositoryStatus(globalArgs, {})
      .asyncIter()) {
      count++;
      break;
    }
    expect(count).toBe(1);

    count = 0;
    // async iterator throw
    try {
      for await (const event of lore
        .repositoryStatus(globalArgs, {})
        .asyncIter()) {
        count++;
        throw new Error("bail out");
      }
    } catch {}
    expect(count).toBe(1);
  });

  test("nonzero return code should throw an error in collectAsync", async () => {
    await stageRandomFile();
    await commit();

    await expect(
      lore
        .repositoryClone(globalArgs, { repositoryUrl: "invalid" })
        .collectAsync()
    ).rejects.toThrowError("Invalid repository URL");
  });

  test("nonzero return code should throw an error in waitAsync", async () => {
    await stageRandomFile();
    await commit();

    const events = [];
    await expect(
      lore
        .repositoryClone(globalArgs, { repositoryUrl: "invalid" })
        .callback((event) => {
          events.push(event.clone());
        })
        .waitAsync()
    ).rejects.toThrowError("Invalid repository URL");
  });

  test("nonzero return code should throw an error in asyncIter", async () => {
    await stageRandomFile();
    await commit();

    const events = [];

    // async iterator
    await expect(async () => {
      for await (const event of lore
        .repositoryClone(globalArgs, { repositoryUrl: "invalid" })
        .asyncIter()) {
        events.push(event);
      }
    }).rejects.toThrowError("Invalid repository URL");
  });

  test("calls should emit both COMPLETE and END events", async () => {
    await stageRandomFile();
    await commit();

    // callback + waitAsync
    const callbackEvents: LoreEvent[] = [];
    await lore
      .revisionHistory(globalArgs, {})
      .filterByType(LoreEventTag.COMPLETE, LoreEventTag.END)
      .callback((event) => {
        callbackEvents.push(event.clone());
      })
      .waitAsync();

    expect(
      callbackEvents.find((event) => event.tag === LoreEventTag.COMPLETE)
    ).toBeDefined();
    expect(
      callbackEvents.find((event) => event.tag === LoreEventTag.END)
    ).toBeDefined();

    // collectAsync
    const collectEvents = await lore
      .revisionHistory(globalArgs, {})
      .filterByType(LoreEventTag.COMPLETE, LoreEventTag.END)
      .collectAsync();

    expect(
      collectEvents.find((event) => event.tag === LoreEventTag.COMPLETE)
    ).toBeDefined();
    expect(
      collectEvents.find((event) => event.tag === LoreEventTag.END)
    ).toBeDefined();

    // asyncIter
    const asyncIterEvents: LoreEvent[] = [];
    for await (const event of lore
      .revisionHistory(globalArgs, {})
      .filterByType(LoreEventTag.COMPLETE, LoreEventTag.END)
      .asyncIter()) {
      asyncIterEvents.push(event);
    }

    expect(
      asyncIterEvents.find((event) => event.tag === LoreEventTag.COMPLETE)
    ).toBeDefined();
    expect(
      asyncIterEvents.find((event) => event.tag === LoreEventTag.END)
    ).toBeDefined();
  });

  test("userContext should set the callback userContext", async () => {
    await stageRandomFile();
    await commit();

    const userContexts: number[] = [];
    await lore
      .revisionHistory(globalArgs, {})
      .userContext(12345)
      .callback((event) => {
        if (event.tag === LoreEventTag.REVISION_HISTORY_ENTRY) {
          userContexts.push(event.userContext);
        }
      })
      .waitAsync();

    expect(userContexts.length).toBeGreaterThan(0);
    expect(userContexts[0]).toBe(12345);
  });

  test("Should be able to call waitAsync without a callback", async () => {
    await stageRandomFile();
    await commit();

    const res = await lore.revisionHistory(globalArgs, {}).waitAsync();

    expect(res).toBe(0);
  });

  test("Should throw if trying to call a config method after start", async () => {
    await stageRandomFile();
    await commit();

    const handle = lore.revisionHistory(globalArgs, {});
    const res = await handle.waitAsync();

    expect(res).toBe(0);

    expect(() => handle.callback(() => {})).toThrowError("Already started");
  });

  test("Should support subscribing and unsubscribing a global log event listener", async () => {
    let debugMessageCount = 0;

    const unsubscribe = lore.globalCallback(LoreEventTag.LOG, (event) => {
      if (event.data.level === LoreLogLevel.DEBUG) {
        debugMessageCount += 1;
      }
    });

    await stageRandomFile();
    expect(debugMessageCount).toBeGreaterThan(0);

    const messageCountAfterFirstCall = debugMessageCount;
    await stageRandomFile();
    expect(debugMessageCount).toBeGreaterThan(messageCountAfterFirstCall);

    const messageCountAfterSecondCall = debugMessageCount;
    unsubscribe();
    await stageRandomFile();
    expect(debugMessageCount).toBe(messageCountAfterSecondCall);
  });

  test("cold handle should not execute until waitAsync is called", async () => {
    await stageRandomFile();
    await commit();

    const callbackEvents: LoreEvent[] = [];
    const handle = lore.revisionHistory(globalArgs, {}).callback((event) => {
      callbackEvents.push(event.clone());
    });

    expect(callbackEvents.length).toBe(0);

    await handle.waitAsync();
    expect(callbackEvents.length).toBeGreaterThan(0);
  });

  test("method chaining should work", async () => {
    await stageRandomFile();
    await commit();

    const userContextValues: number[] = [];
    const res = await lore
      .revisionHistory(globalArgs, {})
      .callback((event) => {
        userContextValues.push(event.userContext);
      })
      .filterByType(LoreEventTag.COMPLETE, LoreEventTag.END)
      .userContext(42)
      .waitAsync();

    expect(res).toBe(0);
    expect(userContextValues.every((ctx) => ctx === 42)).toBe(true);
  });

  test("double waitAsync should throw", async () => {
    await stageRandomFile();
    await commit();

    const handle = lore.revisionHistory(globalArgs, {});
    await handle.waitAsync();

    await expect(handle.waitAsync()).rejects.toThrowError("Already started");
  });

  test("double collectAsync should throw", async () => {
    await stageRandomFile();
    await commit();

    const handle = lore.revisionHistory(globalArgs, {});
    await handle.collectAsync();

    await expect(handle.collectAsync()).rejects.toThrowError("Already started");
  });

  test("waitAsync then collectAsync should throw", async () => {
    await stageRandomFile();
    await commit();

    const handle = lore.revisionHistory(globalArgs, {});
    await handle.waitAsync();

    await expect(handle.collectAsync()).rejects.toThrowError("Already started");
  });

  test("double asyncIter should throw", async () => {
    await stageRandomFile();
    await commit();

    const handle = lore.revisionHistory(globalArgs, {});
    for await (const _event of handle.asyncIter()) {
      // consume
    }

    await expect(async () => {
      for await (const _event of handle.asyncIter()) {
        // should not reach here
      }
    }).rejects.toThrowError("Already started");
  });

  test("waitAsync then asyncIter should throw", async () => {
    await stageRandomFile();
    await commit();

    const handle = lore.revisionHistory(globalArgs, {});
    await handle.waitAsync();

    await expect(async () => {
      for await (const _event of handle.asyncIter()) {
        // should not reach here
      }
    }).rejects.toThrowError("Already started");
  });

  test("asyncIter then waitAsync should throw", async () => {
    await stageRandomFile();
    await commit();

    const handle = lore.revisionHistory(globalArgs, {});
    for await (const _event of handle.asyncIter()) {
      // consume
    }

    await expect(handle.waitAsync()).rejects.toThrowError("Already started");
  });

  test("multiple global callbacks for same event type should work", async () => {
    const eventsA: boolean[] = [];
    const eventsB: boolean[] = [];

    const unsubA = lore.globalCallback(LoreEventTag.LOG, () => {
      eventsA.push(true);
    });
    const unsubB = lore.globalCallback(LoreEventTag.LOG, () => {
      eventsB.push(true);
    });

    await stageRandomFile();

    expect(eventsA.length).toBeGreaterThan(0);
    expect(eventsB.length).toBeGreaterThan(0);
    expect(eventsA.length).toBe(eventsB.length);

    unsubA();
    unsubB();
  });

  test("global callback should fire regardless of per-call filter", async () => {
    const logEvents: boolean[] = [];

    const unsub = lore.globalCallback(LoreEventTag.LOG, () => {
      logEvents.push(true);
    });

    await stageRandomFile();
    await commit();

    await lore
      .revisionHistory(globalArgs, {})
      .filterByType(LoreEventTag.COMPLETE)
      .waitAsync();

    expect(logEvents.length).toBeGreaterThan(0);

    unsub();
  });

  test("collectAsync with filter should only return filtered events", async () => {
    await stageRandomFile();
    await commit();

    const events = await lore
      .revisionHistory(globalArgs, {})
      .filterByType(LoreEventTag.COMPLETE, LoreEventTag.END)
      .collectAsync();

    expect(events.length).toBe(2);
    expect(events.find((e) => e.tag === LoreEventTag.COMPLETE)).toBeDefined();
    expect(events.find((e) => e.tag === LoreEventTag.END)).toBeDefined();
  });

  test("collectAsync event data should be accessible outside callback", async () => {
    await stageRandomFile();
    await commit();

    const events = await lore.revisionHistory(globalArgs, {}).collectAsync();

    const completeEvents = events.filter(
      (e) => e.tag === LoreEventTag.COMPLETE
    );
    expect(completeEvents.length).toBe(1);

    const endEvents = events.filter((e) => e.tag === LoreEventTag.END);
    expect(endEvents.length).toBe(1);
  });

  test("asyncIter event data should be accessible outside iteration", async () => {
    await stageRandomFile();
    await commit();

    const events: LoreEvent[] = [];
    for await (const event of lore
      .revisionHistory(globalArgs, {})
      .asyncIter()) {
      events.push(event);
    }

    const completeEvents = events.filter(
      (e) => e.tag === LoreEventTag.COMPLETE
    );
    expect(completeEvents.length).toBe(1);

    const endEvents = events.filter((e) => e.tag === LoreEventTag.END);
    expect(endEvents.length).toBe(1);
  });

  test(
    "multiple parallel repository creates should work",
    { timeout: 30000 },
    async () => {
      const numCalls = 20;
      const promises: Promise<number>[] = [];

      for (let i = 0; i < numCalls; i++) {
        const repoPath = createTempDir();
        const repoArgs: LoreGlobalArgs = {
          offline: true,
          correlationId: "test-parallel-" + i,
          repositoryPath: repoPath,
        };
        promises.push(
          lore
            .repositoryCreate(repoArgs, { repositoryUrl: randomUUID() })
            .waitAsync()
            .then(async (res) => {
              await lore.repositoryFlush({}, {}).waitAsync();
              cleanTempDir(repoPath);
              return res;
            })
        );
      }

      const results = await Promise.all(promises);
      expect(results.length).toBe(numCalls);
      expect(results.every((r) => r === 0)).toBe(true);
    }
  );

  test(
    "multiple parallel repository creates with commits should work",
    { timeout: 30000 },
    async () => {
      const numCalls = 20;
      const tempDirs: string[] = [];

      const promises = Array.from({ length: numCalls }, async (_, i) => {
        const repoPath = createTempDir();
        tempDirs.push(repoPath);
        const repoArgs: LoreGlobalArgs = {
          offline: true,
          correlationId: "test-parallel-" + i,
          repositoryPath: repoPath,
        };
        lore;
        const createRes = await lore
          .repositoryCreate(repoArgs, {
            repositoryUrl: `lore://lore-test-server/${randomUUID()}`,
          })
          .waitAsync();
        expect(createRes).toBe(0);

        const testFilePath = path.join(repoPath, randomUUID() + ".txt");
        fs.writeFileSync(testFilePath, randomUUID());

        const stageRes = await lore
          .fileStage(repoArgs, { paths: [testFilePath] })
          .waitAsync();
        expect(stageRes).toBe(0);

        const commitEvents: LoreRevisionCommitRevisionEvent[] = (await lore
          .revisionCommit(repoArgs, { message: "test-parallel-" + i })
          .filterByType(LoreEventTag.REVISION_COMMIT_REVISION)
          .collectAsync()) as LoreRevisionCommitRevisionEvent[];
        expect(commitEvents.length).toBe(1);
        expect(commitEvents[0].data.revision.length).toBe(64);

        return createRes;
      });

      const results = await Promise.allSettled(promises);
      const succeededResults = results.filter(
        (result) => result.status === "fulfilled" && result.value === 0
      );
      expect(succeededResults.length).toBe(numCalls);

      for (const tempDir of tempDirs) {
        await lore.repositoryFlush({ repositoryPath: tempDir }, {}).waitAsync();
        cleanTempDir(tempDir);
      }
    }
  );
});
