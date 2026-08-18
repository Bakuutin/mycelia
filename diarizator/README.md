# PyAnnote Diarization Service

A minimal inference provider for speaker diarization with embeddings using Pyannote Community-1. Supports matching Pyannote speaker clusters against known profiles.

For the complete Mycelia operator workflow — local Mac and remote NVIDIA GPU
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
large remote/GPU service, increase throughput explicitly. The tested starting
point for a 24 GiB RTX 4090 pool is:

```bash
DIARIZATION_MAX_SEQUENCE_CHUNKS=8
```

### 2B. Linux server with an NVIDIA GPU (CUDA 12.6)

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

The GPU image is intentionally `linux/amd64` and uses the CUDA 12.6 PyTorch
wheels. Confirm that the installed NVIDIA driver supports this CUDA runtime.
Do not build or run this image as the local Mac default.

The standalone single-process GPU deployment defaults to Pyannote segmentation
and internal embedding batch sizes of `8`, plus a per-segment identity
embedding batch of `16`. The six-process Portainer pool uses `8/8/4` and
`PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`: a third batch of `16`
triggered recoverable CUDA OOM fallback on a shared 24 GiB RTX 4090. Override
`DIARIZATION_SEGMENTATION_BATCH_SIZE`, `DIARIZATION_EMBEDDING_BATCH_SIZE`, and
`DIARIZATION_SEGMENT_EMBEDDING_BATCH_SIZE` only after a representative
throughput/VRAM benchmark. `/health` reports the effective values under
`batching`. `DIARIZATION_REQUEST_CONCURRENCY` defaults to `1` and is shared by
`/diarize` and `/embed`. `DIARIZATION_MAX_QUEUED_REQUESTS` defaults to `1` and
only accepts `0` or `1`; requests beyond that bound get a retryable HTTP 429
instead of running the same model concurrently.

To stop either deployment:

```bash
docker compose --profile cpu down
# or
docker compose --profile gpu down
```

### 2C. Portainer-managed NVIDIA GPU deployment

This is the canonical remote deployment when the Docker endpoint is managed by
Portainer. Keep these three artifacts together and do not build an ad-hoc
overlay Dockerfile on the server:

- image build context: `diarizator/`;
- image definition: `diarizator/Dockerfile`;
- Portainer stack: `diarizator/compose.portainer.yml`.

The detailed operator runbook is [`diarizator/PORTAINER.md`](PORTAINER.md).

The checked-in stack defaults to `mycelia-diarization:cu126`. It uses
`pull_policy: never`, so the exact `linux/amd64` image must exist on the
Portainer Docker endpoint before the stack is deployed. Set
`DIARIZATION_IMAGE` in Portainer to use an immutable versioned tag. The stack
creates the persistent `mycelia_diarization_models` volume automatically. One
stack publishes one through six private endpoints selected through the
Compose-native `COMPOSE_PROFILES` variable.

#### Build on the remote NVIDIA host (recommended)

The build itself does not need access to the GPU. When the remote Docker host
has Buildx, enough free disk space, and outbound access to the base-image and
Python package registries, send the small, commit-exact source archive and
build there. This is normally much faster than transferring a multi-gigabyte
finished image over Tailscale.

Create the archive from committed files at the Mycelia repository root. It
contains only the tracked `diarizator/` tree; it does not include local `.env`
files, model caches, or Docker volumes.

```bash
IMAGE_TAG="$(date +%Y%m%d)-$(git rev-parse --short=8 HEAD)"
SOURCE_ARCHIVE="/tmp/mycelia-diarization-source-${IMAGE_TAG}.tar.gz"

git archive \
  --format=tar.gz \
  --output="${SOURCE_ARCHIVE}" \
  HEAD:diarizator
shasum -a 256 "${SOURCE_ARCHIVE}"
scp "${SOURCE_ARCHIVE}" user@gpu-server:~/
```

Build the exact archive on the remote host and require its `sha256sum` to match
the local `shasum` value. `ssh -t` lets `sudo` prompt in the remote terminal;
do not put a server password in a command, `.env`, or Git.

```bash
ssh -t user@gpu-server

IMAGE_TAG=20260818-c34218d0
IMAGE="mycelia-diarization:${IMAGE_TAG}"
SOURCE_ARCHIVE="$HOME/mycelia-diarization-source-${IMAGE_TAG}.tar.gz"
BUILD_CONTEXT="$HOME/deploy/mycelia-diarization-${IMAGE_TAG}"

sha256sum "${SOURCE_ARCHIVE}"
mkdir -p "${BUILD_CONTEXT}"
tar -xzf "${SOURCE_ARCHIVE}" -C "${BUILD_CONTEXT}"
cd "${BUILD_CONTEXT}"
sudo docker buildx build \
  --platform linux/amd64 \
  --build-arg PYTORCH_CUDA_VERSION=cu126 \
  --file Dockerfile \
  --tag "${IMAGE}" \
  --load \
  .
sudo docker image inspect "${IMAGE}" \
  --format 'id={{.Id}} os={{.Os}} arch={{.Architecture}}'
exit
```

