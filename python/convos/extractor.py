"""Main conversation extraction logic."""

from datetime import datetime
from typing import Optional

from lib.hist import mark_buckets_as, date_to_bucket, SCALE_TO_RESOLUTION

from convos.config import logger, scale
from convos.transcripts import iterate_conversations
from convos.core import process_conversation_chunk
from convos.objects import check_conversations_exist, delete_conversations_in_range


def process_chunk_if_needed(chunk, model: str = "small", force: bool = False):
    chunk_start = chunk[0]["start"]
    chunk_end = chunk[-1]["end"]
    if not force and check_conversations_exist(chunk_start, chunk_end):
        logger.debug("Conversations already exist for bucket %s -> %s; skipping (use --force to recreate)", chunk_start, chunk_end)
        return -1

    if force:
        deleted_count = delete_conversations_in_range(chunk_start, chunk_end)
        if deleted_count > 0:
            logger.info(f"Deleted {deleted_count} existing conversations")
        else:
            logger.debug("No existing conversations to delete for %s -> %s", chunk_start, chunk_end)
    return process_conversation_chunk(chunk, model=model)



def extract_conversations(limit: Optional[int] = None, not_later_than: Optional[datetime] = None, model: str = "small", force: bool = False):
    """Main function to extract conversations from transcripts."""
    logger.info("=" * 60)
    logger.info("Starting conversation extraction")
    if force:
        logger.info("Force mode enabled: will recreate existing conversations")
    logger.info("=" * 60)

    processed = 0
    skipped = 0
    total_conversations = 0
    cursor = not_later_than
    delta = SCALE_TO_RESOLUTION[scale]

    bucket_ranges = {}

    try:
        conv_iterator = iterate_conversations(cursor)

        for chunk in conv_iterator:
            if limit and processed >= limit:
                logger.info(f"Reached limit of {limit} chunks")
                break

            chunk_start = chunk[0]["start"]
            chunk_end = chunk[-1]["end"]
            chunk_bucket = date_to_bucket(chunk_start, scale)

            conversations_found = process_chunk_if_needed(chunk, model=model, force=force)

            if conversations_found == -1:
                skipped += 1
                logger.debug(f"Skipped chunk in bucket {chunk_bucket}")
            else:
                total_conversations += conversations_found
                processed += 1

                if chunk_bucket not in bucket_ranges:
                    bucket_ranges[chunk_bucket] = {"start": chunk_start, "end": chunk_end}
                else:
                    bucket_ranges[chunk_bucket]["start"] = min(bucket_ranges[chunk_bucket]["start"], chunk_start)
                    bucket_ranges[chunk_bucket]["end"] = max(bucket_ranges[chunk_bucket]["end"], chunk_end)

            cursor = chunk_start

            if (processed + skipped) % 10 == 0:
                logger.debug("Progress checkpoint: %s processed, %s skipped, %s conversations found", processed, skipped, total_conversations)

        for bucket, _ in bucket_ranges.items():
            bucket_end = bucket + delta
            mark_buckets_as("done", "conversations", bucket, bucket_end, scale=scale)
            logger.debug(
                "Marked bucket as done: %s -> %s",
                bucket.strftime('%Y-%m-%d %H:%M'),
                bucket_end.strftime('%Y-%m-%d %H:%M')
            )

    except Exception as e:
        logger.error(f"Error in conversation extraction: {e}")
        raise

    logger.info("=" * 60)
    logger.info("Conversation extraction complete:")
    logger.info(f"  - Chunks processed: {processed}")
    logger.info(f"  - Chunks skipped: {skipped}")
    logger.info(f"  - Conversations found: {total_conversations}")
    logger.info(f"  - Buckets marked done: {len(bucket_ranges)}")
    logger.info("=" * 60)
