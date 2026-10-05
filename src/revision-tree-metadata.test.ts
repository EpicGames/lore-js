// Copyright Epic Games, Inc. All Rights Reserved.

// Round-trips every `LoreMetadata` kind through `revisionTreeMetadataSet`
// and `revisionTreeMetadataGet`. Guards the marshaling of the
// `lore_metadata_t` union on both the input and the output path. The binary
// cases live in their own files because a regression there can crash the
// worker process.

import { expect, test, describe, beforeEach, afterEach } from "vitest";
import {
  LoreErrorCode,
  LoreEventTag,
  LoreMetadataType,
} from "@lore-vcs/sdk/types/enums";
import {
  LoreMetadata,
  LoreRevisionTree,
  LoreStore,
} from "@lore-vcs/sdk/types";
import { parseLoreEventJSON } from "@lore-vcs/sdk/types/events";
import { lore } from "@lore-vcs/sdk/native";
import {
  closeTree,
  EMPTY_REVISION,
  getMetadata,
  getMetadataKeys,
  globalArgs,
  hexToBytes,
  openTree,
  REPOSITORY_ID,
  setMetadata,
  setMetadataEntries,
} from "./revision-tree-metadata-shared";

describe("revisionTreeLoad argument marshaling", () => {
  test("accepts a hex revisionHash", async () => {
    // The fixture opens a store and loads a tree with `revisionHash` given as
    // a 64-char hex string; it asserts the load succeeded. Re-load on the same
    // store here so the hash conversion is exercised on an explicit call too.
    const { store, handle } = await openTree();
    let loadedHandleId: number | undefined;
    const res = await lore.revisionTreeLoad(
      globalArgs,
      { store, repository: REPOSITORY_ID, revisionHash: EMPTY_REVISION },
      {
        callback: (event) => {
          if (event.tag === LoreEventTag.REVISION_TREE_LOADED) {
            loadedHandleId = event.data.handleId;
          }
        },
      }
    );
    expect(res).toBe(0);
    expect(loadedHandleId).toBeDefined();
    await lore.revisionTreeClose(
      globalArgs,
      { id: 2, handle: { handleId: loadedHandleId! } },
      { callback: () => {} }
    );
    await closeTree(store, handle);
  });
});

