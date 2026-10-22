import { useState, useEffect, useRef, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { sshWorkspaceUri } from "@pi-gui/session-driver";
import type { PiDesktopApi } from "../../../contracts/ipc";
import type { SshDirectoryListing } from "../../../contracts/ssh";

export function SshWorkspaceDialog({
  onConnect,
  onClose,
  api,
}: {
  readonly onConnect: (uri: string) => Promise<void>;
  readonly onClose: () => void;
  readonly api: Pick<PiDesktopApi, "listSshHosts" | "browseSshDirectory">;
}) {
  const [host, setHost] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hosts, setHosts] = useState<string[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [browsing, setBrowsing] = useState(false);
  const [listing, setListing] = useState<SshDirectoryListing>();
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    void api
      .listSshHosts()
      .then((values) => {
        if (active) setHosts(values);
      })
      .catch((failure: unknown) => {
        if (active) setError(String(failure));
      })
      .finally(() => {
        if (active) setLoadingHosts(false);
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [api]);
  const browse = async (selectedHost: string, directory: string) => {
    const request = ++generation.current;
    setBrowsing(true);
    setError("");
    try {
      const result = await api.browseSshDirectory(selectedHost, directory);
      if (request !== generation.current) return;
      setListing(result);
      setPath(result.path);
    } catch (failure) {
      if (request === generation.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (request === generation.current) setBrowsing(false);
    }
  };
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
        <p>Choose a host from your SSH config, then select its project folder.</p>
        <label>
          SSH host
          <select
            aria-label="SSH host"
            autoFocus
            required
            value={host}
            onChange={(event) => {
              const next = event.target.value;
              setHost(next);
              setPath("");
              setListing(undefined);
              if (next) void browse(next, "").catch(console.error);
            }}
            disabled={busy || loadingHosts}
          >
            <option value="" disabled>
              {loadingHosts ? "Reading SSH config…" : "Select SSH host"}
            </option>
            {hosts.map((alias) => (
              <option key={alias} value={alias}>
                {alias}
              </option>
            ))}
          </select>
        </label>
        {!loadingHosts && hosts.length === 0 ? (
          <p>No named hosts found. Add a Host entry to ~/.ssh/config and reopen this dialog.</p>
        ) : null}
        <label>
          Remote project folder
          <input
            required
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/root/project"
            disabled={busy || !host || browsing}
          />
        </label>
        <div className="ssh-workspace-browser-actions">
          <button
            type="button"
            className="button"
            disabled={!host || busy || browsing}
            onClick={() => {
              void browse(host, path).catch(console.error);
            }}
          >
            Browse path
          </button>
          <button
            type="button"
            className="button"
            disabled={!host || busy || browsing}
            onClick={() => {
              void browse(host, "").catch(console.error);
            }}
          >
            Home
          </button>
          <button
            type="button"
            className="button"
            disabled={!listing?.parent || busy || browsing}
            onClick={() => {
              if (listing?.parent) void browse(host, listing.parent).catch(console.error);
            }}
          >
            Up
          </button>
        </div>
        {browsing ? <p role="status">Reading remote folders…</p> : null}
        {listing && !browsing ? (
          <div className="ssh-workspace-folders" aria-label="Remote folders">
            <p className="ssh-workspace-current-path">{listing.path}</p>
            {listing.directories.map((name) => (
              <button
                type="button"
                key={name}
                disabled={busy}
                onClick={() => {
                  void browse(host, `${listing.path === "/" ? "" : listing.path}/${name}`).catch(
                    console.error,
                  );
                }}
              >
                {name}
              </button>
            ))}
            {listing.directories.length === 0 ? (
              <p>No subfolders. You can connect to this folder.</p>
            ) : null}
            {listing.truncated ? (
              <p>Showing the first 500 folders. Paste a path to navigate directly.</p>
            ) : null}
          </div>
        ) : null}
        <p>
          A small Pi GUI host is installed in your remote user directory. Pi and Node.js must
          already be installed there.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="ssh-workspace-dialog__actions">
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={busy || browsing || !host || !path.trim()}
          >
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
