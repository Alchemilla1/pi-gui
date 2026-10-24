import { expect, test } from "@playwright/test";
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

test("GUI receives a real Anthropic Messages answer and thinking from the configured gateway", async () => {
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
          baseUrl: provider.baseUrl.replace(/\/v1\/?$/, ""),
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
    await expect(page.locator("details.timeline-thinking").first()).toBeVisible();
    await page.locator("details.timeline-thinking summary").first().click();
    await page.screenshot({ path: test.info().outputPath("anthropic-live.png") });
  } finally {
    await harness.close();
  }
});
