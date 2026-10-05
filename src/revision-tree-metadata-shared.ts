// Copyright Epic Games, Inc. All Rights Reserved.

// Shared fixture for the revision-tree metadata tests. Opens an in-memory
// store and loads an empty revision tree so the metadata verbs can be driven
// without a repository on disk.

import { expect } from "vitest";
import { lore } from "@lore-vcs/sdk/native";
import { LoreEventTag, LoreLogLevel } from "@lore-vcs/sdk/types/enums";
import { LoreEventFFI, LoreEvent } from "@lore-vcs/sdk/types/events";
import { LoreMetadata, LoreRevisionTree, LoreStore } from "@lore-vcs/sdk/types";
import { LoreGlobalArgs } from "@lore-vcs/sdk/types/args";

export const globalArgs: LoreGlobalArgs = { offline: true };

// 16-byte identifiers are 32 hex chars; a hash is 64 hex chars.
export const REPOSITORY_ID = "0123456789abcdef0123456789abcdef";
export const EMPTY_REVISION = "0".repeat(64);

export const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
};

export const collectEvents = () => {
  const events: LoreEvent[] = [];
  const logs: string[] = [];
  const callback = (event: LoreEventFFI) => {
    if (event.tag === LoreEventTag.LOG) {
      if (event.data.level >= LoreLogLevel.DEBUG) {
        logs.push(event.data.message);
      }
      return;
    }
    events.push(event.clone());
  };
  const ofTag = <T extends LoreEventTag>(tag: T) =>
    events.filter((e) => e.tag === tag) as Extract<LoreEvent, { tag: T }>[];
  return { callback, events, logs, ofTag };
};

export const openTree = async (): Promise<{
  store: LoreStore;
  handle: LoreRevisionTree;
}> => {
  lore.logConfigure({ level: LoreLogLevel.DEBUG });

  const open = collectEvents();
  const openRes = await lore.storageOpen(
    globalArgs,
    { repositoryPath: "", inMemory: true },
    { callback: open.callback }
  );
  expect(openRes, open.logs.join("\n")).toBe(0);
  const opened = open.ofTag(LoreEventTag.STORAGE_OPENED);
  expect(opened.length).toBe(1);
  const store: LoreStore = { handleId: opened[0].data.handleId };

  const load = collectEvents();
  const loadRes = await lore.revisionTreeLoad(
    globalArgs,
    { store, repository: REPOSITORY_ID, revisionHash: EMPTY_REVISION },
    { callback: load.callback }
  );
  expect(loadRes, load.logs.join("\n")).toBe(0);
  const loaded = load.ofTag(LoreEventTag.REVISION_TREE_LOADED);
  expect(loaded.length).toBe(1);
  const handle: LoreRevisionTree = { handleId: loaded[0].data.handleId };

  return { store, handle };
};

export const closeTree = async (store: LoreStore, handle: LoreRevisionTree) => {
  await lore.revisionTreeClose(
    globalArgs,
    { id: 1, handle },
    { callback: () => {} }
  );
  await lore.storageClose(globalArgs, { handle: store }, { callback: () => {} });
};

export const setMetadataEntries = async (
  handle: LoreRevisionTree,
  entries: { key: string; value: LoreMetadata }[]
) => {
  const c = collectEvents();
  const res = await lore.revisionTreeMetadataSet(
    globalArgs,
    {
      batchId: 7,
      handle,
      entries: entries.map((entry, i) => ({ entryId: i + 1, ...entry })),
    },
    { callback: c.callback }
  );
  return {
    res,
    logs: c.logs,
    entries: c.ofTag(LoreEventTag.REVISION_TREE_METADATA_SET_COMPLETE),
    batch: c.ofTag(LoreEventTag.REVISION_TREE_BATCH_COMPLETE)[0],
  };
};

export const setMetadata = async (
  handle: LoreRevisionTree,
  key: string,
  value: LoreMetadata
) => {
  const { res, logs, entries, batch } = await setMetadataEntries(handle, [
    { key, value },
  ]);
  return { res, logs, entry: entries[0], batch };
};

export const getMetadataKeys = async (
  handle: LoreRevisionTree,
  keys: string[],
  includeRevision = false
) => {
  const c = collectEvents();
  const res = await lore.revisionTreeMetadataGet(
    globalArgs,
    {
      batchId: 8,
      handle,
      includeRevision,
      entries: keys.map((key, i) => ({ entryId: i + 1, key })),
    },
    { callback: c.callback }
  );
  return {
    res,
    logs: c.logs,
    values: c.ofTag(LoreEventTag.REVISION_TREE_METADATA_GET_COMPLETE),
    batch: c.ofTag(LoreEventTag.REVISION_TREE_BATCH_COMPLETE)[0],
  };
};

export const getMetadata = async (handle: LoreRevisionTree, key: string) => {
  const { res, logs, values, batch } = await getMetadataKeys(handle, [key]);
  return { res, logs, value: values[0], batch };
};
