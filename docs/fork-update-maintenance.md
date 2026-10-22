# Fork update maintenance

This is the Muelsyse + Codex fork, `Alchemilla1/pi-gui`. Upstream is
`minghinmatthewlam/pi-gui`. Preserve upstream authors, license and history.

## Implemented update path

- Version 1.0.2 introduces the fork-only release check. All release links and the
  builder publish owner point at the fork. Drafts/prereleases are excluded.
- On Windows, press Alt to reveal the native menu, then Help → Check for Fork
  Updates. Preparation downloads `pi-gui-update.json` and the exact versioned
  Windows x64 ZIP through GitHub HTTPS. Manifest repository, version, platform,
  filename, SHA-256 and size must agree. Checksums are integrity checks, not an
  independent code-signing identity; the GitHub account/repository is trusted.
- Preparation leaves the installed app running. It validates extraction paths,
  caps download/expanded size, checks staged package metadata, then asks before
  restart. No active threads or schedules due within two minutes are permitted
  at the final check. Drafts/persistence are flushed before graceful quit.
- A separate PowerShell helper waits for the old process. It renames the old
  installation to a sibling backup, moves the staged folder into its place,
  launches it, and waits up to 60 seconds for a token + version startup receipt.
  Startup failure restores the old folder when the new process can close safely.
  A process that refuses to close leaves files in place and a manual-action log.
  No histories, credentials, userData or backups are deleted.
- Staging and logs live beside the app in `.pi-gui-updates/<id>`; health receipts
  live under userData `updates/<id>`. Keeping staging on the installation volume
  avoids cross-volume directory moves. Portable userData inside the app directory
  is rejected. Windows x64 folder installs are supported; NSIS updater integration,
  other platforms, signed packages, and one-click later rollback are not provided.
- `fork-windows-release.yml` is manually dispatched on main. It validates versions,
  runs baseline checks, builds, checks dependencies, creates the ZIP and manifest,
  uploads a candidate, and creates a **draft** release. Existing versions/assets
  are never overwritten. The inherited release pipeline is upstream-only.

## Release and local installation contract

1. Fetch origin/upstream. Inspect local changes before integrating. Preserve the
   fork commits; never fast-forward/reset the fork to upstream and lose features.
2. Integrate upstream in a reviewed change, resolve conflicts and check SSH,
   collaboration, scheduler and update behavior. Maintain a monotonic stable fork
   version in the root, desktop and website packages. Record upstream commit and
   fork source commit in release notes; version comparison must not rely on `+build`.
3. Commit with author `Muelsyse <121101149+Alchemilla1@users.noreply.github.com>` and
   trailer `Co-authored-by: Codex <codex@openai.com>`. Preserve upstream commit authors.
4. Push to origin, verify remote SHA, dispatch the fork release candidate workflow.
   If CI fails, fix it; never mark a failed/skipped lane as passed. Windows line
   endings previously caused a full-baseline formatting failure locally.
5. Exercise the exact downloaded artifact on Windows, using an isolated profile:
   startup, SSH dropdown/browse, remote conversation/tools, upgrade and rollback.
   Publish the draft only after the required evidence passes. Do not fabricate
   real-provider coverage when remote access or credentials are unavailable.
6. Update the local installation `E:\apps\Pi GUI`, retaining the previous folder
   and `Desktop\Pi GUI.lnk`. Check no active work is interrupted; gracefully exit,
   apply, relaunch, verify actual app version, retained history and working SSH.
   Git pushed, Release published and local app updated are three separate statuses.

## Remaining work for dots

The initial updater is implemented, but no public fork release-to-release download
has been claimed as tested. The Windows swap/rollback tests use executable fixtures.
Finish the real GitHub download, clean app shutdown, startup receipt, rollback and
retained-session journey before making stable releases automatic. Add progress and
cancel/retry UI without silently resending tasks. Avoid weakening checks to unblock CI.

Build remote host updates independently of the desktop folder swap. Currently the
remote installer uploads a bundle and the daemon keeps its in-memory version; a
protocol handshake alone is insufficient. Required design:

1. `hello/status` reports protocol capabilities/range, host build hash, Pi version,
   active/queued runs, clients and drain state. Preserve UUID + host identities.
2. Upload immutable `releases/<build-hash>/` artifacts to a private staging path,
   check hash and runtime compatibility, and keep current + previous versions.
3. An exclusive daemon-owned drain operation rejects new writes, waits for queued
   and running work to finish, then closes listeners and releases session leases.
   Checking an idle catalog followed by kill is unsafe; close that race atomically.
4. With incompatible clients, refuse upgrade and explain which clients must close.
   Never forcibly kill an agent, run two daemons writing the same session, or replay
   ambiguous prompt/tool writes after a disconnect. Idle upgrades may switch the
   launcher atomically and start the new host; active ones remain pending.
5. Verify handshake and read-only transcript after switch. Failed startup restores
   the previous launcher/build and reconnects without duplicating requests. Preserve
   JSONL, auth, model settings, catalogs and leases; handle crashes/stale locks.
6. Prove idle upgrade, busy deferral, simultaneous clients, incompatible versions,
   SSH loss mid-upload/switch, failed health and rollback with no session loss.

Use DEV-CPU and A800-DLM only for authorized live checks. H100-CUIHU was explicitly
deferred. The scheduler still runs in the desktop: closing it prevents future timer
dispatch. Remote in-flight inference survival is a separate property. Do not promise
server-side schedules until a separately tested scheduler is implemented.

Do not copy API keys, SSH private keys or auth files into the repository, logs,
release ZIPs or prompts. Do not resurrect the removed `cliproxyapi` provider.
