# Reasoning Mode: Defaults, Provenance, and Quality A/B Methodology

Mycelia's LLM workers run with **reasoning (thinking) disabled by default**.
Observed on real traffic before the change: a 2242-character summary billed
3158 output tokens — roughly ⅔ of the paid output was invisible reasoning.
Turning it off is a large cost win, but it must be verified as
quality-neutral. This document describes how the mode is recorded and how to
measure its impact.

> **Verdict (2026-08-07, see Results below): reasoning stays OFF.** On both
> the selfhost Qwen and DeepSeek routes, thinking made extraction 3-4×
> slower, burned 2-9k reasoning tokens per chunk, introduced two new failure
> modes (an unbounded think loop on Qwen; malformed structured output on
> DeepSeek) and extracted *fewer* segments/entities, not more.

## How it works

- Every LLM worker schema has a `reasoning` field: `"off"` (default),
  `"default"` (provider decides) or `"on"` (force thinking — models like
  DeepSeek do not think unless asked). Override it per run in the Launch Job
  form or persistently via the worker's default overrides on the Jobs page.
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

## Results — 2026-08-07 run

12 stratified completed chunks (0.5k-17k transcript chars, RU-dominant), one
run per arm, `force`+`chunkId` re-extraction, metrics from job artifacts.
Arms A/B/C ran on the selfhost route (Qwen3.6-27B Q4, llama.cpp); DA/DB/DC on
OpenRouter (deepseek-v4-flash). "Thinking" = `reasoning: "default"` for Qwen
(thinks by default), `"on"` for DeepSeek.

| Arm | Worker | Reasoning | OK | s/chunk | LLM calls | rTok | Segments | Entities | Tags |
|-----|--------|-----------|----|---------|-----------|------|----------|----------|------|
| A | legacy | thinking | 11/12 | 113 | 24 | 45 235 | 13 | 68 | 33 |
| B | legacy | off | 12/12 | 33 | 42 | 0 | 30 | 119 | 66 |
| C | merged | off | 12/12 | 20 | 12 | 0 | 38 | 135 | 94 |
| DA | legacy | on | 7/12* | 198 | 18 | 25 330 | 11 | 45 | 23 |
| DB | legacy | off | 12/12 | 52 | 49 | 0 | 37 | 104 | 47 |
| DC | merged | off | 12/12 | 13 | 12 | 0 | 6** | 63 | 17 |

\* 2 chunks skipped by stale claims after container restarts (n=10), 2 failed
with malformed JSON, 1 timed out. \*\* DeepSeek with the merged prompt
returned `{"segments": []}` on 6/12 chunks including a rich 12.8k-char one.

Pairwise agreement (entity-name Jaccard / tag Jaccard, mean per chunk):
C vs B 0.37/0.63 · B vs A 0.36/0.58 · C vs A 0.22/0.51 ·
DB vs DA 0.51/0.43 · DC vs DB 0.48/0.29.

Findings:

1. **Thinking under-segments.** On both models the thinking arm collapsed
   almost every chunk into a single segment and found roughly half the
   entities of the off arms. The two off arms agree with each other more
   than either agrees with the thinking arm.
2. **Thinking is fragile.** Qwen looped on 1/12 chunks until the token cap
   (twice, at 4096 and 16384 — the same chunk extracted fine with reasoning
   off in 46s). DeepSeek+thinking produced unparseable JSON on 2/12 chunks
   and timed out on one: thinking fights constrained/structured decoding.
3. **Thinking is expensive.** ≈2-9k reasoning tokens per chunk, 3-4× wall
   time, for strictly less output.
4. **The production config wins.** merged + off + Qwen (arm C): most
   segments (38), entities (135), tags (94), 100% valid emoji, 28/38
   boundaries phrase-resolved, fewest calls (12), fastest (20s/chunk).
5. **DeepSeek is a poor extractor for this corpus.** With the merged prompt
   it declares half the chunks "no usable conversation" (the prompt's empty
   escape hatch invites this); with the legacy prompt it segments but still
   finds fewer entities/tags than Qwen. Keep selfhost as the extraction
   route; if merged ever runs on DeepSeek, tighten the empty-response rule.
6. **Run-to-run entity extraction is unstable** (Jaccard 0.2-0.6 between any
   two arms) — duplicate-merge tooling stays important.

Caveats: single run per arm, completeness metrics only (no manual accuracy
audit), 12 chunks. The raw per-chunk rows live in the experiment's
`ab-results.jsonl` (job ids included — every job is inspectable on the Jobs
page).
