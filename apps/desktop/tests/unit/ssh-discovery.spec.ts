import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { listSshHosts } from "../../electron/remote/ssh-discovery";

test("SSH discovery includes concrete aliases and nested includes without leaking settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-ssh-discovery-"));
  await mkdir(join(dir, "hosts"));
  await writeFile(
    join(dir, "config"),
    '# comment\nHost DEV-CPU A800-DLM * !excluded gpu?\n HostName private.example\n IdentityFile secret.pem\nInclude "hosts/*.conf"\nHost=DEV-CPU\n',
  );
  await writeFile(
    join(dir, "hosts", "one.conf"),
    'Host "H100-CUIHU"\nInclude config\nHost -oProxyCommand=bad\n',
  );
  expect(await listSshHosts(join(dir, "config"))).toEqual(["A800-DLM", "DEV-CPU", "H100-CUIHU"]);
  expect(await listSshHosts(join(dir, "missing"))).toEqual([]);
});
