# Reasoning Mode: Defaults, Provenance, and Quality A/B Methodology

Mycelia's LLM workers run with **reasoning (thinking) disabled by default**.
Observed on real traffic before the change: a 2242-character summary billed
3158 output tokens — roughly ⅔ of the paid output was invisible reasoning.
Turning it off is a large cost win, but it must be verified as
quality-neutral. This document describes how the mode is recorded and how to
measure its impact.

## How it works

- Every LLM worker schema has a `reasoning` field: `"off"` (default) or
  `"default"` (provider decides, usually on). Override it per run in the
  Launch Job form or persistently via the worker's default overrides on the
  Jobs page.
- The `llm` resource translates the mode per provider route:
  - OpenRouter: `reasoning: { enabled: false }`
  - Self-host / others (llama.cpp, vLLM, Qwen-style): `reasoning_budget: 0`
    plus `chat_template_kwargs.enable_thinking: false`
- Provenance records what actually happened on **every** call:
  - `provenance.reasoning`: `"off"` | `"default"`
  - `provenance.reasoningTokens`: reasoning tokens the provider billed
    (from `usage.completion_tokens_details.reasoning_tokens`), when reported
  - Job results aggregate both in `result.inference`
    (`reasoning`, `reasoningTokens`); job details pages render them as
    "Reasoning: off · N reasoning tok".

So historical comparisons are always possible: filter jobs/objects by the
recorded mode, compare cost via `reasoningTokens`.

## A/B methodology: does reasoning-off hurt quality?

The same procedure also answers "is the merged single-call extractor as good
as the legacy two-call one?" — it is arm C below.

### 1. Fix an eval set

Pick ~20 **completed** conversation chunks and record their ids. Mix:
short/long, RU/EN, single-topic/multi-topic. Example query:

```bash
docker compose exec backend deno eval '
  // list candidate chunk ids grouped by transcript length
' # or just copy ids from the Jobs page artifacts
```

Keep the id list in this file or next to it — the set must stay identical
across arms.

### 2. Run the arms

Extraction jobs are idempotent per chunk, and the extraction claim/skip keys
do **not** include the reasoning mode — so re-runs must always use
`force: true` with an explicit `chunkId`.

| Arm | Worker | reasoning | Purpose |
|-----|--------|-----------|---------|
| A | conversation_extractor (legacy) | `default` | baseline (old behavior) |
| B | conversation_extractor (legacy) | `off` | isolates the reasoning effect |
| C | conversation_extractor_merged | `off` | target production config |

For each chunk id and each arm, launch a manual job from the Jobs page with
`{ chunkId, force: true, reasoning: <mode> }`.

### 3. Collect mechanical metrics

All of these are already rendered in the job-details artifacts — no extra
tooling needed:

- **Segmentation**: segment count per chunk; boundary phrases resolved
  (vs fallback to chunk start/end).
- **Entities**: entity-set Jaccard similarity vs arm A (per chunk); count of
  dropped/duplicate entities.
- **Tags**: tag overlap vs arm A; dropped (hallucinated) tag count.
- **Emoji**: valid-emoji rate (`rawEmoji` recorded when invalid).
- **Cost**: `reasoningTokens` and total output tokens from provenance.

### 4. Summaries

Regenerate summaries for ~20 conversations under each mode using
`allowExisting: true` (keeps the old summary), then compare side-by-side in
the existing SummaryCompareDialog on the conversation page.

### 5. Decision thresholds

- ≥95% entity and tag overlap with arm A, and
- no regression in boundary resolution or segment counts, and
- summaries judged equal or better in the side-by-side

⇒ the mode is quality-neutral; keep `off` as the default. Apply the same
B-vs-C comparison to green-light the merged extractor as sole primary.

### Caveats

- Some providers report `finish_reason: "stop"` even when constrained
  decoding silently hit the token cap — the parse-failure retry is the
  backstop; don't treat the absence of `LLM_TRUNCATED_RESPONSE` as proof
  nothing was cut.
- Reasoning-off on non-OpenRouter routes uses Qwen-style knobs
  (`reasoning_budget`, `chat_template_kwargs.enable_thinking`); strict
  OpenAI-compatible servers for other model families may 400 on them —
  failover covers multi-route setups, single-route setups should verify once
  manually.
- Prompt-cache session keys include the reasoning mode, so A/B runs never
  share sticky cache sessions.
