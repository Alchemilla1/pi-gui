import { expect, test } from "@playwright/test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  launchDesktop,
  launchDesktopByExecutable,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedForkSessionFixture,
  waitForSelectedSessionReady,
} from "../helpers/electron-app";

test("saved reasoning is displayed separately in an expandable thinking panel", async () => {
  const profile = await makeUserDataDir();
  const agentDir = join(profile, "agent");
  await seedAgentDir(agentDir);
  const workspace = await makeWorkspace("thinking-proof");
  const fixture = await seedForkSessionFixture(agentDir, workspace);
  const root = join(agentDir, "sessions");
  for (const d of await readdir(root)) {
    for (const file of await readdir(join(root, d))) {
      if (!file.includes(fixture.sessionId) || !file.endsWith(".jsonl")) continue;
      const p = join(root, d, file);
      const lines = (await readFile(p, "utf8"))
        .trim()
        .split("\n")
        .map((line) => {
          const entry = JSON.parse(line) as { message?: { role: string; content: unknown } };
          if (entry.message?.role === "assistant")
            entry.message.content = [
              {
                type: "thinking",
                thinking: "THINKING_FIXTURE: verify the premise before answering.",
              },
              ...(typeof entry.message.content === "string"
                ? [{ type: "text", text: entry.message.content }]
                : (entry.message.content as object[])),
            ];
          return JSON.stringify(entry);
        });
      await writeFile(p, lines.join("\n") + "\n");
    }
  }
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
    await page.locator(`[data-session-id="${fixture.sessionId}"] .session-row__select`).click();
    await waitForSelectedSessionReady(page, { sessionId: fixture.sessionId });
    const panel = page.locator("details.timeline-thinking").first();
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveAttribute("open", "");
    await panel.locator("summary").click();
    await expect(panel).toHaveAttribute("open", "");
    await expect(panel).toContainText("THINKING_FIXTURE");
    await expect(page.getByTestId("transcript")).toContainText("First fork answer");
    await page.screenshot({ path: test.info().outputPath("thinking-panel.png") });
  } finally {
    await harness.close();
  }
});
