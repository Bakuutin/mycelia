# Photo and PDF Knowledge

Mycelia imports photos and PDFs in two explicit stages:

1. Choose files (managed storage) or `Analyze mounted path` (read-only
   reference). Mycelia validates magic bytes and limits, calculates SHA-256,
   extracts local metadata with ExifTool/ffprobe, and creates temporary WebP
   previews with metadata stripped. It does not call a recognition provider.
2. `Confirm import` creates canonical media assets. Recognition is a separate
   opt-in switch, so an import can remain `staged` until Google Cloud or a
   self-hosted provider is ready.

The Media screen separates **where** a job runs from **what** it does. Choose
Google Cloud or a self-hosted Open Media API profile. The primary task is
`visual-understanding`: a Russian caption and description, scene, objects,
activities, people count without identity inference, keywords, possible event,
confidence, warnings, and an embedding for semantic search. OCR, Vision labels,
and Vision object localization are independent optional tasks. Local metadata
extraction is always local and precedes that choice.

Local ingestion is independent of recognition. When `mediaKnowledge.enabled` is
false, managed uploads and mounted-source imports still extract metadata,
deduplicate, and create previews. No recognition profile is selected and no
provider receives content.

Uploaded files use `managed_original`: analysis writes the immutable original
to staging inside the separate `media_originals` GridFS bucket. An untouched
preview expires after one hour; confirmation marks the original canonical. If
confirmation is interrupted after it is claimed, its unfinished staged files
are protected by a bounded seven-day recovery lease so the same confirmation
can resume idempotently. The source-folder path uses
`external_reference`: the mount is read-only and Mycelia stores only its
source-root ID, relative path and hash.
Both modes keep technical metadata, EXIF date/GPS when present, and compact WebP
thumbnails/previews separately. SHA-256 deduplication applies across both import
paths.

An untouched abandoned upload preview expires after one hour; its staged
original and previews are removed by the next import cleanup. A confirmation
already in progress keeps only its unfinished staged files for at most seven
days before normal cleanup can remove them. A managed original can be
converted to `preview_only`, but only through `Review original deletion` and a
second explicit confirmation. Mycelia first verifies a stored preview and a
completed analysis, then permanently deletes only the GridFS original while
retaining previews, metadata, provider results and search projections. Mounted
source files are never deleted; forgetting their reference only changes the
asset to `preview_only`. A preview-only asset cannot be reprocessed unless an
original is imported again.

If a mounted original is moved or removed, recognition stops before any
provider or budget call and the asset becomes `source_missing`; if its bytes
change, it becomes `source_changed`. Uploading the same SHA-256 through the
managed-upload path restores a missing original without discarding the old
source provenance, previews, metadata, or completed analysis.

## Isolated media development stack

This checkout includes a Compose overlay that cannot reuse the main stack's
containers, volumes, image tags, ports, or database:

```bash
cp .env.media.example .env.media.local
```

Edit `.env.media.local`:

- replace the three development-only secrets;
- set `MEDIA_SOURCE_HOST_PATH` to an **absolute** host folder containing JPG,
  PNG, WebP, or PDF files;
- leave `GCP_ADC_HOST_PATH` unused for the local-only phase.

Start only the services needed for the media UI:

```bash
docker compose \
  --env-file .env.media.local \
  -f docker-compose.yml \
  -f docker-compose.media-dev.yml \
  up -d --build mongo redis backend frontend nginx
```

Open `http://127.0.0.1:3211`. HTTPS is also published on port `4443`, but uses
the development self-signed certificate. Complete first-time setup, then open
Media. A recognition profile is not required for local-only import, and the
upload controls remain available when recognition is disabled. Keep
`Queue recognition after import` off, either upload files or analyze the
relative path `.`, review the storage-mode badge and preview, and confirm.

