// Copyright Epic Games, Inc. All Rights Reserved.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";

import {
  expect,
  test,
  describe,
  beforeEach,
  afterEach,
  beforeAll,
} from "vitest";
import { lore } from "@lore-vcs/sdk/native";
import { randomUUID } from "crypto";
import {
  LoreEventTag,
  LoreFileAction,
  LoreLogLevel,
  LoreMetadataTag,
  LoreMetadataType,
} from "@lore-vcs/sdk/types/enums";
import {
  isEventType,
  LoreBranchDiffChangeEvent,
  LoreBranchListEntryEvent,
  LoreEvent,
  LoreFileStageEndEvent,
  LoreMetadataEvent,
  LoreRepositoryStatusFileEvent,
  LoreRepositoryStatusRevisionEvent,
  LoreRevisionCommitEndEvent,
  LoreRevisionCommitRevisionEvent,
  LoreRevisionDiffFileEvent,
  LoreEventFFITyped,
  parseLoreEventJSON,
  LoreEventFFI,
  LoreRevisionHistoryEntryEvent,
  LoreFileInfoEvent,
  LoreRevisionInfoEvent,
  LoreRevisionInfoDeltaEvent,
  LoreBranchInfoEvent,
  LoreFileHistoryEvent,
  LoreBranchMergeConflictFileEvent,
  LoreFileStageFileEvent,
  LoreFileDiffEvent,
  LoreRevisionFindEvent,
  LoreSharedStoreCreateEvent,
  LoreSharedStoreInfoEvent,
  LoreRepositoryCreateEvent,
} from "@lore-vcs/sdk/types/events";
import {
  LoreAddress,
  LoreBranchIdBinary,
  LoreBranchPointArray,
  LoreContextBinary,
  LoreFnResponseCode,
  LoreHashBinary,
  LoreMetadata,
  LoreRepositoryIdBinary,
  LoreStore,
} from "@lore-vcs/sdk/types";
import {
  LoreGlobalArgs,
  LoreRepositoryStatusArgs,
} from "@lore-vcs/sdk/types/args";
import { fail } from "assert";
import { cleanTempDir, createTempDir } from "./temp-dir";

