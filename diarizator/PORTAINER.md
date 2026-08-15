# Operate the remote diarization pool with Portainer

This runbook manages the `gpu-diarization` Docker Compose stack on the remote
NVIDIA host. The canonical stack file is `compose.portainer.yml`.

The stack exposes independent private endpoints because Mycelia reserves one
slot per process. All processes share the downloaded-model volume, while each
process loads a separate model copy into GPU memory.

## Open Portainer safely through Tailscale

Use the Tailscale HTTPS address, not the raw IP and Portainer's self-signed
certificate:

```text
https://gpu-host.example-tailnet.ts.net/
```

On the GPU host, the expected Tailscale Serve configuration is:

```bash
sudo tailscale serve --bg https+insecure://127.0.0.1:9443
sudo tailscale serve status
```

`https+insecure` applies only between the local Tailscale daemon and Portainer's
self-signed loopback endpoint. Clients still receive a publicly trusted
certificate for `gpu-host.example-tailnet.ts.net`, and the service remains
private to the tailnet. Do not enable Tailscale Funnel for Portainer.

Tailscale Serve requires MagicDNS and HTTPS certificates to be enabled in the
tailnet. If the command asks for approval, open the URL it prints while signed
in as a tailnet administrator, approve HTTPS, and run the command again.

## Stack variables

Create or update **Stacks → gpu-diarization → Editor** using the complete
contents of `diarizator/compose.portainer.yml`. Keep secrets in Portainer's
**Environment variables** section, never in Git.

Set these variables:

| Variable | Required value | Purpose |
| --- | --- | --- |
| `HF_TOKEN` | secret value | Access to the gated Pyannote model |
| `DIARIZATION_IMAGE` | immutable imported tag | Exact image to run |
| `DIARIZATION_BIND_ADDRESS` | `<TAILSCALE_IP>` | Bind only to the Tailscale interface |
| `DIARIZATION_MODELS_VOLUME` | `mycelia_diarization_models` | Persistent shared model cache |
| `COMPOSE_PROFILES` | unset or `pool-2`…`pool-6` | Select pool capacity |
| `DIARIZATION_SEGMENTATION_BATCH_SIZE` | `8` | Pyannote segmentation inference batch |
| `DIARIZATION_EMBEDDING_BATCH_SIZE` | `8` | Pyannote internal embedding batch |
| `DIARIZATION_SEGMENT_EMBEDDING_BATCH_SIZE` | `4` | Mycelia per-segment identity embedding batch |
| `PYTORCH_CUDA_ALLOC_CONF` | `expandable_segments:True` | Reduce CUDA allocator fragmentation |

Ports default to `8085` through `8090`. Override `DIARIZATION_PORT_1` through
`DIARIZATION_PORT_6` only if those ports conflict. All processes default to GPU
device `0`; a multi-GPU host can override `DIARIZATION_GPU_1` through
`DIARIZATION_GPU_6`.

The `8/8/4` defaults are the safe starting point for six simultaneous
processes on a 24 GiB RTX 4090 that also hosts other GPU services. A segment
embedding batch of `16` completed through the service's per-segment fallback,
but produced recoverable CUDA OOM warnings with less than 0.5 GiB free and was
slower in practice. Pool sizes one and three can benchmark a larger third
value separately.

## Select any pool size from one through six

The baseline process has no Compose profile and always runs. The other
processes use Compose profiles:

| Desired pool | `COMPOSE_PROFILES` | Active endpoints |
| ---: | --- | --- |
| 1 | delete the variable or leave it empty | `:8085` |
| 2 | `pool-2` | `:8085`–`:8086` |
| 3 | `pool-3` | `:8085`–`:8087` |
| 4 | `pool-4` | `:8085`–`:8088` |
| 5 | `pool-5` | `:8085`–`:8089` |
| 6 | `pool-6` | `:8085`–`:8090` |

`pool-N` always enables the first `N` services. Compose does not evaluate a
numeric replica expression here because every process needs its own stable
published port and matching Mycelia route.

To change capacity without sending new work to containers that are stopping:

1. In Mycelia open **Settings → Diarization** and disable the routes that will
   disappear. Existing jobs keep their route snapshot, so let them finish or
   cancel them before continuing.
2. In Portainer open **Stacks → gpu-diarization**, select **Stop this stack**,
   and wait until all current processes have exited.
3. Open **Editor** and change only `COMPOSE_PROFILES` in **Environment
   variables**.
4. Enable **Prune services**, then select **Update the stack**. Portainer can
   retain stopped containers for services that remain declared in the Compose
   file but are disabled by the new profile. After the update, remove any such
   exited containers from this stack manually and leave **Automatically remove
   non-persistent volumes** disabled. Never remove the named model volume.
5. Confirm that only the expected ports are listening, then wait for every
   expected container to become healthy. A six-process first
   start should be allowed to load sequentially if GPU memory is tight.
6. Check every active `/health` response for `ready: true` and `device: cuda`,
   then send one permitted test file to `/diarize`.