`Analyze mounted path` accepts a path **relative to** `MEDIA_SOURCE_HOST_PATH`,
not an arbitrary macOS path. Use `.` to scan the whole mounted folder or a value
such as `2026/photos` for a subfolder. To change the real host folder, edit
`MEDIA_SOURCE_HOST_PATH` in `.env.media.local`, recreate only `backend`, and
restart `nginx`:

For the large gallery workflow, create a subfolder such as
`~/Pictures/Mycelia-Import/900-photos/` under the mounted host root and enter
only `900-photos` in the browser. Use **Sync mounted folder locally** instead of
the older bounded preview button. The durable campaign walks subdirectories
without following symlinks, inventories unsupported files, hashes and inspects
25 entries per worker job, and survives backend restarts. Its local report
separates imported, duplicate, unsupported, changed, and failed entries before
or during confirmation. Originals remain read-only external references; only
EXIF/GPS, stripped WebP previews, hashes, and derived data enter Mycelia.

```bash
docker compose \
  --env-file .env.media.local \
  -f docker-compose.yml \
  -f docker-compose.media-dev.yml \
  up -d --no-deps --force-recreate backend

docker compose \
  --env-file .env.media.local \
  -f docker-compose.yml \
  -f docker-compose.media-dev.yml \
  restart nginx
```

If this stack already uses Google ADC, keep the Google overlay in both commands
so recreation does not drop the credential mount and environment:

```bash
docker compose \
  --env-file .env.media.local \
  -f docker-compose.yml \
  -f docker-compose.media-dev.yml \
  -f docker-compose.media-gcp.yml \
  up -d --no-deps --force-recreate backend

docker compose \
  --env-file .env.media.local \
  -f docker-compose.yml \
  -f docker-compose.media-dev.yml \
  -f docker-compose.media-gcp.yml \
  restart nginx
```

Alternatively, drag files directly onto **Option 1 — upload managed originals**
or press **Choose files**. This path does not require the mounted folder. It
accepts up to 50 JPEG, PNG, WebP, or PDF files per preview, with a 48 MB total
request limit (20 MB per image, 32 MB and 15 pages per PDF). It keeps staged
originals for one hour while the preview is untouched; confirmation marks those
originals canonical in the same `media_originals` GridFS bucket. An interrupted
confirmation can resume during its bounded seven-day recovery lease. It never
modifies the file selected on the computer.

Disabled providers remain visible in the provider selector for diagnosis but
cannot be selected. Enable the profile and the Media Knowledge master switch in
Settings → Google Cloud, then Save. For a Google profile, Labels and Objects
have an additional `Allow global labels and objects` switch because those two
Vision features do not use the strict-EU OCR endpoint. Visual understanding and
OCR do not depend on that global opt-in. The master switch and current profile
toggle are checked again at enqueue and immediately before a worker reads or
sends content; turning either off stops already queued recognition before a
provider call.

If setup reports that API keys already exist, create browser credentials in the
running isolated backend (this command does not require a checkout `.env`):

```bash
docker exec -it -w /app mycelia-media-89da-backend-1 \
  deno run -A server.ts token-create --name Chrome-$(date +%F)
```

Automated local smoke test (it creates a test owner only inside the isolated
database and never calls Google). Before running it, put at least one supported
JPEG, PNG, WebP, or PDF in `MEDIA_SOURCE_HOST_PATH`; the script uses that file
for the mounted-reference receipt and generates its own separate managed-upload
fixture:

```bash
bash scripts/smoke-media-local.sh
```

Expected result contains two receipts. `mounted` includes `status: staged`,
`storageMode: external_reference`, the relative path, and a valid WebP preview.
`managed` includes `storageMode: managed_original`, a byte-for-byte verified
original hash, and a duplicate receipt from uploading the same generated image
again without creating a second canonical original. Original deletion remains
blocked until that asset has a ready analysis.

To verify the provider-neutral worker pipeline before granting Google IAM, add
the development-only self-hosted contract mock:

```bash
docker compose \
  --env-file .env.media.local \
  -f docker-compose.yml \
  -f docker-compose.media-dev.yml \
  -f docker-compose.media-selfhost-test.yml \
  up -d media-provider
```

