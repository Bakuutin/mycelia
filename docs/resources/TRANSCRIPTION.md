# Transcription Resource (`transcription`)

The `transcription` resource handles audio-to-text conversion using Whisper-compatible inference servers.

## Actions
- `transcribe`: Takes an audio file (Uint8Array, Buffer, or Binary) and returns the transcribed text and segments.

## Policy Paths
- `transcription`: Standard path for transcription requests.

## Implementation Details
- Supports multiple input formats (Uint8Array, Buffer, EJSON Binary).
- Proxies requests to a configured Whisper server via multipart/form-data.
- Returns detailed segment information including timestamps for UI synchronization.

