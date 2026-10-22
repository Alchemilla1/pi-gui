import { expect, test } from "@playwright/test";
import {
  validateForkManifest,
  forkAssetUrl,
  FORK_REPOSITORY,
} from "../../electron/platform/fork-release";

const valid = {
  schema: 1,
  repository: FORK_REPOSITORY,
  version: "1.1.0",
  platform: "win32",
  arch: "x64",
  asset: "pi-gui-1.1.0-win-x64.zip",
  sha256: "a".repeat(64),
  size: 1024,
};
test("updates are pinned to the fork and exact stable version", () => {
  expect(validateForkManifest(valid, "1.1.0")).toEqual(valid);
  expect(forkAssetUrl("1.1.0", valid.asset)).toBe(
    "https://github.com/Alchemilla1/pi-gui/releases/download/v1.1.0/pi-gui-1.1.0-win-x64.zip",
  );
  for (const version of ["../main", "1.1.0-beta.1", "latest"])
    expect(() => forkAssetUrl(version, valid.asset)).toThrow();
  expect(() => forkAssetUrl("1.1.0", "../../other.zip")).toThrow();
});
test("reject foreign, mismatched, oversized and malformed release payloads", () => {
  for (const patch of [
    { repository: "minghinmatthewlam/pi-gui" },
    { version: "1.2.0" },
    { arch: "arm64" },
    { platform: "linux" },
    { asset: "pi-gui.exe" },
    { sha256: "invalid" },
    { size: -1 },
    { size: 0 },
    { size: 1e12 },
    { schema: 2 },
  ]) {
    expect(() => validateForkManifest({ ...valid, ...patch }, "1.1.0")).toThrow();
  }
  expect(() => validateForkManifest(null, "1.1.0")).toThrow();
});
