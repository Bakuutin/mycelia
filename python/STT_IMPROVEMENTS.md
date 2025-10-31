# STT Processing Improvements

## Summary of Changes

### 1. **Added File Logging** ✅
- Logs are now saved to `python/logs/stt.log`
- Uses rotating log files (10MB max, keeps 5 backups)
- Both file and console output
- Structured format with timestamps and log levels

### 2. **Added Progress Bar** ✅
- Real-time progress tracking using `tqdm`
- Shows:
  - Current progress / total sequences
  - Processing speed
  - Live stats: transcribed, empty, errors
- Updates without cluttering the log

### 3. **Implemented Parallel Processing** ✅
- Now supports true parallelism with ThreadPoolExecutor
- Controlled via `--max-workers` parameter
- Default: 1 worker (sequential)
- Example: `--max-workers 5` processes 5 sequences simultaneously

### 4. **Fixed Critical Bug** 🐛 → ✅
**BEFORE**: If transcription failed, chunks were still marked as transcribed (lost forever!)
**AFTER**: Only marks chunks as transcribed on successful transcription
- Failed sequences can be retried on next run
- Errors are logged with full stack trace

### 5. **Better Error Handling**
- Exceptions include timing information
- Full stack traces in logs
- Statistics tracking for all outcomes

## How It Works Now

### Processing Order
1. Fetches chunks from DB where `transcribed_at == None` and `vad.has_speech == True`
2. Sorts by **newest first** (descending `start` time)
3. Groups consecutive chunks into sequences by `original_id`
4. Processes sequences (parallel or sequential)

### Parallelism Behavior
- **Single worker** (`max_workers=1`): Sequential processing, minimal DB load
- **Multiple workers** (`max_workers=N`): Processes N sequences in parallel
  - Each batch fetches up to 1000 sequences
  - Submits all to thread pool
  - Updates progress as each completes
  - Fetches next batch when done

### Resume Capability
✅ **Works perfectly**:
- Only processes chunks where `transcribed_at` is None
- If script crashes/stops, rerunning continues from where it left off
- Failed transcriptions (errors) are NOT marked, so they'll retry

### Error Scenarios

| Scenario | Behavior | Can Retry? |
|----------|----------|------------|
| Network error to STT server | Logs error, continues to next | ✅ Yes |
| STT server timeout | Logs error, continues | ✅ Yes |
| Invalid audio data | Logs error, continues | ✅ Yes |
| Script crashes | Stops processing | ✅ Yes (resume on restart) |
| Successfully transcribed | Marks chunks, saves transcription | ❌ No (done) |
| No speech detected | Marks chunks, no transcription saved | ❌ No (done) |

## Usage Examples

```bash
# Sequential processing (safe, lower load)
python python/stt.py --limit 100

# Parallel processing (faster, higher load)
python python/stt.py --limit 1000 --max-workers 5

# Process everything (no limit)
python python/stt.py --max-workers 3

# Check logs
tail -f python/logs/stt.log
```

## Performance Considerations

### Database Load
- Initial query: `count_documents()` - **1 query** at start
- Batch fetch: Gets sequences in batches of 1000 max
- Update query: Marks chunks as transcribed after success

### Recommended Settings

| Scenario | max_workers | Reasoning |
|----------|-------------|-----------|
| Single STT server | 1-2 | Avoid overwhelming server |
| Multiple STT servers | 3-5 | Balance load across servers |
| High DB load concerns | 1 | Minimize concurrent DB writes |
| Fast catch-up needed | 3-5 | Process backlog quickly |

## Monitoring

### Live Progress
```
Processing sequences: 45%|████▌     | 450/1000 [02:15<02:45, 3.33seq/s] transcribed=380 empty=65 errors=5
```

### Log File
```
2025-10-30 10:15:23 - INFO - Total pending chunks: 5420
2025-10-30 10:15:23 - INFO - Using 3 parallel worker(s)
2025-10-30 10:15:24 - INFO - Processing sequence: 2025-10-30 09:45:12 | 5 chunks | ID: 507f1f77bcf86cd799439011
2025-10-30 10:15:26 - INFO - Completed sequence: 2025-10-30 09:45:12 | 5 chunks | 2.34s | transcribed
2025-10-30 10:15:27 - ERROR - Error processing sequence at 2025-10-30 09:40:00 after 3.21s: Connection timeout
```

## What About Whisper Server Load?

### Current Implementation
- **No built-in throttling** - sends requests as fast as threads allow
- **Timeout protection**: 5s base + 3s per chunk
- **Order**: Newest sequences first (most recent audio)

### Whisper Server Receives
- Multiple parallel requests (if `max_workers > 1`)
- Each request contains multiple audio files (1 per chunk in sequence)
- Files sent as multipart form data

### If Whisper Server Overloaded
1. Requests will timeout (logged as errors)
2. Sequences won't be marked as transcribed
3. Will retry on next run
4. **Solution**: Reduce `max_workers` or add rate limiting

## Future Enhancements (Optional)

- [ ] Add `--retry-errors` flag to reprocess only failed sequences
- [ ] Add rate limiting (requests per second)
- [ ] Add exponential backoff for failed requests
- [ ] Separate error tracking in DB (instead of just not marking)
- [ ] Add metrics endpoint for monitoring
- [ ] Support for priority processing (urgent sequences first)
