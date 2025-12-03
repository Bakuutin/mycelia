# Backend Guide

## Speech-to-Text (STT)

Mycelia uses a Whisper-based transcription server. Install PortAudio as noted in `python/README.md` before running `stt.py`.

### Run Whisper Server Locally

```bash
cd python/whisper_server
uv sync
uv run server.py
```

The server listens on `http://localhost:8081` and loads the `large-v3` model by default.

**Stopping the server**

- Press `Ctrl+C`.
- If the process keeps running, terminate it explicitly:
  ```bash
  pkill -f "whisper_server/server.py"          # macOS/Linux
  # or, as a fallback:
  lsof -nti :8081 | xargs kill -9
  ```

Configure the backend to use your server:
```bash
STT_SERVER_URL=http://localhost:8081/
```

### Run Whisper Server Remotely

On the remote GPU box:
```bash
cd python/whisper_server
uv sync
uv run server.py
```

Stop it via SSH when needed:
```bash
ssh user@remote 'pkill -f "whisper_server/server.py"'
```

Then point your local backend at the remote URL:
```bash
STT_SERVER_URL=https://stt.example.com/
STT_API_KEY=optional_api_key
```

### Backend environment reminder

When copying `.env.example`, make sure `MONGO_URL` uses the direct-connection string:
```bash
MONGO_URL=mongodb://localhost:27017?directConnection=true
```

### Processing Audio Chunks

```bash
cd python
uv run stt.py [--server https://override-stt.example]
```

- `--server` overrides `STT_SERVER_URL` for a single run. To drain multiple STT instances simultaneously, run one `stt.py` process per server.
- `--count` prints the number of pending speech chunks (same filter the worker uses) and exits.
- During processing the script logs both sequence and chunk totals and tags each transcription log line with the STT server being used.

### Mongo MCP helper commands

Use these when you want explicit counts from MongoDB without running `stt.py`:

```bash
# All pending chunks (includes silent ones the worker skips)
cd backend
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call mongo \
  -a '{"action":"count","collection":"audio_chunks","query":{"transcribed_at":{"$eq":null},"processing_by":{"$eq":null}}}'

# Pending chunks that still have speech (matches the STT progress bar total)
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call mongo \
  -a '{"action":"count","collection":"audio_chunks","query":{"transcribed_at":{"$eq":null},"processing_by":{"$eq":null},"vad.has_speech":true}}'
```

### Ensure Audio Chunk Indexes

The backend creates required indexes at startup, but you can rebuild them manually:

```bash
cd backend
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call mongo \
  -a '{"action":"createIndex","collection":"audio_chunks","index":{"transcribed_at":1,"processing_by":1,"vad.has_speech":1,"start":-1},"options":{"name":"audio_chunks_pending_work","partialFilterExpression":{"transcribed_at":null,"processing_by":null,"vad.has_speech":true}}}'
```

Helper indexes on `processing_by` and `transcribed_at` are created automatically alongside the partial compound index.
