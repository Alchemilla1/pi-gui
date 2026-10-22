import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  launchDesktop,
  launchDesktopByExecutable,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedForkSessionFixture,
  getDesktopState,
  getSelectedTranscript,
  waitForSelectedSessionReady,
} from "../helpers/electron-app";

test("discovers existing Pi histories without opening folders and allows unset thinking preference", async () => {
  const profile = await makeUserDataDir();
  const agentDir = join(profile, "agent");
  await seedAgentDir(agentDir);
  const settingsFile = join(agentDir, "settings.json");
  const settings = JSON.parse(await readFile(settingsFile, "utf8")) as Record<string, unknown>;
  delete settings.defaultThinkingLevel;
  await writeFile(settingsFile, JSON.stringify(settings));
  const first = await makeWorkspace("existing-history-one");
  const second = await makeWorkspace("existing-history-two");
  const one = await seedForkSessionFixture(agentDir, first);
  const two = await seedForkSessionFixture(agentDir, second);
  const missing = await seedForkSessionFixture(agentDir, join(first, "missing-project"));
  const launch = process.env.PI_GUI_TEST_EXECUTABLE
    ? (dir: string, options: Parameters<typeof launchDesktop>[1]) =>
        launchDesktopByExecutable(process.env.PI_GUI_TEST_EXECUTABLE!, dir, options)
    : launchDesktop;
  const harness = await launch(profile, {
    agentDir,
    initialWorkspaces: [],
    testMode: "foreground",
    envOverrides: { PI_APP_TEST_MODE: undefined },
  });
  try {
    const page = await harness.firstWindow();
    await harness.focusWindow();
    await expect
      .poll(async () =>
        (await getDesktopState(page)).workspaces.flatMap((w) => w.sessions.map((s) => s.id)),
      )
      .toEqual(expect.arrayContaining([one.sessionId, two.sessionId, missing.sessionId]));
    await page.locator(`[data-session-id="${missing.sessionId}"] .session-row__select`).click();
    await expect
      .poll(async () => JSON.stringify((await getSelectedTranscript(page))?.transcript))
      .toContain("First fork answer");
    await page.locator(`[data-session-id="${one.sessionId}"] .session-row__select`).click();
    await waitForSelectedSessionReady(page, { sessionId: one.sessionId });
    await page
      .locator("#primary-sidebar")
      .getByRole("button", { name: "New thread", exact: true })
      .click();
    const thinking = page.getByRole("button", { name: "Thinking level", exact: true });
    await expect(thinking).toHaveText("Thinking");
    await thinking.click();
    await page.getByRole("button", { name: /^High Greater reasoning/ }).click();
    await expect(thinking).toHaveText("high");
    await page.screenshot({ path: test.info().outputPath("thinking-and-history.png") });
  } finally {
    await harness.close();
  }
});
