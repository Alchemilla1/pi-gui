import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { glob } from "glob";
import type { SshDirectoryListing } from "../../contracts/ssh";

const execFileAsync = promisify(execFile);
const aliasPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** Enumerate concrete aliases only; OpenSSH remains responsible for resolving settings. */
export async function listSshHosts(
  configPath = path.join(homedir(), ".ssh", "config"),
): Promise<string[]> {
  const visited = new Set<string>();
  const hosts = new Set<string>();
  const sshDir = path.dirname(configPath);
  async function read(file: string): Promise<void> {
    const absolute = path.resolve(file);
    if (visited.has(absolute) || visited.size >= 128) return;
    visited.add(absolute);
    let source: string;
    try {
      source = await readFile(absolute, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const line of source.split(/\r?\n/)) {
      const normalized = line.replace(/^(\s*[A-Za-z]+)\s*=\s*/, "$1 ");
      const tokens = normalized.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+/g) ?? [];
      const keyword = tokens.shift()?.toLowerCase();
      const values: string[] = [];
      for (const token of tokens) {
        if (token.startsWith("#")) break;
        values.push(token.replace(/^(["'])(.*)\1$/, "$2"));
      }
      if (keyword === "host")
        for (const alias of values) if (aliasPattern.test(alias)) hosts.add(alias);
      if (keyword === "include")
        for (const pattern of values) {
          const expanded = pattern.startsWith("~/")
            ? path.join(homedir(), pattern.slice(2))
            : path.resolve(sshDir, pattern);
          const matches = await glob(expanded.replaceAll("\\", "/"), { nodir: true });
          for (const included of matches.sort()) await read(included);
        }
    }
  }
  await read(configPath);
  return [...hosts].sort((a, b) => a.localeCompare(b));
}

export async function browseSshDirectory(
  host: string,
  directory: string,
): Promise<SshDirectoryListing> {
  if (!aliasPattern.test(host) || !(await listSshHosts()).includes(host))
    throw new Error("Choose a host from your SSH config.");
  if (directory && (!directory.startsWith("/") || /[\0\r\n]/.test(directory)))
    throw new Error("Use an absolute remote path, or leave it empty for your home directory.");
  // Only this fixed, read-only program runs remotely. User paths are encoded data.
  const code = `const fs=require('fs'),p=require('path'),os=require('os');
    const home=os.homedir();const input=Buffer.from(process.argv[1],'base64').toString('utf8');
    const dir=fs.realpathSync(input||home);if(!fs.statSync(dir).isDirectory())throw Error('Not a directory');
    const names=fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()||(e.isSymbolicLink()&&(()=>{try{return fs.statSync(p.join(dir,e.name)).isDirectory()}catch{return false}})())).map(e=>e.name).sort();
    console.log(JSON.stringify({path:dir,home,parent:dir==='/'?null:p.dirname(dir),directories:names.slice(0,500),truncated:names.length>500}));`;
  const program = Buffer.from(code).toString("base64");
  const encodedPath = Buffer.from(directory).toString("base64");
  const command = `node=$(command -v node || true); if [ -z "$node" ]; then node="$HOME/.local/share/pi-node/current/bin/node"; fi; exec "$node" -e 'eval(Buffer.from("${program}","base64").toString())' '${encodedPath}'`;
  const { stdout } = await execFileAsync(
    "ssh",
    ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=12", host, command],
    { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 },
  );
  const value: unknown = JSON.parse(stdout.trim());
  const data = value as SshDirectoryListing;
  if (
    !data ||
    typeof data.path !== "string" ||
    typeof data.home !== "string" ||
    !Array.isArray(data.directories) ||
    !data.directories.every((n) => typeof n === "string")
  )
    throw new Error("Invalid directory response from SSH host");
  return data;
}
