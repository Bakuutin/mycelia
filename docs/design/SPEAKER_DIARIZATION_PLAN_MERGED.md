# Speaker Diarization - Voice Identification System (Merged Plan)

**Status**: Design Document  
**Last Updated**: 2026-02-03  
**Version**: 2.0 (Merged from Claude_SPEAKER_DIARIZATION_PLAN.md and SPEAKER_DIARIZATION_PLAN.md)

---

## Problem Statement

Diarization runs but produces anonymous `SPEAKER_XX` labels with no cross-session linking. The user cannot:
- Identify their own voice
- See where they speak on the timeline
- Filter transcripts by speaker

---

## Key Discovery: Existing Dead Code

**Critical insight from codebase analysis:**

The diarizator already has **extensive enrollment and speaker management code** that is **built but never mounted or connected**:

| File | Purpose | Status |
|------|---------|--------|
| `routers/enrollment.py` | Full enrollment API (upload, batch, append) | NOT MOUNTED |
| `routers/speakers.py` | Speaker CRUD, export/import, analysis | NOT MOUNTED |
| `core/unified_speaker_db.py` | SQLite + FAISS with identify/verify | UNUSED |
| `core/seeded_clustering.py` | Cosine similarity matching | EXISTS but never invoked |

**The diarization worker never passes `clusters` to `/diarize`**, so seeded clustering is never invoked.

**Action**: Mount these existing routers and pass clusters from worker.

---

## Design Decisions Summary

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Deployment** | Embedded in existing Python worker | Simpler, no new containers |
| **GPU** | Remote RTX 4090 via Tailscale (direct) | Faster than through proxy |
| **Storage** | MongoDB only (`speaker_profiles`) | Simpler than dual-storage sync |
| **Embedding Dimension** | 256 (wespeaker-voxceleb-resnet34-LM) | Verified from model |
| **Similarity Threshold** | 0.35 | Optimal for wespeaker model |
| **Provider Strategy** | Env var based switching | Simple, no complex abstraction |
| **Real-time** | Optional Phase 4 (DIART) | Nice-to-have, not MVP |
| **Feature Toggle** | `features.enable_speaker_identification` | Clean on/off |

---

## Architecture

### Two Storage Layers, One Bridge

```mermaid
flowchart TB
    subgraph Frontend
        TranscriptPage[Transcript Page]
        VoiceProfilesPage[Voice Profiles Page]
        Timeline[Timeline]
    end
    
    subgraph Backend[Node.js Backend]
        API[REST API]
        JobQueue[Job Queue]
    end
    
    subgraph MongoDB[MongoDB - Source of Truth]
        SpeakerProfiles[(speaker_profiles)]
        Diarizations[(diarizations)]
    end
    
    subgraph PythonWorker[Python Worker - The Bridge]
        EnrollmentJob[Enrollment Job]
        MatchingJob[Speaker Matching Job]
        DiarizationWorker[Diarization Worker]
    end
    
    subgraph Diarizator[Diarizator Service]
        DiarizeEndpoint[/diarize]
        EmbedEndpoint[/embed]
        SeededClustering[Seeded Clustering]
    end
    
    Frontend --> Backend
    Backend --> JobQueue
    JobQueue --> PythonWorker
    
    EnrollmentJob -->|POST /embed| Diarizator
    EnrollmentJob -->|Save| SpeakerProfiles
    
    DiarizationWorker -->|Load profiles| SpeakerProfiles
    DiarizationWorker -->|POST /diarize with clusters| Diarizator
    DiarizationWorker -->|Save with matched_speaker| Diarizations
    
    MatchingJob -->|Load profiles| SpeakerProfiles
    MatchingJob -->|Cosine similarity| Diarizations
    
    TranscriptPage --> Diarizations
    VoiceProfilesPage --> SpeakerProfiles
```

**Key principle**: MongoDB is the single source of truth. The diarizator is stateless - profiles are passed as `clusters` parameter on each `/diarize` call.

---

## Infrastructure: GPU Deployment

### The Problem with Mac M2

