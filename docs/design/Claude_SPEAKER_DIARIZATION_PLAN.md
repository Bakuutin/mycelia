# Plan: Speaker Diarization - Voice Identification System

## Problem

Diarization runs but produces anonymous `SPEAKER_XX` labels with no cross-session linking. The user cannot identify their own voice, see where they speak on the timeline, or filter by speaker.

## Key Discovery: Existing Dead Code

The diarizator already has **extensive enrollment and speaker management code** that is **built but never mounted or connected**:

- `diarizator/src/.../api/routers/enrollment.py` — Full enrollment API (upload, batch, append with weighted averaging)
- `diarizator/src/.../api/routers/speakers.py` — Speaker CRUD, export/import, analysis
- `diarizator/src/.../core/unified_speaker_db.py` — SQLite + FAISS speaker database with identify/verify
- `diarizator/src/.../core/seeded_clustering.py` — Cosine similarity matching against known speakers

**None of these routers are mounted in `service.py`** — it only exposes `/health` and `/diarize`.
**The diarization worker never passes `clusters`** to `/diarize`, so seeded clustering is never invoked.

## Architecture Decision

**Two storage layers, one bridge:**

1. **Diarizator** (standalone microservice) — keeps its own SQLite/FAISS for its own webui and fast nearest-neighbor search. We enable the existing routers.
2. **MongoDB `speaker_profiles`** — main system storage. Frontend, workers, transcript page all use this.
3. **Diarization worker** (the bridge) — loads profiles from MongoDB, passes them as `clusters` to the diarizator.

This keeps the diarizator fully standalone while giving the main system what it needs.

## Modularity: Dedicated Structure, On/Off

### Feature Flag
- Add `enable_speaker_identification: boolean` to `config.features` (Zod schema in `myceliasdk/config.ts`)
- Diarization worker checks flag before passing clusters
- Frontend checks flag before showing speaker UI
- Feature Flags settings page gets its first real toggle

### File Organization
Following existing project conventions:

```
# Python (new module for speaker identification logic)
python/speaker_identification/
  __init__.py
  matching.py          # Retroactive batch matching logic
  profiles.py          # Profile management (MongoDB CRUD)

# Backend workers (file-based discovery, one file per capability)
backend/workers/enrollment.ts           # Voice enrollment job
backend/workers/speakerMatching.ts      # Retroactive matching job

# Backend migrations
backend/migrations/0017_speaker_profiles.ts
backend/migrations/0018_diarization_matched_speaker.ts

# Frontend (module pattern, matching existing modules/audio, modules/histogram)
frontend/src/modules/speakers/
  index.tsx                # Exports
  useSpeakerProfiles.ts    # Hook: fetch/manage profiles
  SpeakerBadge.tsx         # Reusable speaker name badge component
  SpeakerFilter.tsx        # Filter dropdown component

# Frontend pages
frontend/src/pages/settings/VoiceProfilesPage.tsx
```

### On/Off Controls
- **Feature flag** in config: `features.enable_speaker_identification`
- **Worker pause**: speaker matching worker can be paused via Workers settings
- **Diarizator**: already runs as separate docker-compose, can be stopped independently
- **No data loss on disable**: `matched_speaker` field is additive, never removes existing data

---

## Infrastructure: Diarizator Deployment

### The Problem with Mac M2

- **MPS (Metal) backend is unreliable** for pyannote — PyTorch operators not fully implemented, users report incorrect diarization results
- **CPU mode works correctly** but is slow: ~3-5x real-time (1 min audio ≈ 3-5 min processing)
- pyannote 3.1 uses pure PyTorch (no onnxruntime), so CPU mode does work on Mac

### Deployment: GPU Primary + Local Fallback

**Primary: RTX 4090 via Tailscale** — add diarizator to `gpu/docker-compose.yml`
**Fallback: Mac M2 CPU** — run `diarizator/docker-compose.yml --profile cpu` locally

Connection: Mac ↔ GPU machine via **Tailscale VPN**.

### GPU Machine Setup (Step 0)

Add diarizator as a new service in `gpu/docker-compose.yml` alongside Whisper + Ollama:

