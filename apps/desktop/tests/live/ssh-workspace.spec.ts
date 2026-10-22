import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  launchDesktopByExecutable,
  makeUserDataDir,
  getDesktopState,
  getSelectedTranscript,
} from "../helpers/electron-app";

test("SSH workspace joins the native sidebar and runs a real remote Pi turn", async () => {
  test.setTimeout(180_000);
  const host = process.env.PI_GUI_SSH_TEST_HOST;
  const cwd = process.env.PI_GUI_SSH_TEST_CWD;
  test.skip(
    !host || !cwd,
    "Set PI_GUI_SSH_TEST_HOST and PI_GUI_SSH_TEST_CWD for the authorized test host.",
  );
  const profile = await makeUserDataDir();
  const launch = process.env.PI_GUI_TEST_EXECUTABLE
    ? (dir: string, options: Parameters<typeof launchDesktop>[1]) =>
        launchDesktopByExecutable(process.env.PI_GUI_TEST_EXECUTABLE!, dir, options)
    : launchDesktop;
  const harness = await launch(profile, {
    testMode: "foreground",
    envOverrides: { PI_APP_TEST_MODE: undefined },
  });
  try {
    const page = await harness.firstWindow();
    await harness.focusWindow();
    await page.getByRole("button", { name: "Connect SSH workspace", exact: true }).click();
    await page.getByLabel("SSH host", { exact: true }).fill(host!);
    await page.getByLabel("Remote project folder").fill(cwd!);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Connect SSH workspace" })).toBeHidden({
      timeout: 90_000,
    });
    await expect
      .poll(async () =>
        (await getDesktopState(page)).workspaces.some((w) => w.path.startsWith(`ssh://${host}/`)),
      )
      .toBe(true);
    await page
      .locator("#primary-sidebar")
      .getByRole("button", { name: "New thread", exact: true })
      .click();
    const composer = page.getByTestId("new-thread-composer");
    await expect(composer).toBeVisible();
    await composer.fill(
      "Call list_threads and list_scheduled_tasks once each. These are read-only checks. Then reply exactly SSH_GUI_OK. Do not modify files or create tasks.",
    );
    const previousSession = (await getDesktopState(page)).selectedSessionId;
    await page.getByRole("button", { name: "Start thread", exact: true }).click();
    await expect
      .poll(async () => {
        const state = await getDesktopState(page);
        return Boolean(state.selectedSessionId && state.selectedSessionId !== previousSession);
      })
      .toBe(true);
    await expect
      .poll(
        async () =>
          (await getSelectedTranscript(page))?.transcript
            .filter((item) => item.kind === "message" && item.role === "assistant")
            .map((item) => (item.kind === "message" ? item.text : ""))
            .join("\n"),
        { timeout: 90_000 },
      )
      .toContain("SSH_GUI_OK");
    const transcript = (await getSelectedTranscript(page))!.transcript;
    for (const toolName of ["list_threads", "list_scheduled_tasks"]) {
      expect(
        transcript.some(
          (item) => item.kind === "tool" && item.toolName === toolName && item.status === "success",
        ),
      ).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath("ssh-native-thread.png") });
    const state = await getDesktopState(page);
    expect(state.selectedWorkspaceId).toContain(`ssh://${host}/`);
  } catch (error) {
    console.log(JSON.stringify(await getDesktopState(await harness.firstWindow())));
    throw error;
  } finally {
    await harness.close();
  }
});
