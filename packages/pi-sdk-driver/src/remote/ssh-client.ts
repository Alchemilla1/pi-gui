import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  JsonLines,
  record,
  REMOTE_PROTOCOL_VERSION,
  type RemoteToolBridge,
  type RemoteToolCall,
} from "./protocol.js";

export class SshDriverClient {
  private process: ChildProcessWithoutNullStreams | undefined;
  private ready: Promise<void> | undefined;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  readonly listeners = new Set<(event: unknown) => void>();
  constructor(
    readonly host: string,
    private readonly bridge?: RemoteToolBridge,
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(host)) throw new Error("Invalid SSH host alias");
  }
  private connect(): Promise<void> {
    if (this.ready) return this.ready;
    const child = spawn(
      "ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=12",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        this.host,
        'exec "$HOME/.local/share/pi-gui-host/bin/pi-gui-host" --connect',
      ],
      { windowsHide: true, stdio: "pipe" },
    );
    this.process = child;
    const decoder = new JsonLines();
    let diagnostic = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data: string) => {
      diagnostic = (diagnostic + data).slice(-2000);
    });
    child.stdout.on("data", (data: string) => {
      try {
        for (const value of decoder.push(data)) {
          const message = record(value);
          if (message.type === "toolCall" && typeof message.id === "string") {
            const id = message.id;
            void Promise.resolve()
              .then(async () => {
                if (!this.bridge) throw new Error("Desktop tools are unavailable");
                const result = await this.bridge.execute(message.call as RemoteToolCall);
                child.stdin.write(JSON.stringify({ type: "toolResult", id, result }) + "\n");
              })
              .catch((error: unknown) => {
                child.stdin.write(
                  JSON.stringify({
                    type: "toolResult",
                    id,
                    error: error instanceof Error ? error.message : String(error),
                  }) + "\n",
                );
              });
            continue;
          }
          if (message.type === "event") {
            for (const listener of this.listeners) listener(message.event);
            continue;
          }
          if (message.type !== "response" || typeof message.id !== "string")
            throw new Error("Invalid remote response");
          const pending = this.pending.get(message.id);
          if (!pending) continue;
          this.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (typeof message.error === "string") pending.reject(new Error(message.error));
          else pending.resolve(message.result);
        }
      } catch (error) {
        child.kill();
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.on("error", (error) => this.fail(error));
    child.on("close", () => {
      if (this.process !== child) return;
      this.process = undefined;
      this.ready = undefined;
      this.fail(
        new Error(
          `SSH ${this.host} disconnected. Running work remains on the host; do not automatically resend a prompt. ${diagnostic}`,
        ),
      );
    });
    this.ready = this.request("hello", [])
      .then(async (value) => {
        if (record(value).protocol !== REMOTE_PROTOCOL_VERSION)
          throw new Error("Remote Pi GUI host protocol mismatch");
        if (this.bridge) await this.request("configureTools", [this.bridge.definitions]);
      })
      .catch((error) => {
        child.kill();
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }
  private fail(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  private request(method: string, args: readonly unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Remote ${method} timed out; execution outcome may be unknown. Do not resend automatically.`,
          ),
        );
      }, 120_000);
      this.pending.set(id, { resolve, reject, timer });
      const data = JSON.stringify({ id, method, args }) + "\n";
      this.process?.stdin.write(data, (error) => {
        if (error) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }
  async call(method: string, args: readonly unknown[]): Promise<unknown> {
    await this.connect();
    return this.request(method, args);
  }
  disconnect(): void {
    this.process?.stdin.end();
    this.process?.kill();
  }
}
