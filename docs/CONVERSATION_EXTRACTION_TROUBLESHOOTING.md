# Conversation extraction: verification and historical backfill

This runbook covers `conversation_extractor` v2: what it creates, how to verify
the result, and how to safely rebuild one historical chunk whose metadata is
missing or incomplete.

## What a successful v2 run creates

For every detected conversation segment the worker creates:

- one conversation object with a title and time range;
- exactly one emoji (`icon.text`);
- `agreed_upon_something`, always present as `true` or `false`;
- zero or more named entities;
- one `mentioned in` relationship from the conversation to each entity;
- extraction provenance and a verification receipt in
  `metadata.extractedWith`.

Zero entities, zero relationships, and `agreementDetected: false` are valid
results. A missing emoji is not valid for v2. A relationship mismatch is not a
fully clean result: `relationshipsCreated` should equal
`relationshipsAttempted`, with `relationshipErrors: 0`.

New jobs expose these totals in both Job List and Job Detail, including zeros:

| Job result field | Meaning |
| --- | --- |
| `chunksProcessed` | Claimed chunks completed by this job |
| `description` | Human-readable outcome with explicit zero or non-zero counts |
| `segmentsFound` | Conversation segments retained after time-range filtering |
| `conversationsCreated` | Conversation objects created |
| `emojiCount` | Conversations with a valid emoji |
| `entityCount` | Total named entities returned by metadata extraction |
| `agreementCount` | Conversations containing a concrete agreement |
| `relationshipsAttempted` | Entity links requested |
| `relationshipsCreated` | Entity links successfully stored |
| `relationshipErrors` | Entity links that failed |
| `artifacts` | Per-conversation title, emoji, entity names, agreement flag, and link counts |

Legacy jobs that predate these counters say `Legacy: unavailable`; do not
interpret an unavailable counter as zero. The corresponding conversation
objects remain the source of truth.

## Model recommendation

The active local profile was verified on 2026-07-28 with an
OpenAI-compatible structured JSON extraction request:

| Alias | Resolved model | Result | Recommendation |
| --- | --- | --- | --- |
| `small` | `gemini-3.5-flash-lite` | HTTP 200, `finish_reason=stop`, valid metadata JSON | Default for routine backfill; faster and lower token usage |
| `medium` | `gemini-3.6-flash` | HTTP 200, `finish_reason=stop`, valid metadata JSON | Use for noisy, multilingual, or difficult segmentation after reviewing a `small` result |

Start with `small`. Re-run the same chunk with `medium` only when the small
result is structurally valid but clearly low quality. A provider
`content_filter` result is not evidence that the parser is broken, and changing
models must not be used to bypass a provider safety decision.

`model` is an alias override for this job. If omitted, the model stored on the
chunk is used. Keep `fallbackModel` empty unless a deliberately configured and
tested fallback is available.

## Find historical candidates

Object Detail already shows one of these extraction states:

- `Verified`: v2 receipt is complete;
- `v2 output present`: v2 artifact exists, but an older object lacks the full receipt;
- `Needs metadata backfill`: the object does not prove that v2 completed.

The following read-only command prints targeted chunk IDs and reasons. It does
not print credentials or transcript text:

```bash
docker exec -w /app mycelia-backend-1 deno eval '
import { getRootDB } from "./app/lib/mongo/core.server.ts";
const db = await getRootDB();
const rows = await db.collection("objects").find({
  isConversation: true,
  "metadata.extractedWith.chunkId": { $type: "string" },
  $or: [
    { "metadata.extractedWith.extractorVersion": { $ne: "v2" } },
    { "metadata.extractedWith.result": { $exists: false } },
    { "icon.text": { $exists: false } },
    { $expr: { $ne: [
      { $ifNull: ["$metadata.extractedWith.result.relationshipsCreated", -1] },
      { $ifNull: ["$metadata.extractedWith.result.relationshipsAttempted", -2] }
    ] } }
  ]
}, { projection: {
  name: 1,
  icon: 1,
  "metadata.extractedWith.chunkId": 1,
  "metadata.extractedWith.extractorVersion": 1,
  "metadata.extractedWith.result": 1
} }).toArray();
for (const row of rows) {
  const x = row.metadata?.extractedWith ?? {};
  const result = x.result ?? {};
  const reasons = [];
  if (x.extractorVersion !== "v2") reasons.push("not_v2");
  if (!x.result) reasons.push("missing_receipt");
  if (!row.icon?.text) reasons.push("missing_emoji");
  if (result.relationshipsCreated !== result.relationshipsAttempted) reasons.push("link_mismatch");
  console.log(JSON.stringify({ chunkId: x.chunkId, objectId: row._id, name: row.name, reasons }));
}
Deno.exit(0);'
```

