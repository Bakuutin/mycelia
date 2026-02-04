# Speaker Identification - Testing Workflow

This guide walks through testing the complete speaker identification feature from start to finish.

## Prerequisites

Before starting, ensure you have:
- Mycelia running via Docker Compose
- Hugging Face token with access to PyAnnote models
- A microphone for voice recording (or audio files to upload)

---

## Step 1: Start the Diarization Service (Local Mac)

Open a **dedicated terminal** for the diarization service:

```bash
cd ./diarizator

# Sync dependencies (first time only)
uv sync --extra cpu

# Start the service (Mac - uses soundfile backend to avoid FFmpeg dependency)
COMPUTE_MODE=cpu AUDIO_BACKEND=soundfile uv run simple-speaker-service
```

**Note:** The `AUDIO_BACKEND=soundfile` is required on Mac to avoid `torchcodec` FFmpeg dependency issues. On GPU servers with FFmpeg installed, you can use the default `torchaudio` backend.

**Wait for:** `Models ready ✔ – device=cpu` (first run downloads ~1.5GB of models)

**Verify it's running:**
```bash
curl http://localhost:8085/health
# Expected: {"status":"ok","version":"1.0.0","device":"cpu","service":"pyannote-diarization"}
```

**Keep this terminal open** - the service must be running for speaker identification to work.

---

## Step 2: Configure Environment

Ensure your root `.env` file has:

```bash
# Hugging Face token
HF_TOKEN=hf_your_token_here

# Diarization service URL (for Docker containers to reach your Mac)
DIARIZATION_SERVER_URL=http://host.docker.internal:8085

# Optional: Adjust similarity threshold (default 0.35)
SPEAKER_SIMILARITY_THRESHOLD=0.35
```

---

## Step 3: Start/Restart Docker Services

In a **second terminal**:

```bash
cd /path/to/mycelia.diarusation

# Start all services (or restart if already running)
docker compose up -d

# Verify python-worker has the new env vars
docker compose exec python-worker env | grep DIARIZATION
# Should show: DIARIZATION_SERVER_URL=http://host.docker.internal:8085
```

---

## Step 4: Run Database Migrations

```bash
# Check migration status
docker compose exec backend deno run -A server.ts migrate-status

# Apply new migrations (0017_speaker_profiles, 0018_diarization_matched_speaker)
docker compose exec backend deno run -A server.ts migrate-up
```

**Expected output:**
```
Applying migration: 0017_speaker_profiles.ts
  + Created speaker_profiles collection
  + Created unique index on name
  ...
Applying migration: 0018_diarization_matched_speaker.ts
  + Created sparse index on matched_speaker.profile_id
  ...
```

---

## Step 5: Enable Speaker Identification Feature Flag

1. Open browser: **https://localhost:4433/settings/feature-flags**
2. Find **"Speaker Identification"**
3. Toggle it **ON**
4. You should see a success toast: "Feature flag updated"

---

## Step 6: Enroll Your Voice

1. Go to: **https://localhost:4433/settings/voice-profiles**
2. Click **"Add Profile"**
3. Fill in:
   - **Name:** "Me" (or your name)
   - **Check:** "This is my voice" ✓
4. Click **"Record from Mic"**
5. **Speak clearly for 10-30 seconds** (read something aloud, or just talk naturally)
6. Click **Stop Recording**
7. Click **"Enroll Voice"**

**What happens behind the scenes:**
- Audio is sent to the Python worker
- Python worker calls diarization service `/embed` endpoint
- 256-dimensional voice embedding is extracted
- Speaker profile is saved to MongoDB

**Verify enrollment:**
- Check the Jobs page: **https://localhost:4433/jobs**
- Look for an "enrollment" job with status "completed"
- Return to Voice Profiles page - your profile should appear

**Saving recordings for retry:**
If enrollment fails (e.g., diarization service not running), you don't need to re-record:
1. After recording, click **"Save for later"** to store the audio
2. Saved samples appear in the dialog for future enrollment attempts
3. Fix the issue, then click on a saved sample to use it for enrollment

---

## Step 7: Test Live Speaker Identification

Now process some audio that contains your voice:

### Option A: Record New Audio
If you have audio recording set up:
1. Record some audio containing your voice
2. Let the audio pipeline process it (VAD → transcription → diarization)
3. The diarization worker will automatically match against your enrolled profile

### Option B: Trigger Manual Diarization
If you have existing audio chunks:
1. Go to **https://localhost:4433/jobs/new**
2. Create a **diarization** job
3. Watch the diarization worker logs (Terminal 1)
4. You should see: `→ Speaker identification enabled with 1 profiles`

---

## Step 8: Run Retroactive Speaker Matching

To identify your voice in **existing** diarization data:

1. Go to: **https://localhost:4433/jobs/new**
2. Select job type: **speakerMatching**
3. Optional parameters:
   - `limit`: 10000 (max segments to process)
   - `threshold`: 0.35 (similarity threshold)
4. Click **"Create Job"**
5. Monitor progress on the Jobs page

**Expected result:**
- Job shows progress: "Matching segments to profiles..."
- Final result: `{"processed": X, "matched": Y, "profiles_count": 1}`

---

## Step 9: View Identified Speakers

After matching is complete, check where your voice was identified:

