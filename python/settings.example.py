from discovery import FilesystemImporter, AppleVoiceMemosImporter, ExtractStartTimeFromPathMixin
import pytz
from datetime import datetime, UTC
import os


class GoogleCloudImporter(FilesystemImporter):
    def get_start(self, metadata) -> datetime:
        filename = os.path.basename(metadata['path'])
        tz = pytz.timezone('Europe/Amsterdam')
        return tz.localize(
            datetime.strptime(filename.split(".")[0], "%Y-%m-%d %H-%M-%S"), is_dst=None
        ).astimezone(UTC)


class LocalFilesystemImporter(ExtractStartTimeFromPathMixin, FilesystemImporter):
    start_group = r"(\d{2}-\d{2}-\d{4} \d{2}-\d{2})"
    strptime_format = "%m-%d-%Y %H-%M"
    timezone_code = "Europe/Moscow"


importers: list[FilesystemImporter] = [
    GoogleCloudImporter(root="/Users/tigor/Library/CloudStorage/GoogleDrive-igorbakutin@gmail.com/My Drive/Easy Voice Recorder/"),
    AppleVoiceMemosImporter(root="/Users/tigor/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings/"),
    LocalFilesystemImporter(root="/Users/tigor/Library/mycelia//audio", code="local", ),
]