from datetime import datetime, timedelta
import io

import shutil
from pytz import UTC

import ffmpeg
import wave

import numpy as np

import os
import logging

import base64

from lib.resources import call_resource

from utils import sample_rate, sha, TMP_DIR

logger = logging.getLogger('chunking')

CHUNK_MAX_LEN = timedelta(seconds=10)


def get_tmp_dir(original):
    return os.path.join(TMP_DIR, sha(original))

def split_to_opus_chunks(original, *, quiet=True):
    dest_dir = get_tmp_dir(original)
    os.makedirs(dest_dir, exist_ok=True)

    stream = (
        ffmpeg
        .input(original)
        .output(
            os.path.join(dest_dir, "%010d.opus"),
            f='segment',
            segment_time=int(CHUNK_MAX_LEN.total_seconds()),
            acodec='libopus',
            audio_bitrate='64k',
            map_metadata = -1,
        )
        .overwrite_output()  # Allow overwriting existing files
    )

    if os.listdir(dest_dir):
        pass
    else:
        try:
            stream.run(quiet=quiet, capture_stdout=True, capture_stderr=True)
        except ffmpeg.Error as e:
            error_msg = e.stderr.decode() if e.stderr else str(e)
            logger.error(f"FFmpeg error processing '{original}':\n{error_msg}")
            raise Exception(f"ffmpeg error processing {os.path.basename(original)}: {error_msg[:200]}")

    return [
        (i * CHUNK_MAX_LEN, os.path.join(dest_dir, f))
        for i, f in enumerate(sorted(os.listdir(dest_dir)))
    ]

def get_os_metadata(file):
    stat = os.stat(file)
    return {
        "created": datetime.fromtimestamp(stat.st_birthtime, tz=UTC),
        "modified": datetime.fromtimestamp(stat.st_mtime, tz=UTC),
        "path": file,
        "size": stat.st_size,
    }


def wav_to_array(source: io.BytesIO) -> np.ndarray:
    wav_file = wave.open(source, 'rb')

    if wav_file.getnchannels() != 1:
        raise ValueError("WAV file must be mono")
    frames = wav_file.readframes(wav_file.getnframes())

    # Get sample width to determine dtype
    if wav_file.getsampwidth() == 2:
        data = np.frombuffer(frames, dtype=np.int16)
    elif wav_file.getsampwidth() == 4:
        data = np.frombuffer(frames, dtype=np.int32)
    else:
        raise ValueError("Unsupported sample width")

    # Normalize to float between -1.0 and 1.0
    return data.astype(np.float32) / np.iinfo(data.dtype).max

def array_to_wav(audio_data: np.ndarray, sample_rate=16000) -> io.BytesIO:
    """
    Convert numpy array to WAV file in memory

    Args:
        audio_data (numpy.ndarray): Audio data normalized between -1.0 and 1.0
        sample_rate (int): Sample rate in Hz

    Returns:
        io.BytesIO: WAV file in memory
    """
    # Convert to 16-bit PCM
    audio_data = (audio_data * 32767).astype(np.int16)

    # Create BytesIO object
    wav_buffer = io.BytesIO()

    with wave.open(wav_buffer, 'wb') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(audio_data.tobytes())

    wav_buffer.seek(0)
    return wav_buffer


def read_codec(source: bytes, codec: str, sample_rate: int = sample_rate) -> np.ndarray:
    process = (
        ffmpeg
        .input('pipe:', codec=codec)
        .output(
            'pipe:',
            format='wav',
            acodec='pcm_s16le',
            ar=str(sample_rate),
            ac=1,
        )
        .overwrite_output()
        .run_async(
            pipe_stdin=True,
            pipe_stdout=True,
            pipe_stderr=True,
        )
    )

    output_data, stderr = process.communicate(input=source)

    if process.returncode != 0:
        raise Exception(f"ffmpeg failed with: {stderr.decode()}")
    return wav_to_array(io.BytesIO(output_data))


