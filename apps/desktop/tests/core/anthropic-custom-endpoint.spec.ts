import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  desktopShortcut,
  getDesktopState,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
} from "../helpers/electron-app";

test("Anthropic endpoint configured through GUI streams thinking, uses a tool and completes", async () => {
  test.setTimeout(90000);
  const requests: {
    path: string;
    key: string | undefined;
    version: string | undefined;
    body: Record<string, unknown>;
  }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (req.method === "GET") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ data: [{ id: "thinking-fixture" }] }));
        return;
      }
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push({
        path: new URL(req.url || "/", "http://fixture").pathname,
        key: req.headers["x-api-key"] as string | undefined,
        version: req.headers["anthropic-version"] as string | undefined,
        body,
      });
      console.log("Anthropic request path", req.url);
      if (new URL(req.url || "/", "http://fixture").pathname !== "/v1/messages") {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const send = (type: string, data: Record<string, unknown>) =>
        res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      send("message_start", {
        message: {
          id: "msg_fixture",
          type: "message",
          role: "assistant",
          model: "thinking-fixture",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      });
      send("content_block_start", {
        index: 0,
        content_block: { type: "thinking", thinking: "ANTHROPIC_" },
      });
      send("content_block_delta", {
        index: 0,
        delta: { type: "thinking_delta", thinking: "THINKING_OK" },
      });
      send("content_block_delta", {
        index: 0,
        delta: { type: "signature_delta", signature: "fixture-signature" },
      });
      send("content_block_stop", { index: 0 });
      if (requests.length === 1) {
        send("content_block_start", {
          index: 1,
          content_block: { type: "tool_use", id: "tool_fixture", name: "bash", input: {} },
        });
        send("content_block_delta", {
          index: 1,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify({ command: "printf ANTHROPIC_TOOL_OK" }),
          },
        });
        send("content_block_stop", { index: 1 });
        send("message_delta", {
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 15 },
        });
      } else {
        send("content_block_start", { index: 1, content_block: { type: "text", text: "" } });
        send("content_block_delta", {
          index: 1,
          delta: { type: "text_delta", text: "ANTHROPIC_FINAL_OK" },
        });
        send("content_block_stop", { index: 1 });
        send("message_delta", {
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 15 },
        });
      }
      send("message_stop", {});
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const profile = await makeUserDataDir(),
    agentDir = join(profile, "agent"),
    workspace = await makeWorkspace("anthropic-protocol-proof");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: [],
  });
  const harness = await launchDesktop(profile, {
    agentDir,
    initialWorkspaces: [workspace],
    testMode: "foreground",
    envOverrides: { PI_APP_TEST_MODE: undefined },
  });
  try {
    const page = await harness.firstWindow();
    await harness.focusWindow();
    await page.keyboard.press(desktopShortcut(","));
    await page.getByRole("button", { name: "Providers", exact: true }).click();
    await page.getByRole("button", { name: "Add endpoint", exact: true }).click();
    const dialog = page.getByTestId("custom-endpoint-dialog");
    await dialog.getByLabel("Provider ID").fill("anthropic-fixture");
    await dialog.getByLabel("Base URL").fill(base);
    await dialog.getByLabel("API protocol").selectOption("anthropic-messages");
    await dialog.getByLabel("API key", { exact: false }).fill("fixture-key");
    await dialog.getByRole("button", { name: "Detect models", exact: true }).click();
    await dialog.getByLabel("Enable thinking-fixture", { exact: true }).check();
    await dialog.getByLabel("Reasoning supported: thinking-fixture").check();
    await dialog.getByRole("button", { name: "Add endpoint", exact: true }).click();
    await expect(dialog).toBeHidden();
    const saved = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")) as {
      providers: Record<string, { api: string; models: { reasoning?: boolean }[] }>;
    };
    expect(saved.providers["anthropic-fixture"].api).toBe("anthropic-messages");
    expect(saved.providers["anthropic-fixture"].models[0].reasoning).toBe(true);
    await page.keyboard.press(desktopShortcut("N"));
    await page.locator(".new-thread .model-selector__badge").first().click();
    await page
      .getByRole("button", { name: "anthropic-fixture · thinking-fixture", exact: true })
      .click();
    await page.getByTestId("new-thread-composer").fill("Run the protocol fixture.");
    await page.getByRole("button", { name: "Start thread", exact: true }).click();
    await expect
      .poll(async () => JSON.stringify((await getSelectedTranscript(page))?.transcript), {
        timeout: 20000,
      })
      .toContain("ANTHROPIC_FINAL_OK");
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests[0]).toMatchObject({
      path: "/v1/messages",
      key: "fixture-key",
      version: "2023-06-01",
    });
    expect(requests[0].body.thinking).toBeTruthy();
    await expect(page.locator(".timeline-thinking").first()).toBeVisible();
    await page.locator(".timeline-thinking summary").first().click();
    await expect(page.getByTestId("transcript")).toContainText("ANTHROPIC_THINKING_OK");
    await page.screenshot({ path: test.info().outputPath("anthropic-protocol.png") });
    expect((await getDesktopState(page)).lastError).toBeUndefined();
  } finally {
    await harness.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
