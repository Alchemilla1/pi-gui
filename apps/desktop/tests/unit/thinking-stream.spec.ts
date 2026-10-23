import { expect, test } from "@playwright/test";
import {
  appendAssistantDelta,
  clearActiveAssistantMessage,
} from "../../electron/conversation/app-store-timeline";
import { sessionKey } from "@pi-gui/session-driver";
import type { TranscriptMessage } from "../../contracts/timeline-types";
test("thinking streams separately from answer text and remains session isolated", () => {
  const cache = new Map<string, readonly TranscriptMessage[]>();
  const active = new Map<string, string>();
  const a = { workspaceId: "/a", sessionId: "a" };
  const b = { workspaceId: "ssh://host/b", sessionId: "b" };
  appendAssistantDelta(cache, active, a, "First ", "thinking");
  appendAssistantDelta(cache, active, b, "Other", "thinking");
  appendAssistantDelta(cache, active, a, "reason", "thinking");
  appendAssistantDelta(cache, active, a, "Answer");
  expect(cache.get(sessionKey(a))?.[0]).toMatchObject({ thinking: "First reason", text: "Answer" });
  expect(cache.get(sessionKey(b))?.[0]).toMatchObject({ thinking: "Other", text: "" });
  clearActiveAssistantMessage(active, a);
  appendAssistantDelta(cache, active, a, "Next", "thinking");
  expect(cache.get(sessionKey(a))).toHaveLength(2);
});
