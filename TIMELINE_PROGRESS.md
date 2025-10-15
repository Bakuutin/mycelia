# Timeline Recalculation Progress Tracking

## Overview

When running timeline recalculation operations, you get **comprehensive real-time progress tracking** with:

✅ **Client-side elapsed time** - Live counter updating every second
✅ **Progress percentages** - See exactly how far along you are (25%, 50%, 75%, 100%)
✅ **Dynamic ETA calculations** - Estimated time remaining based on actual processing speed
✅ **Batch-level progress** - For large datasets, see individual batch completion
✅ **Bin statistics** - Know exactly how many histogram bins are being processed
✅ **Per-resolution timing** - See how long each resolution level takes

**No more guessing!** You'll know exactly what's happening and when it will be done.

## Commands

### ⚠️ Full Recalculation (Slow - Use Rarely!)
```bash
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.timeline -a '{"action": "recalculate", "all": true}'
```

### ⚡ Incremental Updates (Fast - Recommended!)
```bash
# Update last 24 hours (5-10 seconds) ⭐ BEST FOR DAILY USE
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.timeline -a '{"action": "recalculate", "start": "1d"}'

# Update last 7 days (10-20 seconds)
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.timeline -a '{"action": "recalculate", "start": "7d"}'

# Update specific date range
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.timeline -a '{"action": "recalculate", "start": "2025-10-01", "end": "2025-10-15"}'
```

**📚 See [TIMELINE_INCREMENTAL.md](./TIMELINE_INCREMENTAL.md) for complete incremental update guide**

## Progress Tracking

### 1. Client-Side Progress Indicator

The CLI now shows:
- **Real-time elapsed time** that updates every second
- **Status indicators** (processing, completed, failed)
- **Total duration** when completed

**Example Output:**
```
🚀 Calling tool: tech.mycelia.timeline
📝 Arguments: {
  "action": "recalculate",
  "all": true
}
⏳ Processing... (check server logs for progress)

⏱️  Elapsed: 2m 15s (still processing...)

✅ Completed in 145.3s

{
  "success": true,
  "duration": "145.3s",
  "message": "Timeline histograms recalculated successfully"
}
```

### 2. Server-Side Detailed Logs

For detailed progress, monitor the server logs. The recalculation process now logs:

- **Data range scanning**
- **Resolution processing progress** (e.g., 5min, 1hour, 1day, 1week)
- **Completion time for each resolution**
- **Overall completion statistics**

**Example Server Logs:**
```
[Timeline] Scanning collections for data range...
[Timeline] Recalculating histograms from 2024-01-01T00:00:00.000Z to 2025-10-15T00:00:00.000Z (~288 days)
[Timeline] Processing 4 resolutions: 5min, 1hour, 1day, 1week
[Timeline] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Timeline] [1/4] 5MIN (0% complete)
[Timeline] ┌─────────────────────────────────────────────────────
   ├─ Querying lower resolution data (expected ~82944 bins)...
   ├─ Processing 82944 source bins into 82944 target bins...
   ├─ Writing 82944 bins in 83 batches...
   │  └─ Batch 1/83 written (1%)
   │  └─ Batch 10/83 written (12%)
   │  └─ Batch 20/83 written (24%)
   │  └─ Batch 30/83 written (36%)
   ...
   │  └─ Batch 83/83 written (100%)
   └─ ✓ Completed writing 82944 bins
[Timeline] └─────────────────────────────────────────────────────
[Timeline] ✓ 5min completed in 45.2s | 25% complete | ~2m 16s remaining

[Timeline] [2/4] 1HOUR (25% complete)
[Timeline] ┌─────────────────────────────────────────────────────
   ├─ Querying lower resolution data (expected ~6912 bins)...
   ├─ Processing 82944 source bins into 6912 target bins...
   ├─ Writing 6912 bins in 7 batches...
   │  └─ Batch 7/7 written (100%)
   └─ ✓ Completed writing 6912 bins
[Timeline] └─────────────────────────────────────────────────────
[Timeline] ✓ 1hour completed in 33.1s | 50% complete | ~1m 19s remaining

[Timeline] [3/4] 1DAY (50% complete)
[Timeline] ┌─────────────────────────────────────────────────────
   ├─ Querying lower resolution data (expected ~288 bins)...
   ├─ Processing 6912 source bins into 288 target bins...
   ├─ Writing 288 bins in 1 batches...
   └─ ✓ Completed writing 288 bins
[Timeline] └─────────────────────────────────────────────────────
[Timeline] ✓ 1day completed in 16.9s | 75% complete | ~31s remaining

[Timeline] [4/4] 1WEEK (75% complete)
[Timeline] ┌─────────────────────────────────────────────────────
   ├─ Querying lower resolution data (expected ~42 bins)...
   ├─ Processing 288 source bins into 42 target bins...
   ├─ Writing 42 bins in 1 batches...
   └─ ✓ Completed writing 42 bins
[Timeline] └─────────────────────────────────────────────────────
[Timeline] ✓ 1week completed in 12.8s | 100% complete | ~0s remaining

[Timeline] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Timeline] ✅ All histograms updated successfully in 108.0s
```

