# Understanding Transcription Data

#transcriptions #audio #format

Transcriptions are created from audio recordings (voice memos, meetings, etc.).

## Transcription Structure

```json
{
  "_id": "ObjectId",
  "text": "Full transcription text...",
  "start": "2024-03-15T10:30:00Z",
  "end": "2024-03-15T10:35:00Z",
  "duration": 300,
  "segments": [
    {
      "start": 0.0,
      "end": 5.2,
      "text": "Hello, how are you?"
    }
  ],
  "original": "source_file_id"
}
```

## Fields

- `text`: Complete transcription as single string
- `start`/`end`: Wall-clock time of recording
- `duration`: Length in seconds
- `segments`: Individual utterances with relative timestamps
- `original`: Reference to source audio file

## Searching Tips

- Search in `text` field for full-text
- Use `segments.text` for segment-level search
- Filter by `start`/`end` for time periods

## Related Collections

- `conversation_chunks`: Groups of related transcriptions
- `audio_chunks`: Raw audio segments
- `source_files`: Original uploaded files
