# Run Mycelia STT with Portainer

This deployment runs speech-to-text as two containers on an NVIDIA GPU host:

| Container | Required | Purpose |
| --- | --- | --- |
| `mycelia-stt-whisper-1` | Yes | Loads the configured Whisper model (`large-v3-turbo` by default) with `faster-whisper` on CUDA and performs transcription. Port 9000 stays internal. |
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
   | `ASR_MODEL` | `large-v3-turbo` | Optional Whisper model override. The proxy and Whisper container must use the same value. |

6. Deploy the stack. The first pull is large and can outlive a reverse-proxy request timeout. If Portainer times out, pre-pull `onerahmet/openai-whisper-asr-webservice:v1.9.1-gpu` from **Images**, then deploy again.
7. Keep both `whisper` and `proxy` running. Do not publish Whisper's internal port 9000.

If the proxy image was already built on the endpoint, Portainer reuses `sky-mycelia-stt-proxy:latest`. A Git-based deployment can also build it from `gpu/proxy/Dockerfile`.

### Build the proxy image in Portainer

Use the `sky-` prefix for locally built Mycelia images so the stack, Portainer,
and this repository all refer to the same image name:

```text
sky-mycelia-stt-proxy:latest
```

To upload the build context manually, create an archive from the repository
root without putting secrets in it:

```bash
COPYFILE_DISABLE=1 tar --no-xattrs \
  -czf /tmp/sky-mycelia-stt-proxy.tar.gz \
  -C gpu/proxy Dockerfile requirements.txt server.py
```

`COPYFILE_DISABLE=1` and `--no-xattrs` prevent macOS metadata such as
`com.apple.provenance` from making a Linux Portainer build fail.

In Portainer, open **Images → Build a new image**, enter
`sky-mycelia-stt-proxy:latest`, select **Upload**, choose the archive, and build
it. Then open the `mycelia-stt` stack editor and make sure the proxy service
uses the same image name. Updating only this image reference recreates the
proxy; it does not change the configured Whisper model or delete its cache.

### Change the Whisper model

1. Open the `mycelia-stt` stack in Portainer and select **Editor**.
2. Under **Environment variables**, set `ASR_MODEL` to the desired model, for example `large-v3-turbo`.
3. Select **Update the stack** and confirm the redeploy. Portainer must recreate both the `whisper` and `proxy` containers with the same model setting; verify the resulting container environment and `/v1/models` response.
4. Watch `mycelia-stt-whisper-1` logs. The first transcription after a model change may take longer while the model is downloaded or loaded.

`large-v3-turbo` is already the default in `docker-compose.portainer.yml`, so removing the `ASR_MODEL` override also selects it. Do not leave a stale Portainer stack variable with the old model value: either update it to the desired model or set the compose value explicitly. The model cache volume is retained during a normal stack update.

The two `ASR_MODEL` entries in the compose editor should be references to the
same stack variable: `${ASR_MODEL:-large-v3-turbo}`. With that form, change the
value once under Portainer's **Environment variables**. Do not maintain three
independent hard-coded model names.

The model is loaded once by the Whisper container at startup. Sending a different
`model` value with `/v1/audio/transcriptions` does not hot-swap the GPU model;
the proxy accepts the stable `whisper` alias and rejects a named model that does
not match `ASR_MODEL`. To change the loaded model, change `ASR_MODEL` in the
stack configuration and recreate the stack. Mycelia's `transcription.model`
setting controls the request/validation model; it does not redeploy the remote
Docker stack.

### Avoid confusing the UI model with the loaded model

Mycelia's **STT model** field is a request/validation setting. It may display
`large-v3` even while the remote GPU container is loading `large-v3-turbo`.
The authoritative checks are the container environment and the proxy's
authenticated `/v1/models` response:

```bash
docker inspect mycelia-stt-whisper-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^ASR_MODEL='
docker inspect mycelia-stt-proxy-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^ASR_MODEL='
curl --fail-with-body \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  http://100.119.163.116:8001/v1/models
```

Only after all three checks agree should the STT model be saved in Mycelia.

### Unload the model after five idle minutes

Set this Portainer stack environment variable:

```env
MODEL_IDLE_TIMEOUT=300
```