## 📋 How to View Detailed Server Logs

The detailed progress logs (with percentages, ETAs, and batch progress) are **server-side logs**, not shown in the CLI.

### 🚀 Quick Reference

**Logs Location:**
- **Development:** Output to terminal where `deno task dev` is running
- **Background:** `~/mycelia-logs/server.log` (after redirecting, see below)
- **Python Daemon:** `~/Library/mycelia/logs/daemon.log`

**Super Quick Start:**
```bash
# Start server with logging (easiest way)
./scripts/start-server-with-logs.sh

# Stop server
./scripts/stop-server.sh
```

**Tail Commands:**
```bash
# Tail server logs (if running in background)
tail -f ~/mycelia-logs/server.log

# Tail with filtering for Timeline progress
tail -f ~/mycelia-logs/server.log | grep Timeline

# Tail Python daemon logs
tail -f ~/Library/mycelia/logs/daemon.log
```

---

### How to See Them:

### Option 1: Run Server in Foreground (Development) ⭐ RECOMMENDED

**Step 1:** Open a new terminal window/tab

**Step 2:** Start the server with visible logs:
```bash
cd /Users/pk/repo/mycelia

# Using npm
npm run dev

# OR using deno task
deno task dev
```

**Step 3:** In another terminal, run your MCP command:
```bash
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.timeline -a '{"action": "recalculate", "all": true}'
```

**Step 4:** Watch the detailed progress in the server terminal! 🎉

You'll see all the beautiful progress bars, percentages, and ETAs in real-time.

---

### Option 2: Run Server in Background and Tail Logs 🎯 EASY MODE

**Use the provided scripts:**

```bash
cd /Users/pk/repo/mycelia

# Start server with automatic logging
./scripts/start-server-with-logs.sh

# This will:
# - Start the server in background
# - Save logs to ~/mycelia-logs/server.log
# - Automatically start tailing logs
# - Show you useful commands

# To stop viewing logs: Press Ctrl+C (server keeps running)

# To stop the server:
./scripts/stop-server.sh
```

**Manual Method:**

If you prefer to do it manually:

```bash
cd /Users/pk/repo/mycelia

# Create logs directory
mkdir -p ~/mycelia-logs

# Start server in background, redirect output to log file
nohup deno task dev > ~/mycelia-logs/server.log 2>&1 &
echo $! > ~/mycelia-logs/server.pid

# Tail the logs
tail -f ~/mycelia-logs/server.log

# Or with filtering
tail -f ~/mycelia-logs/server.log | grep --color=always -E "Timeline|ERROR|✓|✅"

# To stop later
kill $(cat ~/mycelia-logs/server.pid)
```

---

### Option 3: Using Docker or Process Managers

If using Docker:
```bash
docker logs -f mycelia-server
```

If using PM2 or similar:
```bash
pm2 logs mycelia-server --lines 100
```

---

### Quick Setup Guide

**For the BEST experience:**

