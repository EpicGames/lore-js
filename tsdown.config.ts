import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["lore_js/**/*.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  unbundle: true,
  external: [
    "koffi",
    "@lore-vcs/sdk-amd64-unknown-linux",
    "@lore-vcs/sdk-amd64-unknown-windows",
    "@lore-vcs/sdk-arm64-apple-darwin",
    "@lore-vcs/sdk-arm64-graviton-linux",
  ],
});
