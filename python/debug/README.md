# Debug Scripts

Utility scripts for debugging and analyzing mycelia data sources.

## Scripts

### `analyze_voicememos.py`

Analyze Apple Voice Memos `CloudRecordings.db` database. Shows metadata fields, statistics, and device information for recordings.

**Full analysis:**
```bash
cd python
uv run debug/analyze_voicememos.py
```

**Find specific recording by name/title:**
```bash
uv run debug/analyze_voicememos.py --find "Recording 367"
uv run debug/analyze_voicememos.py --find "Bali"           # partial match
uv run debug/analyze_voicememos.py --find "6EF88D2A"       # by UUID
```

**What it shows:**
- Database schema and table structure
- Recording statistics (count, total hours, date range)
- Folder organization
- Local vs cloud-only recordings breakdown
- Device info (iPhone/iPad/Watch/Mac) extracted from m4a encoder metadata
- Audio format details (codec, sample rate, bitrate)

---

### `cleanup_claims.py`

Inspect and clear stuck diarization claims from `audio_chunks` collection. Useful when workers crash and leave chunks in "claimed" state.

**Show current claims:**
```bash
cd python
uv run debug/cleanup_claims.py
```

**Clear claims (after stopping workers):**
```bash
uv run debug/cleanup_claims.py --clean
```

**Force clear (skip safety check):**
```bash
uv run debug/cleanup_claims.py --clean --force
```

**Options:**
- `--collection NAME` - Target collection (default: `audio_chunks`)
- `--worker-id ID` - Limit to specific worker
- `--clean` - Actually clear the claims
- `--force` - Skip running-worker safety check

---

### `repair_duplicate_audio_chunks.py`

Audits duplicate OPUS payloads for the same `original_id` and chunk `index`.
These are duplicate raw audio records, not merely duplicate transcript rows.
The script is a dry run by default and performs an exact byte comparison inside
Mongo before it permits any deletion. It exchanges the configured local
`MYCELIA_CLIENT_ID` and `MYCELIA_TOKEN` for a short-lived operator JWT; it never
prints either credential.

```bash
cd python
uv run python debug/repair_duplicate_audio_chunks.py --source-id 6a35ca21bfd772083e70e603
uv run python debug/repair_duplicate_audio_chunks.py --source-id 6a35ca21bfd772083e70e603 --apply
```

`--apply` refuses active STT work, non-pair duplicates, missing audio, and
different bytes. It removes redundant audio and derived sequences,
transcriptions, conversation chunks, and conversation objects, while retaining
VAD results for the unchanged audio. Then run sequence creation and
transcription from Jobs → Pipeline health & recovery.

---

### `hist_plot.py`

Jupyter-style notebook script for plotting timeline histogram data. Shows audio chunks, diarizations, and transcriptions over the past 30 days.

**Usage (in Jupyter or as cells):**
```bash
cd python
# Run interactively in Jupyter or use cell markers (#%%)
```

**Requirements:** `pandas`, `matplotlib`

---

### `backfill_devices.py`

Manually backfill device info for voice memo records that don't have it yet.

**Show stats only:**
```bash
cd python
uv run debug/backfill_devices.py --stats
```

**Backfill records:**
```bash
uv run debug/backfill_devices.py              # Up to 100 records
uv run debug/backfill_devices.py --limit 500  # Up to 500 records
uv run debug/backfill_devices.py --all        # All records
uv run debug/backfill_devices.py -v           # Verbose output
```

---

## Device Info Tracking

The daemon automatically extracts device information from Voice Memo m4a files and stores it in the `device` field of `source_files`:

```json
{
  "device": {
    "encoder": "com.apple.VoiceMemos (Watch Version 26.1 (Build 23S37))",
    "device_type": "apple_watch",
    "os_version": "26.1",
    "build": "23S37"
  }
}
```

**Device types detected:**
- `apple_watch` - Apple Watch recordings
- `iphone` - iPhone recordings
- `ipad` - iPad recordings
- `mac` - Mac recordings
- `unknown` - Unrecognized encoder

**Backfill runs automatically** in the daemon cycle for existing records without device info.

---

## Common Paths

| Resource | Path |
|----------|------|
| Voice Memos DB | `~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings/CloudRecordings.db` |
| Voice Memos Files | `~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings/*.m4a` |
| Daemon Logs | `~/Library/mycelia/logs/daemon.log` |

## Useful Queries

### Direct SQLite queries on Voice Memos DB

```bash
DB="$HOME/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings/CloudRecordings.db"

# Count all recordings
sqlite3 "$DB" "SELECT COUNT(*) FROM ZCLOUDRECORDING;"

# Find cloud-only recordings (not downloaded)
sqlite3 -header "$DB" "SELECT ZENCRYPTEDTITLE, ZDURATION FROM ZCLOUDRECORDING WHERE ZPATH IS NULL OR ZPATH = '';"

# List folders
sqlite3 -header "$DB" "SELECT ZENCRYPTEDNAME, ZCOUNTOFRECORDINGS FROM ZFOLDER;"

# Recent recordings
sqlite3 -header "$DB" "SELECT datetime(ZDATE + 978307200, 'unixepoch', 'localtime') as date, ZENCRYPTEDTITLE, ZDURATION/60.0 as minutes FROM ZCLOUDRECORDING ORDER BY ZDATE DESC LIMIT 10;"
```

### Extract device info from m4a file

```bash
ffprobe -v quiet -print_format json -show_format "path/to/file.m4a" | jq '.format.tags.encoder'
```