| Mode | Works? | Speed | Notes |
|------|--------|-------|-------|
| **CPU** | Yes | 3-5x real-time | Correct but slow |
| **MPS (Metal)** | No | ~20s/min | **Produces incorrect results** |
| **CUDA** | Yes | ~1.5s/min | Optimal |

**Warning**: Never use MPS - PyTorch operators not fully implemented for pyannote.

### GPU Machine Setup (RTX 4090 via Tailscale)

Add diarizator to `gpu/docker-compose.yml`:

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
    - ./docker/diarization-models:/models
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

### VRAM Sharing (24GB 4090)

| Service | VRAM Usage |
|---------|------------|
| Whisper large-v3-turbo | ~3GB |
| Ollama (varies) | ~4-14GB |
| pyannote + wespeaker | ~1.5GB |
| **Total** | 8.5-18.5GB |

Fits comfortably. For large Ollama models, use smaller variants when running all three.

### Why Direct Access (Not Through gpu/proxy)

The diarizator is already a complete service with health checks, CORS, and multipart handling. Direct access on port 8085 via Tailscale is cleaner than proxying.

### Environment Configuration

```bash
# .env on main system
DIARIZATION_SERVER_URL=http://<tailscale-ip>:8085  # GPU via Tailscale
SPEAKER_SIMILARITY_THRESHOLD=0.35

# For local fallback (CPU mode)
# DIARIZATION_SERVER_URL=http://localhost:8085
```

---

## Modularity: Feature Flag & File Organization

### Feature Flag

Add to `myceliasdk/config.ts`:

```typescript
features: z.object({
  enable_speaker_identification: z.boolean().default(false),
}).default({}),
```

**Controls**:
- Diarization worker checks flag before passing clusters
- Frontend checks flag before showing speaker UI
- Workers can be paused independently

### File Organization

```
# Python (new module for speaker identification logic)
python/speaker_identification/
  __init__.py
  matching.py          # Retroactive batch matching logic
  profiles.py          # Profile management (MongoDB CRUD)

# Backend workers
backend/workers/enrollment.ts           # Voice enrollment job
backend/workers/speakerMatching.ts      # Retroactive matching job

# Backend migrations
backend/migrations/0017_speaker_profiles.ts
backend/migrations/0018_diarization_matched_speaker.ts

# Frontend (module pattern)
frontend/src/modules/speakers/
  index.tsx                # Exports
  useSpeakerProfiles.ts    # Hook: fetch/manage profiles
  SpeakerBadge.tsx         # Reusable colored badge
  SpeakerFilter.tsx        # Filter dropdown
  VoiceRecorder.tsx        # Microphone recording component
  SegmentSelector.tsx      # Select from existing recordings

# Frontend pages
frontend/src/pages/settings/VoiceProfilesPage.tsx
```

---

## Data Model

### speaker_profiles Collection

```typescript
interface SpeakerProfile {
  _id: ObjectId;
  name: string;              // "Me", "Wife", "Bob"
  embedding: number[];       // 256 floats, L2-normalized
  sample_count: number;      // Number of enrollment samples
  total_duration: number;    // Total seconds of enrollment audio
  is_primary: boolean;       // true = "my voice" (at most one)
  color: string;             // Hex color for UI (auto-assigned)
  created_at: Date;
  updated_at: Date;
}
```

### Extended diarizations Document

```typescript
interface Diarization {
  // ... existing fields
  matched_speaker?: {
    profile_id: ObjectId;
    name: string;            // Denormalized for quick display
    similarity: number;      // Cosine similarity (0-1)
    matched_at: Date;
    method: 'live' | 'retroactive' | 'manual';
  };
}
```

---

## Implementation Plan

### Step 0: Infrastructure - Deploy Diarizator to GPU Machine

**Goal**: Get diarizator running on GPU with Tailscale access.

**Modified**: `gpu/docker-compose.yml` - add `diarization` service

