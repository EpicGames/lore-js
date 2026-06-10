# Lore JavaScript SDK

## About
This repository contains tools to exend Lore with JavaScript and TypeScript. 

Lore is an open source version control system that is designed for unprecedented scalability of both data and teams. It is optimized for projects that combine code with large binary assets, including games and entertainment, and caters for the needs of developers and artists alike. 

For full Lore documentation, architecture details, and contribution guidelines, visit the [main Lore repository](https://github.com/EpicGames/lore).

## Install

### Stable Release

```bash
npm install @lore-vcs/sdk
```

### Nightly Build

Nightly builds are published to npm under the `nightly` dist-tag. To install the latest nightly:

```bash
npm install @lore-vcs/sdk@nightly
```

To install a specific nightly, browse the [release history](https://www.npmjs.com/package/@lore-vcs/sdk?activeTab=versions) and pin the exact version:

```bash
npm install @lore-vcs/sdk@0.6.0-nightly.1
```

## Minimal example

The default entry point (`@lore-vcs/sdk`) exposes the high-level fluent API. A low-level, C-like wrapper around the underlying FFI is also available under `@lore-vcs/sdk/native` for advanced use cases.

```typescript
import { lore } from "@lore-vcs/sdk";
import { LoreEventTag, LoreLogLevel } from "@lore-vcs/sdk/types/enums";
import type { LoreEventFFI } from "@lore-vcs/sdk/types/events";
import type {
  LoreGlobalArgs,
  LoreRepositoryStatusArgs,
} from "@lore-vcs/sdk/types/args";

lore.logConfigure({
  file: true,
  filePath: "/path/to/log/directory",
  level: LoreLogLevel.DEBUG,
});

const globals: LoreGlobalArgs = {
  repositoryPath: "/path/to/local/repository",
};
const args: LoreRepositoryStatusArgs = {
  staged: true,
  scan: true,
};
await lore
  .repositoryStatus(globals, args)
  .callback((event: LoreEventFFI) => {
    if (event.tag === LoreEventTag.REPOSITORY_STATUS_FILE) {
      console.log(event.data);
    }
  })
  .waitAsync();
```

For comprehensive examples, see [examples/esm/example.ts](examples/esm/example.ts) (fluent) and [examples/esm/example-native.ts](examples/esm/example-native.ts) (low-level).

## Contributing

### Set up your dev environment

1. Clone the Lore JS SDK repository:

```bash
git clone https://github.com/EpicGames/lore-js
```

2. (Optional) Create a Python virtual environment for the binding generator:

```bash
uv venv .venv
source .venv/bin/activate
```

3. Install the Python modules used by the binding generator:

```bash
uv pip install jinja2 pycparser
```

4. Install NPM dependencies:

```bash
pnpm install --frozen-lockfile
```

### Get the Lore library

The SDK binds against the Lore C library. Pick one of the two options below depending on whether you're also modifying the Lore core.

#### Option A — build the library from Lore source

Use this when you're changing the Lore C/Rust core alongside the JS SDK.

1. Clone [Lore's repository](https://github.com/EpicGames/lore) and build it:

```bash
cargo build --release
```

#### Option B — fetch a pre-built Lore library

Use this when you only need to develop the JS SDK against an existing Lore version.

1. Download the header and binaries from [Lore's repository](https://github.com/EpicGames/lore) release page.

### Generate the JS bindings

1. Point `LORE_BUILD_PATH` at the library directory from the previous section:

```bash
export LORE_BUILD_PATH="<path-to>/lore/"
```

2. Generate the bindings and build the SDK:

```bash
uv run python find_lorelib.py
uv run python generator/generate.py
pnpm run build
```

3. Any edits you now make under `lore_js/` are picked up by re-running `pnpm run build`. If you change anything under `generator/templates/` or pull a new Lore pre-built binary, re-run step 2 to regenerate the bindings.

### Run the examples

With the dev environment set up, a Lore library available, and the JS bindings generated, run an example from the repository root:

```bash
pnpm --filter examples run example:esm
pnpm --filter examples run example:esm:native
```

See [examples/README.md](examples/README.md) for the full list (ESM and CommonJS, fluent and native).

### Run the test suite

```bash
pnpm test
```

## Releasing

Assumes the dev environment from [Contributing](#contributing) is set up, that is, the Lore library has been built or fetched and JS bindings regenerated against the version you're releasing.

### Bump the version

```bash
# To sync the NPM version with the env variable LORE_VERSION:
pnpm run version:update
# To set a custom version:
pnpm run version:update:to 0.0.1-custom-test
```

### Publish to npm

1. Log in to npm with an account that has publish rights on the `@lore-vcs` scope:

```bash
npm login
```

2. Publish:

```bash
npm publish
```