This unloads the Whisper model from GPU memory after 300 seconds without an ASR request. It does not stop the `whisper` container or remove the cached model files. The API stays available, and the next transcription request automatically reloads the configured model from the persistent `whisper_cache` volume. That first request can therefore take longer than requests made while the model is already loaded.

The five-minute value is the stack default. Set `MODEL_IDLE_TIMEOUT=0` only when the model should remain loaded indefinitely. Continuous backlog processing is activity, so the idle timer begins after the final request completes.

Mycelia's Jobs → Transcription panel can save a desired cache policy and compare
it with the proxy's reported policy. Saving in Mycelia does not change the
remote stack by itself: set the matching `MODEL_IDLE_TIMEOUT` value here and
update the Portainer stack. The proxy reports the effective stack setting at
the authenticated endpoint below after it has been rebuilt from this checkout.

## Verify the service

From the Docker host or a machine that can reach its Tailscale IP:

```bash
curl http://100.119.163.116:8001/health
```

Expected response:

```json
{"status":"ok"}
```

Verify that the authenticated proxy advertises the model actually loaded by
the stack:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  http://100.119.163.116:8001/v1/models
```

The response contains one model whose `id` matches the stack's `ASR_MODEL`.
This endpoint is served directly by the STT proxy; it must not be forwarded to
an Ollama or LLM upstream.

If transcription works but this request returns `502 Bad gateway: Name or
service not known`, the host and API key are already correct. That specific
failure means an older proxy image does not implement `/v1/models` and its
catch-all route is trying to send the request to the obsolete default
`http://ollama:11434`. Rebuild `sky-mycelia-stt-proxy:latest` from the current
`gpu/proxy` directory and recreate only `mycelia-stt-proxy-1`. The explicit
transcription endpoint can keep working throughout this failure, which is why
the same STT configuration may have appeared healthy before model discovery
was added to the UI.

Check cache policy/status:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  http://100.119.163.116:8001/v1/stt/status
```

This reports the persistent model-cache policy, idle timeout, and proxy-observed
time since the last transcription. `idle_unload_expected` means the configured
timeout has elapsed; it is not a direct GPU-memory measurement.

Run a real transcription test:

The repository includes the short `test.wav` and `test.aiff` fixtures for this
smoke test. Run the command from the repository root.

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -F "file=@test.wav;type=audio/wav" \
  -F "model=large-v3-turbo" \
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

The proxy returns its configured model in `X-Whisper-Model`. Transcriptions created by `python/stt.py` store this provenance in MongoDB at `transcriptions.metadata.model`, with the provider recorded at `transcriptions.metadata.provider`. Set `STT_MODEL` in Mycelia only as a fallback when using another OpenAI-compatible server that does not return the header.

The proxy also sends `vad_filter=true` to the Whisper `/asr` endpoint when
`WHISPER_VAD_FILTER=true`. The GPU compose files enable this by default. The
effective setting is returned by `/v1/stt/status` as `whisperVadFilter` and is
stored on new transcriptions as `transcriptions.metadata.whisperVadFilter`.
This distinguishes records processed with Whisper's internal VAD from records
made by an older proxy or with the option disabled. Set
`WHISPER_VAD_FILTER=false` in Portainer and redeploy the proxy to disable it.

Require a specific model when starting the worker:

```bash
docker compose exec python-worker python stt.py --model large-v3-turbo
```

The worker prints both the requested model and the model reported by the server. The Portainer service loads one model per deployment, so `--model` verifies that the requested model is loaded; it does not hot-swap models. A mismatch stops transcription with an error instead of saving misleading provenance. Change `ASR_MODEL` in Portainer and redeploy before requesting a different model.

## Same-host Docker networking

When Mycelia and STT run on the same Docker host, either keep using the host's Tailscale address or attach both stacks to a shared external Docker network. Do not use a container name from an unrelated Compose network: Docker DNS only resolves names on shared networks.

## Operations

Check state and logs in Portainer, or on the host:

```bash
docker compose -f gpu/docker-compose.portainer.yml ps
docker compose -f gpu/docker-compose.portainer.yml logs --tail=100 proxy whisper
```

The model cache is stored in the `whisper_cache` named volume, so recreating containers does not require downloading the model again. Removing that volume deletes the cache.
