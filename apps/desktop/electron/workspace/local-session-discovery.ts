import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type { JsonCatalogStore } from "@pi-gui/catalogs/node";

/** Read Pi's own session index only; never search drives or project trees. */
export async function discoverLocalSessionWorkspaces(
  registryPath: string,
  knownPaths: readonly string[],
  catalog: JsonCatalogStore,
  sessions: readonly SessionInfo[],
): Promise<string[]> {
  let seen: string[] = [];
  try {
    const value: unknown = JSON.parse(await readFile(registryPath, "utf8"));
    if (!Array.isArray(value) || !value.every((path) => typeof path === "string"))
      throw new Error("Invalid local session discovery registry");
    seen = value as string[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const candidates = [...new Set(sessions.map((session) => session.cwd))];
  const excluded = new Set([...seen, ...knownPaths]);
  const discovered: string[] = [];
  for (const cwd of candidates) {
    if (!isAbsolute(cwd) || excluded.has(cwd)) continue;
    discovered.push(cwd);
  }
  // Index histories independently of cwd existence. Missing projects must not erase history.
  for (const cwd of [...knownPaths, ...discovered]) {
    if (!isAbsolute(cwd)) continue;
    const workspaceId = resolve(cwd);
    if (!(await catalog.workspaces.getWorkspace(workspaceId))) {
      await catalog.workspaces.upsertWorkspace({
        workspaceId,
        path: cwd,
        displayName: basename(cwd) || cwd,
        lastOpenedAt: new Date().toISOString(),
        sortOrder: (await catalog.workspaces.listWorkspaces()).workspaces.length,
      });
    }
    for (const session of sessions.filter((entry) => entry.cwd === cwd)) {
      const sessionRef = { workspaceId, sessionId: session.id };
      if (await catalog.sessions.getSession(sessionRef)) continue;
      await catalog.sessions.upsertSession({
        sessionRef,
        workspaceId,
        title: session.name || session.firstMessage.slice(0, 80) || "Untitled session",
        updatedAt: session.modified.toISOString(),
        status: "idle",
        sessionFilePath: session.path,
        previewSnippet: session.firstMessage.slice(0, 300),
      });
    }
  }
  // Remember discoveries so a workspace the user removes does not reappear on restart.
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(
    registryPath,
    JSON.stringify([...new Set([...seen, ...knownPaths, ...discovered])]) + "\n",
  );
  return discovered;
}