def server_side_cursor_find(
        collection: str,
        filter: dict,
        sort: list[tuple[str, int]],
        batch_size: int = 100,
):
    resp = call_resource('tech.mycelia.mongo', {
        "action": "createCursor",
        "collection": collection,
        "filter": filter,
        "sort": sort,
        "batchSize": batch_size,
    })
    cursor_id = resp["cursor_id"]

    while True:
        batch = call_resource('tech.mycelia.mongo', {
            "action": "getMore",
            "collection": collection,
            "cursor_id": cursor_id,
            "batchSize": batch_size,
        })
        docs = batch["documents"]
        if not docs:
            break
        for doc in docs:
            yield doc
    



class AudioChunkReader:
    cursor: datetime

    def __init__(
            self,
            *,
            filter_chunks: dict,
            start_at,
            fetch_batch_size: int,
            sample_rate: int,
        ):
        self.sample_rate = sample_rate
        if isinstance(start_at, (int, float)):
            self.cursor = datetime.fromtimestamp(start_at, tz=UTC)
        elif isinstance(start_at, datetime):
            self.cursor = start_at
        else:
            raise ValueError("start_at must be a float (UTC timestamp) or datetime object.")
        self.chunks = db_collection.find(
            {
                **filter_chunks,
                "start": {"$gt": self.cursor - CHUNK_MAX_LEN - timedelta(seconds=1)}
            }
        ).sort("start", 1).batch_size(fetch_batch_size)

    def read(self, duration: int | float | timedelta = None, **kwargs) -> np.array:
        """
        Read audio chunks from the database and concatenate them into a single array.

        The resulting array might be longer than the requested duration
        """
        assert not (duration and kwargs), "Only one of duration or kwargs can be provided."

        if isinstance(duration, (int, float)):
            duration = timedelta(seconds=duration)
        elif kwargs:
            duration = timedelta(**kwargs)

        start = self.cursor
        result = []

        while self.cursor - start < duration:
            try:
                chunk = self.chunks.next()
            except StopIteration:
                break
            audio = read_codec(chunk["data"], codec="opus", sample_rate=self.sample_rate)
            chunk_duration = timedelta(seconds=len(audio) / self.sample_rate)
            diff = int(
                (chunk["start"] - self.cursor).total_seconds()
                * self.sample_rate
            )

            if diff > 0:
                # gap between chunks, insert silence
                result.append(np.zeros(diff, dtype=np.float32))
            elif diff < 0:
                # chunk starts in the past
                if result:
                    # combine overlap with prev chunk
                    overlap = -diff
                    prev = result[-1]
                    result[-1] = prev[:overlap]
                    result.append(np.mean([prev[overlap:], audio[:overlap]], axis=0))
                audio = audio[-diff:]

            result.append(audio)

            self.cursor = chunk["start"] + chunk_duration


        return np.concatenate(result, axis=0, dtype=np.float32)


def fetch_audio(
        start: datetime,
        duration: timedelta,
        *,
        filter_chunks: dict | None = None,
        prefetch_chunks: int = 10,
        sample_rate: int = sample_rate,
    ) -> io.BytesIO:

    reader = AudioChunkReader(
        filter_chunks=filter_chunks or {},
        start_at=start,
        fetch_batch_size=prefetch_chunks,
        sample_rate=sample_rate,
    )
    result = reader.read(duration)
    return array_to_wav(result[:int(duration.total_seconds() * sample_rate)])


def ingest_source(original: dict):
    path = original["path"]
    tmp_dir = get_tmp_dir(path)
    try:
        logger.info("splitting '%s' into chunks", path)
        chunk_files = split_to_opus_chunks(path)
        start: datetime = original["start"]
        logger.info("ingesting %s chunks of '%s'",len(chunk_files), path)

        for i, [offset, file] in enumerate(chunk_files):
            with open(file, "rb") as f:
                call_resource('tech.mycelia.mongo', {
                    "action": "insertOne",
                    "collection": "audio_chunks",
                    "doc": {
                        "format": "opus",
                        "original_id": original["_id"],
                        "index": i,
                        "ingested_at": {
                            "$date": datetime.now(tz=UTC).isoformat()
                        },
                        "start": start + offset,
                        "data": {
                            "$binary": { "base64": base64.b64encode(f.read()).decode(), "subType": "00"}
                        },
                    }
                })
    finally:
        shutil.rmtree(tmp_dir)