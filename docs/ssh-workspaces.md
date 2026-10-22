# SSH workspaces (fork preview)

Use the arrow beside Open Folder in the native sidebar. Enter an SSH config alias
and an absolute Linux project directory. Authentication uses system OpenSSH in
BatchMode; configure and verify key-based SSH first. Node and Pi must already be
installed remotely.

The desktop installs a small host under `~/.local/share/pi-gui-host`. Its private
socket and catalog are under `~/.pi-gui-host`. The host starts on demand and owns
Pi SDK sessions, preserving the ordinary Pi JSONL history and session leases.
SSH disconnection does not cancel a running inference. Ambiguous failed writes
are not retried automatically.

Native thread, transcript and scheduler surfaces are reused. Registered local
and SSH workspaces appear in the desktop's thread tools. Thread identifiers include
the workspace; ambiguous bare UUIDs are rejected. Remote agents call the desktop
thread and schedule tools through their owning SSH connection. These tools require
the desktop to remain connected. Scheduled jobs are stored and dispatched by the
desktop: the local computer and GUI must remain running at the scheduled time.

## Current verification

- Windows native Electron: connect DEV-CPU, create a thread and receive a real
  provider reply; execute `list_threads` and `list_scheduled_tasks` successfully.
- The same test passed using the standalone Windows executable installed outside
  the checkout. Test profiles and prompts are isolated.
- Remote identity/framing/allowlist tests: 3 passed.
- Existing scheduled-task unit tests: 34 passed.
- Desktop typecheck and scoped ESLint passed.
- Full `pnpm check` stopped at formatting on this Windows checkout (702 files,
  including unchanged files); a full baseline pass is not claimed.

## Preview limitations

Remote worktree creation is disabled. Remote file/review surfaces, cancellation,
terminal interaction, restart recovery and cross-host task delivery still need
broader end-to-end coverage. Listing scheduled tasks is not proof of a timed remote
execution. Desktop tool forwarding is unavailable while the GUI is disconnected.
An existing host daemon must be restarted when changing protocol versions; do so
only after its tasks finish. This fork is not an upstream release.

For an unsigned Windows folder build without signing-tool symlink privileges:

```powershell
corepack pnpm --filter @pi-gui/desktop run build
corepack pnpm --dir apps/desktop exec electron-builder --win --dir --publish never --config.npmRebuild=false --config.win.signAndEditExecutable=false
```

Keep all source and build inputs unchanged while the packager reads them.
