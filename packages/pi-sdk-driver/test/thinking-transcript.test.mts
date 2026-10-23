import test from "node:test";
import assert from "node:assert/strict";
import { transcriptFromMessages } from "../dist/session-supervisor-utils.js";
test("thinking-only and mixed messages survive transcript projection without signatures", () => {
  const items = transcriptFromMessages([
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Check premise", thinkingSignature: "private-signature" },
      ],
    },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Compare" },
        { type: "text", text: "Answer" },
      ],
    },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, "message");
  assert.equal(items[0].thinking, "Check premise");
  assert.equal(items[0].text, "");
  assert.equal(items[1].text, "Answer");
  assert.equal(JSON.stringify(items).includes("private-signature"), false);
});
