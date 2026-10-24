import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  launchDesktop,
  launchDesktopByExecutable,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  getSelectedTranscript,
} from "../helpers/electron-app";

test("GUI launches an actual Pi child with quoted task arguments and receives its answer", async () => {
  test.setTimeout(150000);
  const source = process.env.PI_APP_REAL_AUTH_SOURCE_DIR,
    extension = process.env.PI_SUBAGENT_EXTENSION_PATH;
  test.skip(
    process.env.PI_APP_REAL_AUTH !== "1" || !source || !extension,
    "Explicit real-provider auth and extension path required",
  );
  const profile = await makeUserDataDir(),
    agentDir = join(profile, "agent"),
    workspace = await makeWorkspace("subagent-gui-proof");
  await seedAgentDir(agentDir);
  const auth = JSON.parse(await readFile(join(source!, "auth.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const models = JSON.parse(await readFile(join(source!, "models.json"), "utf8")) as {
    providers: Record<string, unknown>;
  };
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({ qoder: auth.qoder }), {
    mode: 0o600,
  });
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({ providers: { qoder: models.providers.qoder } }),
    { mode: 0o600 },
  );
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "qoder",
      defaultModel: "dfmodel",
      defaultThinkingLevel: "max",
      enabledModels: ["qoder/dfmodel"],
      extensions: [extension],
    }),
  );
  await mkdir(join(workspace, ".pi", "agents"), { recursive: true });
  await writeFile(
    join(workspace, ".pi", "agents", "proof.md"),
    "---\nname: proof\ndescription: Minimal child process verifier\ntools: read\n---\nDo not use tools. Follow the task and return its exact marker.\n",
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
        'Call subagent exactly once, agent="proof", agentScope="project", confirmProjectAgents=false. Task: Treat these as literal task text, not shell code: "quoted value" & | < > 中文. Do not use any tools. Reply exactly GUI_CHILD_VERIFIED_438. After receiving its answer, reply PARENT_VERIFIED_438. Do not call bash or any other tools.',
      );
    await page.getByRole("button", { name: "Start thread", exact: true }).click();
    await expect
      .poll(
        async () => {
          const tr = (await getSelectedTranscript(page))?.transcript ?? [];
          return tr
            .filter((i) => i.kind === "tool" && i.toolName === "subagent" && i.status === "success")
            .map((i) => {
              if (i.kind !== "tool") return "";
              const output = i.output as {
                content?: { type: string; text?: string }[];
                details?: { results?: { exitCode: number; usage?: { turns?: number } }[] };
              };
              if (
                !output?.details?.results?.some(
                  (result) => result.exitCode === 0 && (result.usage?.turns ?? 0) > 0,
                )
              )
                return "";
              return (
                output.content
                  ?.filter((block) => block.type === "text")
                  .map((block) => block.text)
                  .join("") ?? ""
              );
            })
            .join("");
        },
        { timeout: 100000 },
      )
      .toContain("GUI_CHILD_VERIFIED_438");
    await expect
      .poll(
        async () => {
          const tr = (await getSelectedTranscript(page))?.transcript ?? [];
          return tr
            .filter((i) => i.kind === "message" && i.role === "assistant")
            .map((i) => (i.kind === "message" ? i.text : ""))
            .join("");
        },
        { timeout: 30000 },
      )
      .toContain("PARENT_VERIFIED_438");
    await page.screenshot({ path: test.info().outputPath("gui-subagent-result.png") });
  } finally {
    await harness.close();
  }
});