describe("revisionTreeMetadataSet value marshaling", () => {
  let store: LoreStore;
  let handle: LoreRevisionTree;

  beforeEach(async () => {
    ({ store, handle } = await openTree());
  });

  afterEach(async () => {
    await closeTree(store, handle);
  });

  test("string value is stored and read back", async () => {
    const set = await setMetadata(handle, "note", {
      tag: LoreMetadataType.STRING,
      tagName: "string",
      data: "hello metadata",
    });
    expect(set.res, set.logs.join("\n")).toBe(0);
    expect(set.entry?.data.errorCode).toBe(LoreErrorCode.NONE);
    expect(set.batch?.data.errorCode).toBe(LoreErrorCode.NONE);

    const got = await getMetadata(handle, "note");
    expect(got.res, got.logs.join("\n")).toBe(0);
    expect(got.value).toBeDefined();
    expect(got.value?.data.value.tag).toBe(LoreMetadataType.STRING);
    expect(got.value?.data.value.data).toBe("hello metadata");
  });

  test("branch id (context) value is stored and read back as the same id", async () => {
    const branchId = "00112233445566778899aabbccddeeff";
    const set = await setMetadata(handle, "branch", {
      tag: LoreMetadataType.CONTEXT,
      tagName: "context",
      data: branchId,
    });
    expect(set.res, set.logs.join("\n")).toBe(0);
    expect(set.entry?.data.errorCode).toBe(LoreErrorCode.NONE);
    expect(set.batch?.data.errorCode).toBe(LoreErrorCode.NONE);

    const got = await getMetadata(handle, "branch");
    expect(got.res, got.logs.join("\n")).toBe(0);
    expect(got.value).toBeDefined();
    expect(got.value?.data.value.tag).toBe(LoreMetadataType.CONTEXT);
    expect(got.value?.data.value.data).toBe(branchId);
  });

  test("branch id given as 16 raw bytes is stored and read back as the same id", async () => {
    const branchId = "00112233445566778899aabbccddeeff";
    const set = await setMetadata(handle, "branch", {
      tag: LoreMetadataType.CONTEXT,
      tagName: "context",
      data: hexToBytes(branchId) as unknown as string,
    });
    expect(set.res, set.logs.join("\n")).toBe(0);
    expect(set.entry?.data.errorCode).toBe(LoreErrorCode.NONE);
    expect(set.batch?.data.errorCode).toBe(LoreErrorCode.NONE);

    const got = await getMetadata(handle, "branch");
    expect(got.res, got.logs.join("\n")).toBe(0);
    expect(got.value).toBeDefined();
    expect(got.value?.data.value.tag).toBe(LoreMetadataType.CONTEXT);
    expect(got.value?.data.value.data).toBe(branchId);
  });

  test("numeric value is stored and read back", async () => {
    const set = await setMetadata(handle, "count", {
      tag: LoreMetadataType.NUMERIC,
      tagName: "numeric",
      data: 42,
    });
    expect(set.res, set.logs.join("\n")).toBe(0);
    expect(set.entry?.data.errorCode).toBe(LoreErrorCode.NONE);

    const got = await getMetadata(handle, "count");
    expect(got.res, got.logs.join("\n")).toBe(0);
    expect(got.value?.data.value.tag).toBe(LoreMetadataType.NUMERIC);
    expect(got.value?.data.value.data).toBe(42);
  });

  test("address value is stored and read back", async () => {
    const address = {
      hash: "a".repeat(64),
      context: "00112233445566778899aabbccddeeff",
    };
    const set = await setMetadata(handle, "addr", {
      tag: LoreMetadataType.ADDRESS,
      tagName: "address",
      data: address,
    });
    expect(set.res, set.logs.join("\n")).toBe(0);
    expect(set.entry?.data.errorCode).toBe(LoreErrorCode.NONE);

    const got = await getMetadata(handle, "addr");
    expect(got.res, got.logs.join("\n")).toBe(0);
    expect(got.value?.data.value.tag).toBe(LoreMetadataType.ADDRESS);
    expect(got.value?.data.value.data).toEqual(address);
  });

  test("hash value is stored and read back", async () => {
    const hash = "0123456789abcdef".repeat(4);
    const set = await setMetadata(handle, "hash", {
      tag: LoreMetadataType.HASH,
      tagName: "hash",
      data: hash,
    });
    expect(set.res, set.logs.join("\n")).toBe(0);
    expect(set.entry?.data.errorCode).toBe(LoreErrorCode.NONE);

    const got = await getMetadata(handle, "hash");
    expect(got.res, got.logs.join("\n")).toBe(0);
    expect(got.value?.data.value.tag).toBe(LoreMetadataType.HASH);
    expect(got.value?.data.value.data).toBe(hash);
  });

  test("numeric value above 2^53 keeps its precision as a bigint", async () => {
    const big = 2n ** 64n - 1n;
    const set = await setMetadata(handle, "big", {
      tag: LoreMetadataType.NUMERIC,
      tagName: "numeric",
      data: big,
    });
    expect(set.res, set.logs.join("\n")).toBe(0);
    expect(set.entry?.data.errorCode).toBe(LoreErrorCode.NONE);

    const got = await getMetadata(handle, "big");
    expect(got.res, got.logs.join("\n")).toBe(0);
    expect(got.value?.data.value.tag).toBe(LoreMetadataType.NUMERIC);
    expect(got.value?.data.value.data).toBe(big);
  });

  test("value given with only a tagName is accepted", async () => {
    const value = { tagName: "string", data: "by name" } as LoreMetadata;
    const set = await setMetadata(handle, "named", value);
    expect(set.res, set.logs.join("\n")).toBe(0);
    expect(set.entry?.data.errorCode).toBe(LoreErrorCode.NONE);

    const got = await getMetadata(handle, "named");
    expect(got.res, got.logs.join("\n")).toBe(0);
    expect(got.value?.data.value.tag).toBe(LoreMetadataType.STRING);
    expect(got.value?.data.value.data).toBe("by name");
  });

  test("a batch of mixed entries is stored and read back in one call", async () => {
    const blob = Uint8Array.from({ length: 24 }, (_, i) => 255 - i);
    const entries: { key: string; value: LoreMetadata }[] = [
      {
        key: "s1",
        value: { tag: LoreMetadataType.STRING, tagName: "string", data: "one" },
      },
      {
        key: "b1",
        value: { tag: LoreMetadataType.BINARY, tagName: "binary", data: blob },
      },
      {
        key: "s2",
        value: { tag: LoreMetadataType.STRING, tagName: "string", data: "two" },
      },
      {
        key: "n1",
        value: { tag: LoreMetadataType.NUMERIC, tagName: "numeric", data: 7 },
      },
      {
        key: "c1",
        value: {
          tag: LoreMetadataType.CONTEXT,
          tagName: "context",
          data: "ffeeddccbbaa99887766554433221100",
        },
      },
    ];
    const set = await setMetadataEntries(handle, entries);
    expect(set.res, set.logs.join("\n")).toBe(0);
    expect(set.entries.map((e) => e.data.entryId).sort()).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(set.entries.every((e) => e.data.errorCode === LoreErrorCode.NONE)).toBe(
      true
    );
    expect(set.batch?.data.errorCode).toBe(LoreErrorCode.NONE);

    const got = await getMetadataKeys(
      handle,
      entries.map((e) => e.key)
    );
    expect(got.res, got.logs.join("\n")).toBe(0);
    expect(got.values.length).toBe(entries.length);
    const byKey = new Map(got.values.map((v) => [v.data.key, v.data.value]));
    expect(byKey.get("s1")?.data).toBe("one");
    expect(byKey.get("s2")?.data).toBe("two");
    expect(byKey.get("n1")?.data).toBe(7);
    expect(byKey.get("c1")?.data).toBe("ffeeddccbbaa99887766554433221100");
    expect(Buffer.from(byKey.get("b1")?.data as Uint8Array)).toEqual(
      Buffer.from(blob)
    );
  });

  test("absent key emits no value event, with and without includeRevision", async () => {
    for (const includeRevision of [false, true]) {
      const got = await getMetadataKeys(handle, ["missing"], includeRevision);
      expect(got.res, got.logs.join("\n")).toBe(0);
      expect(got.values.length).toBe(0);
      expect(got.batch?.data.errorCode).toBe(LoreErrorCode.NONE);
    }
  });

  test("metadata get event survives a JSON round trip without its numeric tag", async () => {
    const branchId = "00112233445566778899aabbccddeeff";
    await setMetadata(handle, "branch", {
      tag: LoreMetadataType.CONTEXT,
      tagName: "context",
      data: branchId,
    });
    const got = await getMetadata(handle, "branch");
    expect(got.value).toBeDefined();

    // Strip the numeric tag so the parser has to recover it from tagName.
    const json = JSON.parse(JSON.stringify(got.value));
    delete json.data.value.tag;
    const parsed = parseLoreEventJSON(JSON.stringify(json));
    if (parsed.tagName !== "revisionTreeMetadataGetComplete") {
      throw new Error(`unexpected event ${parsed.tagName}`);
    }
    expect(parsed.data.value.tag).toBe(LoreMetadataType.CONTEXT);
    expect(parsed.data.value.data).toBe(branchId);
    expect(parsed.data.key).toBe("branch");
  });

  test("boolean value is stored and read back", async () => {
    const set = await setMetadata(handle, "flag", {
      tag: LoreMetadataType.BOOLEAN,
      tagName: "boolean",
      data: true,
    });
    expect(set.res, set.logs.join("\n")).toBe(0);
    expect(set.entry?.data.errorCode).toBe(LoreErrorCode.NONE);

    const got = await getMetadata(handle, "flag");
    expect(got.res, got.logs.join("\n")).toBe(0);
    expect(got.value?.data.value.tag).toBe(LoreMetadataType.BOOLEAN);
    expect(got.value?.data.value.data).toBe(true);
  });
});
