from discovery import FilesystemImporter, AppleVoiceMemosImporter
import pytz
from datetime import datetime, UTC
import os

amsterdam = pytz.timezone('Europe/Amsterdam')


class GoogleCloudImporter(FilesystemImporter):
    def get_start(self, metadata) -> datetime:
        filename = os.path.basename(metadata['path'])
        return amsterdam.localize(
            datetime.strptime(filename.split(".")[0], "%Y-%m-%d %H-%M-%S"), is_dst=None
        ).astimezone(UTC)


importers: list[FilesystemImporter] = [
    GoogleCloudImporter(root="/Users/tigor/Library/CloudStorage/GoogleDrive-igorbakutin@gmail.com/My Drive/Easy Voice Recorder/"),
    AppleVoiceMemosImporter(root="/Users/tigor/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings/"),
    FilesystemImporter(root="/Users/tigor/sound/"),
]