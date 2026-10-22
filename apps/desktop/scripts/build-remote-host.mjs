import { build } from "esbuild";
await build({
  entryPoints: ["../../packages/pi-sdk-driver/src/remote/host.ts"],
  outfile: "out/remote/host.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["@earendil-works/*"],
  tsconfig: "tsconfig.paths.json",
  logLevel: "info",
});