Add the self-hosted preset in Settings → Google Cloud, set its URL to
`http://media-provider:8090`, enable it, select it under **Active provider**, and
Save. A staged test image can then be queued from its Media details card. This
proves the actual BullMQ worker,
normalized projections, Russian structured visual description, vector search,
provenance, and usage without a cloud request; it is not a substitute for the
final Google connector and worker smoke.

## Google Cloud phase

Google recognition is server-side OAuth/ADC; there is no API-key field in the
browser or MongoDB. Prepare:

1. A dedicated GCP project with billing attached to the promotional-credit
   billing account.
2. Enabled `aiplatform.googleapis.com`. Enable `vision.googleapis.com` and
   `documentai.googleapis.com` only when the optional OCR/labels tasks are used.
3. For optional PDF OCR, an EU Document AI Enterprise OCR processor pinned to
   `pretrained-ocr-v2.1-2024-08-07`.
4. A least-privilege runtime identity with
   `roles/serviceusage.serviceUsageConsumer` and `roles/aiplatform.user`; add
   `roles/documentai.apiUser` only for Document AI.
5. An Application Default Credentials or Workload Identity Federation file
   outside the repository.

Set `GCP_ADC_HOST_PATH` in `.env.media.local` to the absolute credential-file
path, then add the Google overlay:

```bash
docker compose \
  --env-file .env.media.local \
  -f docker-compose.yml \
  -f docker-compose.media-dev.yml \
  -f docker-compose.media-gcp.yml \
  up -d --build --force-recreate backend

docker compose \
  --env-file .env.media.local \
  -f docker-compose.yml \
  -f docker-compose.media-dev.yml \
  -f docker-compose.media-gcp.yml \
  restart nginx
```

In Settings → Google Cloud add the `Google Cloud EU Photo Knowledge` preset,
fill the project ID, save, confirm the remaining promotional-credit balance
shown for that project in Cloud Console, and run the synthetic connector test.
It calls `gemini-3.5-flash-lite` through the Vertex AI EU endpoint and creates a
`gemini-embedding-001` search vector, then calls Cloud Vision EU OCR with the
same generated 1×1 PNG. The base test reserves $0.0075 in the conservative app
ledger. The Document AI processor ID and its additional $0.0015 synthetic PDF
test are optional. No user media is sent by the connector test.

Google Cloud does not expose a per-request "promo credit only" switch, and Cloud
Billing reporting is delayed. In **Free trial account** mode the app therefore
fails closed unless the credit balance and exact project were manually verified
in the preceding 24 hours, and it stops 72 hours before the recorded expiry. In
**Paid account** mode one project-bound confirmation permanently acknowledges
that real charges are acceptable; the 24-hour balance and promotion-expiry
checks are skipped. Both modes retain configurable monthly, daily, per-asset,
and per-event gross list-price stops. The 900-photo rollout uses `$300/month`,
`$50/day`, and `$0.01/photo`; every confirmed batch also stores its exact
SHA-bound maximum cost. A multi-file batch can therefore exceed one cent in
total while each asset stays below its own stop.
These guards reduce risk but cannot mathematically guarantee that a paid billing
account will never charge a card because Google has no per-request "promo
credits only" flag.

The confirmation receipt is bound to the selected project and Billing account
mode. Changing either closes the guard until it is confirmed again. Free-trial
confirmation is also bound to promotion expiry. Selecting **Not confirmed —
block Google calls** and saving is a persistent application kill-switch for
Google spending.

The settings page shows the app-side gross list-price ledger for the current
month and day, split into committed and still-reserved amounts. This counter is
shared across all Mycelia principals using the same GCP project and is the
source of the hard application stop. It deliberately does not subtract Google
free-tier units or promotional credits. Cloud Billing remains the authoritative
source for the actual invoice and remaining promotional balance.

## Provider boundary

