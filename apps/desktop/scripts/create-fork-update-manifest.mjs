import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const [archive, version] = process.argv.slice(2);
if (!archive || !version || !/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Usage: node create-fork-update-manifest.mjs <zip> <stable-version>");
const asset = `pi-gui-${version}-win-x64.zip`;
if (path.basename(archive) !== asset) throw new Error(`Expected ${asset}`);
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
if (pkg.version !== version) throw new Error("Package version does not match release version");
const hash = createHash("sha256");
for await (const chunk of createReadStream(archive)) hash.update(chunk);
await writeFile(
  path.join(path.dirname(archive), "pi-gui-update.json"),
  JSON.stringify(
    {
      schema: 1,
      repository: "Alchemilla1/pi-gui",
      version,
      platform: "win32",
      arch: "x64",
      asset,
      sha256: hash.digest("hex"),
      size: (await stat(archive)).size,
    },
    null,
    2,
  ) + "\n",
);
