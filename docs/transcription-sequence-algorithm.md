# Transcription Sequence Algorithm

## Overview

This document describes the algorithm for grouping audio chunks into sequences for transcription. The algorithm processes chunks in reverse chronological order to build sequences of consecutive chunks.

## Constants

- `MAX_SEQUENCE_LENGTH`: Maximum number of chunks in a sequence (typically 30)
- `MAX_TIME_GAP`: Maximum time gap between sequences before they are considered "stale" (typically 600 seconds)

## Core Algorithm

### Input
- Audio chunks with properties:
  - `original_id`: Identifier for the original audio source
  - `index`: Sequential index of the chunk within the source
  - `start`: Timestamp when the chunk starts
  - `vad.has_speech`: Boolean indicating if speech was detected
  - `transcribed_at`: Timestamp when transcribed (null if not yet transcribed)
  - `processing_by`: Worker ID currently processing (null if available)

### Process

1. **Initialize**
   - Create an empty dictionary `sequences_by_id` mapping `original_id` → `SpeechSequence`
   - Set `yielded` counter to 0

2. **Fetch and Sort Chunks**
   - Query chunks where:
     - `transcribed_at` is null
     - `processing_by` is null
     - `vad.has_speech` is true
   - Sort by `start` timestamp in **descending order** (most recent first)

3. **Process Each Chunk** (in reverse chronological order)

   a. **Check for Stale Sequences**
   - For each existing sequence in `sequences_by_id`:
     - If `sequence.start - chunk.start > MAX_TIME_GAP`:
       - Yield the sequence (unless it's a continuation with only 1 chunk)
       - Remove from `sequences_by_id`
       - Increment `yielded`

   b. **Check Index Continuity**
   - If a sequence exists for this `original_id`:
     - Calculate expected index: `sequence.min_index - 1` (we're going backwards)
     - If `chunk.index ≠ expected_index`:
       - **Index gap detected** - yield the current sequence
       - Remove from `sequences_by_id`
       - Increment `yielded`
       - Continue to next chunk

   c. **Create or Update Sequence**
   - If no sequence exists for this `original_id`:
     - Create new `SpeechSequence`:
       - `original_id` = chunk's original_id
       - `chunks` = empty list
       - `is_continuation` = false
   - Append chunk to sequence's chunks list

   d. **Check Sequence Length**
   - If `sequence.chunks.length >= MAX_SEQUENCE_LENGTH`:
     - Mark sequence as `is_partial = true`
     - Yield the sequence
     - Increment `yielded`
     - Create **continuation sequence**:
       - `original_id` = same as current
       - `chunks` = [current chunk] (overlap for context)
       - `is_continuation` = true
     - Replace the old sequence with the continuation in `sequences_by_id`

4. **Finalize**
   - After processing all chunks, yield all remaining sequences in `sequences_by_id`

## Sequence Properties

### SpeechSequence
- `original_id`: Identifier for the source audio
- `chunks`: List of audio chunks (in reverse chronological order as processed)
- `is_partial`: True if sequence was split due to reaching MAX_SEQUENCE_LENGTH
- `is_continuation`: True if this sequence is a continuation of a previous partial sequence
- `last`: Reference to the most recently added chunk (last in list)
- `start`: Timestamp from the last chunk added
- `min_index`: Index of the last chunk added (minimum index since processing backwards)

## Key Design Decisions

### Why Reverse Chronological Order?
Processing from newest to oldest allows the algorithm to:
- Prioritize recent audio (better user experience)
- Naturally detect gaps by comparing consecutive indices
- Efficiently timeout stale sequences

### Why Index Continuity Check?
The index check (`sequence.min_index - 1 == chunk.index`) ensures:
- Only consecutive chunks are grouped together
- Gaps in recording don't result in disjointed sequences
- Sequences represent continuous speech segments

### Why Continuation Sequences?
When a sequence reaches MAX_SEQUENCE_LENGTH:
- The last chunk is included in both the completed sequence AND the new continuation
- This overlap provides context for better transcription accuracy
- Continuation sequences are marked to potentially handle differently during transcription

### Why Time Gap Filtering?
The 600-second timeout prevents:
- Memory accumulation from long-running processes
- Indefinite waiting for chunks that may never arrive
- Processing delays for completed sequences

## Example Execution

Given chunks with indices [5, 4, 3, 1, 0] for original_id "ABC":

1. Process chunk index=5: Create new sequence {chunks: [5]}
2. Process chunk index=4: Consecutive, append → {chunks: [5, 4]}
3. Process chunk index=3: Consecutive, append → {chunks: [5, 4, 3]}
4. Process chunk index=1: **Gap detected** (expected 2, got 1)
   - Yield sequence {chunks: [5, 4, 3]}
   - Create new sequence {chunks: [1]}
5. Process chunk index=0: Consecutive, append → {chunks: [1, 0]}
6. Finalize: Yield remaining sequence {chunks: [1, 0]}

Result: Two sequences [3,4,5] and [0,1]

## Implementation Notes

### Database Indexing
Recommended indexes:
- Composite index on (transcribed_at, processing_by, vad.has_speech, start DESC)
- Index on processing_by
- Index on transcribed_at

### Claiming Mechanism
Before processing a sequence:
1. Atomically claim all chunks in the sequence by setting `processing_by`
2. If any chunk is already claimed, skip the entire sequence
3. After transcription, mark chunks as `transcribed_at = now()`

### Partial Sequence Handling
For partial sequences (`is_partial = true`):
- Keep the last chunk unmarked as transcribed (it's the overlap)
- Only mark chunks[0:-1] as transcribed
- The last chunk will be included in the continuation sequence
