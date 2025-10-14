#%%
from discovery import Importer

from discovery import source_files
from pymongo import DESCENDING
import logging
from datetime import datetime, UTC
from diarization import run_voice_activity_detection
import time

import platform

from chunking import audio_chunks_collection
import io
from pydub import AudioSegment
from datetime import timedelta


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


def ingests_missing_sources(limit=None):
    query = source_files.find({
        "ingested": False,
        "$or": [
            {
                "path": {"$exists": True},
                "platform.node": platform.node(),
            },
            {"platform.importer": {"$in": list(importer_map.keys())}},
        ],
    }).sort([('start', DESCENDING)])
    if limit:
        query = query.limit(limit)
    for source in query:
        error = source.get('ingestion', {}).get('error')
        if error and source['ingestion']['last_attempt'] > datetime.now(tz=UTC) - timedelta(hours=2):
            logger.info(f"Skipping {source['_id']} due to previous error \"{error}\"")
            continue
        try:
            importer = importer_map.get(
                source['platform'].get('importer'),
                unknown_importer
            )
            importer.upload(source)
            source_files.update_one({"_id": source["_id"]}, {"$set": {
                "ingested": True,
                "ingested_at": datetime.now(tz=UTC),
            }})
        except Exception as e:
            logger.exception(f"Error ingesting {source['_id']}")
            source_files.update_one({"_id": source["_id"]}, {"$set": {"ingestion": {
                "error": str(e),
                "last_attempt": datetime.now(tz=UTC),
            }}})





def add_missing_durations():
    query = {
        "duration": {"$exists": False}
    }

    cursor = source_files.find(query)
    for original in cursor:
        # Find the latest chunk for this original
        latest_chunk = audio_chunks_collection.find_one(
            {"meta.original_id": original["_id"]},
            sort=[("start", -1)]  # Sort by start time descending, get the latest
        )
        if latest_chunk:
            end = latest_chunk["start"] + timedelta(seconds=AudioSegment.from_file(io.BytesIO(latest_chunk['data']), format="ogg").duration_seconds)
            duration = end - original["start"]
            source_files.update_one(
                {"_id": original["_id"]},
                {
                    "$set": {
                        "duration": duration.total_seconds()
                    }
                }
            )


def add_missing_ends():
    for original in source_files.find({
        "duration": {"$exists": True},
        "end": {"$exists": False}
    }):
        source_files.update_one(
            {"_id": original["_id"]},
            {
                "$set": {
                    "end": original["start"] + timedelta(seconds=original["duration"])
                }
            }
        )

#%%

import_new_files()

#%%

def main():
    import_new_files()
    ingests_missing_sources(limit=20)
    run_voice_activity_detection(limit=1000)


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