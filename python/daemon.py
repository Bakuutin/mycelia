#%%
from lib.config import get_url
from discovery import Importer

import logging
from datetime import datetime, UTC
# from diarization import run_voice_activity_detection
import time

import platform

import io
from pydub import AudioSegment
from datetime import timedelta

from lib.resources import call_resource


import settings

#%%

logger = logging.getLogger('daemon')

import os
log_dir = os.path.expanduser('~/Library/mycelia/logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, 'daemon.log')

console = logging.StreamHandler()
console.setLevel(logging.INFO)

file_handler = logging.FileHandler(log_file)
file_handler.setLevel(logging.DEBUG)

formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
console.setFormatter(formatter)
file_handler.setFormatter(formatter)

logging.basicConfig(level=logging.DEBUG, handlers=[console, file_handler])

logger.info(f"Logging to {log_file}")


def import_new_files():
    for importer in settings.importers:
        importer.run()


importer_map = {importer.code: importer for importer in settings.importers}
unknown_importer = Importer(code="unknown")


def ingests_missing_sources(limit=None, retry_errors=False):
    base_query = {
        "ingested": False,
        "$or": [
            {
                "path": {"$exists": True},
                "platform.node": platform.node(),
            },
            {"platform.importer": {"$in": list(importer_map.keys())}},
        ],
    }

    if not retry_errors:
        base_query["ingestion.error"] = {"$exists": False}

    total_pending = call_resource('tech.mycelia.mongo', {
        "action": "count",
        "collection": "source_files",
        "query": base_query
    })

    already_ingested = call_resource('tech.mycelia.mongo', {
        "action": "count",
        "collection": "source_files",
        "query": {"ingested": True}
    })

    errored_count = call_resource('tech.mycelia.mongo', {
        "action": "count",
        "collection": "source_files",
        "query": {
            "ingested": False,
            "ingestion.error": {"$exists": True}
        }
    })

    total_files = already_ingested + total_pending + errored_count

    if total_pending == 0:
        if errored_count > 0:
            logger.info(f"✓ Ingestion complete: {already_ingested}/{total_files} files successfully ingested, {errored_count} errored files cached")
        else:
            logger.info(f"✓ Ingestion complete: {already_ingested}/{total_files} files successfully ingested")
        return

    logger.info(f"Starting ingestion: {total_pending} pending, {already_ingested} already ingested, {errored_count} errored (Total: {total_files} files)")

    query = call_resource('tech.mycelia.mongo', {
        "action": "find",
        "collection": "source_files",
        "query": base_query,
        "sort": [('start', -1)],
        "limit": limit,
    })

    processed = 0
    errors = 0

    for idx, source in enumerate(query, 1):
        file_path = source.get('path', str(source['_id']))
        file_name = os.path.basename(file_path) if 'path' in source else str(source['_id'])

        logger.info(f"Processing [{idx}/{min(limit or total_pending, total_pending)}]: {file_name}")

        try:
            importer = importer_map.get(
                source['platform'].get('importer'),
                unknown_importer
            )
            importer.upload(source)
            call_resource('tech.mycelia.mongo', {
                "action": "updateOne",
                "collection": "source_files",
                "query": {"_id": source["_id"]},
                "update": {"$set": {
                "ingested": True,
                "ingested_at": datetime.now(tz=UTC),
            }}
            })
            processed += 1
            logger.info(f"✓ Successfully ingested: {file_name}")
        except Exception as e:
            errors += 1
            error_msg = str(e)
            logger.error(f"✗ Error ingesting {file_name}: {error_msg[:100]}")

            call_resource('tech.mycelia.mongo', {
                "action": "updateOne",
                "collection": "source_files",
                "query": {"_id": source["_id"]},
                "update": {"$set": {
                    "ingestion": {
                        "error": error_msg,
                        "last_attempt": datetime.now(tz=UTC),
                    }
                }}
            })

    remaining = total_pending - processed - errors
    new_ingested_total = already_ingested + processed
    new_errored_total = errored_count + errors
    logger.info(f"Batch complete: {processed} processed, {errors} errors, {remaining} remaining")
    logger.info(f"Overall status: {new_ingested_total}/{total_files} ingested, {new_errored_total} errored")





def list_errored_files():
    errored_files = call_resource('tech.mycelia.mongo', {
        "action": "find",
        "collection": "source_files",
        "query": {
            "ingested": False,
            "ingestion.error": {"$exists": True}
        },
        "sort": [('ingestion.last_attempt', -1)]
    })

    count = 0
    for source in errored_files:
        count += 1
        file_path = source.get('path', str(source['_id']))
        file_name = os.path.basename(file_path) if 'path' in source else str(source['_id'])
        error = source['ingestion']['error'][:100]
        last_attempt = source['ingestion']['last_attempt'].strftime('%Y-%m-%d %H:%M:%S')
        print(f"{count}. {file_name}")
        print(f"   ID: {source['_id']}")
        print(f"   Error: {error}")
        print(f"   Last attempt: {last_attempt}")
        print()

    if count == 0:
        print("No errored files found")
    else:
        print(f"Total: {count} errored files")

    return count


def clear_error(file_id):
    result = call_resource('tech.mycelia.mongo', {
        "action": "updateOne",
        "collection": "source_files",
        "query": {"_id": file_id},
        "update": {"$unset": {"ingestion": ""}}
    })
    if result.modified_count > 0:
        logger.info(f"Cleared error for file {file_id}")
        return True
    else:
        logger.warning(f"File {file_id} not found or no error to clear")
        return False


def clear_all_errors():
    result = call_resource('tech.mycelia.mongo', {
        "action": "updateMany",
        "collection": "source_files",
        "query": {"ingestion.error": {"$exists": True}},
        "update": {"$unset": {"ingestion": ""}}
    })
    logger.info(f"Cleared errors for {result.modified_count} files")
    return result.modified_count


def add_missing_durations():
    query = {
        "duration": {"$exists": False}
    }

    cursor = call_resource('tech.mycelia.mongo', {
        "action": "find",
        "collection": "source_files",
        "query": query
    })
    for original in cursor:
        # Find the latest chunk for this original
        latest_chunk = call_resource('tech.mycelia.mongo', {
            "action": "findOne",
            "collection": "audio_chunks",
            "query": {"meta.original_id": original["_id"]},
            "sort": [("start", -1)],
            "limit": 1
        })
        if latest_chunk:
            end = latest_chunk["start"] + timedelta(seconds=AudioSegment.from_file(io.BytesIO(latest_chunk['data']), format="ogg").duration_seconds)
            duration = end - original["start"]
            call_resource('tech.mycelia.mongo', {
                "action": "updateOne",
                "collection": "source_files",
                "query": {"_id": original["_id"]},
                "update": {
                    "$set": {
                        "duration": duration.total_seconds()
                    }
                }
            })


def add_missing_ends():
    for original in call_resource('tech.mycelia.mongo', {
        "action": "find",
        "collection": "source_files",
        "query": {
            "duration": {"$exists": True},
            "end": {"$exists": False}
        }
    }):
        call_resource('tech.mycelia.mongo', {
            "action": "updateOne",
            "collection": "source_files",
            "query": {"_id": original["_id"]},
            "update": {
                "$set": {
                    "end": original["start"] + timedelta(seconds=original["duration"])
                }
            }
        })

#%%

import_new_files()

#%%

def main():
    logger.info("=" * 60)
    logger.info("Starting daemon cycle")
    logger.info("=" * 60)

    logger.info("\n[1/3] Importing new files from sources...")
    import_new_files()

    logger.info("\n[2/3] Ingesting audio files...")
    ingests_missing_sources(limit=20)

    # logger.info("\n[3/3] Running voice activity detection...")
    # run_voice_activity_detection(limit=1000)

    logger.info("=" * 60)
    logger.info("Daemon cycle complete")
    logger.info("=" * 60)


if __name__ == '__main__':
    while True:
        start = time.time()
        try:
            main()
        except Exception as e:
            logger.exception(f"Error in main: {e}")
            time.sleep(10)
            continue
        end = time.time()
        if end - start < 10:
            logger.info("Sleeping for a few seconds")
            time.sleep(10)

#%%