Deduplicate the printed `chunkId` values before enqueuing. One forced chunk run
replaces all extractor-owned conversation artifacts for that chunk.

## Rebuild one completed historical chunk

### From the UI

1. Open Timeline and select any time range, then choose **Run Job**.
2. Select `conversation_extractor`.
3. Set `chunkId` to the exact candidate ID.
4. Set `force=true`, `extractorVersion=v2`, `model=small`, and `limit=1`.
5. Leave prompt overrides unchanged and `fallbackModel` empty.
6. Start the job and open its Job Detail page.

When `chunkId` is present, it is authoritative; the Timeline dates are ignored.
`force=true` is accepted only with an explicit `chunkId`. It refuses to steal a
chunk that is currently processing. It deletes only conversations and entity
relationships owned by that chunk, then rebuilds them.

### From the API

Run from the repository root. This loads `.env` without printing secrets,
exchanges the configured client credentials for a short-lived JWT, and enqueues
one targeted job:

```bash
set -a
source .env
set +a

MYCELIA_ACCESS_TOKEN="$(curl -sk -X POST https://localhost:4433/oauth/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode "client_id=${MYCELIA_CLIENT_ID}" \
  --data-urlencode "client_secret=${MYCELIA_TOKEN}" | jq -r '.access_token // empty')"

test -n "${MYCELIA_ACCESS_TOKEN}" || { echo 'OAuth token request failed'; return 1 2>/dev/null || exit 1; }

CHUNK_ID='REPLACE_WITH_24_CHARACTER_CHUNK_ID'

curl -sk -X POST https://localhost:4433/api/resource/jobs \
  -H "Authorization: Bearer ${MYCELIA_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\
    \"action\":\"enqueue\",\
    \"data\":{\
      \"type\":\"conversation_extractor\",\
      \"chunkId\":\"${CHUNK_ID}\",\
      \"force\":true,\
      \"extractorVersion\":\"v2\",\
      \"model\":\"small\",\
      \"fallbackModel\":\"\",\
      \"limit\":1\
    },\
    \"trigger\":{\"type\":\"manual\",\"reason\":\"historical_v2_metadata_backfill\"}\
  }" | jq
```

Change only `"model":"small"` to `"model":"medium"` for a reviewed quality
retry. Never run `small` and `medium` forced jobs for the same chunk
concurrently: each forced run replaces the chunk-owned artifacts.

## Verification checklist

A run is operationally complete only when all applicable checks pass:

1. Job state is `completed` and `chunksProcessed` is greater than zero.
2. `conversationsCreated` equals `artifacts.length`.
3. `emojiCount` equals `conversationsCreated`.
4. `entityCount` may be zero; if it is positive, entity names are visible under
   **Extracted Artifacts**.
5. `relationshipsCreated == relationshipsAttempted` and
   `relationshipErrors == 0`.
6. Each artifact links to a conversation whose Object Detail says `Verified`.
7. `metadata.extractedWith.extractorVersion` is `v2`, and its receipt contains
   `emojiPresent`, `entityCount`, and relationship counts.

`conversationsCreated=0` can be a legitimate empty chunk only when segmentation
found no usable conversation. A completed job with zero processed chunks is an
idle run, not proof that historical data was repaired.

## Summarization after extraction

Conversation extraction and summarization are separate queues. New conversation
objects without summaries trigger `summarization` automatically when that
worker is resumed. Check Jobs > Pipeline Health:

- `conversation_extractor` and `summarization` must both be unpaused;
- the summarization job must show measurable `processed` results;
- provider-filtered conversations are marked `Summarization: Failed` and are
  excluded from automatic retries until a deliberate manual retry.

Do not force extraction again merely because summarization was filtered; use
the summarization failure status and job error instead.
