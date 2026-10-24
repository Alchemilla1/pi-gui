# Provider configuration and GUI subagents (1.0.6)

The custom endpoint editor now supports OpenAI Chat Completions, OpenAI Responses
and Anthropic Messages. Protocol and per-model reasoning flags pass through the
renderer, IPC validation, application store and models.json storage. Existing
model-specific API/base URL overrides, thinkingLevelMap, compatibility settings,
token limits and provider headers survive edits. Anthropic service roots ending
in `/v1` are normalized on save to avoid `/v1/v1/messages`; model discovery sends
Anthropic authentication headers. An endpoint's actual supported protocol still
depends on the server, not on the label selected in the editor.

Missing reasoning metadata causes Pi to clamp the session's thinking level to off.
A global xhigh preference does not override that capability flag. The editor now
offers a per-model reasoning checkbox; it does not guess that every model supports
reasoning. Existing sessions retain recorded preferences until explicitly changed.
The DACINT DeepSeek model was enabled locally after endpoint tests; other models
and unrelated Codex routing were not altered. DeepSeek-V4.1-Flash-1017 supports
`max`, not a distinct `xhigh` effort: its official encoding maps low/high/max to
50/75/100. Its local model definition declares `max: "max"` and does not declare
xhigh. Pi resolves the existing global xhigh preference to the supported max
level. The gateway rejects the native DeepSeek `thinking` field with
`unsupported_chat_request`, so this OpenAI-compatible route sends only its accepted
`reasoning_effort: "max"`. The live DACINT regression observes the outgoing `reasoning_effort` and
the resulting GUI level; it does not claim access to the gateway's vLLM runtime
configuration. See the [model's encoding documentation](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017/blob/main/encoding/README.md)
and [DeepSeek effort mapping](https://api-docs.deepseek.com/guides/thinking_mode).

For the user's Pi example-based project subagent, a packaged Electron executable
must never be used as the child Pi executable. `resources/pi-subagent-launcher.cjs`
resolves a real Node executable and Pi CLI entrypoint, passing an argv array with
`shell: false`. It supports explicit PI_SUBAGENT_NODE and PI_SUBAGENT_CLI overrides.
`scripts/fix-project-subagent.mjs` applies this focused launcher repair to a named
project extension, retaining a backup; it does not install a second subagent tool.

The existing local project extension was also corrected to decode UTF-8 streams,
report empty child transcripts as failures, preserve spawn errors, and cancel its
owned Windows process tree. Thinking-only output is not substituted for a final
answer. Existing scope=both behavior is preserved. These are extension fixes, not
a claim that arbitrary third-party extensions are now GUI-compatible.

Validation: provider-store preservation tests; an Electron settings flow that
creates an Anthropic endpoint and completes thinking -> bash -> final answer over
an HTTP fixture; a real DACINT Anthropic GUI reply with thinking; and a real Qoder
parent/child GUI run. The child proof checks successful tool output and nonzero
child turns, not a marker inside the task arguments. Live specs require explicit
auth opt-in and keep credentials outside evidence directories.

The simple DACINT control requests completed with both none and high, so this fix
does not claim that off alone caused the previous long tool-only loop. It repairs
the demonstrated capability/configuration loss and process-launch failures.

Anthropic streaming start blocks can already contain thinking or text. The driver
now forwards that initial content before subsequent deltas, so fast or buffered
responses no longer lose their reasoning in the live GUI. A protocol fixture
reproduced the missing initial prefix before the fix and verifies the complete
text afterward; the live diagnostic records initial versus total thinking lengths.
The live check distinguishes the conversation response from background title requests
and compares returned thinking with the transcript. An upstream response with no
thinking must not create a thinking panel; the deterministic fixture separately
requires exact thinking and answer text without missing or duplicated content.
