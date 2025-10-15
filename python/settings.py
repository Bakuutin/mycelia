from discovery import FilesystemImporter, AppleVoiceMemosImporter, ExtractStartTimeFromPathMixin
import pytz
from datetime import datetime, UTC
import os


class GoogleCloudImporter(FilesystemImporter):
    def get_start(self, metadata) -> datetime:
        filename = os.path.basename(metadata['path'])
        tz_name = os.getenv('MYCELIA_GOOGLE_TZ', 'UTC')
        tz = pytz.timezone(tz_name)
        return tz.localize(
            datetime.strptime(filename.split(".")[0], "%Y-%m-%d %H-%M-%S"), is_dst=None
        ).astimezone(UTC)


class LocalFilesystemImporter(ExtractStartTimeFromPathMixin, FilesystemImporter):
    start_group = r"(\d{2}-\d{2}-\d{4} \d{2}-\d{2})"
    strptime_format = "%m-%d-%Y %H-%M"
    timezone_code = os.getenv('MYCELIA_LOCAL_TZ', 'UTC')


def find_google_drive_evr() -> str | None:
    custom = os.getenv('MYCELIA_GOOGLE_DRIVE_ROOT')
    if custom:
        path = os.path.expanduser(custom)
        return path if os.path.isdir(path) else None

    cloud_storage = os.path.expanduser("~/Library/CloudStorage")
    if not os.path.isdir(cloud_storage):
        return None

    for folder in os.listdir(cloud_storage):
        if folder.startswith('GoogleDrive-'):
            evr_path = os.path.join(cloud_storage, folder, "My Drive", "Easy Voice Recorder")
            if os.path.isdir(evr_path):
                return evr_path
    return None


def find_apple_voicememos() -> str | None:
    custom = os.getenv('MYCELIA_APPLE_VOICEMEMOS_ROOT')
    if custom:
        path = os.path.expanduser(custom)
        db_path = os.path.join(path, 'CloudRecordings.db')
        return path if os.path.exists(db_path) else None

    default = os.path.expanduser("~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings")
    db_path = os.path.join(default, 'CloudRecordings.db')
    return default if os.path.exists(db_path) else None


def find_local_audio() -> str | None:
    custom = os.getenv('MYCELIA_LOCAL_AUDIO_ROOT')
    if custom:
        path = os.path.expanduser(custom)
        return path if os.path.isdir(path) else None

    default = os.path.expanduser("~/Library/mycelia/audio")
    return default if os.path.isdir(default) else None


importers: list[FilesystemImporter] = []

google_root = find_google_drive_evr()
if google_root:
    importers.append(GoogleCloudImporter(root=google_root, code="google_drive"))

apple_root = find_apple_voicememos()
if apple_root:
    importers.append(AppleVoiceMemosImporter(root=apple_root, code="apple_voicememos"))

local_root = find_local_audio()
if local_root:
    importers.append(LocalFilesystemImporter(root=local_root, code="local"))