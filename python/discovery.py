import platform
from chunking import get_os_metadata
from pymongo.collection import Collection
from utils import mongo, lazy
import os
import re
from datetime import datetime, UTC

from typing import Iterable, TypedDict
import logging
import threading

import sqlite3
class Metadata(TypedDict):
    path: str

_IS_AUDIO_RE = re.compile(r"\.(m4a|mp3|wav|opus)$", re.IGNORECASE)

source_files: Collection = mongo['source_files']

_known_discovered_cache = lazy(lambda: set(source_files.distinct("path")))


def is_audio_file(path: str) -> bool:
    return bool(_IS_AUDIO_RE.search(path))

def is_discovered(path: str) -> bool:
    if path in _known_discovered_cache:
        return True
    return bool(source_files.find_one({"path": path}))

class Importer:
    logger = logging.getLogger('discovery')
    lock: threading.Lock
    root: str

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
        self.lock = threading.Lock()

    def discover(self) -> Iterable[Metadata]:
        raise NotImplementedError
    
    def get_start(self, metadata: Metadata) -> datetime:
        raise NotImplementedError
    
    def ingest(self, metadata: Metadata):
        metadata.update({
            "ingested": False,
            "platform": {
                "system": platform.system(),
                "node": platform.node(),
            },
            "start": self.get_start(metadata)
        })
        self.logger.debug("adding %s to source_files", metadata['path'])
        source_files.insert_one(metadata)

    def run(self):
        with self.lock:
            new_files = list(self.discover())
            self.logger.info("discovered %s new files in '%s'", len(new_files), self.root)
            for item in new_files:
                self.ingest(item)


class FilesystemImporter(Importer):
    def should_discover(self, path: str) -> bool:
        return is_audio_file(path) and not is_discovered(path)
    
    def get_start(self, metadata: Metadata) -> datetime:
        return metadata["created"]

    def discover(self) -> Iterable[Metadata]:
        for dirpath, _, filenames in os.walk(self.root):
            for filename in filenames:
                path = os.path.join(dirpath, filename)
                if self.should_discover(path):
                    yield get_os_metadata(path)


# Apple reference date (Jan 1 2001 00:00:00 GMT)
APPLE_REFERENCE_DATE = 978307200

def apple_date_to_datetime(apple_date):
    return datetime.fromtimestamp(APPLE_REFERENCE_DATE + apple_date, tz=UTC)


class AppleVoiceMemosImporter(Importer):
    def get_start(self, metadata: Metadata):
        return apple_date_to_datetime(metadata["voicememo"]["ZDATE"])

    def get_sqlite_data(self):
        db = sqlite3.connect(os.path.join(self.root, 'CloudRecordings.db'))
        try:
            cursor = db.cursor()
            cursor.execute("SELECT * FROM ZCLOUDRECORDING")
            field_names = [d for d, *_ in cursor.description]
            return [dict(zip(field_names, row)) for row in cursor.fetchall()]
        finally:
            db.close()

    def discover(self) -> Iterable[Metadata]:
        for memo in self.get_sqlite_data():
            if not memo["ZPATH"]:
                continue
            path = os.path.join(self.root, memo["ZPATH"])
            
            if is_discovered(path):
                continue

            yield {
                **get_os_metadata(path),
                "voicememo": {
                    "ZENCRYPTEDTITLE": memo["ZENCRYPTEDTITLE"],
                    "ZUNIQUEID": memo["ZUNIQUEID"],
                    "ZDATE": memo["ZDATE"],
                },
                "duration": memo["ZDURATION"],
            }

