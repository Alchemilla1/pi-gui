import test from "node:test";
import assert from "node:assert/strict";
import { parseSshWorkspace, sshWorkspaceUri } from "@pi-gui/session-driver";
import { JsonLines, SESSION_METHODS, RUNTIME_METHODS } from "../dist/remote/protocol.js";

await test("SSH identity retains host case and remote path characters", () => {
  const uri = sshWorkspaceUri("DEV-CPU", "/root/a folder/中文");
  assert.deepEqual(parseSshWorkspace(uri), { host: "DEV-CPU", path: "/root/a folder/中文" });
  assert.notEqual(uri, sshWorkspaceUri("A800-DLM", "/root/a folder/中文"));
  assert.equal(parseSshWorkspace("C:\\work\\repo"), undefined);
  for (const invalid of [
    "ssh://-oProxyCommand=x/root",
    "ssh://user@host/root",
    "ssh://host/path%0aevil",
    "ssh://host",
  ])
    assert.throws(() => parseSshWorkspace(invalid));
});
await test("wire framing preserves Unicode separators and split records", () => {
  const decoder = new JsonLines();
  assert.deepEqual(decoder.push('{"text":"first\u2028'), []);
  assert.deepEqual(decoder.push('second\u2029third"}\n{"n":2}\r\n'), [
    { text: "first\u2028second\u2029third" },
    { n: 2 },
  ]);
});
await test("remote wire only allows enumerated driver operations", () => {
  for (const name of ["constructor", "__proto__", "eval", "exec", "getSessionFilePath"])
    assert.equal(SESSION_METHODS.has(name), false);
  assert.equal(SESSION_METHODS.has("cancelCurrentRun"), true);
  assert.equal(RUNTIME_METHODS.has("login"), false);
});
