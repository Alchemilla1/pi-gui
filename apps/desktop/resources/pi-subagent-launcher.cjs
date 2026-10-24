const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function executableFromPath(name, environment = process.env) {
  const dirs = (environment.PATH || environment.Path || "").split(path.delimiter);
  return dirs
    .map((dir) => path.join(dir.replace(/^"|"$/g, ""), name))
    .find((file) => fs.existsSync(file));
}

/** Never run an Electron app or a shell shim as a Pi child. Arguments remain argv data. */
function resolvePiInvocation(args, runtime = process) {
  const env = { ...runtime.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = Boolean(runtime.versions.electron);
  const script = runtime.argv[1];
  if (
    !electron &&
    /^(node|bun)(\.exe)?$/i.test(path.basename(runtime.execPath)) &&
    script &&
    /cli\.(js|mjs|cjs)$/.test(script) &&
    fs.existsSync(script)
  ) {
    return { command: runtime.execPath, args: [script, ...args], env };
  }
  const globalRoot = path.join(
    env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
    "npm",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
  const candidates = [
    env.PI_SUBAGENT_CLI,
    path.join(globalRoot, "dist", "bundle", "cli.js"),
    path.join(globalRoot, "dist", "cli.js"),
  ].filter(Boolean);
  const cli = candidates.find((file) => fs.existsSync(file));
  const node =
    env.PI_SUBAGENT_NODE ||
    executableFromPath(runtime.platform === "win32" ? "node.exe" : "node", env);
  if (node && cli) return { command: node, args: [cli, ...args], env };
  if (!electron && !/^(node|bun)(\.exe)?$/i.test(path.basename(runtime.execPath)))
    return { command: runtime.execPath, args, env };
  if (runtime.platform !== "win32") {
    const pi = executableFromPath("pi", env);
    if (pi) return { command: pi, args, env };
  }
  throw new Error(
    "Cannot locate Node + Pi CLI for subagent. Install Pi or set PI_SUBAGENT_NODE and PI_SUBAGENT_CLI; the GUI executable cannot be used as a child agent.",
  );
}

module.exports = { resolvePiInvocation };
