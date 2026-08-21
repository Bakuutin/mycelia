# Photo and PDF Knowledge

Mycelia imports photos and PDFs in two explicit stages:

1. `Analyze locally` reads a mounted source path, validates magic bytes and
   limits, calculates SHA-256, extracts local metadata, and creates temporary
   WebP previews. It does not call a recognition provider.
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

The default storage mode is `external_reference`. The source mount is read-only.
Mycelia stores the source-root ID, relative path, hash, technical metadata, and
compact thumbnails/previews. It does not copy the original. If the source
disappears or its hash changes, processing fails closed instead of silently
recognizing a different file.

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
Settings → Google Cloud and enable Media Knowledge. A recognition profile is not
required for local-only import. Open Media, keep `Queue recognition after
import` off, analyze the relative path `.`, review the preview, and confirm.

Automated local smoke test (it creates a test owner only inside the isolated
database and never calls Google):

```bash
bash scripts/smoke-media-local.sh
```

Expected result includes `status: staged`, `storageMode: external_reference`,
the original relative path, and a valid WebP preview.

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
`http://media-provider:8090`, and enable it. A staged test image can then be
queued from its Media details card. This proves the actual BullMQ worker,
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
  restart nginx
```

In Settings → Google Cloud add the `Google Cloud EU Photo Knowledge` preset,
fill the project ID, save, confirm the remaining promotional-credit balance
shown for that project in Cloud Console, and run the synthetic connector test.
It calls `gemini-3.5-flash-lite` through the Vertex AI EU endpoint and creates a
`gemini-embedding-001` search vector. The Document AI processor ID is optional.

Google Cloud does not expose a per-request "promo credit only" switch, and Cloud
Billing reporting is delayed. The app therefore fails closed unless the credit
balance and exact project were manually verified in the preceding 24 hours,
stops 72 hours before the recorded expiry, and defaults to gross list-price
limits of $1/month, $0.10/day, and $0.01/import. These guards reduce risk but
cannot mathematically guarantee that a paid billing account will never charge a
card because Google has no per-request "promo credits only" flag.

The settings page shows the app-side gross list-price ledger for the current
month and day, split into committed and still-reserved amounts. This counter is
shared across all Mycelia principals using the same GCP project and is the
source of the hard application stop. It deliberately does not subtract Google
free-tier units or promotional credits. Cloud Billing remains the authoritative
source for the actual invoice and remaining promotional balance.

## Provider boundary

Google visual understanding uses the Vertex AI EU multi-region endpoint and the
GA `gemini-3.5-flash-lite` model. Only the sanitized 1280 px WebP preview is
sent. Structured output and its text embedding are rebuildable projections; the
external original reference, SHA-256, technical metadata, preview, exact
model/region/time provenance, token usage, and estimated list-price cost remain
separate. Google image OCR uses strict-EU `DOCUMENT_TEXT_DETECTION`; PDFs use
the pinned EU Document AI processor. Optional labels and object localization are
a separate explicit `global` opt-in and are never silently enabled.

A self-hosted provider implements:

- `GET /health`;
- `GET /v1/capabilities`;
- `POST /v1/media/analyze` with multipart fields `file`, `request_id`, and
  `features`;
- `POST /v1/media/embed` with `{text, purpose:"query"}`.

The multipart `features` field is the exact selected task array
(`visual-understanding`, `ocr`, `labels`, `objects`). Visual providers return
`visualUnderstanding`, `searchText`, and `embedding`; optional tasks add
normalized `pages` and `annotations`. Switching providers creates a new
versioned analysis run; it does not rewrite the canonical asset or previews.
