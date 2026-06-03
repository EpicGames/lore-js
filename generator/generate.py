"""
Copyright Epic Games, Inc. All Rights Reserved.

Generate lorelib wrappers based on Jinja2 template.
"""

import os
import shutil
import sys

import common.visitor
from common.generate import generate_templates
from registry import build_augmented
from common.find_lorelib import (
    LIB_DIR,
    SYSTEM,
    MACHINE,
    _wheel_lib_name,
)

SCRIPT_DIR = os.path.dirname(__file__)
HEADER_FILE = os.path.join(SCRIPT_DIR, "../lore/include/lore.h")
TEMPLATES_DIR = os.path.join(SCRIPT_DIR, "templates")
SDK_DIR = os.path.join(SCRIPT_DIR, "../lore_js")
TYPES_DIR = os.path.join(SDK_DIR, "types")
ARGS_DIR = os.path.join(TYPES_DIR, "args")
ENUMS_DIR = os.path.join(TYPES_DIR, "enums")
EVENTS_DIR = os.path.join(TYPES_DIR, "events")
FUNCTIONS_DIR = os.path.join(SDK_DIR, "functions")
NATIVE_DIR = os.path.join(SDK_DIR, "native")

GENERATE_TARGETS = [
    ("native.ji", NATIVE_DIR, "index.ts"),
    ("types.ji", TYPES_DIR, "index.ts"),
    ("types-ffi.ji", TYPES_DIR, "ffi.ts"),
    ("args.ji", ARGS_DIR, "index.ts"),
    ("args-ffi.ji", ARGS_DIR, "ffi.ts"),
    ("enums.ji", ENUMS_DIR, "index.ts"),
    ("enums-ffi.ji", ENUMS_DIR, "ffi.ts"),
    ("events.ji", EVENTS_DIR, "index.ts"),
    ("events-ffi.ji", EVENTS_DIR, "ffi.ts"),
    ("functions.ji", FUNCTIONS_DIR, "index.ts"),
    ("functions-ffi.ji", FUNCTIONS_DIR, "ffi.ts"),
    ("fluent.ji", SDK_DIR, "index.ts"),
]


def _platform_lib_directory():
    if SYSTEM == "windows":
        return os.path.join("npm", "amd64-unknown-windows")
    elif SYSTEM == "linux":
        if MACHINE in ("arm64", "aarch64"):
            return os.path.join("npm", "arm64-graviton-linux")
        return os.path.join("npm", "amd64-unknown-linux")
    elif SYSTEM == "darwin":
        return os.path.join("npm", "arm64-apple-darwin")
    else:
        sys.exit(f"unsupported platform found: {SYSTEM}")


def copy_lib_to_npm_dir():
    """Copies the shared lib binary under npm package directory"""
    lib_file = _wheel_lib_name()
    src_lib = os.path.join(LIB_DIR, lib_file)
    dst_lib = os.path.join(_platform_lib_directory(), lib_file)

    print(f"Copying lore library to {dst_lib}")
    shutil.copy(
        src_lib,
        dst_lib,
    )


generate_templates(
    HEADER_FILE,
    TEMPLATES_DIR,
    GENERATE_TARGETS,
    common.visitor.LoreVisitor,
    build_augmented,
)

print("Copying the native library", end=" ")
copy_lib_to_npm_dir()
print("done.")