Google visual understanding uses the Vertex AI EU multi-region endpoint and the
GA `gemini-3.5-flash-lite` model. The derived text is embedded with
`gemini-embedding-001` at the supported EU regional endpoint `europe-west4`; the
app never silently falls back to `global`. Google documents that choosing a
standard regional endpoint alone is not a data-residency guarantee, so Mycelia
records this as regional routing rather than claiming Netherlands-only
processing. Only the sanitized 1280 px WebP preview is sent. Structured output
and its text embedding are rebuildable projections; the external original
reference, SHA-256, technical metadata, preview, exact model/region/time
provenance, token usage, and estimated list-price cost remain separate. Google
image OCR uses strict-EU
`DOCUMENT_TEXT_DETECTION`; PDFs use the pinned EU Document AI processor.
Optional labels and object localization are a separate explicit `global` opt-in
and are never silently enabled.

Semantic query text is sent only when the user runs search, the enabled active
provider has owned semantic media, and its connector is available. Google
queries reserve a conservative $0.0004 gross-list-price ledger amount; without
an active provider, or when ADC fails, local OCR and label search still runs.

A self-hosted provider implements:

- `GET /health`;
- `GET /v1/capabilities`;
- `POST /v1/media/analyze` with multipart fields `file`, `request_id`, and
  `features`;
- `POST /v1/media/events/analyze` with an ephemeral manifest and sanitized
  WebP previews for group understanding;
- `POST /v1/media/embed` with `{text, purpose:"query"}`.

The multipart `features` field is the exact selected task array
(`visual-understanding`, `ocr`, `labels`, `objects`). Visual providers return
`visualUnderstanding`, `searchText`, and `embedding`; optional tasks add
normalized `pages` and `annotations`. Switching providers creates a new
versioned analysis run; it does not rewrite the canonical asset or previews.
Existing vectors are never mixed across different embedding model/dimension
spaces. After switching, use explicit Retry on older assets to reprocess them
for the new provider's semantic index; OCR and label search continues to use
the stored local projections meanwhile.

## Photo event aggregation

The **Photo events** panel turns imported images into reviewable memory events.
It deliberately separates local clustering, provider analysis, and canonical
publication:

1. **Build local event proposals** scans the newest unassigned image assets for
   the current principal that have a normalized capture time and stored
   preview. It groups nearby photos by time and EXIF GPS. No cloud or
   self-hosted provider is called. Photos that do not match another photo are
   returned explicitly as **Single photos** instead of disappearing from the
   proposal. Open a singleton for ordinary per-photo recognition, or select
   several photos in the Media inventory and build an explicit local proposal
   from that selection. At most 100 proposed groups can be confirmed in one
   batch; build the next batch afterwards.
2. Review the proposed membership, period, and the exact representative
   thumbnails that would be transmitted. Deselect unwanted groups and choose
   whether to queue group understanding. Omitting that choice creates only a
   local event. Queueing analysis requires explicit confirmation and creates a
   stable owner-scoped event plus an immutable, hash-bound consent receipt.
3. The selected provider receives at most the configured number of sanitized
   WebP previews (eight by default), labelled only with ephemeral references
   and relative time offsets. It never receives filenames, source paths,
   hashes, raw EXIF, exact GPS, transcript text, saved Object data, or original
   files.
4. Reanalysis is also a two-step **Review analysis** → **Confirm and queue**
   flow that shows the exact current thumbnail set, provider, privacy contract,
   and maximum reservation before any call. When a versioned result is ready,
   **Publish to Mycelia** is a second explicit action. It creates one
   idempotent `isEvent` Object with the exact locally computed period and
   optional local GPS centroid, so the event also appears on the existing
   Objects timeline. Later syncs preserve user-edited Object content.