```yaml
diarization:
  build:
    context: ../diarizator
    dockerfile: Dockerfile
    args:
      PYTORCH_CUDA_VERSION: cu126
  environment:
    - HF_HOME=/models
    - HF_TOKEN=${HF_TOKEN}
    - COMPUTE_MODE=gpu
    - SPEAKER_SERVICE_HOST=0.0.0.0
    - SPEAKER_SERVICE_PORT=8085
  volumes:
    - ../diarizator/src:/app/src        # Hot reload
    - ./docker/diarization-models:/models  # Separate model cache for pyannote
  ports:
    - "8085:8085"
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: all
            capabilities: [gpu]
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8085/health"]
    interval: 30s
    retries: 3
  restart: unless-stopped
```

**Configuration in main system:**
```bash
# .env on Mac (points to GPU machine via Tailscale)
DIARIZATION_SERVER_URL=http://<tailscale-ip>:8085

# For local fallback (when GPU machine is off)
DIARIZATION_SERVER_URL=http://localhost:8085
```

### Why Direct Access (Not Through GPU Proxy)

The GPU proxy (`gpu/proxy/server.py`) currently routes Whisper + Ollama. The diarizator is already a complete service with its own health checks, CORS, and multipart handling. Adding it to the proxy would add unnecessary complexity. Direct access on port 8085 via Tailscale is cleaner.

### VRAM Sharing on 4090 (24GB)

The 4090 runs Whisper + Ollama + Diarizator concurrently. VRAM usage:
- Whisper large-v3-turbo: ~3GB
- Ollama (varies by model): ~4-14GB
- pyannote diarization-3.1 + wespeaker embeddings: ~1.5GB
- **Total: ~8.5-18.5GB** — fits in 24GB, but Ollama should use a smaller model if running all three

### Performance Comparison

| Machine | Mode | 1 min audio | 10 min audio |
|---------|------|-------------|--------------|
| 4090 GPU | CUDA | ~1.5s | ~15s |
| Mac M2 | CPU | ~3-5 min | ~30-50 min |
| Mac M2 | MPS | ~20s ⚠️ | ~3 min ⚠️ |

⚠️ MPS produces incorrect results — do not use.

---

## Scope

Steps 0-5 (full MVP). Step 6 (timeline speaker track) deferred.
Enrollment supports both browser microphone recording and file upload.

---

## Implementation Plan (6 Steps)

### Step 0: Infrastructure — Deploy Diarizator to GPU Machine

Add diarizator service to `gpu/docker-compose.yml` and verify connectivity.

**Modified:** `gpu/docker-compose.yml` — add `diarization` service (see config above)

**Steps:**
1. Add service definition to `gpu/docker-compose.yml`
2. Set `HF_TOKEN` in GPU machine's `.env`
3. `docker compose up -d diarization` on GPU machine
4. Verify: `curl http://<tailscale-ip>:8085/health`
5. Set `DIARIZATION_SERVER_URL=http://<tailscale-ip>:8085` in main system `.env`
6. Verify: existing diarization pipeline works through GPU

**Verify:**
- `curl http://<tailscale-ip>:8085/health` returns `{"status": "ok"}`
- Upload test WAV: `curl -X POST http://<tailscale-ip>:8085/diarize -F "file=@test.wav"` returns segments
- Main system's diarization worker processes chunks via GPU service

---

### Step 1: Foundation — Collection + Feature Flag + Diarizator Routers

Create the storage, add the feature flag, and enable the diarizator's existing routers.

**New files:**
- `backend/migrations/0017_speaker_profiles.ts` — create collection + indexes

```
speaker_profiles {
  _id: ObjectId
  name: string              // "Me", "Alice"
  embedding: number[]       // 256 floats, L2-normalized
  sample_count: number      // enrollment samples
  total_duration: number    // total seconds
  is_primary: boolean       // true = "my voice" (at most one)
  created_at: Date
  updated_at: Date
}
```

- `backend/migrations/0018_diarization_matched_speaker.ts` — sparse index on `diarizations.matched_speaker.profile_id`

**Modified files:**
- `myceliasdk/config.ts` — add `enable_speaker_identification: z.boolean().default(false)` to `features`
- `diarizator/src/.../api/service.py` — mount existing routers + add `POST /embed` endpoint:
  ```python
  # Mount existing (currently dead) routers
  app.include_router(enrollment_router, prefix="/api", tags=["enrollment"])
  app.include_router(speakers_router, prefix="/api", tags=["speakers"])

  # New simple endpoint for main system enrollment
  @app.post("/embed")
  async def embed(file: UploadFile):
      wav = audio_backend.load_wave(tmp_path)  # whole file
      emb = await audio_backend.async_embed(wav)
      return {"embedding": emb.flatten().tolist(), "dimension": len(emb.flatten())}
  ```

