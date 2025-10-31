import argparse
import os
import dotenv
dotenv.load_dotenv('../backend/.env', override=True)

from utils import lazy, mongo
from datetime import datetime

chunks = lazy(lambda: mongo['audio_chunks'])
transcriptions = lazy(lambda: mongo['transcriptions'])

def find_orphaned_chunks(limit=None):
    orphaned_chunk_ids = []

    query = {'transcribed_at': {'$ne': None}, 'vad.has_speech': True}
    cursor = chunks.find(query)
    if limit:
        cursor = cursor.limit(limit)

    total_checked = 0
    for chunk in cursor:
        total_checked += 1
        if total_checked % 100 == 0:
            print(f"Checked {total_checked} chunks, found {len(orphaned_chunk_ids)} orphaned...")

        original_id = chunk['original_id']
        start = chunk['start']

        matching_transcription = transcriptions.find_one({
            'original': original_id,
            'start': start
        })

        if not matching_transcription:
            orphaned_chunk_ids.append(chunk['_id'])

    return orphaned_chunk_ids

def reset_orphaned_chunks(dry_run=True):
    print("Finding orphaned chunks (marked as transcribed but no transcription exists)...")
    orphaned_ids = find_orphaned_chunks()

    if not orphaned_ids:
        print("✅ No orphaned chunks found!")
        return

    print(f"\n⚠️  Found {len(orphaned_ids)} orphaned chunks")

    if dry_run:
        print("\n🔍 DRY RUN MODE - No changes will be made")
        print("To actually reset these chunks, run with --execute flag")
        return

    print("\n🔄 Resetting orphaned chunks (clearing transcribed_at)...")
    result = chunks.update_many(
        {'_id': {'$in': orphaned_ids}},
        {'$set': {'transcribed_at': None}}
    )

    print(f"✅ Reset {result.modified_count} chunks")
    print("These chunks will be reprocessed on the next STT run")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Reset orphaned chunks for reprocessing')
    parser.add_argument('--execute', action='store_true', help='Actually reset the chunks (default is dry-run)')
    args = parser.parse_args()

    reset_orphaned_chunks(dry_run=not args.execute)
