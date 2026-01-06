# Sequence Splitting Requirements

## Goal
Group consecutive audio chunks into sequences for batch transcription, with a maximum of 30 chunks per sequence.

## Core Requirements

### R1: Consecutive Grouping
Audio chunks with consecutive indices from the same `original_id` MUST be grouped into the same sequence, unless prevented by other requirements (max length, time gap).

### R2: Maximum Sequence Length
No sequence shall contain more than 30 chunks (MAX_SEQUENCE_LENGTH).

### R3: Index Continuity
If chunk index N and chunk index N+1 both exist and have speech, they MUST appear in either:
- The same sequence, OR
- Adjacent sequences (one ending with N, next starting with N+1)

### R4: Processing Order
Chunks SHOULD be processed newest-to-oldest (descending start time) to prioritize recent audio.

### R5: Time Gap Handling
If more than 600 seconds (MAX_GAP_MS) elapses between chunks being processed, pending sequences SHOULD be finalized to prevent memory accumulation.

## Option A: Overlap in Both Sequences

When a sequence **exceeds** 30 chunks while processing backwards in time, we split it and the **overlap chunk appears in BOTH sequences** for transcription context.

**Important:** If we have exactly 30 chunks, no split occurs - just one sequence is created.

### Example: Chunks [0-29] (30 chunks exactly)

**Processing (backwards from 29 to 0):**

1. Build sequence: [29, 28, 27, ..., 1, 0] = 30 chunks
2. End of chunks → yield remaining

**Result:**
- Single sequence: [0-29] count=30, isPartial=false, isContinuation=false
  - Mark all 30 chunks

**No split occurs** - exactly 30 chunks fits in one sequence.

### Example: Chunks [0-30] (31 chunks)

**Processing (backwards from 30 to 0):**

1. Build sequence: [30, 29, 28, ..., 1] = 30 chunks
2. Add chunk 0 → sequence now has 31 chunks, exceeds limit
3. Remove chunk 0 (will be overlap), yield sequence of 30 chunks
4. Create continuation with chunk 0: [0]
5. End of chunks → yield continuation

**Result:**
- Sequence 1 (partial): [1-30] count=30, isPartial=true, isContinuation=false
  - Mark chunks 2-30 (29 chunks, excludes overlap chunk 1)
- Sequence 2 (continuation): [0-1] count=2, isPartial=false, isContinuation=true
  - Mark chunks 0-1 (2 chunks including overlap)

**Chunk 1** (overlap):
- Appears in BOTH sequence records (end of partial [1-30], start of continuation [0-1])
- But only marked with Sequence 2's ID in the database
- Provides context for the continuation sequence

### Example: Chunks [0-59] (60 chunks)

**Processing (backwards from 59 to 0):**

1. Build [59, 58, ..., 30] = 30 chunks → yield as partial, create continuation [30]
2. Build [30, 29, ..., 1] = 30 chunks → yield as partial, create continuation [1]
3. Add chunk 0 → continuation is [1, 0] = 2 chunks
4. End of chunks → yield remaining

**Result:**
- Sequence 1 (partial): [30-59] count=30, isPartial=true, isContinuation=false
  - Marks chunks 31-59 (29 chunks, excludes overlap 30)
- Sequence 2 (partial continuation): [1-30] count=30, isPartial=true, isContinuation=true
  - Marks chunks 2-30 (29 chunks, excludes overlap 1)
- Sequence 3 (final continuation): [0-1] count=2, isPartial=false, isContinuation=true
  - Marks chunks 0-1 (2 chunks)

**Overlaps:**
- Chunk 30: Appears in Seq 1 and Seq 2, marked with Seq 2
- Chunk 1: Appears in Seq 2 and Seq 3, marked with Seq 3

## Implementation Details

### 1. Sequence Building

```typescript
interface SpeechSequence {
  originalId: ObjectId;
  chunks: any[]; // In reverse chronological order (as added)
  isPartial: boolean; // True if split due to reaching MAX_LENGTH
  isContinuation: boolean; // True if continues a previous sequence
}
```

**Algorithm:**
- Fetch chunks sorted by `start DESC` (newest first)
- For each chunk (going backwards in time):
  - Check for stale sequences (time gap > MAX_GAP_MS), yield them
  - Check index continuity (must be minIndex - 1), yield if gap
  - Add chunk to current sequence
  - If sequence reaches 30 chunks:
    - Mark as `isPartial = true`
    - Yield the sequence
    - Create continuation with overlap chunk (last added)

### 2. Database Persistence

**Sequence Record:**
- `fromIndex`: First chunk index (chronologically)
- `toIndex`: Last chunk index (chronologically)
- `chunk_count`: Total chunks INCLUDING overlap
- `is_continuation`: true if continues a previous sequence
- `state`: "ready" if count >= 30, else "pending"

**Chunk Marking:**
- For partial sequences (`isPartial = true`):
  - Mark all chunks EXCEPT the first (overlap chunk)
  - `chunksToUpdate = chunksInOrder.slice(1)`
- For non-partial sequences:
  - Mark ALL chunks
  - `chunksToUpdate = chunksInOrder`

### 3. Transcription

- Each sequence gets transcribed independently
- Overlap chunks provide context at boundaries
- May result in duplicate transcription at overlaps (acceptable)

## Benefits of Option A

1. **Better transcription context**: Overlap chunks provide context for both sequences
2. **Simpler logic**: No need to orphan chunks or special-case boundaries
3. **Handles edge cases well**: Works naturally with partial sequences at the end
4. **Clear ownership**: Each chunk marked with exactly one sequence ID
5. **Easy to understand**: Sequences contain what they transcribe (with overlap)

## Edge Cases

### Exactly 30 chunks
- No split occurs
- Single sequence created, all chunks marked
- `isPartial = false` (no continuation needed)

### Single chunk continuation
- If time gap causes a continuation to become stale with only 1 chunk
- Skip yielding it (will be recreated if needed)
- Prevents orphaned single-chunk overlaps

### Index gaps
- If index N and index N+2 both exist (N+1 missing)
- Current sequence is yielded
- New sequence starts with N (or N+2 depending on processing order)
