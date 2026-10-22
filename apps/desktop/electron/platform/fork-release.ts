export const FORK_REPOSITORY = "Alchemilla1/pi-gui";
export const FORK_RELEASES_PAGE = `https://github.com/${FORK_REPOSITORY}/releases`;
export const FORK_RELEASE_API = `https://api.github.com/repos/${FORK_REPOSITORY}/releases/latest`;

export interface ForkUpdateManifest {
  readonly schema: 1;
  readonly repository: typeof FORK_REPOSITORY;
  readonly version: string;
  readonly platform: "win32";
  readonly arch: "x64";
  readonly asset: string;
  readonly sha256: string;
  readonly size: number;
}

export function validateForkManifest(value: unknown, version: string): ForkUpdateManifest {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Updates require a stable fork version");
  const data = value as Partial<ForkUpdateManifest> | null;
  if (
    !data ||
    data.schema !== 1 ||
    data.repository !== FORK_REPOSITORY ||
    data.version !== version ||
    data.platform !== "win32" ||
    data.arch !== "x64" ||
    data.asset !== `pi-gui-${version}-win-x64.zip` ||
    typeof data.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.sha256) ||
    !Number.isSafeInteger(data.size) ||
    !data.size ||
    data.size < 0 ||
    data.size > 800 * 1024 * 1024
  ) {
    throw new Error("Invalid fork update manifest");
  }
  return data as ForkUpdateManifest;
}

export function forkAssetUrl(version: string, asset: string): string {
  if (
    !/^\d+\.\d+\.\d+$/.test(version) ||
    !["pi-gui-update.json", `pi-gui-${version}-win-x64.zip`].includes(asset)
  ) {
    throw new Error("Invalid fork update asset");
  }
  return `https://github.com/${FORK_REPOSITORY}/releases/download/v${version}/${asset}`;
}