```
┌─────────────────────────────────────┐  ┌─────────────────────────────────────┐
│      TERMINAL 1 (SERVER)            │  │      TERMINAL 2 (COMMANDS)          │
│  Keep this open and visible! 👀     │  │  Run your commands here             │
├─────────────────────────────────────┤  ├─────────────────────────────────────┤
│ $ npm run dev                       │  │ $ deno run --env ... cli.ts ...     │
│                                     │  │                                     │
│ [Timeline] Processing...           │  │ ⏱️  Elapsed: 2m 15s ...             │
│ [Timeline] [1/4] 5MIN (0%)         │  │                                     │
│    ├─ Batch 10/83 (12%) ← LIVE!   │  │                                     │
│    ├─ Batch 20/83 (24%)            │  │                                     │
│ [Timeline] ✓ 25% | ~2m remaining   │  │ ✅ Completed in 108.0s              │
└─────────────────────────────────────┘  └─────────────────────────────────────┘
```

**Step-by-Step:**

1. **Terminal 1** (Server - keep this open):
   ```bash
   cd /Users/pk/repo/mycelia
   npm run dev  # or: deno task dev
   ```

2. **Terminal 2** (Commands):
   ```bash
   cd /Users/pk/repo/mycelia
   deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.timeline -a '{"action": "recalculate", "all": true}'
   ```

3. **Watch Terminal 1** for all the detailed progress! 📊

---

### What You'll See

**In CLI (Terminal 2):**
```
⏱️  Elapsed: 2m 15s (still processing...)
```

**In Server Logs (Terminal 1):**
```
[Timeline] [2/4] 1HOUR (25% complete)
   ├─ Processing 82944 source bins into 6912 target bins...
   ├─ Writing 6912 bins in 7 batches...
   │  └─ Batch 3/7 written (43%)
   │  └─ Batch 5/7 written (71%)
[Timeline] ✓ 1hour completed in 33.1s | 50% complete | ~1m 19s remaining
```

## Progress Information

### What Gets Tracked

1. **Total time range** - Shows the date range being processed
2. **Number of days** - Approximate days of data being recalculated
3. **Resolutions** - Lists all resolution levels (5min, 1hour, 1day, 1week)
4. **Current resolution** - Shows which resolution is currently processing
5. **Progress percentage** - Overall completion percentage (e.g., 25%, 50%, 75%)
6. **ETA (Estimated Time to Completion)** - Calculated dynamically based on completed resolutions
7. **Bin counts** - Number of histogram bins being processed
8. **Batch progress** - For large datasets, shows batch-by-batch progress within each resolution
9. **Per-resolution timing** - Individual completion time for each resolution
10. **Elapsed time** - Running total of processing time from client side

### Estimating Duration

Processing time depends on:
- **Data volume** - More audio chunks = longer processing
- **Date range** - Larger time spans take longer
- **Database performance** - MongoDB aggregation speed
- **Server resources** - CPU and memory available

**Typical speeds:**
- Small dataset (< 1 month): 10-30 seconds
- Medium dataset (1-6 months): 30-120 seconds
- Large dataset (> 6 months): 2-10 minutes

## Other Timeline Actions

### Invalidate Cache (Mark as Stale)
```bash
# Mark last 7 days as stale (will recalculate on-demand when viewed)
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.timeline -a '{"action": "invalidate", "start": "7d"}'

# Invalidate specific resolution
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.timeline -a '{"action": "invalidate", "resolution": "5min"}'
```

### Ensure Index
```bash
# Ensure database indexes are created (run once during setup)
deno run --env -E='MYCELIA_*' --allow-net cli.ts mcp call tech.mycelia.timeline -a '{"action": "ensureIndex"}'
```

### Performance Comparison

| Update Type | Time Range | Typical Duration |
|-------------|-----------|------------------|
| Incremental | Last 1 day | 5-10 seconds ⚡ |
| Incremental | Last 7 days | 10-20 seconds |
| Incremental | Last 30 days | 20-60 seconds |
| Full (`all: true`) | All data (~288 days) | 2-10 minutes 🐌 |

**💡 Pro Tip:** For daily use, only update last 1-7 days instead of everything!

## Tips

1. **Run in separate terminal** - Keep server logs visible in one terminal while running CLI commands in another
2. **Monitor during first run** - The first recalculation will take longest; subsequent runs are faster
3. **Use specific ranges** - If only recent data changed, recalculate just that range instead of all data
4. **Check completion** - Wait for the ✅ success message before closing the terminal
