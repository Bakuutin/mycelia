# Daemon Improvements Summary

## Problem Identified

The daemon was stuck in an infinite loop continuously querying and attempting to process 2 corrupted audio files every ~10 seconds:
- `20250628 224113-A85DCA23.m4a` - Invalid data found when processing input
- `20230810 182929-E8C9D539.m4a` - error reading header

The loop occurred because:
1. Files with `ingested: False` were continuously queried
2. Files with recent errors (< 2 hours) were skipped in code, but remained in the query results
3. This caused constant re-checking without any productive work

## Solutions Implemented

### 1. Permanent Error Caching

**File**: `python/daemon.py`

Modified `ingests_missing_sources()` to:
- Exclude errored files from the query by default (no more loops!)
- Cache errors permanently until manually cleared
- Add `retry_errors` flag to optionally process errored files

**Key Changes**:
```python
def ingests_missing_sources(limit=None, retry_errors=False):
    # Only query files without errors by default
    if not retry_errors:
        base_query["ingestion.error"] = {"$exists": False}
```

### 2. Enhanced Progress Logging

**Improvements**:
- Show which file is currently being processed
- Display progress counter: `Processing [3/20]: filename.m4a`
- Success/error indicators: ✓ and ✗
- Summary statistics showing:
  - Files processed
  - Errors encountered
  - Files remaining
  - Total cached errors

**Example Output**:
```
Starting ingestion: 45 files pending, 2 errored files cached
Processing [1/20]: audio_recording.m4a
✓ Successfully ingested: audio_recording.m4a
Processing [2/20]: corrupted_file.m4a
✗ Error ingesting corrupted_file.m4a: ffmpeg error...
Batch complete: 19 processed, 1 errors, 25 remaining, 3 total cached errors
No files pending ingestion (3 errored files cached)
```

### 3. Error Management Tools

**New File**: `python/manage_errors.py`

A command-line utility to manage errored files:

#### List Errored Files
```bash
uv run manage_errors.py list
```
Shows all files with errors, including ID, filename, error message, and last attempt time.

#### Retry All Errored Files
```bash
uv run manage_errors.py retry-all
```
Clears all errors and re-attempts ingestion on all previously failed files.

#### Retry Specific File
```bash
uv run manage_errors.py retry <file_id>
```
Retries a single file by its MongoDB ObjectId.

#### Clear Errors
```bash
uv run manage_errors.py clear-all          # Clear all
uv run manage_errors.py clear <file_id>    # Clear specific
```
Removes error flags without retrying ingestion.

### 4. Helper Functions

**Added to `daemon.py`**:

- `list_errored_files()` - Display all errored files with details
- `clear_error(file_id)` - Clear error for specific file
- `clear_all_errors()` - Clear all errors at once

### 5. Documentation

**Updated File**: `python/README.md`

Comprehensive documentation including:
- How the daemon works
- Error handling behavior
- Error management commands
- Usage examples
- Component descriptions

## Benefits

✅ **No More Infinite Loops**: Errored files are permanently excluded until manually cleared

✅ **Better Visibility**: Clear progress indicators show exactly what's happening

✅ **Efficient Processing**: Daemon only processes files that can succeed

✅ **Manual Control**: Full control over retrying errored files when ready

✅ **Better Debugging**: Detailed error information makes troubleshooting easier

✅ **Resource Efficiency**: No CPU cycles wasted on repeated failed attempts

## Usage

### Normal Operation
Just run the daemon - it will automatically skip errored files:
```bash
cd python
uv run daemon.py
```

### Check for Errors
```bash
cd python
uv run manage_errors.py list
```

### Retry After Fixing Issues
If you've fixed the underlying issue (e.g., repaired corrupted files):
```bash
cd python
uv run manage_errors.py retry-all
```

Or retry specific files:
```bash
cd python
uv run manage_errors.py retry 68ee1a98a5ba09aadf9a8838
```

## Migration Notes

- Existing errored files will be automatically excluded on next daemon run
- No database migration needed - the error field already exists
- Use `manage_errors.py clear-all` to reset all errors if desired