7. Enable exactly the matching Mycelia routes and verify **Jobs → Workers →
   diarization** reports the intended effective concurrency.

Configure the Mycelia routes with equal priority and one slot each:

| Route | Base URL | Priority | Slots |
| --- | --- | ---: | ---: |
| `gpu-1` | `http://<TAILSCALE_IP>:8085` | 1 | 1 |
| `gpu-2` | `http://<TAILSCALE_IP>:8086` | 1 | 1 |
| `gpu-3` | `http://<TAILSCALE_IP>:8087` | 1 | 1 |
| `gpu-4` | `http://<TAILSCALE_IP>:8088` | 1 | 1 |
| `gpu-5` | `http://<TAILSCALE_IP>:8089` | 1 | 1 |
| `gpu-6` | `http://<TAILSCALE_IP>:8090` | 1 | 1 |

Do not advertise slots for stopped processes. Health filtering prevents an
unhealthy route from being selected, but configured slots still affect the
worker's desired concurrency and operator UI.

`pool-6` is an experimental capacity mode on a 24 GiB RTX 4090. With the current
Community-1 image, an idle process was observed at about 0.53 GiB and an active
or warmed process at about 2.2–2.5 GiB. Six warmed processes should fit, but
peak inference memory and other GPU services also count. Before leaving six
enabled, run concurrent real jobs and monitor `nvidia-smi` for peak memory,
utilization, throttling, and OOM events.

## Stop and start

For a planned full stop, first disable all remote routes in Mycelia and drain
or cancel active jobs. Then use **Stacks → gpu-diarization → Stop this stack**.
Start the same stack from its Portainer page, wait for health and a real
inference check, then enable only the routes for the selected profile.

The named model volume survives a normal stop, start, or stack update. Do not
delete the stack or volume merely to release GPU memory.

The current service intentionally keeps models resident for the life of each
container; it has no idle offload timer. Stopping an unused pool process is the
reliable way to release its CUDA context and model memory. PyTorch allocator
cache may remain visible in `nvidia-smi` after a request even though that memory
can be reused by the same process.

Restart an individual container only to recover that process from a transient
failure. A restart does not load a new image and does not change pool capacity.

## Build and update the image

Use an immutable tag containing the date and source commit:

For a Portainer-managed NVIDIA host, prefer building on that Docker endpoint
instead of uploading the multi-gigabyte image. The Dockerfile defaults to the
`cu126` dependency extra, so the Portainer build form does not need a build
argument. Create a minimal build context:

```bash
IMAGE_TAG="$(date +%Y%m%d)-$(git rev-parse --short HEAD)"
tar -czf "/tmp/mycelia-diarization-build-${IMAGE_TAG}.tar.gz" \
  -C diarizator Dockerfile pyproject.toml uv.lock src
```

In Portainer, open **Images → Build a new image**, set the name to
`mycelia-diarization:<IMAGE_TAG>`, choose **Upload**, select that archive, and
build it. This transfers only source and lock files; the Docker endpoint
downloads and builds the dependency layers itself.

Alternatively, build locally and import the finished image:

```bash
IMAGE_TAG="$(date +%Y%m%d)-$(git rev-parse --short HEAD)"
IMAGE="mycelia-diarization:${IMAGE_TAG}"

docker buildx build \
  --platform linux/amd64 \
  --build-arg PYTORCH_CUDA_VERSION=cu126 \
  --file diarizator/Dockerfile \
  --tag "${IMAGE}" \
  --load \
  diarizator

docker image inspect "${IMAGE}" \
  --format 'id={{.Id}} os={{.Os}} arch={{.Architecture}}'
```

Smoke-test the image without development bind mounts before transfer. Export
and import the exact tag on the Docker endpoint:

```bash
docker save --output "/tmp/mycelia-diarization-${IMAGE_TAG}.tar" "${IMAGE}"
gzip -f "/tmp/mycelia-diarization-${IMAGE_TAG}.tar"
GPU_SERVER=user@gpu-server
scp "/tmp/mycelia-diarization-${IMAGE_TAG}.tar.gz" "${GPU_SERVER}:/tmp/"
ssh -t "${GPU_SERVER}" \
  "sudo docker load --input '/tmp/mycelia-diarization-${IMAGE_TAG}.tar.gz' && \
   sudo docker image inspect '${IMAGE}' \
     --format 'id={{.Id}} os={{.Os}} arch={{.Architecture}}'"
```

Because the stack uses `pull_policy: never`, importing the new tag is mandatory;
Portainer cannot pull it automatically. After import, update
`DIARIZATION_IMAGE`, enable **Prune services**, and select **Update the stack**.

Verify these states separately:

1. source commit;
2. built local image ID and `linux/amd64` architecture;
3. imported remote image ID;
4. image tag and ID on every running container;
5. container health and CUDA device;
6. successful `/diarize` response with nonzero segments;
7. representative Mycelia jobs on every enabled route.

Do not treat a green Portainer icon or `/health` alone as proof that the new
source is running correctly.