Use the same value for `IMAGE_TAG` on both hosts. The expected architecture is
`amd64`. If shell access to Docker is intentionally unavailable, upload the
same source archive through **Portainer → Images → Build a new image** and set
the image name to `mycelia-diarization:<IMAGE_TAG>`.

#### Build locally and transfer the image (fallback)

Use this path when the remote endpoint cannot build or has no required outbound
network access. Run from the Mycelia repository root. Keep the immutable tag;
do not overwrite an existing tag because Portainer could keep running the old
image ID.

```bash
IMAGE_TAG=20260814-abcdef0
IMAGE="mycelia-diarization:${IMAGE_TAG}"
GPU_SERVER=user@gpu-server

docker buildx build \
  --platform linux/amd64 \
  --build-arg PYTORCH_CUDA_VERSION=cu126 \
  --file diarizator/Dockerfile \
  --tag "${IMAGE}" \
  --load \
  diarizator

docker image inspect "${IMAGE}" \
  --format 'id={{.Id}} arch={{.Architecture}}'

docker save --output "/tmp/mycelia-diarization-${IMAGE_TAG}.tar" "${IMAGE}"
gzip -f "/tmp/mycelia-diarization-${IMAGE_TAG}.tar"
scp "/tmp/mycelia-diarization-${IMAGE_TAG}.tar.gz" "${GPU_SERVER}:/tmp/"
```

Import it on the NVIDIA server. `ssh -t` allocates a terminal so `sudo` can ask
for the server password without putting it in shell history:

```bash
ssh -t user@gpu-server
sudo docker load --input /tmp/mycelia-diarization-20260814-abcdef0.tar.gz
sudo docker image inspect \
  mycelia-diarization:20260814-abcdef0 \
  --format 'id={{.Id}} arch={{.Architecture}}'
sudo docker run --rm --gpus all \
  nvidia/cuda:12.6.3-base-ubuntu24.04 nvidia-smi
exit
```

