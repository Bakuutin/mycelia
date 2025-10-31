import os
import dotenv
dotenv.load_dotenv('../backend/.env', override=True)

from utils import lazy, mongo
from datetime import datetime

chunks = lazy(lambda: mongo['audio_chunks'])
transcriptions = lazy(lambda: mongo['transcriptions'])

marked_as_transcribed = chunks.count_documents({
    'transcribed_at': {'$ne': None},
    'vad.has_speech': True
})

print(f"Chunks marked as transcribed: {marked_as_transcribed}")

total_transcriptions = transcriptions.count_documents({})
print(f"Total transcriptions in DB: {total_transcriptions}")

if marked_as_transcribed > 0:
    orphaned_chunks = []

    for chunk in chunks.find({'transcribed_at': {'$ne': None}, 'vad.has_speech': True}).limit(1000):
        original_id = chunk['original_id']
        start = chunk['start']

        matching_transcription = transcriptions.find_one({
            'original': original_id,
            'start': start
        })

        if not matching_transcription:
            orphaned_chunks.append({
                'chunk_id': chunk['_id'],
                'original_id': original_id,
                'start': start,
                'transcribed_at': chunk['transcribed_at']
            })

    if orphaned_chunks:
        print(f"\n⚠️  Found {len(orphaned_chunks)} orphaned chunks (marked transcribed but no transcription exists)")
        print("\nFirst 5 examples:")
        for chunk in orphaned_chunks[:5]:
            print(f"  - Chunk ID: {chunk['chunk_id']}, Start: {chunk['start']}, Transcribed at: {chunk['transcribed_at']}")

        print("\n💡 To reset these chunks for reprocessing:")
        print("   Run: python python/reset_orphaned_chunks.py")
    else:
        print("\n✅ No orphaned chunks found - all marked chunks have corresponding transcriptions")
else:
    print("\n✅ No chunks marked as transcribed yet")

untranscribed = chunks.count_documents({
    'transcribed_at': {'$eq': None},
    'vad.has_speech': True
})
print(f"\nPending chunks to process: {untranscribed}")
