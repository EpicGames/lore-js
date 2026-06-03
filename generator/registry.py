"""
Copyright Epic Games, Inc. All Rights Reserved.

Type registries used by the Jinja templates. Centralizes detection of
`*_array_t` typedefs and the constants that classify Lore C types so each
newly added entry in `lore.h` flows through with minimal template edits.
"""

from itertools import chain

from common import util

# Native C type -> JS type, for use as the inner type of an `[]` alias and as
# the canonical seed for `cToJsTypeMap`. Anything keyed here passes through to
# FFI without struct wrapping. Includes `char*` and `void*` since those are C
# primitives the FFI layer accepts directly (string and opaque byte buffer).
C_TO_JS_NATIVE_MAP = {
    "uintptr_t": "number",
    "uint8_t": "LoreBoolean",
    "uint16_t": "number",
    "uint32_t": "number",
    "uint64_t": "number",
    "int32_t": "number",
    "int64_t": "number",
    "int": "number",
    "lore_node_id_t": "number",
    "char*": "string",
    "void*": "Uint8Array",
}

# Exposed to Jinja as `native_types`. List form preserves the original
# ordering for any future template iteration; `in` checks go through the
# dict directly (see `_array_data_type`).
NATIVE_TYPES = list(C_TO_JS_NATIVE_MAP)

# Functions skipped by the generic function-emit loops in functions-ffi.ji,
# fluent.ji, and index.ji. They have hand-written wrappers elsewhere.
IGNORED_FUNCTIONS = [
    "lore_event_type",
    "lore_shutdown",
    "lore_set_allocator",
    "lore_version",
    "lore_user_directory",
    "lore_log_configure",
]

# Functions that register a long-running Koffi callback listener — these can
# emit events after the Lore call returns and need a different binding shape.
REGISTERED_CALLBACK_FUNCTIONS = ["lore_notification_subscribe"]

# Types that have hand-written TypeScript / Koffi definitions in templates,
# and so should not be auto-emitted from the visitor's struct list.
CUSTOM_TYPES = [
    "lore_string_t",
    "lore_hash_t",
    "lore_context_t",
    "lore_partition_t",
    "lore_address_t",
    "lore_branch_id_t",
    "lore_repository_id_t",
    "lore_instance_id_t",
    "lore_bytes_t",
    "lore_binary_t",
    "lore_event_t",
    "lore_metadata_t",
    "lore_event_callback_config_t",
]

# Hand-written CUSTOM_TYPES whose JS form takes the standard generic params.
# Auto-generated typedefs (anything in visitor.types/events/args that isn't
# in CUSTOM_TYPES) take generics by construction and don't need listing here,
# so this stays small and stable as new array element types are introduced.
GENERIC_CUSTOM_TYPES = {
    "lore_address_t",
    "lore_bytes_t",
    "lore_binary_t",
    "lore_metadata_t",
}

# JS generic parameter names that all auto-generated Lore* types declare.
GENERIC_PARAM_NAMES = (
    "LoreContext",
    "LoreHash",
    "LoreBranchId",
    "LoreRepositoryId",
    "LoreInstanceId",
    "LorePartition",
)
GENERIC_PARAMS = ", ".join(GENERIC_PARAM_NAMES)


def _takes_generics(c_type, visitor):
    """Whether the JS class for `c_type` declares the standard generic params."""
    if c_type in GENERIC_CUSTOM_TYPES:
        return True
    if c_type in CUSTOM_TYPES:
        return False
    return c_type in visitor.types or c_type in visitor.events or c_type in visitor.args


def _array_data_type(element_c_type):
    """Koffi `arrayDataType` string used by koffi.decode."""
    if element_c_type in C_TO_JS_NATIVE_MAP:
        return element_c_type
    if element_c_type.endswith("_t"):
        return util.pascal_case(element_c_type.removesuffix("_t"))
    return element_c_type


def _js_inner_type(element_c_type, visitor):
    """TypeScript type used inside `[]` in the array alias."""
    if element_c_type in C_TO_JS_NATIVE_MAP:
        return C_TO_JS_NATIVE_MAP[element_c_type]
    if element_c_type in visitor.enums:
        return util.pascal_case(element_c_type.removesuffix("_t"))
    if not element_c_type.endswith("_t"):
        return element_c_type
    cls = util.pascal_case(element_c_type.removesuffix("_t"))
    if _takes_generics(element_c_type, visitor):
        return f"{cls}<{GENERIC_PARAMS}>"
    return cls


def _build_c_to_js_type_map(visitor):
    """Build the cToJsTypeMap exposed to Jinja.

    Native entries come from C_TO_JS_NATIVE_MAP. Generic-typed entries are
    auto-derived: every typedef the visitor parsed whose JS class takes the
    standard generic params gets a `Foo<LoreContext, ...>` mapping. New
    auto-generated types pick this up without any registry edits.
    """
    m = dict(C_TO_JS_NATIVE_MAP)
    for c_type in chain(visitor.types, visitor.events, visitor.args):
        if c_type in m or not _takes_generics(c_type, visitor):
            continue
        cls = util.pascal_case(c_type.removesuffix("_t"))
        m[c_type] = f"{cls}<{GENERIC_PARAMS}>"
    return m


def _detect_in(struct_dict, visitor):
    """Find every `*_array_t` struct in `struct_dict` and return a list of dicts.

    Each dict carries everything the templates need so they don't re-derive
    the element type or the FFI string at render time.
    """
    detected = []
    for struct_name, fields in struct_dict.items():
        if not struct_name.endswith("_array_t") or len(fields) != 2:
            continue
        ptr_field_type, ptr_field_name, _, ptr_field_comments = fields[0]
        _, count_field_name, _, _ = fields[1]
        if not ptr_field_type.endswith("*"):
            continue
        element_c_type = ptr_field_type[:-1]
        detected.append(
            {
                "c_type": struct_name,
                "js_class": util.pascal_case(struct_name.removesuffix("_t")),
                "element_c_type": element_c_type,
                "ptr_field": ptr_field_name,
                "ptr_field_comments": ptr_field_comments,
                "count_field": count_field_name,
                "js_inner_type": _js_inner_type(element_c_type, visitor),
                "array_data_type": _array_data_type(element_c_type),
            }
        )
    return detected


def build_augmented(visitor):
    """Return Jinja globals derived from the parsed header.

    Keys exposed to the templates:
        array_types                   - arrays found in visitor.types
        event_array_types             - arrays found in visitor.events
        array_type_map                - lookup by C type, covers both lists
        ignored_functions             - functions skipped by emit loops
        registered_callback_functions - long-running callback functions
        custom_types                  - types with hand-written wrappers
        native_types                  - C scalar types
        cToJsTypeMap                  - C -> TypeScript type lookup
    """
    array_types = _detect_in(visitor.types, visitor)
    event_array_types = _detect_in(visitor.events, visitor)
    array_type_map = {a["c_type"]: a for a in array_types + event_array_types}
    return {
        "array_types": array_types,
        "event_array_types": event_array_types,
        "array_type_map": array_type_map,
        "ignored_functions": IGNORED_FUNCTIONS,
        "registered_callback_functions": REGISTERED_CALLBACK_FUNCTIONS,
        "custom_types": CUSTOM_TYPES,
        "native_types": NATIVE_TYPES,
        "cToJsTypeMap": _build_c_to_js_type_map(visitor),
    }
