# PyAnnote Diarization Service

A minimal inference provider for speaker diarization with embeddings using Pyannote Community-1. Supports matching Pyannote speaker clusters against known profiles.

For the complete Mycelia operator workflow — local Mac and remote RTX 4090
deployment, routing, campaigns, voice enrollment, calibration, identity
backfill, and Timeline verification — see
[`docs/SPEAKER_IDENTIFICATION.md`](../docs/SPEAKER_IDENTIFICATION.md).

## Features

- **Speaker Diarization**: Uses pyannote to segment audio by speaker
- **Embeddings**: Extracts WeSpeaker ResNet34 embeddings for each segment
- **Speaker Identification**: Optionally match Pyannote speaker centroids against known profiles without replacing diarization labels
- **FastAPI Service**: Simple REST API for easy integration

## Quick Start (Docker)

### Prerequisites

- Docker and Docker Compose
- Hugging Face account (for model access)
- Hugging Face access accepted for both gated models listed below
- 8GB Docker memory minimum for the CPU service; 10–12GB is recommended when
  building and running the full local Mycelia stack together
- 10GB+ disk space (GPU images are substantially larger than CPU images)

### 1. Configure Environment Variables

Create `diarizator/.env` (Compose reads this file):

```bash
HF_TOKEN=your_huggingface_token_here
SPEAKER_SERVICE_HOST=0.0.0.0
SPEAKER_SERVICE_PORT=8085
DIARIZATION_MODEL=pyannote/speaker-diarization-community-1
AUDIO_BACKEND=soundfile
```

Get your HF token from https://huggingface.co/settings/tokens

Accept the terms and conditions for:
- https://huggingface.co/pyannote/speaker-diarization-community-1
- https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM

The token is passed directly to Hugging Face by `Pipeline.from_pretrained`.
Running `huggingface-cli login` is not required inside the container. A valid
token still receives 401/403 until its account has accepted both gated model
conditions.

### 2A. Apple Silicon Mac (CPU, native arm64)

Do not use the GPU profile on macOS: Docker Desktop cannot expose Apple GPU
acceleration to this PyTorch/CUDA service. The CPU profile deliberately has no
fixed `platform`, so Docker builds it natively as `linux/arm64` on an M-series
Mac.

```bash
cd /path/to/mycelia
docker compose --profile diarization up --build -d diarizator

# Follow the first model load. Ready means the log contains "Models ready".
docker compose --profile diarization logs -f diarizator
```

This main-stack profile is the canonical local launch path. It puts the
diarizator on the same Docker network as backend and python-worker, where it is
available as `http://diarizator:8085`. The compatibility wrapper
`scripts/start-diarizator.sh` runs the same command.

The build flag is needed on the first start and after Dockerfile or dependency
changes. Once the image exists, the shorter normal-start command reuses it:

```bash
docker compose --profile diarization up -d diarizator
```

Recommended Docker Desktop resources for Mycelia plus diarization:

- memory: at least 10 GB, preferably 12 GB;
- swap: 2–4 GB;
- keep only the CPU profile active on a Mac.

The main Mycelia Compose stack defaults to two 10-second audio chunks per
diarization request (`DIARIZATION_MAX_SEQUENCE_CHUNKS=2`). This preserves the
one-chunk overlap used for speaker continuity while avoiding a confirmed Docker
Desktop OOM when six chunks are combined under an 8 GB VM.
After assigning 10–12 GB to Docker, or when the worker targets a sufficiently
large remote/GPU service, increase throughput explicitly:

```bash
DIARIZATION_MAX_SEQUENCE_CHUNKS=6
```

### 2B. Linux server with RTX 4090 (CUDA 12.6)

Prerequisites on the server:

1. Current NVIDIA driver with `nvidia-smi` working on the host.
2. NVIDIA Container Toolkit configured for Docker.
3. `docker run --rm --gpus all nvidia/cuda:12.6.3-base-ubuntu24.04 nvidia-smi`
   succeeds before starting this service.

Then:

```bash
cd diarizator
PYTORCH_CUDA_VERSION=cu126 docker compose --profile gpu up --build -d diarization-service-gpu

docker compose --profile gpu logs -f diarization-service-gpu
docker compose --profile gpu exec diarization-service-gpu \
  uv run python -c 'import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))'
```

The GPU image is intentionally `linux/amd64`; RTX 4090 is an NVIDIA Ada GPU
and is served by the CUDA 12.6 PyTorch wheels. Do not build or run this image as
the local Mac default.

To stop either deployment:

```bash
docker compose --profile cpu down
# or
docker compose --profile gpu down
```

### 3. Connect Mycelia

For Mycelia running in Docker on the same Mac, the default is already correct
when the main-stack `diarization` profile is used:

```bash
DIARIZATION_SERVER_URL=http://diarizator:8085
```

The standalone `diarizator/docker-compose.yml --profile cpu` path remains
useful for isolated service development. If used alongside containerized
Mycelia, configure an explicit reachable URL; Docker Desktop host-port
hairpinning is not used as the supported default.

For a remote RTX 4090 server, set the backend to the reachable protected URL,
or add that URL in **Settings → Diarization** and give it a lower priority:

```bash
DIARIZATION_SERVER_URL=https://diarizator.example.com
```

Port 8085 has no application authentication. Do not expose it directly to the
public internet; use a private network/VPN or an authenticated reverse proxy.

### 4. Check Health

Startup and readiness are different states. The container can be running while
Pyannote is still downloading/loading models.

```bash
docker compose --profile diarization ps diarizator
curl -fsS http://localhost:8085/health
```

Expected ready response is HTTP 200. In Mycelia, open **Jobs → External
services & routing** or **Settings → Diarization**; the route must show
`Running`, not only configured.

