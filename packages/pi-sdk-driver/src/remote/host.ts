import net from "node:net";
import fs from "node:fs";
import { mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ToolDefinition, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { PiSdkDriver } from "../pi-sdk-driver.js";
import type { SessionRef } from "@pi-gui/session-driver";
import {
  JsonLines,
  record,
  REMOTE_PROTOCOL_VERSION,
  SESSION_METHODS,
  RUNTIME_METHODS,
  type RemoteToolDefinition,
  type RemoteToolCall,
} from "./protocol.js";

const root = process.env.PI_GUI_HOST_DIR || join(homedir(), ".pi-gui-host");
const socketPath = join(root, "driver.sock");
async function connect(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}
async function relay(): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  let socket: net.Socket;
  try {
    socket = await connect();
  } catch {
    const log = fs.openSync(join(root, "host.log"), "a", 0o600);
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--serve"], {
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.unref();
    fs.closeSync(log);
    let last: unknown;
    for (let i = 0; i < 60; i++) {
      try {
        socket = await connect();
        last = undefined;
        break;
      } catch (error) {
        last = error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    if (last) throw last;
  }
  process.stdin.pipe(socket!);
  socket!.pipe(process.stdout);
  socket!.on("close", () => process.exit(0));
}
async function serve(): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lockPath = join(root, "host.lock");
  if (fs.existsSync(lockPath)) {
    const owner = Number(fs.readFileSync(lockPath, "utf8"));
    let alive = false;
    if (Number.isSafeInteger(owner) && owner > 0) {
      try {
        process.kill(owner, 0);
        alive = true;
      } catch {
        /* stale owner */
      }
      if (alive && process.platform === "linux") {
        try {
          if (fs.readFileSync(`/proc/${owner}/stat`, "utf8").split(") ")[1]?.startsWith("Z "))
            alive = false;
        } catch {
          alive = false;
        }
      }
    }
    if (alive) return;
    fs.unlinkSync(lockPath);
  }
  const lock = fs.openSync(lockPath, "wx", 0o600);
  fs.writeFileSync(lock, String(process.pid));
  fs.closeSync(lock);
  process.on("exit", () => {
    try {
      if (fs.readFileSync(lockPath, "utf8") === String(process.pid)) fs.unlinkSync(lockPath);
    } catch {
      /* already released */
    }
  });
  if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  const toolDefinitions = new Map<net.Socket, RemoteToolDefinition[]>();
  const owners = new Map<string, net.Socket>();
  const pendingTools = new Map<
    string,
    {
      socket: net.Socket;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  const callDesktop = (call: RemoteToolCall): Promise<unknown> => {
    const socket = owners.get(JSON.stringify(call.sessionRef));
    if (!socket || socket.destroyed)
      return Promise.reject(
        new Error("Open this session in Pi GUI to use desktop thread and scheduled-task tools."),
      );
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        pendingTools.delete(id);
        reject(
          new Error(
            "Desktop tool timed out; outcome is unknown. Do not retry a write automatically.",
          ),
        );
      }, 120_000);
      pendingTools.set(id, { socket, resolve, reject, timer });
      socket.write(JSON.stringify({ type: "toolCall", id, call }) + "\n");
    });
  };
  const driver = new PiSdkDriver({
    catalogFilePath: join(root, "catalogs.json"),
    builtinExtensions: [
      {
        name: "pi-gui-remote-desktop",
        displayName: "Desktop threads and schedules",
        factory: (pi) => {
          const definitions = [...toolDefinitions.values()].at(-1) ?? [];
          for (const definition of definitions)
            pi.registerTool({
              ...definition,
              parameters: definition.parameters as ToolDefinition["parameters"],
              execute: async (toolCallId, params: unknown, _signal, _onUpdate, ctx) =>
                (await callDesktop({
                  sessionRef: {
                    workspaceId: ctx.sessionManager.getCwd(),
                    sessionId: ctx.sessionManager.getSessionId(),
                  },
                  toolName: definition.name,
                  toolCallId,
                  params,
                })) as AgentToolResult<unknown>,
            });
        },
      },
    ],
  });
  const peers = new Set<net.Socket>();
  const subscriptions = new Map<string, () => void>();
  const subscribe = (ref: SessionRef) => {
    const key = JSON.stringify(ref);
    if (subscriptions.has(key)) return;
    subscriptions.set(
      key,
      driver.subscribe(ref, (event) => {
        const line = JSON.stringify({ type: "event", event }) + "\n";
        for (const peer of peers) if (!peer.destroyed) peer.write(line);
      }),
    );
  };
  const server = net.createServer((socket) => {
    peers.add(socket);
    socket.setEncoding("utf8");
    const decoder = new JsonLines();
    socket.on("close", () => {
      peers.delete(socket);
      toolDefinitions.delete(socket);
      for (const [key, owner] of owners) if (owner === socket) owners.delete(key);
      for (const [id, pending] of pendingTools)
        if (pending.socket === socket) {
          clearTimeout(pending.timer);
          pendingTools.delete(id);
          pending.reject(
            new Error(
              "Desktop disconnected; tool outcome may be unknown. Do not resend automatically.",
            ),
          );
        }
    });
    socket.on("error", () => peers.delete(socket));
    const dispatch = async (input: unknown): Promise<void> => {
      let id = "";
      try {
        const request = record(input);
        if (request.type === "toolResult" && typeof request.id === "string") {
          const pending = pendingTools.get(request.id);
          if (pending?.socket === socket) {
            pendingTools.delete(request.id);
            clearTimeout(pending.timer);
            if (typeof request.error === "string") pending.reject(new Error(request.error));
            else pending.resolve(request.result);
          }
          return;
        }
        if (
          typeof request.id !== "string" ||
          typeof request.method !== "string" ||
          !Array.isArray(request.args)
        )
          throw new Error("Invalid request");
        id = request.id;
        const method = request.method;
        const args = request.args as unknown[];
        let result: unknown;
        if (method === "hello") result = { protocol: REMOTE_PROTOCOL_VERSION };
        else if (method === "configureTools") {
          if (!Array.isArray(args[0])) throw new Error("Invalid desktop tool definitions");
          toolDefinitions.set(socket, args[0] as RemoteToolDefinition[]);
          result = true;
        } else if (method === "subscribe") {
          const ref = record(args[0]);
          if (typeof ref.workspaceId !== "string" || typeof ref.sessionId !== "string")
            throw new Error("Invalid session reference");
          subscribe(ref as unknown as SessionRef);
          owners.set(JSON.stringify(ref), socket);
          result = true;
        } else {
          const runtime = method.startsWith("runtime.");
          const name = runtime ? method.slice(8) : method;
          if (!(runtime ? RUNTIME_METHODS : SESSION_METHODS).has(name))
            throw new Error(`Unsupported remote operation: ${method}`);
          const target: object = runtime ? driver.runtimeSupervisor : driver;
          const fn: unknown = Reflect.get(target, name);
          if (typeof fn !== "function") throw new Error(`Unknown host method: ${method}`);
          result = await (fn as (...values: unknown[]) => unknown).apply(target, args);
          if (["openSession", "createSession"].includes(name)) {
            subscribe(record(result).ref as SessionRef);
            owners.set(JSON.stringify(record(result).ref), socket);
          }
        }
        socket.write(JSON.stringify({ type: "response", id, result: result ?? null }) + "\n");
      } catch (error) {
        socket.write(
          JSON.stringify({
            type: "response",
            id,
            error: error instanceof Error ? error.message : String(error),
          }) + "\n",
        );
      }
    };
    socket.on("data", (data: string) => {
      try {
        for (const value of decoder.push(data)) void dispatch(value).catch(() => socket.destroy());
      } catch {
        socket.destroy();
      }
    });
  });
  server.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
  server.listen(socketPath, () => {
    void chmod(socketPath, 0o600).catch(console.error);
  });
}
if (process.argv.includes("--connect"))
  void relay().catch((error) => {
    console.error(error);
    process.exit(1);
  });
else if (process.argv.includes("--serve"))
  void serve().catch((error) => {
    console.error(error);
    process.exit(1);
  });
