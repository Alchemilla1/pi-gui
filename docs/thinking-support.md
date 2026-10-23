# Thinking display and Qoder compatibility

Version 1.0.4 retains assistant thinking separately from answer text when reading
Pi histories, and forwards thinking deltas over the local/SSH driver contract.
The transcript renders a collapsed Thinking panel that users can expand. Raw
signatures and redacted thinking blocks are not presented as reasoning text.

Qoder's current DeepSeek catalog advertises low/high/max for Flash and high/max
for Pro inside thinking_config, even when Flash's top-level is_reasoning is false.
The deployed qoder2api patch parses requested effort and forwards it as
parameters.reasoning_effort with enable_thinking and model_config.is_reasoning.
This field is consistent with the official @qoder-ai/qodercli 1.1.77 generation
serialization. Chat responses now preserve reasoning_content in both streaming
and nonstreaming forms.

Pi model configuration uses openai-completions, reasoning=true, explicit
thinkingLevelMap (xhigh -> max, max -> max), and supportsDeveloperRole=false.
The upstream name is max, not xhigh. Do not claim backend effort from a GUI label
alone: verify the Pi session level, outgoing bridge parameter, and successful
response independently. These checks passed on local Pi and DEV-CPU; A800-DLM
also completed a Max-mapped Pi request. Existing sessions retain their recorded
thinking preference until explicitly changed.

The proxy source patch is deployed on HDNSMANTLE under /opt/qoder2api/source.
The image is local/qoder2api:thinking-max-20261023; the previous image and compose
backup are retained. Do not rebuild from an unpatched upstream source and lose
the mapping. No third-party upstream Git repository was modified.

Verification includes saved thinking-only/mixed messages, separate streaming
channels and session isolation, a visible Electron expand/collapse test, the
packaged Windows app, and a real SSH stream with persisted thinking.
