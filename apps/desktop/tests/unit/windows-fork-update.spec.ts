import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const helper = path.resolve("apps/desktop/resources/apply-fork-update.ps1");
test("Windows updater replaces an idle app and retains its old directory", async () => {
  test.skip(process.platform !== "win32", "Windows directory swap contract");
  const result = await exercise(false);
  expect(result.failed).toBe(false);
  expect(await readFile(path.join(result.target, "version.txt"), "utf8")).toBe("new");
  expect(await readFile(path.join(result.backup, "version.txt"), "utf8")).toBe("old");
});
test("Windows updater restores the previous app when the new executable fails", async () => {
  test.skip(process.platform !== "win32", "Windows directory swap contract");
  const result = await exercise(true);
  expect(result.failed).toBe(true);
  expect(await readFile(path.join(result.target, "version.txt"), "utf8")).toBe("old");
  await expect
    .poll(async () =>
      access(path.join(result.target, "restored.marker")).then(
        () => true,
        () => false,
      ),
    )
    .toBe(true);
});

async function exercise(broken: boolean) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-update-proof-"));
  const target = path.join(root, "Pi GUI");
  const stage = path.join(root, "stage");
  const backup = `${target}.previous-proof`;
  await mkdir(target);
  await mkdir(stage);
  const source = path.join(root, "Program.cs");
  await writeFile(
    source,
    `using System; using System.IO;
    class Program { static int Main() {
      var here=AppDomain.CurrentDomain.BaseDirectory;
      if(File.ReadAllText(Path.Combine(here,"version.txt"))=="old") { File.WriteAllText(Path.Combine(here,"restored.marker"),"ok"); return 0; }
      if(File.Exists(Path.Combine(here,"broken"))) return 1;
      var file=Environment.GetEnvironmentVariable("PI_GUI_UPDATE_HEALTH_FILE");
      var token=Environment.GetEnvironmentVariable("PI_GUI_UPDATE_HEALTH_TOKEN");
      var q=(char)34; File.WriteAllText(file,"{"+q+"token"+q+":"+q+token+q+","+q+"version"+q+":"+q+"1.1.0"+q+"}"); return 0;
    } }`,
  );
  const compiler = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  await exec(
    compiler,
    ["/nologo", "/target:winexe", `/out:${path.join(stage, "pi-gui.exe")}`, source],
    { windowsHide: true },
  );
  await copyFile(path.join(stage, "pi-gui.exe"), path.join(target, "pi-gui.exe"));
  await writeFile(path.join(target, "version.txt"), "old");
  await writeFile(path.join(stage, "version.txt"), "new");
  if (broken) await writeFile(path.join(stage, "broken"), "");
  const plan = path.join(root, "plan.json");
  await writeFile(
    plan,
    JSON.stringify({
      target,
      stage,
      backup,
      failed: `${target}.failed-proof`,
      pid: 2147483647,
      version: "1.1.0",
      healthFile: path.join(root, "health.json"),
      token: "fixture",
    }),
  );
  const failed = await exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      helper,
      "-PlanPath",
      plan,
    ],
    { windowsHide: true, timeout: 90000 },
  ).then(
    () => false,
    () => true,
  );
  return { target, backup, failed };
}