describe("lore-js-sdk", () => {
  let repositoryPath: string;

  let globalArgs: LoreGlobalArgs;

  const createErrorHandler = () => {
    const logs: string[] = [];
    const gatherLogs = (event: LoreEventFFI) => {
      if (
        event.tag === LoreEventTag.LOG &&
        event.data.level >= LoreLogLevel.DEBUG
      ) {
        logs.push(event.data.message);
      }
    };
    const printLogsIfLoreCallFailed = (status: number) => {
      if (status !== 0) {
        console.error("Lore call failed. Lore logs:");
        console.error(logs.join("\n"));
      }
    };
    return { gatherLogs, printLogsIfLoreCallFailed };
  };

  const stageRandomFile = async () => {
    const testFilePath = path.join(repositoryPath, randomUUID() + ".txt");
    const testFileContents = randomUUID();
    fs.writeFileSync(testFilePath, testFileContents);

    const stageEndEvents: LoreFileStageEndEvent[] = [];
    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();

    const stageRes = await lore.fileStage(
      globalArgs,
      {
        paths: [testFilePath],
      },
      {
        userContext: 1,
        callback: (event) => {
          if (event.tag === LoreEventTag.FILE_STAGE_END) {
            stageEndEvents.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(stageRes);

    return {
      testFilePath,
      stageRes,
      stageEndEvent: stageEndEvents[0],
      testFileContents,
    };
  };

  const commit = async () => {
    const commitRevisionEvents: LoreRevisionCommitRevisionEvent[] = [];
    const commitEndEvents: LoreRevisionCommitEndEvent[] = [];
    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();

    const commitRes = await lore.revisionCommit(
      globalArgs,
      {
        message: "test",
      },
      {
        userContext: 1,
        callback: (event) => {
          if (event.tag === LoreEventTag.REVISION_COMMIT_END) {
            commitEndEvents.push(event.clone());
          } else if (event.tag === LoreEventTag.REVISION_COMMIT_REVISION) {
            commitRevisionEvents.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(commitRes);

    return {
      commitRes,
      commitEndEvent: commitEndEvents[0],
      commitRevisionEvent: commitRevisionEvents[0],
    };
  };

  const status = async () => {
    const statusRevisionEvents: LoreRepositoryStatusRevisionEvent[] = [];
    const statusFileEvents: LoreRepositoryStatusFileEvent[] = [];
    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    const statusRes = await lore.repositoryStatus(
      globalArgs,
      {
        staged: true,
        scan: true,
        unstaged: true,
      } as LoreRepositoryStatusArgs,
      {
        userContext: 1,
        callback: (event) => {
          if (event.tag === LoreEventTag.REPOSITORY_STATUS_REVISION) {
            statusRevisionEvents.push(event.clone());
          } else if (event.tag === LoreEventTag.REPOSITORY_STATUS_FILE) {
            statusFileEvents.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(statusRes);
    return {
      statusRes,
      statusRevisionEvent: statusRevisionEvents[0],
      statusFileEvents,
    };
  };

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
    await lore.repositoryCreate(
      globalArgs,
      { repositoryUrl: randomUUID() },
      {
        userContext: 1,
        callback: () => {},
      }
    );
  });

  afterEach(async () => {
    await lore.repositoryFlush(globalArgs, {}, { callback: () => {} });
    cleanTempDir(repositoryPath);
  });

  test("repositoryStatus should work", async () => {
    await stageRandomFile();
    const { statusRes, statusFileEvents } = await status();
    expect(statusRes).toBe(0);
    expect(statusFileEvents.length).toBe(1);
    expect(statusFileEvents[0].data.flagStaged).toBe(true);
  });

  test("fileStage and revisionCommit should work", async () => {
    const { stageRes, stageEndEvent } = await stageRandomFile();

    expect(stageRes).toBe(0);
    expect(stageEndEvent?.data.count?.fileAddCount).toBe(1);

    const { commitRes, commitEndEvent } = await commit();

    expect(commitRes).toBe(0);
    expect(commitEndEvent?.data.count?.fileCount).toBe(1);
  });

  test("fileUnstage should work", async () => {
    const { testFilePath } = await stageRandomFile();

    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    const unstageRes = await lore.fileUnstage(
      globalArgs,
      {
        paths: [testFilePath],
      },
      {
        callback: gatherLogs,
      }
    );
    printLogsIfLoreCallFailed(unstageRes);
    expect(unstageRes).toBe(0);

    const { statusRes, statusFileEvents } = await status();
    expect(statusRes).toBe(0);
    expect(statusFileEvents.length).toBe(1);
    expect(statusFileEvents[0].data.flagStaged).toBe(false);
  });

  test("revisionList should work", async () => {
    await stageRandomFile();
    const { commitRevisionEvent } = await commit();
    await stageRandomFile();
    await commit();

    const revisionEvents: LoreRevisionHistoryEntryEvent[] = [];

    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    const statusRes = await lore.revisionHistory(
      globalArgs,
      {},
      {
        userContext: 1,
        callback: (event) => {
          if (event.tag === LoreEventTag.REVISION_HISTORY_ENTRY) {
            revisionEvents.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(statusRes);
    expect(statusRes).toBe(0);
    expect(revisionEvents.length).toBe(2);
    expect(revisionEvents[0].data.revisionNumber).toBe(2);
    expect(revisionEvents[0].data.parent.length).toBe(2);
    expect(revisionEvents[0].data.parent[0]).toBe(
      commitRevisionEvent.data.revision
    );
  });

  test(
    "branchCreate, branchSwitch, branchList, branchDiff and branchDelete should work",
    { timeout: 15000 },
    async () => {
      await stageRandomFile();
      await commit();

      const testBranchName = "test-branch";

      let createdBranchName = "";
      const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
      const createRes = await lore.branchCreate(
        globalArgs,
        {
          branch: testBranchName,
        },
        {
          userContext: 1,
          callback: (event) => {
            if (event.tag === LoreEventTag.BRANCH_CREATE) {
              createdBranchName = event.data.name;
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(createRes);
      expect(createRes).toBe(0);
      expect(createdBranchName).toBe(testBranchName);

      const { testFilePath } = await stageRandomFile();
      await commit();

      const branchDiffChanges: LoreBranchDiffChangeEvent[] = [];
      const branchDiffRes = await lore.branchDiff(
        globalArgs,
        {
          target: "main",
        },
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.BRANCH_DIFF_CHANGE) {
              branchDiffChanges.push(event.clone());
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(branchDiffRes);
      expect(branchDiffRes).toBe(0);
      expect(branchDiffChanges.length).toBe(1);
      expect(
        testFilePath.endsWith(branchDiffChanges[0].data.change.path)
      ).toBeTruthy();
      expect(branchDiffChanges[0].data.change.action).toBe(LoreFileAction.ADD);

      let switchedBranchName = "";
      const switchRes = await lore.branchSwitch(
        globalArgs,
        {
          branch: "main",
        },
        {
          userContext: 1,
          callback: (event) => {
            if (event.tag === LoreEventTag.BRANCH_SWITCH_END) {
              switchedBranchName = event.data.branch.name;
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(switchRes);
      expect(switchRes).toBe(0);
      expect(switchedBranchName).toBe("main");

      expect(
        fs.existsSync(testFilePath),
        "file committed to branch should be removed when switching back to main"
      ).toBe(false);

      const branches: LoreBranchListEntryEvent[] = [];
      const listRes = await lore.branchList(
        globalArgs,
        {},
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.BRANCH_LIST_ENTRY) {
              branches.push(event.clone());
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(listRes);
      const mainBranchEvent = branches.find(
        (event) => event.data.name === "main"
      );
      const testBranchEvent = branches.find(
        (event) => event.data.name === testBranchName
      );

      expect(listRes).toBe(0);
      expect(branches.length).toBe(2);
      expect(mainBranchEvent?.data.stack.length).toBe(0);
      expect(testBranchEvent?.data.stack.length).toBe(1);
      expect(testBranchEvent?.data.stack[0].branch).toBeDefined();
      expect(testBranchEvent?.data.stack[0].branch.length).toBe(32);
      expect(testBranchEvent?.data.stack[0].revision).toBeDefined();

      // branch switch with branch ID received from Lore library (parent id of the created branch === main)
      const switchWithBranchIdRes = await lore.branchSwitch(
        globalArgs,
        {
          branch: branches.find((event) => event.data.name === testBranchName)
            ?.data.stack[0].branch,
        },
        {
          userContext: 1,
          callback: (event) => {
            if (event.tag === LoreEventTag.BRANCH_SWITCH_END) {
              switchedBranchName = event.data.branch.name;
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(switchWithBranchIdRes);
      expect(switchWithBranchIdRes).toBe(0);
      expect(switchedBranchName).toBe("main");

      const deleteRes = await lore.branchDelete(
        globalArgs,
        {
          branch: testBranchName,
        },
        {
          userContext: 1,
          callback: gatherLogs,
        }
      );
      printLogsIfLoreCallFailed(deleteRes);
      expect(deleteRes).toBe(0);

      const switchRes2 = await lore.branchSwitch(
        globalArgs,
        {
          branch: testBranchName,
        },
        {
          userContext: 1,
          callback: () => {},
        }
      );
      expect(
        switchRes2,
        "branch switch should fail after branch deletion"
      ).toBe(1);
    }
  );

  test("fileDescribe should work", async () => {
    const { testFilePath } = await stageRandomFile();
    await commit();

    const fileDescribeEvents: LoreFileInfoEvent[] = [];

    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    const statusRes = await lore.fileInfo(
      globalArgs,
      {
        paths: [testFilePath],
      },
      {
        userContext: 1,
        callback: (event) => {
          if (event.tag === LoreEventTag.FILE_INFO) {
            fileDescribeEvents.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(statusRes);
    expect(statusRes).toBe(0);
    expect(fileDescribeEvents[0]?.data.isFile).toBe(true);
  });

  test("revisionDescribe should work", async () => {
    await stageRandomFile();
    await commit();

    const describeEvents: LoreRevisionInfoEvent[] = [];
    const deltaEvents: LoreRevisionInfoDeltaEvent[] = [];

    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    const statusRes = await lore.revisionInfo(
      globalArgs,
      {
        delta: true,
      },
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.REVISION_INFO) {
            describeEvents.push(event.clone());
          } else if (event.tag === LoreEventTag.REVISION_INFO_DELTA) {
            deltaEvents.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(statusRes);
    expect(statusRes).toBe(0);
    expect(describeEvents[0]?.data.revisionNumber).toBe(1);
    expect(deltaEvents.length).toBe(1);
    expect(deltaEvents[0]?.data.action).toBe(LoreFileAction.ADD);
  });

  test("revisionMetadataSet and revisionMetadataList should work", async () => {
    const beforeTestTimeStamp = Date.now() - 1000; // with some margin

    const { testFilePath } = await stageRandomFile();

    const metadataEvents: LoreMetadataEvent[] = [];

    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    const statusRes = await lore.revisionMetadataSet(
      globalArgs,
      {
        keys: ["meta-string", "meta-binary", "empty-string"],
        values: ["string value", testFilePath, ""],
        formats: [
          LoreMetadataType.STRING,
          LoreMetadataType.BINARY,
          LoreMetadataType.STRING,
        ],
      },
      {
        userContext: 1,
        callback: (event) => {
          if (event.tag === LoreEventTag.METADATA) {
            metadataEvents.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );

    printLogsIfLoreCallFailed(statusRes);
    expect(statusRes).toBe(0);
    expect(metadataEvents.length).toBe(3);

    await commit();

    const metadataListEvents: LoreMetadataEvent[] = [];

    const listRes = await lore.revisionMetadataList(
      globalArgs,
      {},
      {
        userContext: 1,
        callback: (event) => {
          if (event.tag === LoreEventTag.METADATA) {
            metadataListEvents.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(listRes);
    expect(listRes).toBe(0);
    const customStringMetadataEvent = metadataListEvents.find(
      (event) => event.data.key === "meta-string"
    );
    const customBinaryMetadataEvent = metadataListEvents.find(
      (event) => event.data.key === "meta-binary"
    );
    const customEmptyStringMetadataEvent = metadataListEvents.find(
      (event) => event.data.key === "empty-string"
    );
    const branchMetadataEvent = metadataListEvents.find(
      (event) => event.data.key === "branch"
    );
    const timestampMetadataEvent = metadataListEvents.find(
      (event) => event.data.key === "timestamp"
    );
    const messageMetadataEvent = metadataListEvents.find(
      (event) => event.data.key === "message"
    );

    if (customStringMetadataEvent?.data.value.tag !== LoreMetadataTag.STRING) {
      fail("Expect string tag");
    }
    if (
      customEmptyStringMetadataEvent?.data.value.tag !== LoreMetadataTag.STRING
    ) {
      fail("Expect string tag");
    }
    if (customBinaryMetadataEvent?.data.value.tag !== LoreMetadataTag.ADDRESS) {
      fail("Expect address tag");
    }
    if (branchMetadataEvent?.data.value.tag !== LoreMetadataTag.CONTEXT) {
      fail("Expect context tag");
    }
    if (timestampMetadataEvent?.data.value.tag !== LoreMetadataTag.NUMERIC) {
      fail("Expect numeric tag");
    }
    if (messageMetadataEvent?.data.value.tag !== LoreMetadataTag.STRING) {
      fail("Expect string tag");
    }

    expect(customStringMetadataEvent?.data.value.data).toBe("string value");
    expect(customEmptyStringMetadataEvent?.data.value.data).toBe("");
    expect(customBinaryMetadataEvent?.data.value.data).toBeDefined();
    expect(customBinaryMetadataEvent?.data.value.data.hash.length).toBe(64);
    expect(customBinaryMetadataEvent?.data.value.data.context.length).toBe(32);
    expect(branchMetadataEvent?.data.value.data).toBeDefined();
    expect(branchMetadataEvent?.data.value.data.length).toBe(32);
    expect(timestampMetadataEvent?.data.value.data).toBeGreaterThan(
      beforeTestTimeStamp
    );
    expect(messageMetadataEvent?.data.value.data).toBe("test");
  });

  test("branchDescribe should work", async () => {
    const branchDescribeEvents: LoreBranchInfoEvent[] = [];

    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    const statusRes = await lore.branchInfo(
      globalArgs,
      {},
      {
        userContext: 1,
        callback: (event) => {
          if (event.tag === LoreEventTag.BRANCH_INFO) {
            branchDescribeEvents.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(statusRes);
    expect(statusRes).toBe(0);
    expect(branchDescribeEvents[0]?.data.name).toBe("main");
  });

  test("branchMerge should work", { timeout: 15000 }, async () => {
    const { testFilePath } = await stageRandomFile();
    await commit();

    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    // create a new branch and switch to it
    const testBranchName = "test-branch";
    await lore.branchCreate(
      globalArgs,
      {
        branch: testBranchName,
      },
      {
        callback: () => {},
      }
    );

    // overwrite the original content with new content in test-branch
    fs.writeFileSync(testFilePath, randomUUID());
    await lore.fileStage(
      globalArgs,
      {
        paths: [testFilePath],
      },
      {
        userContext: 1,
        callback: () => {},
      }
    );
    await commit();

    // switch back to main
    await lore.branchSwitch(
      globalArgs,
      {
        branch: "main",
      },
      {
        callback: () => {},
      }
    );

    // overwrite the original content with conflicting content in main
    fs.writeFileSync(testFilePath, randomUUID());
    await lore.fileStage(
      globalArgs,
      {
        paths: [testFilePath],
      },
      {
        userContext: 1,
        callback: () => {},
      }
    );
    await commit();

    // merge test-branch to main, expecting a conflict
    const conflicts: LoreBranchMergeConflictFileEvent[] = [];
    const mergeRes = await lore.branchMergeStart(
      globalArgs,
      { branch: testBranchName },
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.BRANCH_MERGE_CONFLICT_FILE) {
            conflicts.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(mergeRes);
    expect(mergeRes).toBe(0);
    expect(conflicts.length).toBe(1);
    expect(testFilePath.endsWith(conflicts[0].data.path)).toBeTruthy();

    // resolve mine
    const stagedFiles = [];
    const resolveRes = await lore.branchMergeResolveMine(
      globalArgs,
      { paths: [testFilePath] },
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.FILE_STAGE_FILE) {
            stagedFiles.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(resolveRes);
    expect(resolveRes).toBe(0);
    expect(stagedFiles.length).toBe(1);

    expect((await commit()).commitRes).toBe(0);
  });

  test("revisionDiff should work", async () => {
    const { testFilePath } = await stageRandomFile();
    const { commitRevisionEvent } = await commit();

    // stage a new file and modify an existing file
    await stageRandomFile();
    fs.writeFileSync(testFilePath, randomUUID());
    await lore.fileStage(
      globalArgs,
      {
        paths: [testFilePath],
      },
      {
        callback: () => {},
      }
    );
    await commit();

    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    // revision diff
    const diffEvents: LoreRevisionDiffFileEvent[] = [];
    const statusRes = await lore.revisionDiff(
      globalArgs,
      {
        revisionSource: commitRevisionEvent.data.revision,
      },
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.REVISION_DIFF_FILE) {
            diffEvents.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(statusRes);
    expect(statusRes).toBe(0);
    expect(diffEvents.length).toBe(2);
    expect(
      diffEvents.find((change) => change.data.action === LoreFileAction.ADD)
    ).toBeDefined();
    expect(
      diffEvents.find((change) => change.data.action === LoreFileAction.KEEP)
    ).toBeDefined();
  });

  test("fileWrite should work", async () => {
    const { testFilePath, testFileContents } = await stageRandomFile();
    const { commitRevisionEvent } = await commit();

    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    // create a new commit that overwrites the existing file contents
    fs.writeFileSync(testFilePath, randomUUID());
    await lore.fileStage(
      globalArgs,
      {
        paths: [testFilePath],
      },
      {
        callback: () => {},
      }
    );
    await commit();

    // use file write to fetch the original contenst of the previous commit
    const outputFilePath = testFilePath + ".old";
    const statusRes = await lore.fileWrite(
      globalArgs,
      {
        path: testFilePath,
        output: outputFilePath,
        revision: commitRevisionEvent.data.revision,
      },
      {
        callback: gatherLogs,
      }
    );
    printLogsIfLoreCallFailed(statusRes);
    expect(statusRes).toBe(0);
    expect(fs.readFileSync(outputFilePath, { encoding: "utf-8" })).toBe(
      testFileContents
    );
  });

  test("fileLog should work", async () => {
    const { testFilePath } = await stageRandomFile();
    const { commitRevisionEvent: initialCommit } = await commit();

    // create another commit that adds a separate file but does not modify the original file
    await stageRandomFile();
    const { commitRevisionEvent: secondCommit } = await commit();

    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    // create a third commit that modifies the file from the initial commit
    fs.writeFileSync(testFilePath, randomUUID());
    await lore.fileStage(
      globalArgs,
      {
        paths: [testFilePath],
      },
      {
        callback: () => {},
      }
    );
    const { commitRevisionEvent: thirdCommit } = await commit();

    // use file log to fetch the commits that touched the test file
    const logEvents: LoreFileHistoryEvent[] = [];
    const statusRes = await lore.fileHistory(
      globalArgs,
      {
        path: testFilePath,
      },
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.FILE_HISTORY) {
            logEvents.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(statusRes);
    expect(statusRes).toBe(0);
    expect(logEvents.length).toBe(2);
    expect(
      logEvents.find(
        (logEvent) => logEvent.data.revision === initialCommit.data.revision
      )
    ).toBeDefined();
    expect(
      logEvents.find(
        (logEvent) => logEvent.data.revision === thirdCommit.data.revision
      )
    ).toBeDefined();
    expect(
      logEvents.find(
        (logEvent) => logEvent.data.revision === secondCommit.data.revision
      )
    ).not.toBeDefined();
  });

  describe("array types in events", () => {
    test("lore_branch_point_array_t should work", async () => {
      await stageRandomFile();
      await commit();
      await lore.branchCreate(
        globalArgs,
        { branch: "feature" },
        { callback: () => {} }
      );
      const events: LoreBranchListEntryEvent[] = [];

      await lore.branchList(
        globalArgs,
        {},
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.BRANCH_LIST_ENTRY) {
              events.push(event.clone());
            }
          },
        }
      );

      expect(events.length).toBe(2);
      expect(
        events.find((ev) => ev.data.name === "feature")?.data.stack.length
      ).toBe(1);
    });
  });

  describe("type guards", () => {
    test("should work with both SDK and Serde JSON types", async () => {
      const logEventSDK: LoreEvent = {
        tag: LoreEventTag.LOG,
        tagName: "log",
        userContext: 0,
        data: {
          level: LoreLogLevel.NONE,
          category: 0,
          timestamp: 0,
          location: "",
          message: "",
        },
      };

      const logEventJSON: LoreEvent = {
        tag: undefined as unknown as LoreEventTag.LOG,
        tagName: "log",
        data: {
          level: LoreLogLevel.NONE,
          category: 0,
          timestamp: 0,
          location: "",
          message: "",
        },
      };

      expect(isEventType(logEventSDK, LoreEventTag.LOG)).toBe(true);
      expect(isEventType(logEventJSON, LoreEventTag.LOG)).toBe(true);
      expect(isEventType(logEventSDK, LoreEventTag.ERROR)).toBe(false);
      expect(isEventType(logEventJSON, LoreEventTag.ERROR)).toBe(false);
    });
  });

  describe("LoreEventFFI", () => {
    test("should have access to binary Hash, RepositoryId and BranchId values inside a callback", async () => {
      await stageRandomFile();
      let branch: LoreBranchIdBinary | undefined;
      let repository: LoreRepositoryIdBinary | undefined;
      let revision: LoreHashBinary | undefined;
      const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
      const statusRes = await lore.repositoryStatus(
        globalArgs,
        {
          staged: true,
          scan: true,
          unstaged: true,
        } as LoreRepositoryStatusArgs,
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.REPOSITORY_STATUS_REVISION) {
              branch = event.data.branch;
              repository = event.data.repository;
              revision = event.data.revision;
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(statusRes);

      expect(typeof revision).not.toBe("string");
      expect(revision?.data.length).toBe(32);
      expect(revision?.toString().length).toBe(64);
      expect(typeof branch).not.toBe("string");
      expect(branch?.data.length).toBe(16);
      expect(branch?.toString().length).toBe(32);
      expect(repository?.data.length).toBe(16);
      expect(repository?.toString().length).toBe(32);
    });

    test("should have access to string Hash and Context values after calling clone()", async () => {
      await stageRandomFile();
      let branch: string | undefined;
      let repository: string | undefined;
      let revision: string | undefined;
      const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();

      const statusRes = await lore.repositoryStatus(
        globalArgs,
        {
          staged: true,
          scan: true,
          unstaged: true,
        } as LoreRepositoryStatusArgs,
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.REPOSITORY_STATUS_REVISION) {
              const clone = event.clone();
              branch = clone.data.branch;
              repository = clone.data.repository;
              revision = clone.data.revision;
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(statusRes);

      expect(typeof revision).toBe("string");
      expect(revision?.length).toBe(64);
      expect(typeof branch).toBe("string");
      expect(branch?.length).toBe(32);
      expect(typeof repository).toBe("string");
      expect(repository?.length).toBe(32);
    });
  });

  describe("lazy decoding of event getEvent()", () => {
    test("should work inside callback handler just by accessing getEvent()", async () => {
      await stageRandomFile();
      let branchName: string = "";
      const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();

      const statusRes = await lore.repositoryStatus(
        globalArgs,
        {
          staged: true,
          scan: true,
          unstaged: true,
        } as LoreRepositoryStatusArgs,
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.REPOSITORY_STATUS_REVISION) {
              branchName = event.data.branchName;
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(statusRes);

      expect(statusRes).toBe(0);
      expect(branchName).toBe("main");
    });

    test("should fail outside callback handler", async () => {
      await stageRandomFile();
      const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
      const repoStatusEvents: LoreEventFFITyped<LoreEventTag.REPOSITORY_STATUS_REVISION>[] =
        [];
      const statusRes = await lore.repositoryStatus(
        globalArgs,
        {
          staged: true,
          scan: true,
          unstaged: true,
        } as LoreRepositoryStatusArgs,
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.REPOSITORY_STATUS_REVISION) {
              repoStatusEvents.push(event);
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(statusRes);

      expect(statusRes).toBe(0);
      expect(() => repoStatusEvents[0]?.data).toThrowError(
        "Event payload can be decoded only inside the event callback handler."
      );
    });

    test("should work outside the callback handler, if the data was accessed once in the callback", async () => {
      await stageRandomFile();
      const repoStatusEvents: LoreEventFFITyped<LoreEventTag.REPOSITORY_STATUS_REVISION>[] =
        [];
      const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
      const statusRes = await lore.repositoryStatus(
        globalArgs,
        {
          staged: true,
          scan: true,
          unstaged: true,
        } as LoreRepositoryStatusArgs,
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.REPOSITORY_STATUS_REVISION) {
              const _read = event.data.branchName; // decoded when accessed inside the callback
              repoStatusEvents.push(event);
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(statusRes);

      expect(statusRes).toBe(0);
      expect(() => repoStatusEvents[0]?.data.branchName).not.toThrowError();
      expect(repoStatusEvents[0]?.data.branchName).toBe("main");
    });

    test("should fail outside the callback handler, if the data was not accessed in the callback", async () => {
      await stageRandomFile();
      const repoStatusEvents: LoreEventFFITyped<LoreEventTag.REPOSITORY_STATUS_REVISION>[] =
        [];
      const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
      const statusRes = await lore.repositoryStatus(
        globalArgs,
        {
          staged: true,
          scan: true,
          unstaged: true,
        } as LoreRepositoryStatusArgs,
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.REPOSITORY_STATUS_REVISION) {
              const _read = event.data; // decoded when accessed inside the callback
              repoStatusEvents.push(event);
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(statusRes);

      expect(statusRes).toBe(0);
      expect(repoStatusEvents[0]?.data.branchName).not.toBe("main");
    });
  });

  describe("Serde JSON support", () => {
    test("should parse JSON outputted by Serde", () => {
      // Data copy-pasted from Lore CLI --json output:
      const log = parseLoreEventJSON(
        `{"tagName":"log","data":{"level":"debug","category":0,"timestamp":1761044536693,"location":"lorecore::repository","message":"Using repository config remote: lore://localhost"}}`
      );
      const revisionList = parseLoreEventJSON(
        `{"tagName":"revisionHistory","data":{"repository":"01947a20d9ea7f11a81157dbf12cc0f9","branch":"e726318bbc3fd75ac8733a7e030cc35b"}}`
      );
      const revisionListEntry = parseLoreEventJSON(
        `{"tagName":"revisionHistoryEntry","data":{"revision":"4657f3628ef4489b71e2de619ef7d138b2b3606fa4c4ba400ae69b6ca4c76020","revisionNumber":1360,"parent":["b95c90ee56933e3f706abab544abb77b497081757e448aab5f85569221412a63","fcfd029bdc625d25f20c26b220e8312cc89e7c8beecd5005b815faa3e91dd4e1"]}}`
      );
      const metadata = parseLoreEventJSON(
        `{"tagName":"metadata","data":{"key":"merged-by","value":{"tagName":"string","data":"01928c29594b775f8715352b0d5e7a29"}}}`
      );

      if (log.tagName === "log") {
        expect(log.tag).toBe(LoreEventTag.LOG);
        expect(log.data.level).toBe(LoreLogLevel.DEBUG);
      } else {
        fail("should parse as LoreLogEvent");
      }

      if (revisionList.tagName === "revisionHistory") {
        expect(revisionList.tag).toBe(LoreEventTag.REVISION_HISTORY);
        expect(revisionList.data.branch).toBe(
          "e726318bbc3fd75ac8733a7e030cc35b"
        );
        expect(revisionList.data.repository).toBe(
          "01947a20d9ea7f11a81157dbf12cc0f9"
        );
      } else {
        fail("should parse as LoreRevisionHistoryEvent");
      }

      if (revisionListEntry.tagName === "revisionHistoryEntry") {
        expect(revisionListEntry.tag).toBe(LoreEventTag.REVISION_HISTORY_ENTRY);
        expect(revisionListEntry.data.revision).toBe(
          "4657f3628ef4489b71e2de619ef7d138b2b3606fa4c4ba400ae69b6ca4c76020"
        );
        expect(revisionListEntry.data.revisionNumber).toBeTypeOf("number");
        expect(revisionListEntry.data.parent.length).toBe(2);
        expect(revisionListEntry.data.parent[0]).toBe(
          "b95c90ee56933e3f706abab544abb77b497081757e448aab5f85569221412a63"
        );
      } else {
        fail("should parse as LoreRevisionListEntryEvent");
      }

      if (metadata.tagName === "metadata") {
        expect(metadata.tag).toBe(LoreEventTag.METADATA);
        expect(metadata.data.key).toBe("merged-by");
        expect(metadata.data.value.tagName).toBe("string");
        expect(metadata.data.value.tag).toBe(LoreMetadataTag.STRING);
        expect(
          metadata.data.value.tagName === "string" && metadata.data.value.data
        ).toBe("01928c29594b775f8715352b0d5e7a29");
      } else {
        fail("should parse as LoreMetadataEvent");
      }
    });

    test("should fail to parse unrecognized LoreEvent JSON", async () => {
      expect(() =>
        parseLoreEventJSON(`{"tagName":"unrecognized_event_name","data":{}}`)
      ).toThrowError("Invalid LoreEvent");
    });

    test("should fail to parse unrecognized string enum in LoreEvent JSON", async () => {
      expect(() =>
        parseLoreEventJSON(
          `{"tagName":"log","data":{"level":"invalidEnumString","category":0,"timestamp":1761044536693,"location":"lorecore::repository","message":"Using repository config remote: lore://localhost"}}`
        )
      ).toThrowError("Invalid enum string");
    });

    test("should succeed parsing both string enums and numeric enums", async () => {
      const withStringEnum = parseLoreEventJSON(
        `{"tagName":"log","data":{"level":"debug","category":0,"timestamp":1761044536693,"location":"lorecore::repository","message":"Using repository config remote: lore://localhost"}}`
      );
      const withNumericEnum = parseLoreEventJSON(
        `{"tagName":"log","data":{"level":${LoreLogLevel.DEBUG},"category":0,"timestamp":1761044536693,"location":"lorecore::repository","message":"Using repository config remote: lore://localhost"}}`
      );
      expect(
        withStringEnum.tag === LoreEventTag.LOG && withStringEnum.data.level
      ).toBe(LoreLogLevel.DEBUG);
      expect(
        withNumericEnum.tag === LoreEventTag.LOG && withNumericEnum.data.level
      ).toBe(LoreLogLevel.DEBUG);
    });

    test("should print Hash, RepositoryId and BranchId values as strings when using JSON.stringify()", async () => {
      let repository: LoreRepositoryIdBinary | undefined;
      let branch: LoreBranchIdBinary | undefined;
      let revision: LoreHashBinary | undefined;
      const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
      const statusRes = await lore.repositoryStatus(
        globalArgs,
        {
          staged: true,
          scan: true,
          unstaged: true,
        } as LoreRepositoryStatusArgs,
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.REPOSITORY_STATUS_REVISION) {
              repository = event.data.repository;
              branch = event.data.branch;
              revision = event.data.revision;
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(statusRes);
      expect(statusRes).toBe(0);
      expect(branch?.toString()).toBe("e726318bbc3fd75ac8733a7e030cc35b");
      expect(repository?.toString().length).toBeGreaterThan(0);
      expect(revision?.toString()).toBe(
        "0000000000000000000000000000000000000000000000000000000000000000"
      );
      expect(JSON.stringify({ branch: branch })).toBe(
        '{"branch":"e726318bbc3fd75ac8733a7e030cc35b"}'
      );
      expect(JSON.stringify({ repository: repository })).toBe(
        `{"repository":"${repository?.toString()}"}`
      );
      expect(JSON.stringify({ revision: revision })).toBe(
        '{"revision":"0000000000000000000000000000000000000000000000000000000000000000"}'
      );
    });

    test("should succeed parsing a JS SDK LoreEvent that has been stringified", async () => {
      let events: LoreRepositoryStatusRevisionEvent[] = [];
      let repository: LoreRepositoryIdBinary | undefined;
      let branch: LoreBranchIdBinary | undefined;
      let revision: LoreHashBinary | undefined;
      const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
      const statusRes = await lore.repositoryStatus(
        globalArgs,
        {
          staged: true,
          scan: true,
          unstaged: true,
        } as LoreRepositoryStatusArgs,
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.REPOSITORY_STATUS_REVISION) {
              branch = event.data.branch;
              repository = event.data.repository;
              revision = event.data.revision;
              events.push(event.clone());
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(statusRes);
      const sdkEvent = events[0];
      const parsedEvent = parseLoreEventJSON(JSON.stringify(events[0]));
      if (parsedEvent.tag !== LoreEventTag.REPOSITORY_STATUS_REVISION) {
        fail("Should be LoreRepositoryStatusRevisionEvent");
      }
      expect(parsedEvent.tag).toBe(sdkEvent.tag);
      expect(parsedEvent.tagName).toBe(sdkEvent.tagName);
      expect(parsedEvent.data.branch).toBe(branch?.toString());
      expect(parsedEvent.data.repository).toBe(repository?.toString());
      expect(parsedEvent.data.revision).toBe(revision?.toString());
      expect(parsedEvent.data.branchName).toBe(sdkEvent.data.branchName);
      expect(parsedEvent.data.revisionNumber).toBe(
        sdkEvent.data.revisionNumber
      );
    });
  });

  describe("structuredClone support", () => {
    test("should support passing events with BranchId, RepositoryId, Hash, Address through structuredClone", async () => {
      const { testFilePath } = await stageRandomFile();
      await commit();

      let events: LoreFileHistoryEvent[] = [];
      let repository: LoreRepositoryIdBinary | undefined;
      let revision: LoreHashBinary | undefined;
      let address:
        | LoreAddress<
            LoreContextBinary,
            LoreHashBinary,
            LoreBranchIdBinary,
            LoreRepositoryIdBinary
          >
        | undefined;
      let parent: LoreHashBinary[] | undefined;
      await lore.fileHistory(
        globalArgs,
        {
          path: testFilePath,
        },
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.FILE_HISTORY) {
              repository = event.data.repository;
              revision = event.data.revision;
              address = event.data.address;
              parent = event.data.parent;
              events.push(event.clone());
            }
          },
        }
      );

      const sdkEvent = events[0];
      const clone = structuredClone(sdkEvent);

      expect(clone.tag).toBe(sdkEvent.tag);
      // LoreContext:
      expect(clone.data.repository).toBe(repository?.toString());
      // LoreHash:
      expect(clone.data.revision).toBe(revision?.toString());
      // LoreHash array:
      expect(clone.data.parent[0]).toBe(parent?.[0].toString());
      expect(clone.data.parent[1]).toBe(parent?.[1].toString());
      // LoreAddress:
      expect(clone.data.address.context).toBe(address?.context.toString());
      expect(clone.data.address.hash).toBe(address?.hash.toString());
    });

    test("should support passing events with LoreBranchPointArray through structuredClone", async () => {
      await stageRandomFile();
      await commit();
      await lore.branchCreate(
        globalArgs,
        {
          branch: "test-branch",
        },
        {
          callback: () => {},
        }
      );

      let events: LoreBranchListEntryEvent[] = [];
      let stack:
        | LoreBranchPointArray<
            LoreContextBinary,
            LoreHashBinary,
            LoreBranchIdBinary,
            LoreRepositoryIdBinary
          >
        | undefined;
      await lore.branchList(
        globalArgs,
        {},
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.BRANCH_LIST_ENTRY) {
              if (event.data.name === "test-branch") {
                stack = event.data.stack;
              }
              events.push(event.clone());
            }
          },
        }
      );

      const sdkEvent = events.find(
        (branch) => branch.data.name === "test-branch"
      );
      if (!sdkEvent) fail("branch event should be defined");

      const clone = structuredClone(sdkEvent);

      expect(clone.tag).toBe(sdkEvent.tag);
      // LoreBranchPointArray:
      expect(clone.data.stack.length).toBe(1);
      expect(clone.data.stack[0].branch).toBe(stack?.[0].branch.toString());
      expect(clone.data.stack[0].revision).toBe(stack?.[0].revision.toString());
    });

    test("should support passing Metadata events through structuredClone", async () => {
      const { testFilePath } = await stageRandomFile();

      await lore.revisionMetadataSet(
        globalArgs,
        {
          keys: ["meta-string", "meta-binary"],
          values: ["string value", testFilePath],
          formats: [LoreMetadataType.STRING, LoreMetadataType.BINARY],
        },
        {
          callback: () => {},
        }
      );
      await commit();

      const metadataListEvents: {
        event: LoreMetadataEvent;
        valueBeforeClone: LoreMetadata<
          LoreContextBinary,
          LoreHashBinary,
          LoreBranchIdBinary,
          LoreRepositoryIdBinary
        >["data"];
      }[] = [];

      const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
      const listRes = await lore.revisionMetadataList(
        globalArgs,
        {},
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.METADATA) {
              metadataListEvents.push({
                valueBeforeClone: event.data.value.data,
                event: event.clone(),
              });
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(listRes);
      expect(listRes).toBe(0);
      const customStringMetadataEvent = metadataListEvents.find(
        (event) => event.event.data.key === "meta-string"
      );
      const customBinaryMetadataEvent = metadataListEvents.find(
        (event) => event.event.data.key === "meta-binary"
      );
      const branchMetadataEvent = metadataListEvents.find(
        (event) => event.event.data.key === "branch"
      );
      const timestampMetadataEvent = metadataListEvents.find(
        (event) => event.event.data.key === "timestamp"
      );
      const messageMetadataEvent = metadataListEvents.find(
        (event) => event.event.data.key === "message"
      );

      if (
        customStringMetadataEvent?.event.data.value.tag !==
        LoreMetadataTag.STRING
      ) {
        fail("Expect string tag");
      }
      if (
        customBinaryMetadataEvent?.event.data.value.tag !==
        LoreMetadataTag.ADDRESS
      ) {
        fail("Expect address tag");
      }
      if (
        branchMetadataEvent?.event.data.value.tag !== LoreMetadataTag.CONTEXT
      ) {
        fail("Expect context tag");
      }
      if (
        timestampMetadataEvent?.event.data.value.tag !== LoreMetadataTag.NUMERIC
      ) {
        fail("Expect numeric tag");
      }
      if (
        messageMetadataEvent?.event.data.value.tag !== LoreMetadataTag.STRING
      ) {
        fail("Expect string tag");
      }

      for (const event of [
        customStringMetadataEvent,
        customBinaryMetadataEvent,
        branchMetadataEvent,
        timestampMetadataEvent,
        messageMetadataEvent,
      ]) {
        const eventClone = structuredClone(event.event);
        if (eventClone.data.value.tag === LoreMetadataTag.ADDRESS) {
          expect(eventClone.data.value.data.context).toBe(
            (
              event.valueBeforeClone as LoreAddress<
                LoreContextBinary,
                LoreHashBinary
              >
            ).context.toString()
          );
          expect(eventClone.data.value.data.hash).toBe(
            (
              event.valueBeforeClone as LoreAddress<
                LoreContextBinary,
                LoreHashBinary
              >
            ).hash.toString()
          );
        } else if (eventClone.data.value.tag === LoreMetadataTag.NUMERIC) {
          expect(eventClone.data.value.data).toBe(event.valueBeforeClone);
        } else {
          expect(eventClone.data.value.data).toBe(
            event.valueBeforeClone.toString()
          );
        }
      }
    });
  });
  describe("parallel calls", () => {
    test(
      "should support multiple parallel Lore calls",
      { timeout: 30000 },
      async () => {
        await stageRandomFile();

        const calls = 1000;
        const promises: Promise<LoreFnResponseCode>[] = [];
        const events: LoreRepositoryStatusFileEvent[] = [];

        for (let i = 0; i < calls; i++) {
          const { gatherLogs, printLogsIfLoreCallFailed } =
            createErrorHandler();
          promises.push(
            lore
              .repositoryStatus(
                globalArgs,
                {
                  staged: true,
                  scan: true,
                  unstaged: true,
                } as LoreRepositoryStatusArgs,
                {
                  callback: (event) => {
                    gatherLogs(event);
                    if (event.tag === LoreEventTag.REPOSITORY_STATUS_FILE) {
                      events.push(event.clone());
                    }
                  },
                }
              )
              .then((res) => {
                if (res !== 0) {
                  printLogsIfLoreCallFailed(res);
                }
                return res;
              })
          );
        }
        const results = await Promise.allSettled(promises);
        const fulfilledResults = results.filter(
          (result) => result.status === "fulfilled"
        );
        expect(fulfilledResults.length).toBe(calls);
        const succeededResults = fulfilledResults.filter(
          (result) => result.value === 0
        );
        expect(succeededResults.length).toBe(calls);
        expect(events.length).toBe(calls);
      }
    );

    test(
      "should support multiple parallel repositoryCreate calls",
      { timeout: 30000 },
      async () => {
        const calls = 20;
        const tempDirs: string[] = [];

        const promises = Array.from({ length: calls }, async (_, i) => {
          const repoPath = createTempDir();
          tempDirs.push(repoPath);
          const repoArgs = {
            offline: true,
            correlationId: "test-parallel-" + i,
            repositoryPath: repoPath,
          };

          const createEvents: LoreRepositoryCreateEvent[] = [];
          const createRes = await lore.repositoryCreate(
            repoArgs,
            { repositoryUrl: `lore://lore-test-server/${randomUUID()}` },
            {
              callback: (event) => {
                if (event.tag === LoreEventTag.REPOSITORY_CREATE) {
                  createEvents.push(event.clone());
                }
              },
            }
          );
          expect(createRes).toBe(0);
          expect(createEvents.length).toBe(1);

          const testFilePath = path.join(repoPath, randomUUID() + ".txt");
          fs.writeFileSync(testFilePath, randomUUID());

          const stageRes = await lore.fileStage(
            repoArgs,
            { paths: [testFilePath] },
            { callback: () => {} }
          );
          expect(stageRes).toBe(0);

          const commitRevisionEvents: LoreRevisionCommitRevisionEvent[] = [];
          const commitRes = await lore.revisionCommit(
            repoArgs,
            { message: "test-parallel-" + i },
            {
              callback: (event) => {
                if (event.tag === LoreEventTag.REVISION_COMMIT_REVISION) {
                  commitRevisionEvents.push(event.clone());
                }
              },
            }
          );
          expect(commitRes).toBe(0);
          expect(commitRevisionEvents.length).toBe(1);
          expect(commitRevisionEvents[0].data.revision.length).toBe(64);

          return createRes;
        });

        const results = await Promise.allSettled(promises);
        const succeededResults = results.filter(
          (result) => result.status === "fulfilled" && result.value === 0
        );
        expect(succeededResults.length).toBe(calls);

        for (const tempDir of tempDirs) {
          await lore.repositoryFlush(
            { repositoryPath: tempDir },
            {},
            { callback: () => {} }
          );
          cleanTempDir(tempDir);
        }
      }
    );
  });

  describe("unicode support", () => {
    test("should support LoreStrings with multibyte unicode characters", async () => {
      await stageRandomFile();
      const { commitRevisionEvent } = await commit();

      const testFileName = "öäÄÅ的ЛЛЛµÐ𒁻𒁃𓉡𓉢‼️🌏🇩🇪" + randomUUID() + ".txt";
      const testFilePath = path.join(repositoryPath, testFileName);
      const testFileContents = "öäÄÅ𒂔𒀱的ЛЛЛµ𒅌𓉡𓉢‼️🌏🇩🇪";
      fs.writeFileSync(testFilePath, testFileContents);

      const stageFileEvents: LoreFileStageFileEvent[] = [];

      const stageRes = await lore.fileStage(
        globalArgs,
        {
          paths: [testFilePath],
        },
        {
          userContext: 1,
          callback: (event) => {
            if (event.tag === LoreEventTag.FILE_STAGE_FILE) {
              stageFileEvents.push(event.clone());
            }
          },
        }
      );

      if (stageRes !== 0) {
        fail("Error staging file");
      }
      expect(stageFileEvents[0].data.path).toBe(testFileName);

      const commitMessage = "commit: öäÄÅ𒂔𒀱的ЛЛЛµ𒅌𓉡𓉢‼️🌏🇩🇪";
      await lore.revisionCommit(
        globalArgs,
        {
          message: commitMessage,
        },
        {
          userContext: 1,
          callback: () => {},
        }
      );

      const diffFileEvents: LoreFileDiffEvent[] = [];

      await lore.fileDiff(
        globalArgs,
        {
          paths: [testFilePath],
          sourceRevision: commitRevisionEvent.data.revision,
        },
        {
          userContext: 1,
          callback: (event) => {
            if (event.tag === LoreEventTag.FILE_DIFF) {
              diffFileEvents.push(event.clone());
            }
          },
        }
      );

      expect(diffFileEvents[0].data.path).toBe(testFileName);
      expect(diffFileEvents[0].data.patch).toContain(testFileContents);

      const commitMessages: string[] = [];
      await lore.revisionHistory(
        globalArgs,
        {},
        {
          userContext: 1,
          callback: (event) => {
            if (event.tag === LoreEventTag.METADATA) {
              if (
                event.data.key === "message" &&
                event.data.value.tag === LoreMetadataTag.STRING
              ) {
                commitMessages.push(event.data.value.data);
              }
            }
          },
        }
      );
      expect(commitMessages).toContain(commitMessage);
    });

    test("should support unicode characters in branch names", async () => {
      await stageRandomFile();
      await commit();

      const testBranchName = "branch1-öäÄÅ𒂔𒀱的ЛЛЛµ𒅌𓉡𓉢‼️🌏🇩🇪";

      let createdBranchName = "";
      await lore.branchCreate(
        globalArgs,
        {
          branch: testBranchName,
        },
        {
          userContext: 1,
          callback: (event) => {
            if (event.tag === LoreEventTag.BRANCH_CREATE) {
              createdBranchName = event.data.name;
            }
          },
        }
      );

      expect(createdBranchName).toBe(testBranchName);

      const testBranchName2 = "branch2-öäÄÅ𒂔𒀱的ЛЛЛµ𒅌𓉡𓉢‼️🌏🇩🇪-µ𒅌𓉡";

      await lore.branchCreate(
        globalArgs,
        {
          branch: testBranchName2,
        },
        {
          userContext: 1,
          callback: () => {},
        }
      );

      await lore.branchSwitch(
        globalArgs,
        {
          branch: testBranchName,
        },
        {
          userContext: 1,
          callback: () => {},
        }
      );

      const branchNames: string[] = [];

      await lore.branchList(
        globalArgs,
        {},
        {
          userContext: 1,
          callback: (event) => {
            if (event.tag === LoreEventTag.BRANCH_LIST_ENTRY) {
              branchNames.push(event.data.name);
            }
          },
        }
      );

      expect(branchNames).toContain(testBranchName);
      expect(branchNames).toContain(testBranchName2);

      let currentBranch = "";
      await lore.branchInfo(
        globalArgs,
        {},
        {
          userContext: 1,
          callback: (event) => {
            if (event.tag === LoreEventTag.BRANCH_INFO) {
              currentBranch = event.data.name;
            }
          },
        }
      );

      expect(currentBranch).toBe(testBranchName);
    });
  });

  describe("file encoding support", () => {
    const testFilesDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "test-files"
    );

    const diffEncodingFile = async (encodingFileName: string) => {
      // Baseline commit with a random file (capture its revision).
      await stageRandomFile();
      const {
        commitRes: baselineCommitRes,
        commitRevisionEvent: baselineEvent,
      } = await commit();
      expect(baselineCommitRes).toBe(0);
      const baselineRevision = baselineEvent.data.revision;

      // Copy the encoding file into the repo, preserving raw bytes.
      const sourcePath = path.join(testFilesDir, encodingFileName);
      const destPath = path.join(repositoryPath, encodingFileName);
      fs.copyFileSync(sourcePath, destPath);
      const fileBytes = fs.readFileSync(sourcePath);

      // Stage and commit the encoding file.
      const { gatherLogs: stageGather, printLogsIfLoreCallFailed: stagePrint } =
        createErrorHandler();
      const stageRes = await lore.fileStage(
        globalArgs,
        { paths: [destPath] },
        { userContext: 1, callback: stageGather }
      );
      stagePrint(stageRes);
      expect(stageRes).toBe(0);

      const { commitRes, commitRevisionEvent: addedEvent } = await commit();
      expect(commitRes).toBe(0);
      const addedRevision = addedEvent.data.revision;

      // Diff the added file between the two revisions, with diff3 enabled.
      const diffFileEvents: LoreFileDiffEvent[] = [];
      const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
      const diffRes = await lore.fileDiff(
        globalArgs,
        {
          paths: [destPath],
          sourceRevision: baselineRevision,
          targetRevision: addedRevision,
          diff3: true,
        },
        {
          userContext: 1,
          callback: (event) => {
            if (event.tag === LoreEventTag.FILE_DIFF) {
              diffFileEvents.push(event.clone());
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(diffRes);
      expect(diffRes).toBe(0);
      expect(diffFileEvents.length).toBe(1);
      expect(diffFileEvents[0].data.action).toBe(LoreFileAction.ADD);

      return { patch: diffFileEvents[0].data.patch, fileBytes };
    };

    test("UTF-8 encoded file diff should contain encoded content", async () => {
      const { patch } = await diffEncodingFile("encoding-utf8.txt");
      expect(patch).toContain("+Line 1 ASCII");
      expect(patch).toContain("+Café CHANGED naïve");
      expect(patch).toContain("+Line 3 end");
    });

    test("Latin-1 encoded file diff is reported as binary", async () => {
      // lore only supports UTF-8 and UTF-16 (with BOM) diffs; any other
      // encoding is treated as binary and the patch just notes the difference.
      const { patch } = await diffEncodingFile("encoding-latin1.txt");
      expect(patch).toContain("Binary files differ");
    });

    test("CP1252 encoded file diff is reported as binary", async () => {
      const { patch } = await diffEncodingFile("encoding-cp1252.txt");
      expect(patch).toContain("Binary files differ");
    });

    test("UTF-16LE (with BOM) encoded file diff should contain encoded content", async () => {
      // lore detects the BOM and transcodes the file content to UTF-8 in the
      // diff output, so the patch should match the decoded text.
      const { patch } = await diffEncodingFile("encoding-utf16le.txt");
      expect(patch).toContain("+Line 1 ASCII");
      expect(patch).toContain("+Café CHANGED naïve");
      expect(patch).toContain("+Line 3 end");
    });

    test("UTF-16BE (with BOM) encoded file diff should contain encoded content", async () => {
      // lore detects the BOM and transcodes the file content to UTF-8 in the
      // diff output, so the patch should match the decoded text.
      const { patch } = await diffEncodingFile("encoding-utf16be.txt");
      expect(patch).toContain("+Line 1 ASCII");
      expect(patch).toContain("+Café CHANGED naïve");
      expect(patch).toContain("+Line 3 end");
    });

    test("UTF-16LE (bomless) encoded file diff is reported as binary", async () => {
      const { patch } = await diffEncodingFile("encoding-bomless-utf16le.txt");
      expect(patch).toContain("Binary files differ");
    });

    test("UTF-16BE (bomless) encoded file diff is reported as binary", async () => {
      const { patch } = await diffEncodingFile("encoding-bomless-utf16be.txt");
      expect(patch).toContain("Binary files differ");
    });
  });

  test("version should return a non-empty string", () => {
    const version = lore.version();
    expect(version).toBeDefined();
    expect(version).not.toBe("");
  });

  test("revisionAmend should work", async () => {
    await stageRandomFile();
    await commit();

    const amendedMessage = "amended commit message";
    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    const amendRes = await lore.revisionAmend(
      globalArgs,
      { message: amendedMessage },
      { callback: gatherLogs }
    );
    printLogsIfLoreCallFailed(amendRes);
    expect(amendRes).toBe(0);

    const commitMessages: string[] = [];
    const historyRes = await lore.revisionHistory(
      globalArgs,
      {},
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.METADATA) {
            if (
              event.data.key === "message" &&
              event.data.value.tag === LoreMetadataTag.STRING
            ) {
              commitMessages.push(event.data.value.data);
            }
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(historyRes);
    expect(historyRes).toBe(0);
    expect(commitMessages).toContain(amendedMessage);
  });

  test("revisionFind by metadata should work", async () => {
    await stageRandomFile();

    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    const setRes = await lore.revisionMetadataSet(
      globalArgs,
      {
        keys: ["search-key"],
        values: ["search-value"],
        formats: [LoreMetadataType.STRING],
      },
      { callback: gatherLogs }
    );
    printLogsIfLoreCallFailed(setRes);
    expect(setRes).toBe(0);

    await commit();

    const findResults: LoreRevisionFindEvent[] = [];
    const findRes = await lore.revisionFind(
      globalArgs,
      { key: "search-key", value: "search-value" },
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.REVISION_FIND) {
            findResults.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(findRes);
    expect(findRes).toBe(0);
    expect(findResults.length).toBe(1);
    expect(findResults[0].data.signature.length).toBe(64);
  });

  test("revisionFind by number should work", async () => {
    await stageRandomFile();
    await commit();

    const findResults: LoreRevisionFindEvent[] = [];
    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    const findRes = await lore.revisionFind(
      globalArgs,
      { number: 1 },
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.REVISION_FIND) {
            findResults.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(findRes);
    expect(findRes).toBe(0);
    expect(findResults.length).toBe(1);
    expect(findResults[0].data.signature.length).toBe(64);
  });

  test("fileMetadataSet and fileMetadataList should work", async () => {
    const { testFilePath } = await stageRandomFile();

    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    const setRes = await lore.fileMetadataSet(
      globalArgs,
      {
        paths: [testFilePath],
        keys: ["test-key"],
        values: ["test-value"],
        formats: [LoreMetadataType.STRING],
        entries: [1],
      },
      { callback: gatherLogs }
    );
    printLogsIfLoreCallFailed(setRes);
    expect(setRes).toBe(0);

    const metadataEvents: LoreMetadataEvent[] = [];
    const listRes = await lore.fileMetadataList(
      globalArgs,
      { path: testFilePath },
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.METADATA) {
            metadataEvents.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(listRes);
    expect(listRes).toBe(0);
    expect(
      metadataEvents.some(
        (e) =>
          e.data.key === "test-key" &&
          e.data.value.tag === LoreMetadataTag.STRING &&
          e.data.value.data === "test-value"
      )
    ).toBe(true);
  });

  test("revisionInfo should return hash and parent array", async () => {
    await stageRandomFile();
    await commit();

    const revisionInfoEvents: LoreRevisionInfoEvent[] = [];
    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    const res = await lore.revisionInfo(
      globalArgs,
      {},
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.REVISION_INFO) {
            revisionInfoEvents.push(event.clone());
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(res);
    expect(res).toBe(0);
    expect(revisionInfoEvents.length).toBe(1);
    expect(revisionInfoEvents[0].data.revisionNumber).toBe(1);
    expect(revisionInfoEvents[0].data.revision.length).toBe(64);
    expect(Array.isArray(revisionInfoEvents[0].data.parent)).toBe(true);
  });

  test("fileDependencyAdd, fileDependencyList and fileDependencyRemove should marshal parallel arrays", async () => {
    // Five files: a, b are sources; x, y, z are targets.
    const aPath = path.join(repositoryPath, "a.txt");
    const bPath = path.join(repositoryPath, "b.txt");
    const xPath = path.join(repositoryPath, "x.txt");
    const yPath = path.join(repositoryPath, "y.txt");
    const zPath = path.join(repositoryPath, "z.txt");
    fs.writeFileSync(aPath, "a");
    fs.writeFileSync(bPath, "b");
    fs.writeFileSync(xPath, "x");
    fs.writeFileSync(yPath, "y");
    fs.writeFileSync(zPath, "z");

    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    const stageRes = await lore.fileStage(
      globalArgs,
      { paths: [aPath, bPath, xPath, yPath, zPath] },
      { callback: gatherLogs }
    );
    printLogsIfLoreCallFailed(stageRes);
    expect(stageRes).toBe(0);
    const { commitRes } = await commit();
    expect(commitRes).toBe(0);

    // Dependency layout:
    //   a.txt -> x.txt (tags: ["alpha"])
    //   a.txt -> y.txt (tags: ["alpha", "beta"])
    //   b.txt -> z.txt (tags: [])
    //
    // Parallel arrays:
    //   paths        = [a, b]                               len = 2
    //   depCounts    = [2, 1]                               len = 2 (matches paths)
    //   dependencies = [x, y, z]                            len = sum(depCounts) = 3
    //   tagCounts    = [1, 2, 0]                            len = 3 (matches dependencies)
    //   tags         = ["alpha", "alpha", "beta"]           len = sum(tagCounts) = 3
    const addEntries: { path: string; dependency: string; tags: string[] }[] =
      [];
    const addRes = await lore.fileDependencyAdd(
      globalArgs,
      {
        paths: [aPath, bPath],
        depCounts: [2, 1],
        dependencies: [xPath, yPath, zPath],
        tagCounts: [1, 2, 0],
        tags: ["alpha", "alpha", "beta"],
      },
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.FILE_DEPENDENCY_ADD_ENTRY) {
            // Touch the FFI array length inside the callback to exercise the
            // no-allocation path before clone() copies it out.
            expect(event.data.tags.length).toBeGreaterThanOrEqual(0);
            const cloned = event.clone();
            addEntries.push({
              path: cloned.data.path,
              dependency: cloned.data.dependency,
              tags: cloned.data.tags,
            });
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(addRes);
    expect(addRes).toBe(0);
    expect(addEntries.length).toBe(3);

    // Index by (path, dependency) for order-independent verification.
    const addByKey = new Map<string, string[]>();
    for (const e of addEntries) {
      addByKey.set(e.path + "|" + e.dependency, e.tags);
    }
    const wantAdd: Record<string, string[]> = {
      [aPath + "|" + xPath]: ["alpha"],
      [aPath + "|" + yPath]: ["alpha", "beta"],
      [bPath + "|" + zPath]: [], // empty tag array (zero-element string array)
    };
    for (const [key, want] of Object.entries(wantAdd)) {
      const got = addByKey.get(key);
      expect(got, `ADD_ENTRY missing for ${key}`).toBeDefined();
      expect([...got!].sort()).toEqual([...want].sort());
    }

    // List dependencies starting from a.txt and b.txt.
    const listEntries = new Map<string, string[]>(); // dependency path -> tags
    let listFileCount: number | undefined;
    let listEntryCount: number | undefined;
    const listRes = await lore.fileDependencyList(
      globalArgs,
      { paths: [aPath, bPath] },
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.FILE_DEPENDENCY_LIST_BEGIN) {
            listFileCount = event.data.fileCount;
          } else if (event.tag === LoreEventTag.FILE_DEPENDENCY_LIST_ENTRY) {
            expect(event.data.tags.length).toBeGreaterThanOrEqual(0);
            const cloned = event.clone();
            listEntries.set(cloned.data.path, cloned.data.tags);
          } else if (event.tag === LoreEventTag.FILE_DEPENDENCY_LIST_END) {
            listEntryCount = event.data.totalEntryCount;
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(listRes);
    expect(listRes).toBe(0);
    expect(listFileCount).toBe(2);
    expect(listEntryCount).toBe(3);

    // LIST_ENTRY emits paths relative to the repo root, not the absolute
    // paths that were passed in. Compare by basename.
    const listByBasename = new Map<string, string[]>();
    for (const [p, tags] of listEntries) {
      listByBasename.set(path.basename(p), tags);
    }
    const wantList: Record<string, string[]> = {
      "x.txt": ["alpha"],
      "y.txt": ["alpha", "beta"],
      "z.txt": [],
    };
    for (const [base, want] of Object.entries(wantList)) {
      const got = listByBasename.get(base);
      expect(got, `LIST_ENTRY missing for ${base}`).toBeDefined();
      expect([...got!].sort()).toEqual([...want].sort());
    }

    // Remove a.txt -> y.txt only. This exercises a degenerate parallel-array
    // shape (paths=1, depCounts=[1], dependencies=[y], tagCounts=[0], tags=[]).
    const removeEntries: {
      path: string;
      dependency: string;
      tags: string[];
    }[] = [];
    const removeRes = await lore.fileDependencyRemove(
      globalArgs,
      {
        paths: [aPath],
        depCounts: [1],
        dependencies: [yPath],
        tagCounts: [0],
        tags: [],
      },
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.FILE_DEPENDENCY_REMOVE_ENTRY) {
            expect(event.data.tags.length).toBeGreaterThanOrEqual(0);
            const cloned = event.clone();
            removeEntries.push({
              path: cloned.data.path,
              dependency: cloned.data.dependency,
              tags: cloned.data.tags,
            });
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(removeRes);
    expect(removeRes).toBe(0);
    expect(removeEntries.length).toBe(1);
    expect(removeEntries[0].path).toBe(aPath);
    expect(removeEntries[0].dependency).toBe(yPath);

    // Re-list and verify y.txt is gone, x.txt and z.txt remain.
    const postEntries = new Map<string, string[]>();
    const postListRes = await lore.fileDependencyList(
      globalArgs,
      { paths: [aPath, bPath] },
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.FILE_DEPENDENCY_LIST_ENTRY) {
            const cloned = event.clone();
            postEntries.set(path.basename(cloned.data.path), cloned.data.tags);
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(postListRes);
    expect(postListRes).toBe(0);
    expect(postEntries.has("y.txt")).toBe(false);
    expect(postEntries.has("x.txt")).toBe(true);
    expect(postEntries.has("z.txt")).toBe(true);
  });

  test("branchInfo should return a multi-element stack for a chain of branches", async () => {
    // branchCreate implicitly switches to the new branch, so the chain is
    // built by creating, committing, and creating again — each new branch is
    // a child of the previous tip.
    await stageRandomFile();
    await commit();

    const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();
    for (const name of ["b1", "b2", "b3"]) {
      const createRes = await lore.branchCreate(
        globalArgs,
        { branch: name },
        { callback: gatherLogs }
      );
      printLogsIfLoreCallFailed(createRes);
      expect(createRes).toBe(0);
      // A commit per branch ensures each branch contributes a distinct
      // branch point to the stack.
      await stageRandomFile();
      await commit();
    }

    let ffiStackLen: number | undefined;
    let stackGet: { branch: string; revision: string }[] = [];
    let clonedStack: { branch: string; revision: string }[] | undefined;
    const infoRes = await lore.branchInfo(
      globalArgs,
      { branch: "b3" },
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.BRANCH_INFO) {
            // Read each entry through the FFI array while still inside the
            // callback. This is the only safe time for FFI access.
            ffiStackLen = event.data.stack.length;
            stackGet = [];
            for (let i = 0; i < ffiStackLen; i++) {
              const bp = event.data.stack[i];
              stackGet.push({
                branch: bp.branch.toString(),
                revision: bp.revision.toString(),
              });
            }
            clonedStack = event.clone().data.stack;
          }
          gatherLogs(event);
        },
      }
    );
    printLogsIfLoreCallFailed(infoRes);
    expect(infoRes).toBe(0);
    expect(ffiStackLen).toBeDefined();
    expect(clonedStack).toBeDefined();

    // b3 was created off b2 which was created off b1 which was created off
    // main. Expect at least 3 ancestor branch points.
    expect(ffiStackLen!).toBeGreaterThanOrEqual(3);
    expect(clonedStack!.length).toBe(ffiStackLen);

    const zeroBranch = "0".repeat(32);
    const zeroRevision = "0".repeat(64);
    for (let i = 0; i < ffiStackLen!; i++) {
      // FFI per-index access and Clone() must agree on every entry.
      expect(stackGet[i].branch).toBe(clonedStack![i].branch);
      expect(stackGet[i].revision).toBe(clonedStack![i].revision);
      expect(stackGet[i].branch).not.toBe(zeroBranch);
      expect(stackGet[i].revision).not.toBe(zeroRevision);
    }

    // All branch points in the stack should be unique — the chain has no
    // duplicate ancestors.
    const seen = new Map<string, number>();
    for (let i = 0; i < clonedStack!.length; i++) {
      const id = clonedStack![i].branch;
      expect(seen.has(id), `duplicate branch in stack at index ${i}`).toBe(
        false
      );
      seen.set(id, i);
    }
  });

  describe("global store", () => {
    let globalStoreTestPath: string;

    beforeEach(() => {
      globalStoreTestPath = createTempDir();
    });

    afterEach(async () => {
      await lore.repositoryFlush({}, {}, { callback: () => {} });
      cleanTempDir(globalStoreTestPath);
    });

    test("should see a created global store in global store info", async () => {
      const globalStorePath = path.join(globalStoreTestPath, "store");
      const remoteUrl = "lore-js-unit-test-global-store";

      const storeCreateEvent: LoreSharedStoreCreateEvent[] = [];
      const createStatus = await lore.sharedStoreCreate(
        { offline: true },
        { path: globalStorePath, remoteUrl, makeDefault: true },
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.SHARED_STORE_CREATE) {
              storeCreateEvent.push(event.clone());
            }
          },
        }
      );
      expect(createStatus).toBe(0);
      expect(storeCreateEvent[0]?.data.path).toContain(globalStorePath);

      const globalStoreInfo: LoreSharedStoreInfoEvent[] = [];
      await lore.sharedStoreInfo(
        { offline: true },
        {},
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.SHARED_STORE_INFO) {
              globalStoreInfo.push(event.clone());
            }
          },
        }
      );

      expect(globalStoreInfo.length).toBe(1);

      const storeIndex = globalStoreInfo[0].data.remoteUrls.findIndex(
        (url) => url === remoteUrl
      );
      expect(storeIndex).toBeGreaterThanOrEqual(0);
      expect(globalStoreInfo[0].data.exists[storeIndex]).toBe(true);
      expect(globalStoreInfo[0].data.paths[storeIndex]).toContain(
        globalStorePath
      );
      expect(globalStoreInfo[0].data.remoteUrls[storeIndex]).toBe(remoteUrl);
    });

    test("sharedStoreInfo should expose multi-element parallel arrays for paths, exists, and remoteUrls", async () => {
      // Create three shared stores, each with a unique remote URL so we can
      // pick them out of the info response.
      const stamp = Date.now() + "-" + randomUUID();
      const remoteUrls = [
        `lore-js-exists-test-${stamp}-a`,
        `lore-js-exists-test-${stamp}-b`,
        `lore-js-exists-test-${stamp}-c`,
      ];
      const storePaths = [
        path.join(globalStoreTestPath, "store-a"),
        path.join(globalStoreTestPath, "store-b"),
        path.join(globalStoreTestPath, "store-c"),
      ];

      for (let i = 0; i < remoteUrls.length; i++) {
        const createStatus = await lore.sharedStoreCreate(
          { offline: true },
          {
            path: storePaths[i],
            remoteUrl: remoteUrls[i],
            makeDefault: true,
          },
          { callback: () => {} }
        );
        expect(createStatus).toBe(0);
      }

      // Query info — exactly one event with all stores listed in parallel
      // arrays. Capture both the cloned event AND the raw FFI lengths seen
      // inside the callback. They must agree.
      let ffiExistsLen: number | undefined;
      let ffiPathsLen: number | undefined;
      let ffiRemoteUrlsLen: number | undefined;
      let existsAtIndex: boolean[] = [];
      const infoEvents: LoreSharedStoreInfoEvent[] = [];

      const infoRes = await lore.sharedStoreInfo(
        { offline: true },
        {},
        {
          callback: (event) => {
            if (event.tag !== LoreEventTag.SHARED_STORE_INFO) {
              return;
            }
            ffiExistsLen = event.data.exists.length;
            ffiPathsLen = event.data.paths.length;
            ffiRemoteUrlsLen = event.data.remoteUrls.length;
            // Drive the per-index access path on the FFI array — independent
            // from the clone() path used below. The FFI exposes uint8_t
            // values; normalize to booleans so the two views can be compared.
            existsAtIndex = [];
            for (let i = 0; i < ffiExistsLen; i++) {
              existsAtIndex.push(Boolean(event.data.exists[i]));
            }
            infoEvents.push(event.clone());
          },
        }
      );
      expect(infoRes).toBe(0);
      expect(infoEvents.length).toBe(1);

      // All three parallel arrays must agree in length, both at the FFI
      // level and after clone().
      expect(ffiPathsLen).toBe(ffiExistsLen);
      expect(ffiRemoteUrlsLen).toBe(ffiExistsLen);
      expect(infoEvents[0].data.exists.length).toBe(ffiExistsLen);
      expect(infoEvents[0].data.paths.length).toBe(ffiExistsLen);
      expect(infoEvents[0].data.remoteUrls.length).toBe(ffiExistsLen);
      expect(infoEvents[0].data.exists).toEqual(existsAtIndex);

      // Each of our three stores should be present and exists==true.
      for (let i = 0; i < remoteUrls.length; i++) {
        const idx = infoEvents[0].data.remoteUrls.findIndex(
          (u) => u === remoteUrls[i]
        );
        expect(
          idx,
          `remote URL ${remoteUrls[i]} not found in info`
        ).toBeGreaterThanOrEqual(0);
        expect(infoEvents[0].data.exists[idx]).toBe(true);
        expect(infoEvents[0].data.paths[idx]).toContain(storePaths[i]);
      }
    });
  });

  describe("content addressed storage", () => {
    test("should open in-memory storage, put and get data, then close", async () => {
      const { gatherLogs, printLogsIfLoreCallFailed } = createErrorHandler();

      let handle: LoreStore | undefined;
      const openRes = await lore.storageOpen(
        { offline: true },
        {
          repositoryPath: "",
          inMemory: true,
        },
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.STORAGE_OPENED) {
              handle = { handleId: event.data.handleId };
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(openRes);
      expect(openRes).toBe(0);
      expect(handle).toBeDefined();

      const partition = "1234567890123456";
      const context = "1234567890123456";
      const testString = "with multibyte unicode chars -öäÄÅ𒂔𒀱的ЛЛЛµ𒅌𓉡𓉢‼️🌏🇩🇪";
      const testData = Buffer.from(testString, "utf-8");

      let putAddress: LoreAddress | undefined;
      const putRes = await lore.storagePut(
        { offline: true },
        {
          handle,
          items: [
            {
              id: 1,
              partition,
              context,
              data: testData,
              remoteWrite: false,
              localCache: false,
              fixedSizeChunk: 0,
            },
          ],
        },
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.STORAGE_PUT_ITEM_COMPLETE) {
              putAddress = event.clone().data.address;
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(putRes);
      expect(putRes).toBe(0);
      if (!putAddress) {
        fail("putAddress not received");
      }
      expect(putAddress.context).toBeDefined();
      expect(putAddress.hash).toBeDefined();

      let contentLength: number | undefined;
      let bytes: Uint8Array | undefined;
      let getCompleteCount = 0;
      const getRes = await lore.storageGet(
        { offline: true },
        {
          handle,
          items: [
            {
              id: 1,
              partition,
              address: putAddress,
              streaming: false,
              localCache: false,
            },
          ],
        },
        {
          callback: (event) => {
            if (event.tag === LoreEventTag.STORAGE_GET_HEADER) {
              contentLength = event.data.sizeContent;
            } else if (event.tag === LoreEventTag.STORAGE_GET_DATA) {
              bytes = event.clone().data.bytes;
            } else if (event.tag === LoreEventTag.STORAGE_GET_ITEM_COMPLETE) {
              getCompleteCount++;
            }
            gatherLogs(event);
          },
        }
      );
      printLogsIfLoreCallFailed(getRes);
      expect(getRes).toBe(0);
      expect(contentLength).toBe(testData.byteLength);
      expect(getCompleteCount).toBe(1);
      expect(new TextDecoder().decode(bytes)).toBe(testString);

      const closeRes = await lore.storageClose(
        { offline: true },
        { handle },
        { callback: gatherLogs }
      );
      printLogsIfLoreCallFailed(closeRes);
      expect(closeRes).toBe(0);
    });
  });
});
