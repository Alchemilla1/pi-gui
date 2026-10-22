import type { SessionFileCatalogStorage, SessionCatalogEntry } from "@pi-gui/catalogs";
import { parseSshWorkspace, sshWorkspaceUri, sessionKey } from "@pi-gui/session-driver";
import type {
  SessionDriverEvent,
  SessionEventListener,
  SessionRef,
  SessionSnapshot,
} from "@pi-gui/session-driver";
import { PiSdkDriver, type PiSdkDriverConfig } from "../pi-sdk-driver.js";
import { SshDriverClient } from "./ssh-client.js";
import {
  record,
  SESSION_METHODS,
  RUNTIME_METHODS,
  type RemoteToolBridge,
  type RemoteToolCall,
} from "./protocol.js";

function firstRemote(args: readonly unknown[]): ReturnType<typeof parseSshWorkspace> {
  const first = args[0];
  if (typeof first === "string") return parseSshWorkspace(first);
  if (first && typeof first === "object") {
    const value = record(first);
    if (typeof value.workspaceId === "string") return parseSshWorkspace(value.workspaceId);
  }
  return undefined;
}
function toRemote(value: unknown, host: string, field = ""): unknown {
  if (typeof value === "string") {
    if (field !== "workspaceId" && field !== "path") return value;
    const remote = parseSshWorkspace(value);
    if (remote && remote.host !== host)
      throw new Error("An operation cannot mix different SSH hosts");
    return remote?.path ?? value;
  }
  if (Array.isArray(value)) return value.map((item) => toRemote(item, host));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toRemote(item, host, key)]),
    );
  if (typeof value === "function")
    throw new Error("This desktop interaction is not available over SSH");
  return value;
}
function fromRemote(value: unknown, host: string): unknown {
  if (Array.isArray(value)) return value.map((item) => fromRemote(item, host));
  if (!value || typeof value !== "object") return value;
  const item = record(value);
  return Object.fromEntries(
    Object.entries(item).map(([key, child]) => {
      if (
        typeof child === "string" &&
        (key === "workspaceId" ||
          (key === "path" && typeof item.workspaceId === "string") ||
          key === "sessionFilePath")
      )
        return [key, sshWorkspaceUri(host, child)];
      return [key, fromRemote(child, host)];
    }),
  );
}

/** Route through the existing driver contract. Failed SSH calls never fall back to local execution. */
export function createSshAwareDriver(
  options: PiSdkDriverConfig & {
    catalogStorage: SessionFileCatalogStorage;
    remoteToolBridge?: RemoteToolBridge;
  },
): PiSdkDriver {
  const local = new PiSdkDriver(options);
  const catalogs = options.catalogStorage;
  const clients = new Map<string, SshDriverClient>();
  const listeners = new Map<string, Set<SessionEventListener>>();
  const clientFor = (host: string): SshDriverClient => {
    let client = clients.get(host);
    if (client) return client;
    client = new SshDriverClient(
      host,
      options.remoteToolBridge
        ? {
            definitions: options.remoteToolBridge.definitions,
            execute: (call) =>
              options.remoteToolBridge!.execute(fromRemote(call, host) as RemoteToolCall),
          }
        : undefined,
    );
    clients.set(host, client);
    client.listeners.add((value) => {
      const event = fromRemote(value, host) as SessionDriverEvent;
      if (!event?.sessionRef || typeof event.type !== "string") return;
      if ("snapshot" in event) void mirrorSnapshot(event.snapshot).catch(console.error);
      for (const listener of listeners.get(sessionKey(event.sessionRef)) ?? [])
        void Promise.resolve(listener(event)).catch(console.error);
    });
    return client;
  };
  async function mirrorSnapshot(snapshot: SessionSnapshot): Promise<void> {
    await catalogs.sessions.upsertSession({
      sessionRef: snapshot.ref,
      workspaceId: snapshot.ref.workspaceId,
      title: snapshot.title,
      updatedAt: snapshot.updatedAt,
      status: snapshot.status,
      ...(snapshot.preview ? { previewSnippet: snapshot.preview } : {}),
      ...(snapshot.archivedAt ? { archivedAt: snapshot.archivedAt } : {}),
    });
  }
  async function invoke(host: string, method: string, args: readonly unknown[]): Promise<unknown> {
    const result = fromRemote(
      await clientFor(host).call(
        method,
        args.map((arg, i) => toRemote(arg, host, i === 0 && typeof arg === "string" ? "path" : "")),
      ),
      host,
    );
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const data = record(result);
      if (data.workspace && Array.isArray(data.sessions)) {
        const workspace = record(data.workspace);
        const workspaceId = String(workspace.workspaceId);
        const existing = await catalogs.workspaces.getWorkspace(workspaceId);
        await catalogs.workspaces.upsertWorkspace({
          workspaceId,
          path: String(workspace.path),
          displayName:
            existing?.displayName ??
            `${host} · ${String(workspace.displayName ?? parseSshWorkspace(workspaceId)?.path)}`,
          lastOpenedAt: new Date().toISOString(),
          sortOrder:
            existing?.sortOrder ?? (await catalogs.workspaces.listWorkspaces()).workspaces.length,
        });
        for (const entry of data.sessions as SessionCatalogEntry[])
          await catalogs.sessions.upsertSession(entry);
      } else if (data.ref && data.workspace && typeof data.title === "string")
        await mirrorSnapshot(result as SessionSnapshot);
    }
    return result;
  }
  const runtime = new Proxy(local.runtimeSupervisor, {
    get(target, key, receiver): unknown {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const remote = firstRemote(args);
        if (!remote) return (value as (...values: unknown[]) => unknown).apply(target, args);
        if (typeof key !== "string" || !RUNTIME_METHODS.has(key))
          throw new Error(`Remote runtime operation is not supported: ${String(key)}`);
        return invoke(remote.host, "runtime." + key, args);
      };
    },
  });
  return new Proxy(local, {
    get(target, key, receiver): unknown {
      if (key === "runtimeSupervisor") return runtime;
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const remote = firstRemote(args);
        if (!remote) return (value as (...values: unknown[]) => unknown).apply(target, args);
        if (key === "subscribe") {
          const ref = args[0] as SessionRef;
          const listener = args[1] as SessionEventListener;
          const id = sessionKey(ref);
          let group = listeners.get(id);
          if (!group) {
            group = new Set();
            listeners.set(id, group);
          }
          group.add(listener);
          void clientFor(remote.host)
            .call("subscribe", [toRemote(ref, remote.host)])
            .catch((error) =>
              listener({
                type: "runFailed",
                sessionRef: ref,
                timestamp: new Date().toISOString(),
                error: {
                  code: "SSH_DISCONNECTED",
                  message: error instanceof Error ? error.message : String(error),
                },
              }),
            );
          return () => {
            group.delete(listener);
            if (!group.size) listeners.delete(id);
          };
        }
        if (key === "closeSession") return Promise.resolve(); // Closing a desktop view does not kill remote work.
        if (key === "getSessionFilePath") return Promise.resolve(undefined); // Never hand a remote path to local fs.
        if (key === "removeWorkspace") return catalogs.workspaces.deleteWorkspace(String(args[0]));
        if (key === "generateThreadTitle") return Promise.resolve(null);
        if (key === "listSessions") return catalogs.sessions.listSessions(String(args[0]));
        if (typeof key !== "string" || !SESSION_METHODS.has(key))
          throw new Error(`Remote session operation is not supported: ${String(key)}`);
        return invoke(remote.host, key, args);
      };
    },
  });
}