**Verify:**
- Run backend → migration creates `speaker_profiles` collection
- Hit diarizator `/embed` with a WAV → get 256-dim embedding back
- Check config has `features.enable_speaker_identification`

---

### Step 2: Voice Enrollment

Allow enrolling voice via file upload or browser microphone recording. The diarizator extracts the embedding, we store it in MongoDB.

**New files:**
- `python/speaker_identification/__init__.py`
- `python/speaker_identification/profiles.py` — MongoDB profile CRUD:
  - `create_or_update_profile(name, embedding, duration, is_primary)`
  - `get_all_profiles()` → list of profiles with embeddings
  - `get_primary_profile()` → the "my voice" profile
  - `delete_profile(profile_id)`
- `python/jobs/enrollment.py` — job handler:
  1. Receives audio (from uploaded file stored in GridFS)
  2. Calls diarizator `POST /embed` → gets embedding
  3. Calls `create_or_update_profile()` → saves to MongoDB
  4. If profile exists: weighted mean `(old * count + new) / (count + 1)`, normalize
- `backend/workers/enrollment.ts` — `NetworkJobCapability` pointing to python worker

**Modified:**
- `python/worker_server.py` — register enrollment job

**Verify:**
- Upload WAV via enrollment job → profile appears in `speaker_profiles` with 256-dim embedding
- Upload second sample for same name → embedding updated via weighted average, `sample_count` incremented

---

### Step 3: Retroactive Speaker Matching

Match all existing diarization embeddings against enrolled profiles. Pure MongoDB operation — no diarizator needed since embeddings are already stored.

**New files:**
- `python/speaker_identification/matching.py`:
  ```python
  def match_segments_batch(profiles, segments, threshold=0.35):
      """Compute cosine similarity between segment embeddings and profile embeddings.
      Both are L2-normalized, so similarity = dot product."""
      for segment in segments:
          seg_emb = np.array(segment['embedding'])
          best_sim, best_profile = -1, None
          for profile in profiles:
              sim = np.dot(seg_emb, np.array(profile['embedding']))
              if sim > best_sim:
                  best_sim, best_profile = sim, profile
          if best_sim >= threshold:
              yield segment['_id'], {
                  'profile_id': best_profile['_id'],
                  'name': best_profile['name'],
                  'similarity': float(best_sim),
                  'matched_at': datetime.now(UTC)
              }
  ```
- `python/jobs/speaker_matching.py` — batch job:
  1. Load all profiles from `speaker_profiles`
  2. Stream `diarizations` where `matched_speaker` doesn't exist (cursor, batch of 1000)
  3. For each batch: compute similarities, `updateMany` with `matched_speaker` field
  4. Report progress via callback
- `backend/workers/speakerMatching.ts` — `NetworkJobCapability`

**Modified:**
- `python/worker_server.py` — register speaker_matching job

**Why threshold 0.35:**
- 0.15 (diarizator default) matches nearly everything
- 0.35 is a good starting point for wespeaker-voxceleb-resnet34-LM
- Tunable via `SPEAKER_SIMILARITY_THRESHOLD` env var

**Verify:**
- Enroll voice → run matching → query `diarizations` with `matched_speaker` → spot-check by playing audio

---

### Step 4: Live Pipeline Integration

Pass enrolled profiles to diarizator during real-time processing. This is the **key missing link** — connecting two pieces of existing infrastructure.

**Modified:** `python/diarization_worker.py`

Changes to `diarize_sequence()`:
1. Check feature flag (from config or env var)
2. Load profiles from MongoDB (cache, refresh every 5 minutes)
3. Build `clusters` param from profiles
4. Pass to `/diarize` as Form data + `similarity_threshold=0.35`
5. When response has `cluster_id` on segment, write `matched_speaker` field on diarization document

