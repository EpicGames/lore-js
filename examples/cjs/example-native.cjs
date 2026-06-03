// Copyright Epic Games, Inc. All Rights Reserved.

const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const process = require("node:process");
const { lore } = require("@lore-vcs/sdk/native");
const { LoreEventTag, LoreLogLevel } = require("@lore-vcs/sdk/types/enums");

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
const GLOBALS = {
  repositoryPath: REPOSITORY_PATH,
  offline: !ONLINE,
};
const LOG_CONFIG = {
  file: true,
  filePath: LOG_FILE_PATH,
  level: LoreLogLevel.DEBUG,
};

/**
 * Handle callback events
 */
function event_handler(event) {
  if (event.tag === LoreEventTag.LOG) {
    if (event.data.level > LoreLogLevel.DEBUG) {
      console.log(event.data.message);
    }
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
  {
    const result = lore.logConfigure(LOG_CONFIG);
    if (result === 0) {
      console.log("Setup successful");
    } else {
      console.log("Unable to setup");
      process.exit(1);
    }
  }

  // Create repository
  {
    const args = {
      repositoryUrl: REPOSITORY_URL,
    };
    const result = await lore.repositoryCreate(GLOBALS, args, {
      callback: event_handler,
    });
    if (result === 0) {
      console.log("Repository created");
    } else {
      console.log("Unable to create repository");
      process.exit(1);
    }
  }

  // Create files to commit to the new repository
  create_files();

  // Stage file
  {
    const args = {
      paths: [
        `./LoreRepositories/${REPOSITORY_NAME}/file.txt`,
        `./LoreRepositories/${REPOSITORY_NAME}/log.txt`,
      ],
    };
    const result = await lore.fileStage(GLOBALS, args, {
      callback: event_handler,
    });
    if (result === 0) {
      console.log("Files staged");
    } else {
      console.log("Unable to stage files");
      process.exit(1);
    }
  }

  // Revision commit
  {
    const args = {
      message: "Initial commit",
    };
    const result = await lore.revisionCommit(GLOBALS, args, {
      callback: event_handler,
    });
    if (result === 0) {
      console.log("Revision commited");
    } else {
      console.log("Unable to commit revision");
      process.exit(1);
    }
  }

  if (ONLINE) {
    // Branch push
    {
      const args = {};
      const result = await lore.branchPush(GLOBALS, args, {
        callback: event_handler,
      });
      if (result === 0) {
        console.log("Branch pushed");
      } else {
        console.log("Unable to push branch");
        process.exit(1);
      }
    }

    // Clone repository
    {
      const args = {
        repositoryUrl: REPOSITORY_URL,
      };
      const result = await lore.repositoryClone(
        {
          ...GLOBALS,
          repositoryPath: `./LoreRepositories/${REPOSITORY_NAME}_clone`,
        },
        args,
        {
          callback: event_handler,
        }
      );
      if (result === 0) {
        console.log("Repository cloned");
      } else {
        console.log("Unable to clone repository");
        process.exit(1);
      }
    }
  }

  // Shutdown
  {
    const result = lore.shutdown();
    if (result === 0) {
      console.log("Shutdown successful");
    } else {
      console.log("Unable to shutdown");
      process.exit(1);
    }
  }
}

run();
