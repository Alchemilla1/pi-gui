import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSshWorkspace } from "@pi-gui/session-driver";

export async function installRemoteHost(workspaceUri: string): Promise<void> {
  const remote = parseSshWorkspace(workspaceUri);
  if (!remote) throw new Error("A valid SSH workspace is required");
  // Bundled beside out/main, and readable through Electron's asar filesystem.
  const bundle = await readFile(join(__dirname, "../remote/host.mjs"));
  const script = [
    "set -eu; umask 077",
    'root="$HOME/.local/share/pi-gui-host"',
    'mkdir -p "$root/bin" "$root/app"',
    "node=$(command -v node || true)",
    'if [ -z "$node" ] && [ -x "$HOME/.local/share/pi-node/current/bin/node" ]; then node="$HOME/.local/share/pi-node/current/bin/node"; fi',
    'test -n "$node" || { echo "Node.js 22.19+ is required on the SSH host" >&2; exit 1; }',
    'sdk=""',
    'if [ -f "$HOME/.pi/agent/install/current-version" ]; then version=$(cat "$HOME/.pi/agent/install/current-version"); sdk="$HOME/.pi/agent/install/releases/$version/node_modules"; fi',
    'if [ -z "$sdk" ]; then sdk=$(PATH="$(dirname "$node"):$PATH" npm root -g 2>/dev/null || true); fi',
    'test -f "$sdk/@earendil-works/pi-coding-agent/package.json" || { echo "Install the Pi npm SDK on the SSH host first" >&2; exit 1; }',
    'if [ -e "$root/app/node_modules" ] && [ ! -L "$root/app/node_modules" ]; then echo "Refusing to replace existing node_modules directory" >&2; exit 1; fi',
    'ln -sfn "$sdk" "$root/app/node_modules"',
    'cat > "$root/app/host.mjs.incoming"',
    'mv "$root/app/host.mjs.incoming" "$root/app/host.mjs"',
    String.raw`printf '#!/bin/sh\nexec "%s" "%s/app/host.mjs" "$@"\n' "$node" "$root" > "$root/bin/pi-gui-host"`,
    'chmod 700 "$root/bin/pi-gui-host"',
  ].join("; ");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ssh",
      ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=12", remote.host, script],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data: string) => {
      output = (output + data).slice(-3000);
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Remote host installation timed out"));
    }, 60000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      code === 0 ? resolve() : reject(new Error(output || `SSH installer exited ${String(code)}`));
    });
    child.stdin.end(bundle);
  });
}
