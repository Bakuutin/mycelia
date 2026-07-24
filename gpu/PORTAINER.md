# Run Mycelia STT with Portainer

This deployment runs speech-to-text as two containers on an NVIDIA GPU host:

| Container | Required | Purpose |
| --- | --- | --- |
| `mycelia-stt-whisper-1` | Yes | Loads `large-v3-turbo` with `faster-whisper` on CUDA and performs transcription. Port 9000 stays internal. |
| `mycelia-stt-proxy-1` | Yes | Exposes the authenticated OpenAI-compatible `POST /v1/audio/transcriptions` API. |
| `cloudflared` | No | Only needed when a Cloudflare Tunnel that owns the chosen hostname is configured to route to this proxy. It is not needed for direct Tailscale access. |

The Portainer container page is an administration URL, not an STT API URL. For the deployment on `100.119.163.116`, the direct API base URL is:

```text
http://100.119.163.116:8001
```

## Prerequisites

- Docker Standalone endpoint managed by Portainer.
- NVIDIA GPU, driver, and NVIDIA Container Toolkit installed on the Docker host.
- The client running Mycelia can reach the GPU host. Tailscale is recommended; do not expose the port publicly without a firewall or authenticated reverse proxy.
- Enough disk space for the CUDA image and Whisper model cache.

## Deploy the stack

1. In Portainer, open **Stacks** and select **Add stack**.
2. Choose **Git repository**.
3. Enter this repository URL and the branch or commit to deploy.
4. Set **Compose path** to `gpu/docker-compose.portainer.yml`.
5. Add these stack environment variables:

   | Name | Example | Notes |
   | --- | --- | --- |
   | `PROXY_API_KEY` | Generate with `openssl rand -hex 32` | Required. Store it as a secret and use the same value in Mycelia. |
   | `PROXY_PORT` | `8001` | Published host port. Change it if already occupied. |
   | `ASR_MODEL` | `large-v3-turbo` | Optional Whisper model override. |

6. Deploy the stack. The first pull is large and can outlive a reverse-proxy request timeout. If Portainer times out, pre-pull `onerahmet/openai-whisper-asr-webservice:v1.9.1-gpu` from **Images**, then deploy again.
7. Keep both `whisper` and `proxy` running. Do not publish Whisper's internal port 9000.

If the proxy image was already built on the endpoint, Portainer reuses `mycelia-stt-proxy:latest`. A Git-based deployment can also build it from `gpu/proxy/Dockerfile`.

## Verify the service

From the Docker host or a machine that can reach its Tailscale IP:

```bash
curl http://100.119.163.116:8001/health
```

Expected response:

```json
{"status":"ok"}
```

Run a real transcription test:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -F "file=@sample.wav;type=audio/wav" \
  -F "language=en" \
  http://100.119.163.116:8001/v1/audio/transcriptions
```

Expected result is JSON containing `text` and `segments`. An HTTP 401 means the keys differ. A timeout means the client cannot reach the host; check Tailscale and the host firewall. HTTP 500/502 requires checking both container logs.

## Connect Mycelia

Set the direct proxy URL and the same key in Mycelia's root `.env`:

```dotenv
STT_SERVER_URL=http://100.119.163.116:8001
PROXY_API_KEY=replace-with-the-Portainer-stack-key
```

If the STT worker runs in the main Mycelia Compose stack, recreate `python-worker` so it receives the updated environment:

```bash
docker compose up -d --build python-worker
docker compose exec python-worker uv run stt.py --count
docker compose exec python-worker uv run stt.py --limit 1
```

For a worker running directly on the host:

```bash
cd python
uv run stt.py --count
uv run stt.py --limit 1
```

`--count` verifies Mycelia authentication and reports pending speech chunks without transcribing them. `--limit 1` processes one sequence through the remote proxy.

## Same-host Docker networking

When Mycelia and STT run on the same Docker host, either keep using the host's Tailscale address or attach both stacks to a shared external Docker network. Do not use a container name from an unrelated Compose network: Docker DNS only resolves names on shared networks.

## Operations

Check state and logs in Portainer, or on the host:

```bash
docker compose -f gpu/docker-compose.portainer.yml ps
docker compose -f gpu/docker-compose.portainer.yml logs --tail=100 proxy whisper
```

The model cache is stored in the `whisper_cache` named volume, so recreating containers does not require downloading the model again. Removing that volume deletes the cache.
