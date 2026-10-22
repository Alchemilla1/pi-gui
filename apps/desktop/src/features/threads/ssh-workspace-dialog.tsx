import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { sshWorkspaceUri } from "@pi-gui/session-driver";

export function SshWorkspaceDialog({
  onConnect,
  onClose,
}: {
  readonly onConnect: (uri: string) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [host, setHost] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (!path.trim().startsWith("/"))
        throw new Error("Enter the absolute project path on the remote machine.");
      await onConnect(sshWorkspaceUri(host.trim(), path.trim()));
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div
      className="ssh-workspace-backdrop"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onClose();
      }}
    >
      <form
        className="ssh-workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Connect SSH workspace"
        onSubmit={(event) => {
          void submit(event).catch(console.error);
        }}
      >
        <h2>Connect remote workspace</h2>
        <p>Use a host from your SSH config. Threads and tools run on that machine.</p>
        <label>
          SSH host
          <input
            autoFocus
            required
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="DEV-CPU"
            disabled={busy}
          />
        </label>
        <label>
          Remote project folder
          <input
            required
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/root/project"
            disabled={busy}
          />
        </label>
        <p>
          A small Pi GUI host is installed in your remote user directory. Pi and Node.js must
          already be installed there.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="ssh-workspace-dialog__actions">
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
