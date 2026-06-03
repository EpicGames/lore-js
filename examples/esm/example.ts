// Copyright Epic Games, Inc. All Rights Reserved.

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { lore } from "@lore-vcs/sdk";
import { LoreEventTag, LoreLogLevel } from "@lore-vcs/sdk/types/enums";
import type { LoreEvent, LoreEventFFI } from "@lore-vcs/sdk/types/events";
import type {
  LoreBranchPushArgs,
  LoreFileStageArgs,
  LoreGlobalArgs,
  LoreRepositoryCloneArgs,
  LoreRepositoryCreateArgs,
  LoreRevisionCommitArgs,
} from "@lore-vcs/sdk/types/args";
import type { LoreLogConfig } from "@lore-vcs/sdk/types";
import * as process from "node:process";

// If a remote URL is provided as the first CLI arg, run in online mode
// (push the revision and clone the repository back). Otherwise run a fully
// offline example that only creates a local repository and commits a file.
// Authentication is not handled by this example; if the remote requires it,
// run `lore auth` before invoking this program.
const REMOTE_URL = process.argv[2];
const ONLINE = REMOTE_URL !== undefined;

if (ONLINE) {
  console.log(`Running in online mode against: ${REMOTE_URL}`);
} else {
  console.log(
    "Running in offline mode (pass a remote URL as the first arg to enable push/clone)"
  );
}

// Set up general configuration
const LOG_FILE_PATH = "./LoreRepositories";
const REPOSITORY_NAME = "EpicRepo" + randomUUID();
const REPOSITORY_URL = ONLINE
  ? `${REMOTE_URL}/${REPOSITORY_NAME}`
  : REPOSITORY_NAME;
const REPOSITORY_PATH = `./LoreRepositories/${REPOSITORY_NAME}`;
const GLOBALS: LoreGlobalArgs = {
  repositoryPath: REPOSITORY_PATH,
  offline: !ONLINE,
};
const LOG_CONFIG: LoreLogConfig = {
  file: true,
  filePath: LOG_FILE_PATH,
  level: LoreLogLevel.DEBUG,
};

/**
 * Handle callback events
 */
function event_handler(event: LoreEventFFI) {
  if (event.tag === LoreEventTag.COMPLETE && event.data.status !== 0) {
    console.log(`Call ended with return code ${event.data.status}`);
  }
}

/**
 * Generate random files to commit to repository
 */
function create_files() {
  for (const file of [
    `./LoreRepositories/${REPOSITORY_NAME}/file.txt`,
    `./LoreRepositories/${REPOSITORY_NAME}/log.txt`,
  ]) {
    fs.writeFileSync(
      file,
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et"
    );
  }
}

/**
 * Async wrapper function for async Lore calls
 */
async function run() {
  try {
    lore.logConfigure(LOG_CONFIG);
    console.log("Setup successful");
  } catch (e) {
    console.log("Unable to setup", e);
    process.exit(1);
  }

  // Register a global logger:
  lore.globalCallback(LoreEventTag.LOG, (event) => {
    if (event.data.level > LoreLogLevel.DEBUG) {
      console.log(event.data.message);
    }
  });

  // Create repository using filter and collectAsync
  try {
    const args: LoreRepositoryCreateArgs = {
      repositoryUrl: REPOSITORY_URL,
    };
    const events: LoreEvent[] = await lore
      .repositoryCreate(GLOBALS, args)
      .filterByType(LoreEventTag.REPOSITORY_CREATE)
      .collectAsync();
    const repositoryId =
      events[0].tag === LoreEventTag.REPOSITORY_CREATE
        ? events[0].data.id
        : "unknown";
    console.log("Repository created", repositoryId);
  } catch (e) {
    console.log("Unable to create repository", e);
    process.exit(1);
  }

  // Create files to commit to the new repository
  create_files();

  // Stage file using asyncIter
  try {
    const args: LoreFileStageArgs = {
      paths: [
        `./LoreRepositories/${REPOSITORY_NAME}/file.txt`,
        `./LoreRepositories/${REPOSITORY_NAME}/log.txt`,
      ],
    };
    for await (const event of lore.fileStage(GLOBALS, args).asyncIter()) {
      switch (event.tag) {
        case LoreEventTag.LOG:
          if (event.data.level > LoreLogLevel.DEBUG) {
            console.log(event.data.message);
          }
      }
    }
    console.log("Files staged");
  } catch (e) {
    console.log("Unable to stage files", e);
    process.exit(1);
  }

  // Revision commit
  try {
    const args: LoreRevisionCommitArgs = {
      message: "Initial commit",
    };
    await lore
      .revisionCommit(GLOBALS, args)
      .callback(event_handler)
      .waitAsync();
    console.log("Revision commited");
  } catch (e) {
    console.log("Unable to commit revision", e);
    process.exit(1);
  }

  if (ONLINE) {
    // Branch push
    try {
      const args: LoreBranchPushArgs = {};
      await lore.branchPush(GLOBALS, args).callback(event_handler).waitAsync();
      console.log("Branch pushed");
    } catch (e) {
      console.log("Unable to push branch", e);
      process.exit(1);
    }

    // Clone repository
    try {
      const args: LoreRepositoryCloneArgs = {
        repositoryUrl: REPOSITORY_URL,
      };
      await lore
        .repositoryClone(
          {
            ...GLOBALS,
            repositoryPath: `./LoreRepositories/${REPOSITORY_NAME}_clone`,
          },
          args
        )
        .callback(event_handler)
        .waitAsync();
      console.log("Repository cloned");
    } catch (e) {
      console.log("Unable to clone repository", e);
      process.exit(1);
    }
  }

  // Shutdown
  try {
    lore.shutdown();
    console.log("Shutdown successful");
  } catch (e) {
    console.log("Unable to shutdown", e);
    process.exit(1);
  }
}

void run();
