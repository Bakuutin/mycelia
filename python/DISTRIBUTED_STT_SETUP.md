# Running STT on Multiple Machines (Local M1 Mac + Remote 4090 Server)

## Performance Comparison

**4090 GPU Server:**
- Speed: ~1-3 seconds per chunk (large-v3)
- Best for: Bulk processing, production

**M1 Mac Local:**
- Speed: ~8-15 seconds per chunk (large-v3) or ~5-10 seconds (medium)
- Best for: Development, testing, backup processing

## What Changed: Distributed Lock System

The code now implements a **distributed locking mechanism** using MongoDB to prevent race conditions:

1. **`processing_by`** field marks which worker is processing a chunk
2. **`claimed_at`** timestamp tracks when a chunk was claimed
3. **Atomic operations** ensure only one worker can claim a chunk
4. **Auto-release** on errors so chunks aren't stuck

## Setup Instructions

### Option 1: Connect Both to Remote 4090 Server

Both machines point to the same remote STT server.

**On M1 Mac:**
```bash
cd python
export STT_SERVER_URL=https://stt.mycelia.tech
uv run stt.py --limit 100
```

**On Remote Server (if you want to run locally there too):**
```bash
cd python
export STT_SERVER_URL=http://localhost:8087  # Local whisper server
python stt.py --limit 100
```

### Option 2: Run Local Whisper Server on M1

Setup local Whisper server on M1 for faster development/testing.

**Step 1: Install Whisper Server on M1**
```bash
cd python/whisper_server
uv sync
```

**Step 2: Modify server.py for M1 (CPU/MPS)**

Edit `python/whisper_server/server.py`:
```python
# Change line 12-14 from:
device = "cuda"
model_size = "large-v3"
model = WhisperModel(model_size, device=device, compute_type="float16", num_workers=5, cpu_threads=10)

# To (for M1):
device = "cpu"  # or "mps" for Metal Performance Shaders (experimental)
model_size = "medium"  # Smaller model for faster CPU processing
model = WhisperModel(model_size, device=device, compute_type="int8", num_workers=2, cpu_threads=8)
```

**Step 3: Start Local Whisper Server**
```bash
cd python/whisper_server
uv run server.py
# Server will run on http://localhost:8081
```

**Step 4: Run STT pointing to local server**
```bash
cd python
export STT_SERVER_URL=http://localhost:8081
uv run stt.py --limit 100
```

## Running Simultaneously on Both Machines

**Terminal 1 (M1 Mac):**
```bash
cd ~/repo/mycelia/python
export STT_SERVER_URL=https://stt.mycelia.tech  # or http://localhost:8081
uv run stt.py --limit 500  # Process 500 chunks
```

**Terminal 2 (Remote 4090 Server):**
```bash
cd /path/to/mycelia/python
export STT_SERVER_URL=http://localhost:8087
python stt.py --limit 500  # Process 500 chunks
```

### What Happens:
- ✅ Both machines query MongoDB for untranscribed chunks
- ✅ Each worker **atomically claims** chunks before processing
- ✅ If a chunk is already claimed, it's **skipped** (logged as "already claimed by another worker")
- ✅ On error, chunks are **released** back to the pool
- ✅ **No duplicates**, no wasted processing

## Monitoring

### Check Worker Progress
Look for these log lines:
```
Worker ID: MacBook-Pro.local_12345
Total pending chunks: 1234
Using 1 parallel worker(s)
```

### Check for Skipped Chunks
```
2025-10-31 04:30:15	len 1 chunks	OriginalId 6903ce2e3006e94c81d59b3f	 already claimed by another worker
```

### Final Stats
```
Completed processing. Stats: {'transcribed': 450, 'empty': 25, 'error': 5, 'skipped': 20}
```

## MongoDB Cleanup (If Needed)

If a worker crashes and leaves chunks in "processing" state:

```javascript
// Reset stuck chunks (processing for > 10 minutes)
db.audio_chunks.updateMany(
  {
    processing_by: { $ne: null },
    claimed_at: { $lt: new Date(Date.now() - 10 * 60 * 1000) }
  },
  {
    $set: { processing_by: null, claimed_at: null }
  }
)

// Check how many chunks are currently being processed
db.audio_chunks.countDocuments({ processing_by: { $ne: null } })

// See which workers are active
db.audio_chunks.distinct("processing_by", { processing_by: { $ne: null } })
```

## Recommendations

### For Development/Testing (M1 Mac):
1. Use local Whisper server with `medium` model
2. Smaller `--limit` values (10-50 chunks)
3. Good for testing new features without using GPU resources

### For Production (4090 Server):
1. Use `large-v3` model on GPU
2. Large batches (500-1000 chunks)
3. Best performance for bulk processing

### For Maximum Throughput (Both):
1. Run both simultaneously pointing to remote 4090 server
2. M1 processes ~4-5 chunks/minute
3. 4090 processes ~20-30 chunks/minute
4. Combined: ~25-35 chunks/minute

## Troubleshooting

### Issue: Both workers processing same chunks
**Cause:** MongoDB not updating fast enough
**Fix:** The atomic `claim_sequence()` function prevents this - check logs for "skipped" messages

### Issue: Chunks stuck in "processing" state
**Cause:** Worker crashed without releasing
**Fix:** Run MongoDB cleanup query above

### Issue: M1 too slow
**Fix:** Use smaller model (`medium` or `small`) or just let 4090 handle it
