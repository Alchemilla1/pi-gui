/** Stable identities: remote filesystem paths never become local filesystem paths. */
export interface SshWorkspace {
  readonly host: string;
  readonly path: string;
}
export function parseSshWorkspace(value: string): SshWorkspace | undefined {
  if (!value.startsWith("ssh://")) return undefined;
  const match = /^ssh:\/\/([A-Za-z0-9][A-Za-z0-9_.-]{0,127})(\/[^\r\n\0]*)$/.exec(value);
  if (!match) throw new Error("Use ssh://HostAlias/absolute/project/path");
  const remotePath = decodeURIComponent(match[2]!);
  if (!remotePath.startsWith("/") || /[\r\n\0]/.test(remotePath))
    throw new Error("Invalid remote project path");
  return { host: match[1]!, path: remotePath };
}
export function sshWorkspaceUri(host: string, remotePath: string): string {
  const value = `ssh://${host}/${remotePath.slice(1).split("/").map(encodeURIComponent).join("/")}`;
  parseSshWorkspace(value);
  return value;
}
