import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  launchDesktop,
  launchDesktopByExecutable,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  getSelectedTranscript,
} from "../helpers/electron-app";

test("DACINT uses supported max instead of off for the global xhigh preference", async () => {
  test.setTimeout(120000);
  const source = process.env.PI_APP_REAL_AUTH_SOURCE_DIR;
  test.skip(process.env.PI_APP_REAL_AUTH !== "1" || !source, "Explicit real-auth source required");
  const profile = await makeUserDataDir();
  const agentDir = join(profile, "agent");
  const workspace = await makeWorkspace("dacint-effort-proof");
  await seedAgentDir(agentDir);
  const auth = JSON.parse(await readFile(join(source!, "auth.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const models = JSON.parse(await readFile(join(source!, "models.json"), "utf8")) as {
    providers: Record<string, { baseUrl: string; api: string; models: { id: string }[] }>;
  };
  const provider = models.providers.dacint;
  expect(provider.api).toBe("openai-completions");
  const model = provider.models.find((m) => m.id === "DeepSeek-V4.1-Flash-1017");
  expect(model).toBeDefined();
  // Observe only effort and model. Credentials and prompts are never written to artifacts.
  const requests: { model: unknown; effort: unknown }[] = [];
  const server = createServer((req, res) => {
    const forward = async () => {
      let raw = "";
      for await (const chunk of req) raw += String(chunk);
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push({ model: body.model, effort: body.reasoning_effort });
      const response = await fetch(provider.baseUrl.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: req.headers.authorization ?? "",
        },
        body: raw,
        signal: AbortSignal.timeout(90000),
      });
      res.writeHead(response.status, {
        "Content-Type": response.headers.get("content-type") ?? "text/event-stream",
      });
      if (response.body) for await (const chunk of response.body) res.write(chunk);
      res.end();
    };
    forward().catch(() => {
      res.writeHead(502);
      res.end("DACINT verification relay failed");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({ dacint: auth.dacint }), {
    mode: 0o600,
  });
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        dacint: { ...provider, baseUrl: `http://127.0.0.1:${port}/v1`, models: [model] },
      },
    }),
    { mode: 0o600 },
  );
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "dacint",
      defaultModel: model!.id,
      defaultThinkingLevel: "xhigh",
      enabledModels: [`dacint/${model!.id}`],
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
    await expect(page.getByRole("button", { name: "Thinking level", exact: true })).toHaveText(
      /max|xhigh/,
    );
    await page
      .getByTestId("new-thread-composer")
      .fill(
        "Connection verification only. Do not use tools. Compute 19 times 23 and answer DACINT_EFFORT_OK 437.",
      );
    await page.getByRole("button", { name: "Start thread", exact: true }).click();
    await expect
      .poll(() => requests.find((r) => r.model === model!.id)?.effort, { timeout: 30000 })
      .toBe("max");
    await expect
      .poll(
        async () =>
          ((await getSelectedTranscript(page))?.transcript ?? [])
            .filter((i) => i.kind === "message" && i.role === "assistant")
            .map((i) => (i.kind === "message" ? i.text : ""))
            .join(""),
        { timeout: 90000 },
      )
      .toContain("DACINT_EFFORT_OK 437");
    await writeFile(test.info().outputPath("effort.json"), JSON.stringify(requests));
    await expect(page.getByRole("button", { name: "Thinking level", exact: true })).toHaveText(
      "max",
    );
    await page.screenshot({ path: test.info().outputPath("dacint-effort.png") });
  } finally {
    await harness.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
