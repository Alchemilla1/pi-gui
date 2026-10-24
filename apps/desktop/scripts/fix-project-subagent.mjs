import { readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
if (!target) throw new Error("Usage: node fix-project-subagent.mjs <project subagent/index.ts>");
const file = path.resolve(target);
let source = await readFile(file, "utf8");
if (!source.includes("async function runSingleAgent(") || !source.includes('"--mode", "json"'))
  throw new Error("This is not the supported Pi example subagent extension; no files changed.");
const helper = fileURLToPath(new URL("../resources/pi-subagent-launcher.cjs", import.meta.url));
if (source.includes('import launcher from "./launcher.cjs"')) {
  await copyFile(helper, path.join(path.dirname(file), "launcher.cjs"));
  console.log("Launcher refreshed; existing extension modifications preserved.");
} else {
  const start =
    source.indexOf("function resolvePiCli()") >= 0
      ? source.indexOf("function resolvePiCli()")
      : source.indexOf("function getPiInvocation(");
  const end = source.indexOf("type OnUpdateCallback", start);
  if (start < 0 || end < 0 || !source.includes('import { spawn } from "node:child_process";'))
    throw new Error("Unexpected launcher structure; no files changed.");
  await copyFile(file, `${file}.before-gui-launch-${Date.now()}`);
  source =
    source.slice(0, start) +
    "const getPiInvocation = launcher.resolvePiInvocation;\n\n" +
    source.slice(end);
  source = source.replace(
    'import { spawn } from "node:child_process";',
    'import { spawn } from "node:child_process";\nimport launcher from "./launcher.cjs";',
  );
  source = source.replace(/\s*const needsShell =[^;]+;/, "").replace(/\s*shell: needsShell,/, "");
  source = source.replace(
    'stdio: ["ignore", "pipe", "pipe"],',
    'stdio: ["ignore", "pipe", "pipe"],\n shell: false, windowsHide: true, env: invocation.env,',
  );
  source = source.replace(
    'let buffer = "";',
    'proc.stdout.setEncoding("utf8");\nproc.stderr.setEncoding("utf8");\nlet buffer = "";',
  );
  source = source.replace("resolve(code ?? 0);", "resolve(code ?? 1);");
  source = source.replace(
    "currentResult.exitCode = exitCode;",
    'currentResult.exitCode = exitCode;\nif (exitCode === 0 && !currentResult.messages.some(message => message.role === "assistant")) { currentResult.exitCode = 1; currentResult.errorMessage = "Subagent exited without an assistant response."; }',
  );
  await copyFile(helper, path.join(path.dirname(file), "launcher.cjs"));
  await writeFile(file, source);
  console.log("Updated the explicit project extension; reload Pi before using it.");
}
