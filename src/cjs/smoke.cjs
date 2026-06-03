// Copyright Epic Games, Inc. All Rights Reserved.

/**
 * Smoke test to verify CommonJS imports work correctly.
 * Run with: pnpm test:cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

// Test main entry point (fluent API)
const fluent = require("@lore-vcs/sdk");
assert(fluent.lore, "lore should be defined");
assert(typeof fluent.lore === "object", "lore should be an object");
assert(
  typeof fluent.lore.authUserInfo === "function",
  "lore.authUserInfo should be a function"
);

// Test subpath exports
const { LoreEventTag, LoreLogLevel } = require("@lore-vcs/sdk/types/enums");
assert(LoreEventTag, "LoreEventTag should be defined");
assert(LoreLogLevel, "LoreLogLevel should be defined");

const types = require("@lore-vcs/sdk/types");
assert(types, "types module should be defined");

const events = require("@lore-vcs/sdk/types/events");
assert(events, "events module should be defined");
assert(events.parseLoreEventJSON, "parseLoreEventJSON should be defined");

// Native (low-level) API
const { lore } = require("@lore-vcs/sdk/native");
assert(lore, "native lore should be defined");
assert(
  typeof lore.authUserInfo === "function",
  "native lore.authUserInfo should be a function"
);

const functions = require("@lore-vcs/sdk/functions");
assert(functions, "functions module should be defined");

console.log("CJS import smoke test passed");

// FFI integration test
async function testFFI() {
  const repositoryPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "lore-js-sdk-cjs-test-")
  );

  try {
    const globalArgs = {
      offline: true,
      correlationId: "cjs-smoke-test",
      repositoryPath,
    };

    // Test repositoryCreate
    const createRes = await lore.repositoryCreate(
      globalArgs,
      { repositoryUrl: crypto.randomUUID() },
      {
        userContext: 1,
        callback: () => {},
      }
    );
    assert(
      createRes === 0,
      `repositoryCreate should return 0, got ${createRes}`
    );

    // Test repositoryStatus
    let statusCallbackCalled = false;
    const statusRes = await lore.repositoryStatus(
      globalArgs,
      { staged: true, scan: true },
      {
        userContext: 1,
        callback: (event) => {
          statusCallbackCalled = true;
          // Verify we can access event properties
          assert(typeof event.tag === "number", "event.tag should be a number");
        },
      }
    );
    assert(
      statusRes === 0,
      `repositoryStatus should return 0, got ${statusRes}`
    );
    assert(statusCallbackCalled, "repositoryStatus callback should be called");

    // Flush before cleanup
    await lore.repositoryFlush(globalArgs, {}, { callback: () => {} });

    console.log("CJS FFI smoke test passed");
  } finally {
    // Shutdown and clean up temp directory
    lore.shutdown();
    try {
      fs.rmSync(repositoryPath, {
        recursive: true,
        maxRetries: 3,
        retryDelay: 500,
        force: true,
      });
    } catch (e) {
      console.error("Failed to remove temporary directory", repositoryPath, e);
    }
  }
}

testFFI()
  .then(() => {
    console.log("All CJS smoke tests passed");
    process.exit(0);
  })
  .catch((err) => {
    console.error("CJS smoke test failed:", err);
    process.exit(1);
  });
