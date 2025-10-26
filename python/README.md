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