**Steps**:
1. Add service definition to `gpu/docker-compose.yml`
2. Set `HF_TOKEN` in GPU machine's `.env`
3. `docker compose up -d diarization` on GPU machine
4. Verify: `curl http://<tailscale-ip>:8085/health`
5. Set `DIARIZATION_SERVER_URL` in main system `.env`
6. Verify existing diarization pipeline works through GPU

**Verification**:
```bash
# Health check
curl http://<tailscale-ip>:8085/health
# Expected: {"status": "ok"}

# Test diarization
curl -X POST http://<tailscale-ip>:8085/diarize -F "file=@test.wav"
# Expected: segments with embeddings
```

---

### Step 1: Foundation - Collection + Feature Flag + Mount Routers

**Goal**: Create storage, add feature flag, enable existing diarizator routers.

**New files**:
- `backend/migrations/0017_speaker_profiles.ts` - create collection + indexes
- `backend/migrations/0018_diarization_matched_speaker.ts` - sparse index

**Modified files**:
- `myceliasdk/config.ts` - add `enable_speaker_identification`
- `diarizator/src/.../api/service.py`:
  ```python
  # Mount existing (currently dead) routers
  from .routers import enrollment_router, speakers_router
  app.include_router(enrollment_router, prefix="/api", tags=["enrollment"])
  app.include_router(speakers_router, prefix="/api", tags=["speakers"])

  # New simple endpoint for embedding extraction
  @app.post("/embed")
  async def embed(file: UploadFile):
      wav = audio_backend.load_wave(tmp_path)
      emb = await audio_backend.async_embed(wav)
      return {"embedding": emb.flatten().tolist(), "dimension": len(emb.flatten())}
  ```

**Verification**:
- Run backend → migration creates `speaker_profiles` collection
- Hit `/embed` with WAV → get 256-dim embedding
- Check config has `features.enable_speaker_identification`

---

### Step 2: Voice Enrollment

**Goal**: Allow enrolling voice via file upload or browser microphone.

**New files**:
- `python/speaker_identification/__init__.py`
- `python/speaker_identification/profiles.py`:
  ```python
  async def create_or_update_profile(name, embedding, duration, is_primary):
      """Create new profile or update existing via weighted average."""
      existing = await db.speaker_profiles.find_one({"name": name})
      if existing:
          # Weighted average: (old * count + new) / (count + 1)
          old_emb = np.array(existing["embedding"])
          new_emb = np.array(embedding)
          count = existing["sample_count"]
          merged = (old_emb * count + new_emb) / (count + 1)
          merged = merged / np.linalg.norm(merged)  # Normalize
          await db.speaker_profiles.update_one(
              {"_id": existing["_id"]},
              {"$set": {"embedding": merged.tolist(), 
                        "sample_count": count + 1,
                        "total_duration": existing["total_duration"] + duration}}
          )
      else:
          await db.speaker_profiles.insert_one({...})
  ```
- `python/jobs/enrollment.py` - job handler
- `backend/workers/enrollment.ts` - `NetworkJobCapability`

**Enrollment methods** (UI in Step 5):
1. **File upload** - WAV/MP3/OGG
2. **Microphone recording** - MediaRecorder API
3. **Segment selection** - Pick time range from existing recordings

**Verification**:
- Upload WAV via enrollment job → profile in `speaker_profiles` with 256-dim embedding
- Upload second sample → embedding updated, `sample_count` incremented

---

### Step 3: Retroactive Speaker Matching

**Goal**: Match all existing diarization embeddings against enrolled profiles.

**Key insight**: This is a pure MongoDB operation - embeddings are already stored, no diarizator needed.

**New files**:
- `python/speaker_identification/matching.py`:
  ```python
  def match_segments_batch(profiles, segments, threshold=0.35):
      """Cosine similarity between segment and profile embeddings.
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
                  'matched_at': datetime.now(UTC),
                  'method': 'retroactive'
              }
  ```
- `python/jobs/speaker_matching.py` - batch job with cursor
- `backend/workers/speakerMatching.ts`

