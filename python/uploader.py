
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

from chunking import audio_chunks_collection
import io
from pydub import AudioSegment
from datetime import timedelta


import settings


logger = logging.getLogger('deamon')



console = logging.StreamHandler()
console.setLevel(logging.INFO)

formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logging.basicConfig(level=logging.DEBUG, handlers=[console])


def import_new_files():
    for importer in settings.importers:
        importer.run()

def main():
    import_new_files()


if __name__ == '__main__':
    main()
