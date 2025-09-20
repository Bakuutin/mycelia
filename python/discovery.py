import platform
from chunking import get_os_metadata
from pymongo.collection import Collection
from utils import mongo, lazy
import os
import re
from datetime import datetime, UTC, timedelta

from typing import Iterable, TypedDict
import logging
import threading
from chunking import ingest_source
import sqlite3


from functools import cached_property
import pytz

import shutil
import stat
import humanize
from tqdm import tqdm
from contextlib import contextmanager
import paramiko
from chunking import get_tmp_dir
from copy import deepcopy

class Skip(Exception):
    pass

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
    found = bool(source_files.find_one({"path": path}))
    if found:
        _known_discovered_cache.add(path)
    return found

class Importer:
    logger = logging.getLogger('discovery')
    lock: threading.Lock
    root: str
    code: str

    def __init__(self, code: str, **kwargs):
        self.code = code
        for k, v in kwargs.items():
            setattr(self, k, v)
        self.lock = threading.Lock()

    def discover(self) -> Iterable[Metadata]:
        raise NotImplementedError
    
    def get_start(self, metadata: Metadata) -> datetime:
        raise NotImplementedError

    def get_platform(self) -> dict:
        return {
            "system": platform.system(),
            "node": platform.node(),
            "importer": self.code,
        }
    
    def ingest(self, metadata: Metadata):
        metadata.update({
            "ingested": False,
            "platform": self.get_platform(),
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

    def upload(self, source: dict):
        ingest_source(source)


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


class SshFilesystemImporter(FilesystemImporter):
    host: str
    port: int
    username: str
    last_modified_threshold: timedelta = timedelta(minutes=1)
    recursive: bool = True
    delete_after_upload: bool = False

    def get_platform(self):
        platform = super().get_platform()
        platform.update({
            "host": self.host,
        })
        return platform

    def iterate_remote_files(self) -> Iterable[tuple[str, paramiko.SFTPAttributes]]:
        with self.clients() as (ssh, sftp):
            stack = [self.root]
            while stack:
                current_path = stack.pop()
                for entry in sftp.listdir_attr(current_path):
                    full_path = f"{current_path}/{entry.filename}" if not current_path.endswith("/") else f"{current_path}{entry.filename}"
                    if not stat.S_ISDIR(entry.st_mode):
                        yield full_path, entry
                    elif self.recursive:
                        stack.append(full_path)

    @contextmanager
    def clients(self) -> tuple[paramiko.SSHClient, paramiko.SFTPClient]:
        with paramiko.SSHClient() as ssh:
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(self.host, port=self.port, username=self.username, allow_agent=True, look_for_keys=True)
            with ssh.open_sftp() as sftp:
                yield ssh, sftp

    def should_process(self, path: str, attributes: paramiko.SFTPAttributes) -> bool:
        if not is_audio_file(path):
            return False

        if self.last_modified_threshold:
            last_modified = datetime.fromtimestamp(attributes.st_mtime, tz=UTC)
            delta = datetime.now(UTC) - last_modified
            if delta < self.last_modified_threshold:
                print(f"Skipping {path} because it was modified too recently ({delta.total_seconds()} seconds ago)")
                return False

        return not is_discovered(path)

    def discover(self):
        for path, attributes in self.iterate_remote_files():
            if not self.should_process(path, attributes):
                continue
            yield {
                "created": datetime.fromtimestamp(attributes.st_mtime, tz=UTC),
                "modified": datetime.fromtimestamp(attributes.st_mtime, tz=UTC),
                "path": path,
                "size": attributes.st_size,
            }

    def upload(self, source: dict):
        remote_path = source["path"]
        local_dir = get_tmp_dir(remote_path)
        try:
            os.makedirs(local_dir, exist_ok=True)
            local_path = os.path.join(local_dir, os.path.basename(remote_path))
            with self.clients() as (ssh, sftp):
                print(f"Downloading {humanize.naturalsize(source['size'])} from {self.host}")
                total_size = int(source.get("size") or 0)
                description = os.path.basename(remote_path)
                with tqdm(total=total_size if total_size > 0 else None, unit='B', unit_scale=True, desc=f"{self.host}:{description}") as progress_bar:
                    def handle_progress(transferred, total):
                        if progress_bar.total != total and total:
                            progress_bar.total = total
                        progress_bar.update(transferred - progress_bar.n)
                    sftp.get(remote_path, local_path, callback=handle_progress)
            local_source = deepcopy(source)
            local_source["path"] = local_path
            super().upload(local_source)
            if self.delete_after_upload:
                with self.clients() as (ssh, sftp):
                    sftp.remove(remote_path)

                    print(f"Cleaned up {humanize.naturalsize(source['size'])} from {self.host}")
        finally:
            if os.path.exists(local_path):
                os.remove(local_path)
            shutil.rmtree(local_dir, ignore_errors=True)


class ExtractStartTimeFromPathMixin:
    timezone_code: str = 'UTC'
    start_group: str
    strptime_format: str

    @cached_property
    def timezone(self) -> pytz.timezone:
        return pytz.timezone(self.timezone_code)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_group_re = re.compile(self.start_group)
        assert self.start_group_re.groups == 1, "Start group must be a single group"

    def get_start(self, metadata: Metadata) -> datetime:
        match = self.start_group_re.search(metadata["path"])
        if not match:
            raise Skip(f"Could not find start time in filename {metadata['path']}")
        return self.timezone.localize(
            datetime.strptime(match.group(1), self.strptime_format), is_dst=None
        ).astimezone(pytz.UTC)