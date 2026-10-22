export const REMOTE_PROTOCOL_VERSION = 2;
export interface RemoteToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
}
export interface RemoteToolCall {
  sessionRef: { workspaceId: string; sessionId: string };
  toolName: string;
  toolCallId: string;
  params: unknown;
}
export interface RemoteToolBridge {
  definitions: readonly RemoteToolDefinition[];
  execute: (call: RemoteToolCall) => Promise<unknown>;
}
export const MAX_RECORD_BYTES = 16 * 1024 * 1024;
export const SESSION_METHODS = new Set([
  "syncWorkspace",
  "reconcileWorkspace",
  "createSession",
  "validateForkSession",
  "forkSession",
  "openSession",
  "archiveSession",
  "unarchiveSession",
  "sendUserMessage",
  "replaceQueuedMessages",
  "cancelCurrentRun",
  "setSessionModel",
  "setSessionThinkingLevel",
  "renameSession",
  "compactSession",
  "reloadSession",
  "reloadSessionWhenIdle",
  "getSessionTree",
  "navigateSessionTree",
  "getSessionCommands",
  "respondToHostUiRequest",
  "getTranscript",
  "getSessionSchemaInfo",
  "renameWorkspace",
]);
export const RUNTIME_METHODS = new Set([
  "refreshRuntime",
  "getRuntimeSnapshot",
  "getGlobalModelSettings",
  "getProjectModelSettings",
  "setDefaultModel",
  "setProjectDefaultModel",
  "setDefaultThinkingLevel",
  "setProjectDefaultThinkingLevel",
  "setEnableSkillCommands",
  "setScopedModelPatterns",
  "setProjectScopedModelPatterns",
  "setSkillEnabled",
  "setExtensionEnabled",
  "getCodemodeAlwaysOn",
  "setCodemodeAlwaysOn",
]);
export type RemoteRecord =
  | { type: "response"; id: string; result?: unknown; error?: string }
  | { type: "event"; event: unknown };
/** LF only: U+2028/U+2029 are legal inside JSON strings. */
export class JsonLines {
  private buffer = "";
  push(chunk: string): unknown[] {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > MAX_RECORD_BYTES)
      throw new Error("Remote record exceeds size limit");
    const records: unknown[] = [];
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim()) records.push(JSON.parse(line));
    }
    return records;
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
