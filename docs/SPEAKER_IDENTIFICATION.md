# Speaker Identification

This guide explains how to set up and use voice identification to recognize enrolled speakers in your recordings.

## Overview

Speaker identification allows you to:
- **Enroll voices**: Record or upload audio samples to create voice profiles
- **Automatic labeling**: Identify enrolled speakers during diarization
- **Named transcripts**: See speaker names instead of "SPEAKER_00" in transcripts
- **Timeline visualization**: Filter and view when specific speakers talk

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Voice Profile  │────▶│  Diarization     │────▶│  Transcripts    │
│  (Enrollment)   │     │  (GPU Service)   │     │  with Names     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                       │
        │    256-dim embedding  │
        └───────────────────────┘
```

**Components:**
- **Speaker Profiles**: MongoDB collection storing voice embeddings
- **Diarization Service**: PyAnnote-based service on GPU for segmentation and matching
- **Feature Flag**: Enable/disable speaker identification globally

## Setup

### Prerequisites

1. **GPU Server with Diarization Service** (see [GPU README](../gpu/README.md))
2. **Hugging Face Token** with access to PyAnnote models
3. **Tailscale or VPN** for connecting main server to GPU

### Step 1: Deploy Diarization Service

On your GPU machine:

```bash
cd mycelia/gpu

# Create .env with HF_TOKEN
echo "HF_TOKEN=hf_your_token_here" >> .env

# Start all GPU services
docker compose up -d --build

# Wait for models to download (check logs)
docker compose logs -f diarization
```

Wait until you see: `Models ready ✔ – device=cuda`

### Step 2: Run Migrations

On your main Mycelia server:

```bash
# Check migration status
docker compose exec backend deno run -A server.ts migrate-status

# Apply new migrations
docker compose exec backend deno run -A server.ts migrate-up
```

This creates:
- `speaker_profiles` collection
- Indexes for `matched_speaker` on diarizations

### Step 3: Configure Connection

Set the diarization server URL in your main server's environment:

```bash
# In your main docker-compose.yml or .env
DIARIZATION_SERVER_URL=http://<gpu-tailscale-ip>:8085
```

### Step 4: Enable Feature Flag

1. Open Mycelia web UI
2. Go to **Settings → Feature Flags**
3. Enable **"Speaker Identification"**

## Usage

### Enrolling Your Voice

1. Go to **Settings → Voice Profiles**
2. Click **"Add Profile"**
3. Enter a name (e.g., "Me", "Wife", "Bob")
4. Check **"This is my voice"** if applicable
5. Either:
   - Click **"Record from Mic"** and speak for 10-30 seconds
   - Click **"Upload Audio File"** with a clear audio sample
6. Click **"Enroll Voice"**

**Tips for better enrollment:**
- Record 10-30 seconds of clear speech
- Avoid background noise
- Speak naturally (don't read)
- Add multiple samples over time to improve accuracy

### Viewing Identified Speakers

Once voices are enrolled and identification is enabled:

- **Transcripts**: Speaker names appear with colored badges
- **Diarization Detail**: Shows speaker matches with confidence scores
- **Timeline**: Filter by speaker (coming soon)

### Retroactive Matching

To identify speakers in existing recordings:

1. Go to **Jobs → New Job**
2. Select job type: **"speakerMatching"**
3. Optionally set:
   - `limit`: Maximum segments to process (default: 10000)
   - `threshold`: Similarity threshold (default: 0.35, range: 0-1)
4. Click **"Create Job"**

The job will match existing diarization segments against enrolled profiles.

## Configuration

### Similarity Threshold

The default threshold is **0.35** (35% similarity). Lower values = more matches but more false positives.

Set via environment variable:
```bash
SPEAKER_SIMILARITY_THRESHOLD=0.35
```

Recommended ranges:
- **0.30-0.35**: Balanced (default)
- **0.25-0.30**: More permissive, may have false matches
- **0.40-0.50**: More strict, may miss some matches

### Profile Cache

Speaker profiles are cached for 5 minutes during diarization to avoid repeated database queries. This is configurable in `diarization_worker.py`:

```python
_PROFILE_CACHE_TTL_SECONDS = 300  # 5 minutes
```

## Technical Details

### Embedding Model

Uses **WeSpeaker ResNet34-LM** (256-dimensional embeddings):
- Pre-trained on VoxCeleb dataset
- L2-normalized embeddings
- Cosine similarity for matching

### Matching Algorithm

1. During diarization, segments are extracted with embeddings
2. If profiles are enrolled and feature is enabled:
   - Profiles are passed to diarization service as "clusters"
   - Seeded agglomerative clustering assigns segments to known speakers
   - Unmatched segments get generic labels (SPEAKER_XX)
3. Results include `matched_speaker` with profile ID, name, and similarity

### Database Schema

**speaker_profiles collection:**
```javascript
{
  _id: ObjectId,
  name: "Me",                    // Unique name
  embedding: [0.1, -0.2, ...],   // 256 floats, L2-normalized
  sample_count: 3,               // Number of enrollment samples
  total_duration: 45.5,          // Total seconds of enrolled audio
  is_primary: true,              // Is this "my voice"?
  color: "#3b82f6",              // Display color (hex)
  created_at: ISODate,
  updated_at: ISODate
}
```

**diarizations collection (with matched_speaker):**
```javascript
{
  _id: ObjectId,
  // ... other fields ...
  matched_speaker: {
    profile_id: ObjectId("..."),
    name: "Me",
    similarity: 0.85,
    matched_at: ISODate,
    method: "live"  // or "retroactive"
  }
}
```

## Troubleshooting

### Speakers not being identified

1. **Check feature flag** is enabled (Settings → Feature Flags)
2. **Verify diarization service** is running: `curl http://gpu-ip:8085/health`
3. **Check profiles exist**: Settings → Voice Profiles
4. **Check threshold**: Try lowering to 0.30 for testing

### Low similarity scores

- Add more enrollment samples (3-5 is good)
- Use cleaner audio for enrollment
- Ensure consistent microphone/recording conditions

### Enrollment fails

- Check diarization service is accessible
- Ensure audio is at least 0.5 seconds
- Check Python worker logs: `docker compose logs python-worker`

### Wrong speaker matched

- Increase similarity threshold to 0.40-0.50
- Delete profile and re-enroll with cleaner samples
- Ensure enrolled speakers have distinct voices

## Running on Mac

For development/testing on Mac (without NVIDIA GPU):

```bash
cd diarizator

# Install dependencies
uv sync --extra cpu

# Run service
HF_TOKEN=your_token COMPUTE_MODE=cpu uv run simple-speaker-service
```

Note: CPU mode is significantly slower (10-30x) than GPU. For production, use a machine with NVIDIA GPU.

## API Reference

### Enrollment Job

```json
POST /resource/jobs
{
  "action": "enqueue",
  "data": {
    "type": "enrollment",
    "name": "Speaker Name",
    "is_primary": true,
    "audio_data_base64": "base64-encoded-audio"
  }
}
```

### Speaker Matching Job

```json
POST /resource/jobs
{
  "action": "enqueue",
  "data": {
    "type": "speakerMatching",
    "limit": 10000,
    "threshold": 0.35
  }
}
```

### Diarization with Clusters (Direct API)

```bash
curl -X POST "http://gpu-ip:8085/diarize" \
  -F "file=@audio.wav" \
  -F 'clusters=[{"id":"profile_id","name":"Me","embedding":[...]}]' \
  -F "similarity_threshold=0.35"
```
