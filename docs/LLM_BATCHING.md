# LLM Batching: choosing batch sizes for workers

Several workers can put many items into a **single LLM request** instead of
one request per item. Batch size is configurable per worker from the Jobs
page (Workers table → "Concurrency · Batch" column) or per job run via the
`batchSize` field on the Launch Job form.

| Worker | What one batch contains | Where the setting lives | Default |
|---|---|---|---|
| `entity_typing` | Entity names (+aliases/details) classified in one call | `workers.entity_typing.defaultOverrides.batchSize` | 40 |
| `transcription` | Audio sequences per STT request | `config.transcription.batchSize` | env `TRANSCRIPTION_BATCH_SIZE` |

Workers that are *not* batched at the request level (`summarization`,
`conversation_extractor_merged`) make one call per chunk/batch —
their "batch" settings (`limit`) only control how many items one job run
processes, which affects job-chaining granularity, not token usage.

`summarization` exposes this as `batchSize`
(`workers.summarization.defaultOverrides.batchSize`, default 25, max 100):
conversations per automatic batch job, processed sequentially. The job
timeout scales with it (5 min base + 90 s per conversation, 15 min minimum),
so larger batches get proportionally more time instead of dying at a flat
limit.

## What batch size actually trades off

**Why batching saves tokens.** The system prompt (and for the tagger the tag
list) is re-sent on every call. With N items per call the fixed prompt cost
is amortized N times. For `entity_typing` the fixed prompt is ~250 tokens and
each entity is ~10–40 tokens, so going from batch 1 → 40 cuts prompt tokens
roughly 5–8×. Provider-side prompt caching (`session_id`) further discounts
the repeated prefix on subsequent calls, so the marginal saving of very large
batches is smaller than it first appears.

**Why not batch to the maximum:**

1. **Quality degrades with list length.** Small models start skipping or
   mis-aligning items in long lists ("lost in the middle"). The entity typing
   worker keys results by object id specifically so omissions are detected
   (they are counted as `skipped` and retried on the next run) — a rising
   `skipped` count is the primary signal that the batch is too large for the
   current model.
2. **Output token limits.** The response must fit the model's completion
   limit. For entity typing each item costs ~15–25 output tokens; 100 items ≈
   2k output tokens, fine for most models but tight for small local ones.
3. **Retry blast radius.** One failed call (parse error, provider 5xx,
   timeout) loses the whole batch. With providers that fail intermittently,
   smaller batches waste less on retries.
4. **Latency per call.** Long batches mean long single calls; with
   `maxConcurrency: 1` workers, one slow call blocks the queue longer and is
   more likely to hit the job timeout.

## Recommendations

- **Capable API models** (DeepSeek, GPT-4o-mini, Gemini Flash class):
  **30–50** items. This is the default (40) — near-maximal amortization while
  keeping omission rates near zero.
- **Small local models** (7–30B quantized on selfhost): **10–20**. Local
  models both misalign long lists more often and have tighter context/output
  budgets.
- **Very long items** (entities with long `details`, future work-item
  batching): scale down so a call stays under ~4k prompt tokens.

## How to verify a batch size empirically

1. Pick ~100 objects with known-correct types (or hand-check a sample after
   a run).
2. Run `entity_typing` with `force: true` and `objectIds` (or a small
   `limit`) at candidate batch sizes, e.g. 10 / 40 / 80.
3. Compare per run, all visible on the job details page:
   - `skipped` — items the LLM omitted or mis-keyed (**the** batch-too-big
     signal; should be 0);
   - spot-check the **Classified Entities** section (each badge links to the
     object) for wrong types;
   - tokens per item — `usage` from provider dashboards, or job duration as
     a proxy;
   - `errors` — parse failures grow when the response gets long.
4. Choose the largest batch where `skipped` stays 0 and spot-check accuracy
   matches the small-batch run.

Because the worker is idempotent and never overrides manual toggles,
re-running classification experiments is safe; `force: true` re-classifies
only objects whose flags were set by the worker itself.
