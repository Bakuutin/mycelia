# PyAnnote Diarization Service

A minimal inference provider for speaker diarization with embeddings using pyannote. Supports seeded clustering with known speaker clusters.

## Features

- **Speaker Diarization**: Uses pyannote to segment audio by speaker
- **Embeddings**: Extracts WeSpeaker ResNet34 embeddings for each segment
- **Seeded Clustering**: Optionally match segments against known speaker clusters using seeded clustering
- **FastAPI Service**: Simple REST API for easy integration

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Hugging Face account (for model access)
- 8GB+ RAM, 10GB+ disk space

### 1. Configure Environment Variables

Create a `.env` file:

```bash
HF_TOKEN=your_huggingface_token_here
COMPUTE_MODE=cpu  # or "gpu" for GPU acceleration
PYTORCH_CUDA_VERSION=cpu  # or "cu121", "cu126", "cu128" for GPU
SPEAKER_SERVICE_HOST=0.0.0.0
SPEAKER_SERVICE_PORT=8085
```

Get your HF token from https://huggingface.co/settings/tokens

Accept the terms and conditions for:
- https://huggingface.co/pyannote/speaker-diarization-3.1
- https://huggingface.co/pyannote/segmentation-3.0
- https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM

### 2. Start the Service

```bash
# For CPU-only
docker compose --profile cpu up --build -d

# For GPU acceleration
docker compose --profile gpu up --build -d
```

### 3. Check Health

```bash
curl http://localhost:8085/health
```

## API Usage

### POST /diarize

Perform speaker diarization on an audio file.

**Request:**
- `file`: Audio file (multipart/form-data)
- `min_speakers` (optional): Minimum number of speakers to detect
- `max_speakers` (optional): Maximum number of speakers to detect
- `collar` (optional, default: 2.0): Gap duration in seconds to merge between speaker segments
- `min_duration_off` (optional, default: 1.5): Minimum silence duration before treating as segment boundary
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