The event model may produce a Russian title, description, visual place type,
anonymous visible-participant ranges, key actions, keywords, and ranked
representative frames. It is forbidden from resolving identities, matching
faces between frames, creating Person links, or inferring age, gender,
ethnicity, health, religion, politics, sexuality, or other sensitive traits.
Provider prose is still treated as untrusted output: it is displayed for human
review, neutralized before Markdown publication, and never creates a Person
link automatically.
The exact event period, membership, GPS, audio/transcription links, and Object
links remain local deterministic evidence and cannot be changed by the model.

## Media inventory and batches

The `/media` page uses cursor pagination and server-side filters, so an archive
of 900 or more photos is not truncated to the first 500. It separates
**Unprocessed**, **Queued / processing**, **Ready**,
and **Needs attention** states, while keeping local capture time, timezone,
camera, dimensions, GPS availability, current provider/model, OCR page count,
annotation count, short description, and estimated list-price usage visible.
The detail view presents the useful local metadata as structured fields; raw
EXIF/ffprobe JSON remains available only under the advanced disclosure.

Select inventory rows and use **Process selected** to queue individual,
auditable recognition jobs with the provider and tasks chosen in the import
section. This is deliberately not one large provider request: partial failures
are reported per file and do not discard the rest of the batch. The action asks
for confirmation before queueing. A selection of two or more images can also be
used as the explicit candidate set for local event clustering; no provider is
called by that step.

**Process all with Google Cloud EU Photo Knowledge** first creates a local
preview receipt with a cutoff, exact asset IDs/SHA-256 values, the pinned Google
profile, tasks, per-photo estimate, and total gross ceiling. Confirmation
returns immediately. A durable coordinator keeps a bounded queue window and
creates one ordinary `mediaRecognition` job per photo. It skips `ready`,
`queued`, and `processing`; missing references become `source_missing` under
Needs attention. Stop prevents new jobs while already-started provider calls
finish and remain accounted. Retry resets only failed or budget-blocked batch
items. The fixed tasks are Vertex visual understanding/embedding and strict-EU
Vision OCR; global Vision labels/objects are never part of this bulk action.

Every individual photo with a reliable local capture time appears on the
adaptive **Photos** Timeline track, regardless of recognition status. Narrow
ranges show thumbnail markers; wide ranges use indexed density buckets. Every
photo with EXIF or manually assigned GPS appears on the default **Photos** map
layer, which also works without GPX imports. Missing values are never inferred:
**Missing time**, **Missing location**, and Unplaced links open the inventory,
where time/timezone/coordinates can be assigned locally with audit history.
Photo groups remain separate: an event appears as a canonical Object only after
its own review and explicit **Publish to Mycelia** action.

Audio and transcription links are derived locally from time overlap and are
stored as IDs rather than copied text. The linker accepts a transcription only
when its source file is owned by the same principal. Because legacy Objects are
a single-person corpus without owner fields, automatic Object suggestions are
enabled only for the default `admin` personal corpus and always exclude Person
Objects. Tokens created with a different owner can still build owner-scoped
photo events, but cannot publish into that shared Object corpus.
Nothing from those links is sent to Google.

Settings → Google Cloud exposes defaults for the time gap, GPS distance, audio
link window, maximum event size, provider preview count, and the conservative
per-event gross stop. The initial Google reservation is capped at $0.02 per
event and shares the existing daily/monthly project ledger. A provider call is
never triggered automatically by file import or by local clustering. Changing
the active provider affects only new explicit event jobs; there is no automatic
self-hosted-to-Google fallback. Once a provider request has crossed its durable
start fence, cancelling the queue job may not stop a request already accepted
by the remote provider; the run remains auditable instead of being silently
replayed. Startup maintenance and a one-minute reconciler settle expired event
runs and their budget records across all owners; duplicate workers wait for the
saved lease instead of creating another provider call.

Deleting a photo's previews or analysis marks every affected derived event
stale and blocks publication/reanalysis until it is rebuilt. A previously
published Event Object is retained as user-owned canonical content rather than
being deleted implicitly; removing that Object remains a separate user action.
The first release creates single events only. Hierarchical multi-day journeys
and automatic merging/splitting of confirmed events remain future work.
