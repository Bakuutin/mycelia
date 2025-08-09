
from discovery import FilesystemImporter, AppleVoiceMemosImporter

from discovery import source_files
from chunking import ingest_source
from pymongo import DESCENDING
import logging
import pytz
from datetime import datetime, UTC
import os
from diarization import run_voice_activity_detection
import time

import platform

from chunking import audio_chunks_collection
import io
from pydub import AudioSegment
from datetime import timedelta


import settings


logger = logging.getLogger('daemon')



console = logging.StreamHandler()
console.setLevel(logging.INFO)

formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logging.basicConfig(level=logging.DEBUG, handlers=[console])


def import_new_files():
    for importer in settings.importers:
        importer.run()


def ingests_missing_sources(limit=None):
    query = source_files.find({
        "ingested": False,
        "path": {"$exists": True},
        "platform.node": platform.node(),
    }).sort([('start', DESCENDING)])
    if limit:
        query = query.limit(limit)
    for source in query:
        error = source.get('ingestion', {}).get('error')
        if error and source['ingestion']['last_attempt'] > datetime.now(tz=UTC) - timedelta(hours=2):
            logger.info(f"Skipping {source['_id']} due to previous error \"{error}\"")
            continue
        try:
            ingest_source(source)
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


def main():
    import_new_files()
    ingests_missing_sources(limit=20)
    run_voice_activity_detection(limit=1000)


if __name__ == '__main__':
    while True:
        start = time.time()
        main()
        end = time.time()
        if end - start < 10:
            time.sleep(10)