**Why threshold 0.35**:
- 0.15 (diarizator default) matches nearly everything
- 0.35 is optimal for wespeaker-voxceleb-resnet34-LM
- Tunable via `SPEAKER_SIMILARITY_THRESHOLD` env var

**Verification**:
- Enroll voice → run matching → query `diarizations` with `matched_speaker` → spot-check by playing audio

---

### Step 4: Live Pipeline Integration

**Goal**: Pass enrolled profiles to diarizator during real-time processing.

**This is the key missing link** - connecting two pieces of existing infrastructure.

**Modified**: `python/diarization_worker.py`

```python
# In diarize_sequence(), before calling /diarize:
from speaker_identification.profiles import get_all_profiles

async def diarize_sequence(sequence):
    # Check feature flag
    if not config.features.enable_speaker_identification:
        clusters = None
    else:
        profiles = await get_all_profiles()
        if profiles:
            clusters = json.dumps([
                {"id": str(p["_id"]), "name": p["name"], "embedding": p["embedding"]}
                for p in profiles
            ])
        else:
            clusters = None
    
    # Call diarizator with clusters
    data = {'similarity_threshold': '0.35'}
    if clusters:
        data['clusters'] = clusters
    
    response = requests.post(
        f'{DIARIZATION_SERVER_URL}/diarize',
        files={'file': ('audio.wav', wav_file, 'audio/wav')},
        data=data,
        timeout=300 + len(sequence.chunks) * 3
    )
    
    # Save results with matched_speaker if cluster_id present
    for segment in response.json()['segments']:
        diar_doc = {
            'start': segment['start'],
            'end': segment['end'],
            'embedding': segment['embedding'],
            # ... other fields
        }
        if 'cluster_id' in segment and segment['cluster_id']:
            diar_doc['matched_speaker'] = {
                'profile_id': ObjectId(segment['cluster_id']),
                'name': segment.get('cluster_name', 'Unknown'),
                'similarity': segment.get('similarity', 0),
                'matched_at': datetime.now(UTC),
                'method': 'live'
            }
        await db.diarizations.insert_one(diar_doc)
```

**Verification**: Enroll → record new audio → wait for processing → new segments have `matched_speaker`

---

### Step 5: Frontend - Speaker Display, Enrollment UI, Filtering

**New files**:
- `frontend/src/modules/speakers/index.tsx`
- `frontend/src/modules/speakers/useSpeakerProfiles.ts`
- `frontend/src/modules/speakers/SpeakerBadge.tsx`
- `frontend/src/modules/speakers/SpeakerFilter.tsx`
- `frontend/src/modules/speakers/VoiceRecorder.tsx`
- `frontend/src/modules/speakers/SegmentSelector.tsx`
- `frontend/src/pages/settings/VoiceProfilesPage.tsx`:
  - List enrolled profiles
  - **Record from mic**: MediaRecorder API → 10-30s → send to enrollment job
  - **Upload file**: drag & drop
  - **Select segment**: pick from timeline
  - Delete profile, mark as primary
  - Button: "Run retroactive matching"

**Modified files**:
- `frontend/src/pages/TranscriptPage.tsx`:
  - Add `matched_speaker` to `DiarizationDoc`
  - Show `SpeakerBadge` next to colored dot
  - Add `SpeakerFilter` dropdown
- `frontend/src/pages/DiarizationDetailPage.tsx`:
  - Show speaker name and similarity score
- `frontend/src/pages/settings/FeatureFlagsPage.tsx`:
  - Add toggle for `enable_speaker_identification`
- `frontend/src/router.tsx` - add route

**Verification**:
- Settings → Feature Flags → enable speaker identification
- Settings → Voice Profiles → record from mic → profile created
- Transcript page → speaker names visible → filter to "My voice"

---

### Step 6: Per-Speaker Timeline Tracks

**Goal**: Visual timeline tracks showing when each speaker was talking.

**New files**:
- `frontend/src/components/timeline/tracks/SpeakerTrack.tsx`

**Modified files**:
- `frontend/src/components/timeline/MultiTrackTimeline.tsx`:
  - Add dynamic tracks for each enrolled speaker
  - Color matches speaker's color
  - Toggle via TrackVisibilityPanel

