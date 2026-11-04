"""
Copyright Epic Games, Inc. All Rights Reserved.

Gets the Lore header and lib

LORE_BUILD_PATH: Use a locally build lorelib or a pre-built lorelib
LORE_JS_TARGET: On arm64 Linux, the npm package to build: arm64-graviton-linux
                (default, Graviton3+ tuned) or arm64-unknown-linux (generic).
                Both libraries arrive as the same liblore.so, so the host
                cannot tell them apart.
"""

import os
import platform
import re
import shutil
import sys

LORE_BUILD_PATH = os.environ.get("LORE_BUILD_PATH")

SYSTEM = platform.system().lower()
MACHINE = platform.machine().lower().replace("x86_64", "amd64")

WINDOWS_LIB_NAME = "lorelib-amd64-unknown-windows.dll"
DARWIN_LIB_NAME = "lorelib-arm64-apple-darwin.dylib"
LINUX_ARM_LIB_NAMES = {
    "arm64-graviton-linux": "lorelib-arm64-graviton-linux.so",
    "arm64-unknown-linux": "lorelib-arm64-unknown-linux.so",
}
LINUX_ARM_DEFAULT_TARGET = "arm64-graviton-linux"
LINUX_X64_LIB_NAME = "lorelib-amd64-unknown-linux.so"

HEADER_NAME_RE = re.compile(r"^lore(-v\d+\.\d+\.\d+(-nightly-\d+(-[\w.-]+)?)?)?\.h$")

INC_DIR = os.path.join("lore", "include")
LIB_DIR = os.path.join("lore", "lib")


def _copy_header():
    matches = [
        name for name in os.listdir(LORE_BUILD_PATH) if HEADER_NAME_RE.match(name)
    ]
    if not matches:
        sys.exit(
            f"No Lore header found in {LORE_BUILD_PATH} "
            f"(expected lore.h, lore-vX.Y.Z.h, or lore-vX.Y.Z-nightly-REVISION[-NAME].h)"
        )
    if len(matches) > 1:
        sys.exit(
            f"Multiple Lore headers found in {LORE_BUILD_PATH}: "
            f"{sorted(matches)}. Remove all but one before building."
        )
    header_path = os.path.join(LORE_BUILD_PATH, matches[0])
    shutil.copy(header_path, os.path.join(INC_DIR, "lore.h"))


def _wheel_lib_name():
    if SYSTEM == "windows":
        return WINDOWS_LIB_NAME
    elif SYSTEM == "linux":
        if MACHINE in ("arm64", "aarch64"):
            target = os.environ.get("LORE_JS_TARGET") or LINUX_ARM_DEFAULT_TARGET
            if target not in LINUX_ARM_LIB_NAMES:
                sys.exit(
                    f"LORE_JS_TARGET={target} is not an arm64 Linux target "
                    f"(expected one of {sorted(LINUX_ARM_LIB_NAMES)})"
                )
            return LINUX_ARM_LIB_NAMES[target]
        return LINUX_X64_LIB_NAME
    elif SYSTEM == "darwin":
        return DARWIN_LIB_NAME
    else:
        sys.exit(f"unsupported platform found: {SYSTEM}")


def _copy_lib():
    if SYSTEM == "windows":
        prefix, ext, tag = "lore", "dll", ""
    elif SYSTEM == "linux":
        prefix, ext = "liblore", "so"
        tag = "linux-arm64" if MACHINE in ("arm64", "aarch64") else "linux-x86_64"
    elif SYSTEM == "darwin":
        prefix, ext, tag = "liblore", "dylib", "macos-arm64"
    else:
        sys.exit(f"unsupported platform found: {SYSTEM}")

    tag_suffix = f"-{tag}" if tag else ""
    pattern = re.compile(
        rf"^{prefix}(-v\d+\.\d+\.\d+(-nightly-\d+(-[\w.-]+?)?)?{tag_suffix})?\.{ext}$"
    )

    matches = [name for name in os.listdir(LORE_BUILD_PATH) if pattern.match(name)]
    if not matches:
        sys.exit(
            f"No Lore library found in {LORE_BUILD_PATH} for {SYSTEM}/{MACHINE} "
            f"(expected {prefix}.{ext} or "
            f"{prefix}-vX.Y.Z[-nightly-REVISION[-NAME]]{tag_suffix}.{ext})"
        )
    if len(matches) > 1:
        sys.exit(
            f"Multiple Lore libraries found in {LORE_BUILD_PATH}: "
            f"{sorted(matches)}. Remove all but one before building."
        )

    src_lib = os.path.join(LORE_BUILD_PATH, matches[0])
    dst_lib = os.path.join(LIB_DIR, _wheel_lib_name())
    shutil.copy(src_lib, dst_lib)


def main():
    """Gets the Lore header and library from a pre-built binary or a local build"""

    if not LORE_BUILD_PATH:
        sys.exit("LORE_BUILD_PATH must be set")

    print(f"Creating include folder: {INC_DIR}")
    os.makedirs(INC_DIR, exist_ok=True)

    print(f"Creating include folder: {LIB_DIR}")
    os.makedirs(LIB_DIR, exist_ok=True)

    _copy_header()
    _copy_lib()


if __name__ == "__main__":
    main()