### Troubleshooting

`401/403 Cannot access gated repo`

- Verify `HF_TOKEN` is in `diarizator/.env` (not only the repository root).
- Sign in to Hugging Face with the same account as the token and accept both
  model conditions.
- Recreate the container after changing `.env`.

```bash
docker compose --profile diarization up -d --force-recreate diarizator
```

`Exited (137)`

- This means the process was killed; on Docker Desktop the common cause is
  memory pressure. Increase Docker memory/swap and make sure the CUDA image is
  not running on the Mac.

`CUDA available: False` on the RTX 4090 server

- Confirm the GPU profile was used, the image is `mycelia-diarizator:cu126`,
  and the NVIDIA Container Toolkit smoke test above succeeds.

Inspect the exact image architecture and dependency flavor:

```bash
docker image inspect mycelia-diarizator:cpu \
  --format 'arch={{.Architecture}} env={{json .Config.Env}}'
docker image inspect mycelia-diarizator:cu126 \
  --format 'arch={{.Architecture}} env={{json .Config.Env}}'
```

## API Usage

### POST /diarize

Perform speaker diarization on an audio file.

**Request:**
- `file`: Audio file (multipart/form-data)
- `min_speakers` (optional): Minimum number of speakers to detect
- `max_speakers` (optional): Maximum number of speakers to detect
- `collar` (optional, disabled by default): Post-processing gap duration used to merge same-speaker segments
- `min_duration_off` (optional, disabled by default): Legacy segmentation override; Community-1 defaults are recommended
- `clusters` (optional): JSON array of known speaker clusters with embeddings
- `similarity_threshold` (optional, default: 0.15): Cosine similarity threshold for cluster matching

**Clusters Format:**
```json
[
  {
    "id": "speaker_1",
    "name": "John Doe",
    "embedding": [0.123, -0.456, ...]
  },
  {
    "id": "speaker_2",
    "name": "Jane Smith",
    "embedding": [0.789, 0.012, ...]
  }
]
```

**Response (without clusters):**
```json
{
  "segments": [
    {
      "start": 0.0,
      "end": 5.234,
      "speaker": "SPEAKER_00",
      "duration": 5.234,
      "embedding": [0.123, -0.456, ...]
    }
  ],
  "summary": {
    "total_duration": 120.5,
    "num_segments": 15,
    "num_speakers": 2,
    "speakers": ["SPEAKER_00", "SPEAKER_01"]
  }
}
```

**Response (with clusters - seeded clustering):**
```json
{
  "segments": [
    {
      "start": 0.0,
      "end": 5.234,
      "speaker": "speaker_1",
      "duration": 5.234,
      "embedding": [0.123, -0.456, ...],
      "cluster_id": "speaker_1",
      "cluster_name": "John Doe",
      "similarity": 0.892
    },
    {
      "start": 5.234,
      "end": 10.5,
      "speaker": "SPEAKER_02",
      "duration": 5.266,
      "embedding": [0.789, 0.012, ...],
      "cluster_id": null,
      "cluster_name": null,
      "similarity": null
    }
  ],
  "summary": {
    "total_duration": 120.5,
    "num_segments": 15,
    "num_speakers": 3,
    "speakers": ["speaker_1", "SPEAKER_02"],
    "matched_clusters": ["speaker_1"],
    "unmatched_segments": 8,
    "clustering_stats": {
      "method": "seeded",
      "num_seeds": 2,
      "num_assigned_to_seeds": 7,
      "num_unassigned": 8,
      "total_segments": 15,
      "unique_speakers": 3,
      "similarity_threshold": 0.15
    }
  }
}
```

**Example Request:**
```bash
curl -X POST "http://localhost:8085/diarize" \
  -F "file=@audio.wav" \
  -F "clusters=[{\"id\":\"speaker_1\",\"name\":\"John\",\"embedding\":[0.1,-0.2,0.3,...]}]" \
  -F "similarity_threshold=0.15"
```

## How It Works

1. **Diarization**: The service uses pyannote to segment audio by speaker, producing initial speaker labels (SPEAKER_00, SPEAKER_01, etc.)

2. **Embedding Extraction**: For each segment, a WeSpeaker ResNet34 embedding is extracted and normalized

3. **Seeded Clustering** (if clusters provided): 
   - Segments are matched against known speaker clusters using cosine similarity
   - Segments above the similarity threshold are assigned to the matching cluster
   - Remaining segments are clustered using traditional agglomerative clustering
   - This allows the diarization to prefer known speakers while still handling unknown speakers

## Configuration

### Environment Variables

- `HF_TOKEN`: Hugging Face token (required)
- `COMPUTE_MODE`: `cpu` or `gpu` (default: `cpu`)
- `PYTORCH_CUDA_VERSION`: `cpu`, `cu121`, `cu126`, or `cu128` (default: `cpu`)
- `SPEAKER_SERVICE_HOST`: Service bind host (default: `0.0.0.0`)
- `SPEAKER_SERVICE_PORT`: Service port (default: `8085`)
- `LOG_LEVEL`: Logging level - `DEBUG`, `INFO`, `WARNING`, `ERROR` (default: `INFO`)

## Development

### Local Development

```bash
# Install dependencies
uv sync --extra cpu  # or --extra cu121 for GPU

# Run service
HF_TOKEN=your_token uv run simple-speaker-service
```

### Project Structure

```
src/simple_speaker_recognition/
├── api/
│   └── service.py          # FastAPI service with /diarize endpoint
└── core/
    ├── audio_backend.py    # PyAnnote diarization and embedding extraction
    └── seeded_clustering.py # Seeded clustering implementation
```

## License

See LICENSE file for details.