```python
# In diarize_sequence(), before calling /diarize:
if speaker_profiles:
    clusters = json.dumps([
        {"id": str(p["_id"]), "name": p["name"], "embedding": p["embedding"]}
        for p in speaker_profiles
    ])
    response = requests.post(
        f'{DIARIZATION_SERVER_URL}/diarize',
        files={'file': ('audio.wav', wav_file, 'audio/wav')},
        data={'clusters': clusters, 'similarity_threshold': '0.35'},
        timeout=300 + len(sequence.chunks) * 3
    )
```

**Verify:** Enroll → record new audio → wait for processing → new segments have `matched_speaker`

---

### Step 5: Frontend — Speaker Display, Enrollment UI, Filtering

**New files:**
- `frontend/src/modules/speakers/index.tsx` — module exports
- `frontend/src/modules/speakers/useSpeakerProfiles.ts` — hook to fetch/manage profiles from `speaker_profiles` collection
- `frontend/src/modules/speakers/SpeakerBadge.tsx` — reusable colored badge with speaker name
- `frontend/src/modules/speakers/SpeakerFilter.tsx` — dropdown filter component
- `frontend/src/pages/settings/VoiceProfilesPage.tsx`:
  - List enrolled profiles (name, sample count, duration, is_primary badge)
  - **Record from mic**: MediaRecorder API → capture 10-30s → send as WAV to enrollment job
  - **Upload file**: drag & drop WAV/MP3/OGG
  - Delete profile
  - Mark as primary ("my voice")
  - Button: "Run retroactive matching" → triggers speaker_matching job
  - Show matching job status

**Modified files:**
- `frontend/src/pages/TranscriptPage.tsx`:
  - Add `matched_speaker` to `DiarizationDoc` interface
  - Show `SpeakerBadge` next to colored dot when matched
  - Add `SpeakerFilter` dropdown: "All" / "My voice" / specific names
  - Filter modifies query: `"matched_speaker.profile_id": { $oid: id }`
- `frontend/src/pages/DiarizationDetailPage.tsx`:
  - Show speaker name and similarity score
- `frontend/src/pages/settings/FeatureFlagsPage.tsx`:
  - Add toggle for `enable_speaker_identification`
- `frontend/src/router.tsx` — add `/settings/voice-profiles` route

**Verify:**
- Settings → Feature Flags → enable speaker identification
- Settings → Voice Profiles → record from mic → profile created
- Transcript page → speaker names visible → filter to "My voice"
- Diarization detail → speaker name + similarity score shown

---

## Critical Files

| File | Change |
|------|--------|
| `gpu/docker-compose.yml` | Add diarizator service (Step 0) |
| `python/diarization_worker.py` | Pass `clusters` to diarizator (Step 4) |
| `diarizator/.../api/service.py` | Mount routers + add `/embed` (Step 1) |
| `diarizator/.../seeded_clustering.py` | Already built, threshold 0.15→0.35 |
| `myceliasdk/config.ts` | Feature flag (Step 1) |
| `python/worker_server.py` | Register new jobs (Steps 2, 3) |
| `frontend/src/pages/TranscriptPage.tsx` | Speaker display + filter (Step 5) |

## What We DON'T Need to Build

Thanks to existing code in the diarizator:
- Enrollment API logic (exists in `routers/enrollment.py`, just needs mounting)
- Speaker CRUD API (exists in `routers/speakers.py`)
- Embedding extraction (exists in `audio_backend.py`)
- Seeded clustering (exists in `seeded_clustering.py`)
- FAISS-based identification (exists in `unified_speaker_db.py`)
- Weighted embedding averaging (exists in `embedding_manager.py`)
- Export/import speakers (exists in `routers/speakers.py`)

## Model Upgrade Note

pyannote `community-1` (v4.0) has better accuracy. Defer until Steps 1-5 are proven:
- **Risk:** embedding dim may change → all stored embeddings incompatible
- Upgrade: `pyproject.toml` + `audio_backend.py` model name change

## Verification Plan

0. `curl http://<tailscale-ip>:8085/health` → `{"status": "ok"}`
1. Enable feature flag in settings
2. Settings → Voice Profiles → record 10-30s of clean speech
3. Confirm profile in MongoDB with 256-dim embedding
4. Run retroactive matching job
5. Transcript page → "Me" labels on your segments
6. Filter to "My voice" → only your speech
7. Record new audio → wait → new segments auto-labeled
8. Disconnect GPU → set `DIARIZATION_SERVER_URL=http://localhost:8085` → run diarizator locally with CPU profile → verify still works (slower)
