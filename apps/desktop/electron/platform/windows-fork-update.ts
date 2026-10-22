import { app, net } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, writeFile, readFile, copyFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { forkAssetUrl, validateForkManifest } from "./fork-release";

const execFileAsync = promisify(execFile);
const powershell = () =>
  path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );

/** Keep preparation separate from apply: network failures never close or replace the app. */
export async function prepareWindowsForkUpdate(version: string): Promise<string> {
  if (process.platform !== "win32" || process.arch !== "x64" || !app.isPackaged)
    throw new Error("In-app installation requires a packaged Windows x64 build.");
  const manifestResponse = await net.fetch(forkAssetUrl(version, "pi-gui-update.json"), {
    signal: AbortSignal.timeout(20_000),
  });
  if (!manifestResponse.ok)
    throw new Error("This fork release has no verified Windows update package yet.");
  const manifest = validateForkManifest(await manifestResponse.json(), version);
  const target = path.dirname(process.execPath);
  const relativeData = path.relative(target, app.getPath("userData"));
  if (!relativeData.startsWith("..") && !path.isAbsolute(relativeData))
    throw new Error(
      "User data is inside the installation folder; move it outside before updating.",
    );
  const updateId = randomUUID();
  const updateRoot = path.join(path.dirname(target), ".pi-gui-updates", updateId);
  const healthRoot = path.join(app.getPath("userData"), "updates", updateId);
  await mkdir(updateRoot, { recursive: true });
  await mkdir(healthRoot, { recursive: true });
  const archive = path.join(updateRoot, "package.zip");
  const stage = path.join(updateRoot, "staged");
  const response = await net.fetch(forkAssetUrl(version, manifest.asset), {
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok || !response.body)
    throw new Error(`Update download failed: HTTP ${response.status}`);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const output = await open(archive, "wx");
  const hash = createHash("sha256");
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > manifest.size) throw new Error("Update exceeded its declared size");
      hash.update(value);
      await output.writeFile(value);
    }
  } finally {
    await output.close();
    await reader.cancel();
  }
  if (size !== manifest.size || hash.digest("hex") !== manifest.sha256)
    throw new Error("Update checksum or size mismatch; the installed app was not changed.");
  const extraction = `param([string]$Archive,[string]$Stage)
    $ErrorActionPreference='Stop'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip=[IO.Compression.ZipFile]::OpenRead($Archive)
    try {
      $root=[IO.Path]::GetFullPath($Stage)+[IO.Path]::DirectorySeparatorChar
      $total=[long]0
      foreach($entry in $zip.Entries) {
        $destination=[IO.Path]::GetFullPath((Join-Path $Stage $entry.FullName))
        if(!$destination.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or $entry.FullName.Contains(':')) { throw 'Unsafe archive path' }
        $total += $entry.Length
        if($total -gt 3GB) { throw 'Archive expands beyond size limit' }
      }
    } finally { $zip.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($Archive,$Stage)
    if(!(Test-Path -LiteralPath (Join-Path $Stage 'pi-gui.exe'))) { throw 'Missing application executable' }
    if(!(Test-Path -LiteralPath (Join-Path $Stage 'resources/app.asar'))) { throw 'Missing application archive' }
  `;
  const extractionFile = path.join(updateRoot, "extract.ps1");
  await writeFile(extractionFile, extraction);
  await execFileAsync(
    powershell(),
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      extractionFile,
      "-Archive",
      archive,
      "-Stage",
      stage,
    ],
    { windowsHide: true, timeout: 180_000 },
  );
  // Electron's filesystem reads package metadata directly through the staged asar.
  const metadata: unknown = JSON.parse(
    await readFile(path.join(stage, "resources", "app.asar", "package.json"), "utf8"),
  );
  if (!metadata || (metadata as { version?: string }).version !== version)
    throw new Error("Staged application version does not match its release");
  await copyFile(
    path.join(process.resourcesPath, "apply-fork-update.ps1"),
    path.join(updateRoot, "apply.ps1"),
  );
  const suffix = randomUUID();
  const planFile = path.join(updateRoot, "plan.json");
  await writeFile(
    planFile,
    JSON.stringify({
      target,
      stage,
      backup: `${target}.previous-${suffix}`,
      failed: `${target}.failed-${suffix}`,
      pid: process.pid,
      version,
      healthFile: path.join(healthRoot, "health.json"),
      token: randomUUID(),
    }),
  );
  return planFile;
}

export async function applyPreparedWindowsUpdate(planFile: string): Promise<void> {
  const child = spawn(
    powershell(),
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(path.dirname(planFile), "apply.ps1"),
      "-PlanPath",
      planFile,
    ],
    { detached: true, windowsHide: true, stdio: "ignore" },
  );
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  app.quit();
}

export async function acknowledgeUpdateStartup(): Promise<void> {
  const file = process.env.PI_GUI_UPDATE_HEALTH_FILE;
  const token = process.env.PI_GUI_UPDATE_HEALTH_TOKEN;
  if (!file || !token) return;
  const root = path.join(app.getPath("userData"), "updates") + path.sep;
  if (!path.resolve(file).startsWith(root) || path.basename(file) !== "health.json") return;
  await writeFile(file, JSON.stringify({ token, version: app.getVersion() }));
  delete process.env.PI_GUI_UPDATE_HEALTH_FILE;
  delete process.env.PI_GUI_UPDATE_HEALTH_TOKEN;
}
