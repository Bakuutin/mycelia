# Mycelia Python Backend

This directory contains the Python components of Mycelia, including audio processing, daemon services, and data ingestion.

## Prerequisites

The main prerequisites are listed in the [root README](../README.md). This section covers Python-specific requirements:

### Python & uv

**Install uv (Python package manager):**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### PortAudio (Required for `stt.py`)

**macOS:**
```bash
brew install portaudio
```

**Linux:**
```bash
sudo apt install portaudio19-dev
```

**Windows:**
```bash
# Download from https://www.portaudio.com/download.html
```

## Components

### Daemon (`daemon.py`)

The main daemon service that continuously:
- Imports new audio files from configured sources
- Ingests audio files into the system
- Runs voice activity detection on audio chunks

#### Running the Daemon

```bash
uv run daemon.py
```

The daemon runs continuously and logs to `~/Library/mycelia/logs/daemon.log`.

#### Error Handling

The daemon now intelligently handles errors:
- **Cached Errors**: Files that fail ingestion are marked with an error and automatically excluded from future processing
- **No Automatic Retry**: Errored files won't be retried automatically to prevent infinite loops
- **Manual Retry**: You can manually retry errored files using the management script

### Error Management (`manage_errors.py`)

A utility script to manage files that failed during ingestion.

#### List Errored Files

```bash
uv run manage_errors.py list
```

Shows all files with ingestion errors, including:
- File name and ID
- Error message (truncated to 100 chars)
- Last attempt timestamp

#### Retry All Errored Files

```bash
uv run manage_errors.py retry-all
```

Clears all errors and attempts to re-ingest all previously failed files.

#### Retry Specific File

```bash
uv run manage_errors.py retry <file_id>
```

Clears the error for a specific file (by MongoDB ObjectId) and retries ingestion.

Example:
```bash
uv run manage_errors.py retry 68ee1a98a5ba09aadf9a8838
```

#### Clear All Errors (Without Retry)

```bash
uv run manage_errors.py clear-all
```

Removes error flags from all files without attempting to re-ingest them.

#### Clear Specific Error (Without Retry)

```bash
uv run manage_errors.py clear <file_id>
```

Removes the error flag from a specific file without retrying ingestion.

### Conversation Extraction (`convos.py`)

Extracts conversations from existing transcripts using an LLM and writes conversation objects plus entity mention relationships to MongoDB.

#### When to run

- After transcripts exist in the `transcriptions` collection (produced by your ingestion/transcription pipeline)
- Ad hoc to backfill older data or periodically (e.g., via cron) to keep conversations up to date

#### Running

```bash
uv run convos.py
```

Optional flags:

- `--limit <N>`: process at most N conversation chunks
- `--not-later-than <UNIX_TS>`: only process transcripts earlier than the given UNIX timestamp (seconds)
- `--model {small|medium|large}`: choose LLM size (default: small)
- `--force`: force recreation of existing conversations (deletes and recreates)

#### Resume-Safe Processing

By default, `convos.py` **skips** chunks that already have conversations, making it safe to resume interrupted processing:

```bash
# Process new conversations only (skips existing)
uv run convos.py --limit 10

# Continue processing - will skip the 10 already done
uv run convos.py --limit 10
```

#### Force Recreate

Use `--force` to delete and recreate existing conversations:

```bash
# Recreate conversations (useful after prompt improvements)
uv run convos.py --limit 10 --force

# Recreate with larger model
uv run convos.py --limit 10 --force --model medium

# Process items not later than a specific time
uv run convos.py --not-later-than 1730500000
```

#### Logs

Writes logs to `~/Library/mycelia/logs/convos.log` and also prints progress to the console.

## Improved Logging

The daemon now provides detailed progress information:

```
Starting ingestion: 45 files pending, 2 errored files cached
Processing [1/20]: audio_recording.m4a
✓ Successfully ingested: audio_recording.m4a
Processing [2/20]: meeting_notes.wav
✗ Error ingesting meeting_notes.wav: ffmpeg error...
Batch complete: 19 processed, 1 errors, 25 remaining, 3 total cached errors
```

## Other Components

### Audio Processing (`chunking.py`)
Handles audio file splitting and conversion to Opus chunks.

### Discovery (`discovery.py`)
Discovers and imports new audio files from configured sources.

### Voice Activity Detection (`diarization.py`)
Runs VAD on audio chunks to detect speech segments.

### Transcription (`stt.py`)
Speech-to-text transcription services.

## Configuration

Configuration is managed through `settings.py`.
