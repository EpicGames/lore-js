# Lore JS SDK - Quick Start Guide

Each example exists in two flavors: the default uses the high-level fluent API
(`@lore-vcs/sdk`), and the `:native` variant uses the low-level native API
(`@lore-vcs/sdk/native`), which mirrors the underlying FFI calls.

## Offline vs. online runs

Every example accepts an optional remote URL as the first command-line
argument.

- **No argument** → fully offline run. The example creates a local repository
  and commits a file. Nothing is pushed; nothing is cloned.
- **With argument** (e.g. `lore://localhost`) → online run. The example also
  pushes the revision and clones the repository back.

These examples do not perform authentication. If the remote requires it, run
`lore auth` from the CLI before invoking the example.

### Running a local Lore server

To exercise the online mode of these examples, you can run a Lore server
locally. The steps below build the server from source and configure it for
local development:

1. Clone the Lore repository and build the server in release mode:

   ```bash
   git clone https://github.com/EpicGames/lore.git
   cd lore
   cargo build --release
   ```

2. Create a local config file by copying the example:

   ```bash
   cp lore-server/config/local.toml.example lore-server/config/local.toml
   ```

3. Generate a random secret and set it as `presigned_url_hmac_key` in
   `lore-server/config/local.toml`:

   ```bash
   openssl rand -hex 32
   ```

4. Generate a self-signed TLS certificate (run from the directory where the
   server expects `cert.pem` and `key.pem`):

   ```bash
   openssl req \
     -subj '/CN=localhost:8443/O=Self signed/C=CH' \
     -new -newkey rsa:2048 -sha256 -days 365 -nodes -x509 \
     -keyout key.pem -out cert.pem
   ```

5. Start the server:

   ```bash
   RUST_LOG=info ./target/release/loreserver 2>&1 | tee /tmp/lore.log
   ```

The server is now reachable as `lore://localhost`, which you can pass to the
examples below.

## ESM Examples

Run the ESM example (fluent API):

```bash
# Offline run
pnpm run example:esm

# Online run against a local server
pnpm run example:esm lore://localhost
```

Run the ESM native (low-level) API example:

```bash
# Offline run
pnpm run example:esm:native

# Online run against a local server
pnpm run example:esm:native lore://localhost
```

## CommonJS Examples

Run the CommonJS example (fluent API):

```bash
# Offline run
pnpm run example:cjs

# Online run against a local server
pnpm run example:cjs lore://localhost
```

Run the CommonJS native (low-level) API example:

```bash
# Offline run
pnpm run example:cjs:native

# Online run against a local server
pnpm run example:cjs:native lore://localhost
```
