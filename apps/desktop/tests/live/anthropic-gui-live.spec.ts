import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  launchDesktop,
  launchDesktopByExecutable,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  getSelectedTranscript,
} from "../helpers/electron-app";

test("GUI matches the real Anthropic answer and thinking returned by the gateway", async () => {
  test.setTimeout(90000);
  const source = process.env.PI_APP_REAL_AUTH_SOURCE_DIR;
  test.skip(process.env.PI_APP_REAL_AUTH !== "1" || !source, "Explicit real-auth source required");
  const profile = await makeUserDataDir(),
    agentDir = join(profile, "agent"),
    workspace = await makeWorkspace("anthropic-live-proof");
  await seedAgentDir(agentDir);
  const auth = JSON.parse(await readFile(join(source!, "auth.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const all = JSON.parse(await readFile(join(source!, "models.json"), "utf8")) as {
    providers: Record<string, { baseUrl: string; apiKey?: string }>;
  };
  const provider = all.providers.dacint;
  if (!provider) throw new Error("dacint is not configured");
  const wire: {
    thinking?: unknown;
    outputConfig?: unknown;
    thinkingChars: number;
    initialThinkingChars: number;
    status?: number;
    isAnswer: boolean;
  }[] = [];
  const relay = createServer((req, res) => {
    const forward = async () => {
      let raw = "";
      for await (const chunk of req) raw += String(chunk);
      const body = JSON.parse(raw) as Record<string, unknown>;
      const call: (typeof wire)[number] = {
        thinking: body.thinking,
        outputConfig: body.output_config,
        thinkingChars: 0,
        initialThinkingChars: 0,
        isAnswer: false,
      };
      wire.push(call);
      let responseText = "";
      const response = await fetch(provider.baseUrl.replace(/\/v1\/?$/, "") + req.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": String(req.headers["x-api-key"] ?? ""),
          "anthropic-version": String(req.headers["anthropic-version"] ?? "2023-06-01"),
        },
        body: raw,
        signal: AbortSignal.timeout(60000),
      });
      call.status = response.status;
      res.writeHead(response.status, {
        "Content-Type": response.headers.get("content-type") ?? "text/event-stream",
      });
      let buffered = "";
      const decoder = new TextDecoder();
      if (response.body)
        for await (const chunk of response.body) {
          res.write(chunk);
          buffered += decoder.decode(chunk as Uint8Array, { stream: true });
          let end: number;
          while ((end = buffered.indexOf("\n")) >= 0) {
            const line = buffered.slice(0, end);
            buffered = buffered.slice(end + 1);
            if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
            const event = JSON.parse(line.slice(6)) as {
              delta?: { thinking?: string; text?: string };
              content_block?: { thinking?: string; text?: string };
            };
            call.thinkingChars +=
              event.delta?.thinking?.length ?? event.content_block?.thinking?.length ?? 0;
            call.initialThinkingChars += event.content_block?.thinking?.length ?? 0;
            responseText += event.delta?.text ?? event.content_block?.text ?? "";
          }
        }
      call.isAnswer = responseText.includes("ANTHROPIC_GUI_LIVE_OK 437");
      res.end();
    };
    forward().catch(() => {
      res.writeHead(502);
      res.end("Anthropic verification relay failed");
    });
  });
  await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({ dacint: auth.dacint }), {
    mode: 0o600,
  });
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        dacint: {
          ...provider,
          api: "anthropic-messages",
          baseUrl: `http://127.0.0.1:${(relay.address() as AddressInfo).port}`,
          models: [
            {
              id: "DeepSeek-V4.1-Flash-1017",
              reasoning: true,
              contextWindow: 828000,
              maxTokens: 16384,
            },
          ],
        },
      },
    }),
    { mode: 0o600 },
  );
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "dacint",
      defaultModel: "DeepSeek-V4.1-Flash-1017",
      defaultThinkingLevel: "high",
      enabledModels: ["dacint/DeepSeek-V4.1-Flash-1017"],
      packages: [],
      extensions: [],
    }),
  );
  const launch = process.env.PI_GUI_TEST_EXECUTABLE
    ? (dir: string, opts: Parameters<typeof launchDesktop>[1]) =>
        launchDesktopByExecutable(process.env.PI_GUI_TEST_EXECUTABLE!, dir, opts)
    : launchDesktop;
  const harness = await launch(profile, {
    agentDir,
    initialWorkspaces: [workspace],
    testMode: "foreground",
    envOverrides: { PI_APP_TEST_MODE: undefined },
  });
  try {
    const page = await harness.firstWindow();
    await harness.focusWindow();
    await page
      .locator("#primary-sidebar")
      .getByRole("button", { name: "New thread", exact: true })
      .click();
    await page
      .getByTestId("new-thread-composer")
      .fill(
        "Connection verification only. Do not call tools or access files. Compute 19 times 23 and reply exactly ANTHROPIC_GUI_LIVE_OK 437.",
      );
    await page.getByRole("button", { name: "Start thread", exact: true }).click();
    await expect
      .poll(
        async () => {
          const tr = (await getSelectedTranscript(page))?.transcript ?? [];
          return tr
            .filter((i) => i.kind === "message" && i.role === "assistant")
            .map((i) => (i.kind === "message" ? i.text : ""))
            .join("");
        },
        { timeout: 60000 },
      )
      .toContain("ANTHROPIC_GUI_LIVE_OK 437");
    await writeFile(test.info().outputPath("anthropic-wire.json"), JSON.stringify(wire));
    const answer = wire.find((call) => call.isAnswer);
    expect(
      answer,
      "The observed response must be the conversation, not a title request",
    ).toBeDefined();
    const transcript = (await getSelectedTranscript(page))?.transcript ?? [];
    const displayedChars = transcript.reduce(
      (total, item) =>
        total +
        (item.kind === "message" && item.role === "assistant" ? (item.thinking?.length ?? 0) : 0),
      0,
    );
    expect(displayedChars).toBe(answer!.thinkingChars);
    if (answer!.thinkingChars > 0) {
      await expect(page.locator("details.timeline-thinking").first()).toBeVisible();
      await page.locator("details.timeline-thinking summary").first().click();
    } else {
      await expect(page.locator("details.timeline-thinking")).toHaveCount(0);
    }
    await page.screenshot({ path: test.info().outputPath("anthropic-live.png") });
  } finally {
    await harness.close();
    relay.closeAllConnections();
    await new Promise<void>((resolve) => relay.close(() => resolve()));
  }
});