**Features**:
- Speaking time per speaker ("You spoke for 45 min today")
- Filter by speaker
- Click to navigate to transcript

---

### Step 7 (Optional): Real-time Speaker Identification

**Goal**: Show provisional speaker identification during recording.

**Approach**: DIART library for streaming diarization

```python
# python/speaker/realtime.py
from diart import SpeakerDiarization

class RealtimeSpeakerIdentifier:
    def __init__(self, enrolled_embeddings: dict):
        self.pipeline = SpeakerDiarization()
        self.enrolled = enrolled_embeddings
    
    async def process_chunk(self, audio_chunk: bytes):
        # Process 2-5 second chunk
        diarization = self.pipeline(audio_chunk)
        for segment, track, embedding in diarization:
            speaker = self.match_speaker(embedding)
            yield {'speaker': speaker, 'confidence': confidence}
```

**Latency options**:

| Mode | Chunk Size | Latency | Accuracy Impact |
|------|------------|---------|-----------------|
| Fast | 2 seconds | ~3s | -5% |
| Balanced | 5 seconds | ~6s | -2% |
| Accurate | 10 seconds | ~12s | Optimal |

**WebSocket streaming**: Real-time updates to frontend during recording.

---

### Step 8 (Future): Cloud API Fallback

**Goal**: Support pyannote.ai or Deepgram when GPU unavailable.

**Provider comparison**:

| Provider | Accuracy (DER) | Latency | Cost | Voiceprints | Offline |
|----------|----------------|---------|------|-------------|---------|
| Local GPU | ~11-19% | 2-5s/min | Electricity | Yes | Yes |
| pyannote.ai | ~8-14% | 3-10s | $0.01-0.05/min | Yes | No |
| Deepgram | ~15-20% | 1-3s | $0.01/min | Limited | No |

**Implementation**: Env var based provider switching, not complex abstraction.

---

## What We DON'T Need to Build

Thanks to existing code in the diarizator:
- Enrollment API logic (exists in `routers/enrollment.py`)
- Speaker CRUD API (exists in `routers/speakers.py`)
- Embedding extraction (exists in `audio_backend.py`)
- Seeded clustering (exists in `seeded_clustering.py`)
- FAISS-based identification (exists in `unified_speaker_db.py`)
- Weighted embedding averaging (exists in `embedding_manager.py`)
- Export/import speakers (exists in `routers/speakers.py`)

---

## Critical Files Summary

| File | Change |
|------|--------|
| `gpu/docker-compose.yml` | Add diarizator service (Step 0) |
| `diarizator/.../api/service.py` | Mount routers + add `/embed` (Step 1) |
| `myceliasdk/config.ts` | Feature flag (Step 1) |
| `python/diarization_worker.py` | Pass `clusters` to diarizator (Step 4) |
| `python/worker_server.py` | Register new jobs (Steps 2, 3) |
| `frontend/src/pages/TranscriptPage.tsx` | Speaker display + filter (Step 5) |

---

## Verification Checklist

1. [ ] `curl http://<tailscale-ip>:8085/health` → `{"status": "ok"}`
2. [ ] Enable feature flag in settings
3. [ ] Settings → Voice Profiles → record 10-30s clean speech
4. [ ] Profile in MongoDB with 256-dim embedding
5. [ ] Run retroactive matching job
6. [ ] Transcript page → "Me" labels on your segments
7. [ ] Filter to "My voice" → only your speech
8. [ ] Record new audio → wait → new segments auto-labeled
9. [ ] (Optional) Disconnect GPU → local CPU fallback works

---

## Model Upgrade Note

pyannote `community-1` (v4.0) has better accuracy. Defer until Steps 1-5 are proven:
- **Risk**: embedding dim may change → all stored embeddings incompatible
- **Upgrade path**: `pyproject.toml` + `audio_backend.py` model name change

---

**Document Owner**: Development Team  
**Review Cycle**: As needed during implementation
