// Copyright Epic Games, Inc. All Rights Reserved.

// Binary value round trips for `revisionTreeMetadataSet`. Kept in its own
// file because a mis-marshaled `lore_binary_t` pointer segfaults the worker,
// which would otherwise take the rest of the metadata tests down with it.

import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { LoreErrorCode, LoreMetadataType } from "@lore-vcs/sdk/types/enums";
import { LoreRevisionTree, LoreStore } from "@lore-vcs/sdk/types";
import {
  closeTree,
  getMetadata,
  openTree,
  setMetadata,
} from "./revision-tree-metadata-shared";

describe("revisionTreeMetadataSet binary value marshaling", () => {
  let store: LoreStore;
  let handle: LoreRevisionTree;

  beforeEach(async () => {
    ({ store, handle } = await openTree());
  });

  afterEach(async () => {
    await closeTree(store, handle);
  });

  const roundTrip = async (bytes: Uint8Array) => {
    const set = await setMetadata(handle, "blob", {
      tag: LoreMetadataType.BINARY,
      tagName: "binary",
      data: bytes,
    });
    expect(set.res, set.logs.join("\n")).toBe(0);
    expect(set.entry?.data.errorCode).toBe(LoreErrorCode.NONE);
    expect(set.batch?.data.errorCode).toBe(LoreErrorCode.NONE);

    const got = await getMetadata(handle, "blob");
    expect(got.res, got.logs.join("\n")).toBe(0);
    expect(got.value).toBeDefined();
    expect(got.value?.data.value.tag).toBe(LoreMetadataType.BINARY);
    expect(
      Buffer.from(got.value?.data.value.data as unknown as Uint8Array)
    ).toEqual(Buffer.from(bytes));
  };

  test("short byte array value is stored and read back", async () => {
    await roundTrip(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  });

  test("byte array longer than the union is stored and read back", async () => {
    // Regression: when the union was marshaled as raw bytes, an array this
    // long put non-zero garbage into the pointer and length the native side
    // read, and the process crashed with SIGSEGV.
    await roundTrip(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
  });

  test("empty byte array value is stored and read back", async () => {
    await roundTrip(new Uint8Array(0));
  });
});
