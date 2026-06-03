// Copyright Epic Games, Inc. All Rights Reserved.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const libCwd =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

export default join(libCwd, "lorelib-arm64-graviton-linux.so");
