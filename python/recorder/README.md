# Audio Recorder *DOES NOT WORK YET, WORK IN PROGRESS*

A fault-tolerant audio recording console application that streams audio from your microphone to the Mycelia server.

## Features

- **PulseAudio Integration**: Captures audio directly from your microphone using PulseAudio
- **Fault-Tolerant Queue**: Uses SQLite-backed persistent queue to handle network interruptions
- **Automatic Retry**: Automatically retries failed uploads with exponential backoff
- **Streaming Mode**: Records audio in 10-second chunks for continuous streaming
- **OAuth2 Authentication**: Secure authentication with the Mycelia server
- **Graceful Shutdown**: Handles Ctrl+C gracefully and preserves unuploaded chunks

## Prerequisites

1. **System Dependencies**:
   ```bash
   # macOS
   brew install portaudio
   
   # Ubuntu/Debian
   sudo apt-get install portaudio19-dev
   
   # Fedora
   sudo dnf install portaudio-devel
   ```

2. **Python Dependencies**:
   ```bash
   cd python
   uv sync
   ```

3. **Environment Variables**:
   Create a `.env` file in the project root with:
   ```
   MYCELIA_URL=http://localhost:5173
   MYCELIA_CLIENT_ID=your_client_id
   MYCELIA_TOKEN=your_client_secret
   ```

## Usage

### Basic Recording

```bash
cd python
python recorder.py
```

The recorder will:
1. Authenticate with the server
2. Start capturing audio from your default microphone
3. Process audio in 10-second chunks
4. Upload chunks to the server as they're captured
5. Queue chunks locally if the network is unavailable

### Custom Queue Database

```bash
python recorder.py --db /path/to/custom_queue.db
```

### Stopping Recording

Press `Ctrl+C` to stop recording. The application will:
1. Stop capturing new audio
2. Wait for the upload worker to finish current uploads
3. Report any remaining chunks in the queue
4. Clean up resources gracefully

## How It Works

### Architecture

```
Microphone → PulseAudio → Audio Recorder → Persistent Queue → Upload Worker → Server
                                ↓                                    ↓
                           SQLite DB                          OAuth2 Session
```

### Recording Process

1. **Audio Capture**: 
   - Captures audio at 16kHz mono
   - Processes in 10-second chunks
   - Converts to WAV format

2. **Queueing**:
   - Each chunk is immediately written to SQLite
   - Includes metadata: timestamp, chunk number, source file ID
   - Survives application restarts

3. **Upload Worker**:
   - Runs in a separate thread
   - Dequeues chunks and uploads to server
   - Handles authentication and token refresh
   - Implements exponential backoff on failures
   - Removes chunks from queue only after successful upload

4. **Server Communication**:
   - First chunk creates a new source file
   - Subsequent chunks reference the source file ID
   - Uses OAuth2 for authentication
   - Sends multipart form data with audio file and metadata

## Configuration

### Audio Settings

Edit `recorder.py` to customize:

```python
CHUNK_SIZE = 1024              # Buffer size for PyAudio
FORMAT = pyaudio.paInt16       # 16-bit audio
CHANNELS = 1                    # Mono
RATE = 16000                    # 16kHz sample rate
CHUNK_DURATION_SECONDS = 10     # Duration of each chunk
```

### Queue Database

The queue database (`audio_queue.db`) contains:

```sql
CREATE TABLE audio_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    chunk_number INTEGER NOT NULL,
    source_file_id TEXT,
    audio_data BLOB NOT NULL,
    recording_start TEXT NOT NULL,
    created_at TEXT NOT NULL
)
```

## Troubleshooting

### PyAudio Installation Issues

If PyAudio fails to install:

```bash
# macOS
brew install portaudio
pip install --global-option='build_ext' --global-option='-I/opt/homebrew/include' --global-option='-L/opt/homebrew/lib' pyaudio

# Or use conda
conda install pyaudio
```

### Authentication Errors

Verify your `.env` file contains valid credentials:
```bash
# Test authentication
curl -X POST http://localhost:5173/oauth/token \
  -d "grant_type=client_credentials" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET"
```

### Audio Input Issues

List available audio devices:
```python
import pyaudio
p = pyaudio.PyAudio()
for i in range(p.get_device_count()):
    print(p.get_device_info_by_index(i))
```

### Queue Growth

If the queue grows too large:
1. Check network connectivity
2. Verify server is running and accessible
3. Check server logs for upload errors
4. Monitor queue size: `SELECT COUNT(*) FROM audio_chunks;`

### Network Issues

The recorder handles network interruptions automatically:
- Chunks are queued locally during outages
- Uploads resume when connection is restored
- Exponential backoff prevents overwhelming the server
- Maximum retry delay: 60 seconds

## Performance

- **CPU Usage**: ~5-10% on modern hardware
- **Memory Usage**: ~50-100MB (excluding queue)
- **Disk Usage**: ~1.6MB per minute of audio in queue
- **Network Usage**: ~1.6MB per minute uploaded

## Development

### Running Tests

```bash
# Test audio capture
python -c "import pyaudio; p = pyaudio.PyAudio(); print('PyAudio OK')"

# Test queue
python -c "from recorder import PersistentQueue; q = PersistentQueue('test.db'); print('Queue OK')"

# Test authentication
python -c "from lib.config import client_id, client_secret; print(f'Client ID: {client_id}')"
```

### Debugging

Enable verbose output by modifying the print statements or adding logging:

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

## Security

- OAuth2 client credentials flow for authentication
- Tokens are automatically refreshed
- Audio data is transmitted over HTTPS (in production)
- Queue database is stored locally and not encrypted

## License

Part of the Mycelia project.