Set the Portainer stack variable `DIARIZATION_IMAGE` to the built or imported
immutable tag before deploying. See
[PORTAINER.md](PORTAINER.md#build-and-update-the-image) for both paths.

#### Create or update the Portainer stack

1. Open the target Docker environment in Portainer.
2. Open **Stacks → Add stack** and use the name `gpu-diarization`, or open the
   existing stack with that name.
3. Select **Web editor** and paste the complete contents of
   `diarizator/compose.portainer.yml`.
4. Under **Environment variables**, add `HF_TOKEN`, the immutable
   `DIARIZATION_IMAGE` tag, `DIARIZATION_BIND_ADDRESS=<TAILSCALE_IP>`,
   `DIARIZATION_REQUEST_CONCURRENCY=1`, and
   `DIARIZATION_MAX_QUEUED_REQUESTS=1`.
   Do not place the token in the Compose file or Git.
5. Set `COMPOSE_PROFILES` to `pool-N`, where `N` is `2` through `6`; delete it
   for one process.
6. Deploy the stack. For an update, replace the editor contents, preserve all
   environment variables, enable **Prune services**, and select
   **Update the stack**.

#### Keep the previous stack for comparison and rollback

Do not overwrite, delete, or rename the current Portainer stack. Record its
stack name, `DIARIZATION_IMAGE` value, and the image ID of every running
container. Keep that immutable image on the Docker endpoint; do not run an
image prune during the comparison.

Create a separate `gpu-diarization-candidate` stack from the same
`compose.portainer.yml` with:

- the new immutable `DIARIZATION_IMAGE`;
- `COMPOSE_PROFILES` unset, so the candidate starts with one process;
- a verified-free port such as `DIARIZATION_PORT_1=8185`;
- the same `DIARIZATION_MODELS_VOLUME`, so model files are not downloaded
  again;
- no enabled Mycelia route until `/ready`, `/health`, and a real `/diarize`
  have passed.

Do not run the old two-process pool and a second full pool simultaneously on a
24 GiB card. CUDA workspace peaks are not determined by resident model memory
alone. Compare sequentially instead:

1. Measure a fixed control window on the current stack.
2. Pause only diarization and wait for `active=0`; do not clear waiting or
   delayed jobs.
3. Disable the current routes and stop the current stack without deleting it.
4. Start and verify the one-process candidate, enable its one-slot route, and
   measure the same workload window.
5. To roll back, pause and drain again, disable and stop the candidate, start
   the unchanged current stack, verify its recorded image ID and a real
   inference, then re-enable its routes.

Stopping a stack preserves its Portainer definition, immutable image, and the
named model volume. A legacy control image without `/ready` is not compatible
with a backend that requires the new readiness contract; benchmark it directly
before the backend switch, or roll back the backend and GPU image together.

The Hugging Face account owning the token must have accepted both gated model
agreements listed in the prerequisites. The first start can take several
minutes while the persistent model volume is populated.

Verify all runtime layers instead of relying on the green container icon alone:

```bash
curl -fsS http://SERVER_PRIVATE_IP:8085/ready
curl -fsS http://SERVER_PRIVATE_IP:8085/health
```

`/ready` must return HTTP 200. `/health` must contain `"ready":true`,
`"device":"cuda"`, `"concurrency":1`, and the expected `batching`. Portainer
logs must also contain records equivalent to:

```text
CUDA device name: <NVIDIA GPU model>
Models ready - device=cuda
```

Finally send a permitted test audio file and require HTTP 200 from `/diarize`:

```bash
curl -fsS --max-time 180 \
  -X POST http://SERVER_PRIVATE_IP:8085/diarize \
  -F file=@/path/to/permitted-test.wav
```

Do not upload personal audio to a remote server unless the owner has explicitly
approved that transfer.

#### Select pool capacity

The canonical stack supports one through six independent processes without
editing its YAML. Set Portainer's `COMPOSE_PROFILES` stack variable to:

| Processes | `COMPOSE_PROFILES` | Ports |
| ---: | --- | --- |
| 1 | unset or empty | `8085` |
| 2 | `pool-2` | `8085`–`8086` |
| 3 | `pool-3` | `8085`–`8087` |
| 4 | `pool-4` | `8085`–`8088` |
| 5 | `pool-5` | `8085`–`8089` |
| 6 | `pool-6` | `8085`–`8090` |

Before changing the value, disable disappearing Mycelia routes, drain work, and
stop the stack. Then select **Prune services** and **Update the stack**. When
reducing capacity, Portainer can retain exited containers for services disabled
by the new profile; remove only those extra stopped containers and do not remove
volumes. Each enabled endpoint must have a matching Mycelia profile with
Priority `1` and Slots `1`.

The six-process mode is experimental on a 24 GiB GPU. Validate concurrent peak
memory and throughput with real work before leaving it enabled.

See [`PORTAINER.md`](PORTAINER.md) for the exact Tailscale URL, stack variables,
profile-switch procedure, Mycelia route table, image update, and verification
checklist.

#### Private Portainer access through Tailscale

Use `https://gpu-host.example-tailnet.ts.net/`. This trusted Tailscale Serve URL
proxies to Portainer's self-signed loopback endpoint, so browsers do not need a
certificate-warning bypass. Do not use the raw `<TAILSCALE_IP>:9443` URL and
do not expose Portainer with Tailscale Funnel.

#### Duplicate diarization containers in Portainer

Canonical containers belong to the `gpu-diarization` stack and have service
names `diarization-1` through `diarization-6`. A container such as
`mycelia-stt-diarization-1` belongs to another stack and is not a pool slot. If
it is obsolete, remove the `diarization` service from that stack's Compose and
update the stack; deleting only the container allows Portainer/Compose to
create it again. A restart loop ending in `HF_TOKEN environment variable is
required` confirms that the duplicate is not a working provider.

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

For a remote GPU server, set the backend to the reachable protected URL,
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
curl -fsS http://localhost:8085/ready
curl -fsS http://localhost:8085/health
```

`/health` is liveness and always reports current `ready`, `computeMode`,
`device`, `concurrency`, `inflight`, and `queued` state. `/ready` returns HTTP
503 until the models are loaded; it also remains 503 when `COMPUTE_MODE=gpu`
was requested but CUDA is unavailable. In Mycelia, open **Jobs → External
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

`CUDA available: False` on the GPU server

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

### GET /health and GET /ready

`/health` is a liveness/status response. It includes model readiness, requested
compute mode, effective device, batching, runtime fingerprints, and the shared
inference gate's `concurrency`, `inflight`, `queued`, and `maxQueued` values.
`/ready` returns the same payload with HTTP 503 until models are loaded or when
GPU mode fell back to CPU.

`/diarize` and `/embed` share that gate. With the defaults, one request runs and
one waits. `DIARIZATION_MAX_QUEUED_REQUESTS=0` disables waiting; values above
`1` are rejected at startup. A request beyond the configured bound receives
HTTP 429, a `Retry-After: 1` header, and a JSON body with `retryable: true`.

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
  },
  "timings": {
    "upload_read_ms": 0.4,
    "queue_ms": 0.0,
    "decode_ms": 2.7,
    "diarization_ms": 810.5,
    "segment_embedding_ms": 122.1,
    "cluster_matching_ms": 0.0,
    "total_ms": 937.4
  }
}
```

The additive `timings` object is also returned by `/embed` with its applicable
upload, queue, decode, embedding, and total stages. Audio is decoded once in
memory and the same waveform is reused for diarization and segment embeddings.

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