### In Diarization Details
1. Go to any conversation or audio segment
2. Look at the diarization data
3. Segments matching your voice will show:
   - Your name instead of "SPEAKER_00"
   - A colored badge with confidence score

### In Transcripts (Future)
The transcript view will show speaker names alongside the text.

---

## Troubleshooting

### Enrollment job fails with "Connection refused"
- **Cause:** Diarization service not running
- **Fix:** Start the service in Terminal 1:
  ```bash
  cd diarizator && COMPUTE_MODE=cpu AUDIO_BACKEND=soundfile uv run simple-speaker-service
  ```

### Enrollment job fails with "Could not load libtorchcodec" or "AudioDecoder"
- **Cause:** Mac doesn't have FFmpeg installed, and torchaudio 2.9+ requires torchcodec
- **Fix:** Use the soundfile audio backend (no FFmpeg required):
  ```bash
  COMPUTE_MODE=cpu AUDIO_BACKEND=soundfile uv run simple-speaker-service
  ```

### Enrollment job fails with "Audio too short"
- **Cause:** Recording less than 0.5 seconds
- **Fix:** Record at least 10 seconds of clear speech

### No matches found (0 matched)
- **Cause:** Threshold too high or voice doesn't match
- **Fix:**
  1. Try lowering threshold to 0.25-0.30
  2. Re-enroll with a cleaner audio sample
  3. Ensure enrollment audio was clear (no background noise)

### Feature flag toggle fails with 404
- **Cause:** Frontend not rebuilt after code changes
- **Fix:** `docker compose restart frontend`

### "No module named 'faiss'" error
- **Cause:** Old code with unused imports
- **Fix:** This should be fixed - ensure you have the latest code

---

## Verification Checklist

Use this checklist to verify everything works:

- [ ] Diarization service starts without errors
- [ ] `curl http://localhost:8085/health` returns OK
- [ ] Feature Flags page loads without errors
- [ ] Speaker Identification toggle works
- [ ] Voice Profiles page loads
- [ ] Voice recording works (browser asks for mic permission)
- [ ] Enrollment job completes successfully
- [ ] Profile appears in Voice Profiles list
- [ ] Speaker Matching job completes
- [ ] Matched segments show speaker name

---

## Quick Reference Commands

```bash
# Start diarization service on Mac (Terminal 1)
cd diarizator && COMPUTE_MODE=cpu AUDIO_BACKEND=soundfile uv run simple-speaker-service

# Start diarization service on GPU server (uses torchaudio with FFmpeg)
cd diarizator && COMPUTE_MODE=gpu uv run simple-speaker-service

# Restart Docker services (Terminal 2)
docker compose up -d

# Check python-worker logs
docker compose logs -f python-worker

# Check backend logs
docker compose logs -f backend

# Run migrations
docker compose exec backend deno run -A server.ts migrate-up

# Test diarization health
curl http://localhost:8085/health

# Test embedding extraction directly
curl -X POST http://localhost:8085/embed -F "file=@test.wav"
```

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                         Your Mac (Host)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Terminal 1: Diarization Service                                │
│  ┌─────────────────────────────────────────┐                    │
│  │  COMPUTE_MODE=cpu uv run simple-speaker │  ← PyAnnote models │
│  │  Listening on :8085                     │                    │
│  │  Endpoints: /health, /diarize, /embed   │                    │
│  └─────────────────────────────────────────┘                    │
│                         ↑                                        │
│                         │ http://host.docker.internal:8085       │
│                         │                                        │
│  Docker Compose         │                                        │
│  ┌──────────────────────┴──────────────────────────────────┐    │
│  │                                                          │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │    │
│  │  │   Frontend   │  │   Backend    │  │Python Worker │  │    │
│  │  │   :4433      │  │   :5173      │  │   :8000      │  │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │    │
│  │                                              │          │    │
│  │  ┌──────────────┐  ┌──────────────┐         │          │    │
│  │  │   MongoDB    │  │    Redis     │         │          │    │
│  │  │   :27017     │  │   :6379      │         │          │    │
│  │  └──────────────┘  └──────────────┘         │          │    │
│  │                                              │          │    │
│  └──────────────────────────────────────────────┴──────────┘    │
│                                                                  │
│  Browser: https://localhost:4433                                │
│  - Settings → Feature Flags                                     │
│  - Settings → Voice Profiles                                    │
│  - Jobs                                                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## What We Built

1. **Database Migrations**
   - `speaker_profiles` collection for enrolled voices
   - Indexes for efficient speaker matching queries

2. **Diarization Service Enhancements**
   - `/embed` endpoint for extracting voice embeddings
   - Cluster-based speaker matching in `/diarize`

3. **Python Worker Jobs**
   - `enrollment` job - enrolls a voice from audio
   - `speakerMatching` job - retroactively matches existing segments

4. **Backend Workers**
   - `enrollment.ts` - TypeScript job capability
   - `speakerMatching.ts` - TypeScript job capability

5. **Frontend Pages**
   - Voice Profiles page - enroll and manage speakers
   - Saved voice samples - record once, retry enrollment if it fails
   - Feature Flags page - toggle speaker identification

6. **Configuration**
   - `enable_speaker_identification` feature flag
   - `DIARIZATION_SERVER_URL` environment variable
   - `SPEAKER_SIMILARITY_THRESHOLD` tuning parameter
   - `AUDIO_BACKEND` - use `soundfile` for Mac, default `torchaudio` for GPU servers
