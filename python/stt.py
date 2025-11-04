import io
import time
import wave
import os
import argparse
import requests
import concurrent.futures
from concurrent.futures import ThreadPoolExecutor
import logging
from logging.handlers import RotatingFileHandler
from tqdm import tqdm
from lib.config import get_url

from lib.transcription import known_errors, remove_if_lonely
from utils import lazy, mongo

STT_SERVER_URL = os.environ.get('STT_SERVER_URL', 'http://localhost:8087').rstrip('/')

LOG_DIR = os.path.join(os.path.dirname(__file__), 'logs')
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    handlers=[
        RotatingFileHandler(
            os.path.join(LOG_DIR, 'stt.log'),
            maxBytes=10*1024*1024,
            backupCount=5
        ),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

from pydantic import BaseModel
from datetime import datetime
from bson import ObjectId
from datetime import timedelta
from typing import Any, Iterator
from pytz import UTC

import signal

signal.signal(signal.SIGINT, signal.SIG_DFL)



chunks = lazy(lambda: mongo['audio_chunks'])
transcriptions = lazy(lambda: mongo['transcriptions'])

NO_SPEECH_DETECTED = object()

class SpeechSequence(BaseModel):
    original_id: ObjectId
    chunks: list[Any] = []
    is_partial: bool = False
    is_continuation: bool = False

    class Config:
        arbitrary_types_allowed = True

    @property
    def last(self) -> Any:
        return self.chunks[-1]

    @property
    def start(self) -> datetime:
        return self.last['start']

    @property
    def min_index(self) -> int:
        return self.last['index']

    def __repr__(self):
        indices = [chunk['index'] for chunk in self.chunks]
        return f'{self.original_id}: {repr(indices)}'



def get_speech_sequences(limit=10, filters=None, max_sequence_length=30, worker_id=None) -> Iterator[SpeechSequence]:
    sequences_by_id: dict[ObjectId, SpeechSequence] = {}
    yielded = 0

    base_filters = {
        'transcribed_at': {'$eq': None},
        'processing_by': {'$eq': None},
        'vad.has_speech': True
    }

    if filters:
        base_filters.update(filters)

    cursor = chunks.find(base_filters).sort('start', -1)

    for i, chunk in enumerate(cursor):
        if limit is not None and yielded >= limit:
            break

        original_id = chunk['original_id']
        start = chunk['start']


        for existing_id, seq in tuple(sequences_by_id.items()):
            if seq.start - start > timedelta(seconds=600):
                if not seq.is_continuation or len(seq.chunks) > 1:
                    yield seq
                    yielded += 1
                del sequences_by_id[existing_id]


        seq = sequences_by_id.get(original_id)



        if seq and seq.min_index - 1 != chunk['index']:
            assert chunk not in seq.chunks
            yield seq
            del sequences_by_id[original_id]
            yielded += 1
            continue

        if original_id not in sequences_by_id:
            try:
                seq = sequences_by_id[original_id] = SpeechSequence(
                start=start,
                original_id=original_id,
                chunks=[]
            )
            except Exception as e:
                tqdm.write(f"ERROR: Creating speech sequence for {original_id}: {e}")
                continue

        seq.chunks.append(chunk)

        if len(seq.chunks) >= max_sequence_length:
            seq.is_partial = True
            yield seq
            yielded += 1
            sequences_by_id[original_id] = SpeechSequence(
                start=chunk['start'],
                original_id=original_id,
                chunks=[chunk],
                is_continuation=True,
            )



    if limit is None or yielded < limit:
        for seq in sequences_by_id.values():
            yield seq


def claim_sequence(seq: SpeechSequence, worker_id: str) -> bool:
    result = chunks.update_many(
        {
            '_id': {'$in': [chunk['_id'] for chunk in seq.chunks]},
            'processing_by': None
        },
        {'$set': {'processing_by': worker_id, 'claimed_at': datetime.now(tz=UTC)}}
    )
    return result.modified_count == len(seq.chunks)


def release_sequence(seq: SpeechSequence):
    chunks.update_many(
        {
            '_id': {'$in': [chunk['_id'] for chunk in seq.chunks]}
        },
        {'$set': {'processing_by': None, 'claimed_at': None}}
    )


def process_sequence(sequence: SpeechSequence, worker_id: str):
    start_time = time.time()
    timestamp = sequence.start.strftime("%Y-%m-%d %H:%M:%S")
    chunks_count = len(sequence.chunks)
    original_id = str(sequence.original_id)

    try:
        if not claim_sequence(sequence, worker_id):
            tqdm.write(f'{timestamp}  {chunks_count:3d} chunks  {original_id}  skipped (claimed)')
            return {"status": "skipped", "chunks": 0, "duration": 0}

        result = transcribe_sequence(sequence)
        mark_as_transcribed(sequence)

        end_time = time.time()
        duration = end_time - start_time
        status = "empty" if result is NO_SPEECH_DETECTED else "transcribed"
        tqdm.write(f'{timestamp}  {chunks_count:3d} chunks  {original_id}  {duration:5.2f}s  {status}')
        return {"status": status, "chunks": chunks_count, "duration": duration}

    except requests.exceptions.ReadTimeout as e:
        end_time = time.time()
        release_sequence(sequence)
        tqdm.write(f'{timestamp}  {chunks_count:3d} chunks  {original_id}  ERROR: ReadTimeout')
        tqdm.write(f'  → Increase timeout or check STT server at {STT_SERVER_URL}')
        return {"status": "error", "chunks": 0, "duration": end_time - start_time}

    except Exception as e:
        end_time = time.time()
        release_sequence(sequence)
        tqdm.write(f'{timestamp}  {chunks_count:3d} chunks  {original_id}  ERROR: {str(e)}')
        return {"status": "error", "chunks": 0, "duration": end_time - start_time}



def process_speech_sequences(limit=None, max_workers=1, worker_id=None):
    import socket
    if worker_id is None:
        worker_id = f"{socket.gethostname()}_{os.getpid()}"

    tqdm.write(f'Worker ID: {worker_id}')
    tqdm.write(f'Using {max_workers} parallel worker(s)')

    processed_count = 0
    stats = {'transcribed': 0, 'empty': 0, 'error': 0, 'skipped': 0}
    total_chunks = 0
    batch_size = min(limit if limit else 1000, 1000)

    total = limit if limit else None
    bar_format = '{n_fmt}/{total_fmt} [{elapsed}<{remaining}, {rate_fmt}, {postfix}]' if total else '{n_fmt} [{elapsed}, {rate_fmt}, {postfix}]'

    with tqdm(total=total, desc="Processing", unit="seq", bar_format=bar_format) as pbar:

        if max_workers == 1:
            while True:
                batch_processed = 0
                for sequence in get_speech_sequences(limit=batch_size, worker_id=worker_id):
                    result = process_sequence(sequence, worker_id)
                    status = result["status"]

                    if status in stats:
                        stats[status] += 1

                    total_chunks += result["chunks"]

                    if status != "skipped":
                        processed_count += 1
                        batch_processed += 1

                    pbar.update(1)
                    pbar.set_postfix(
                        transcribed=stats['transcribed'],
                        empty=stats['empty'],
                        errors=stats['error'],
                        skipped=stats['skipped'],
                        chunks=total_chunks
                    )

                    if limit and processed_count >= limit:
                        break

                if limit and processed_count >= limit:
                    break

                if batch_processed == 0:
                    tqdm.write("\nNo more sequences to process")
                    break
        else:
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                while True:
                    sequences = list(get_speech_sequences(limit=batch_size, worker_id=worker_id))
                    if not sequences:
                        tqdm.write("\nNo more sequences to process")
                        break

                    futures = {executor.submit(process_sequence, seq, worker_id): seq for seq in sequences}

                    for future in concurrent.futures.as_completed(futures):
                        result = future.result()
                        status = result["status"]

                        if status in stats:
                            stats[status] += 1

                        total_chunks += result["chunks"]

                        if status != "skipped":
                            processed_count += 1

                        pbar.update(1)
                        pbar.set_postfix(
                            transcribed=stats['transcribed'],
                            empty=stats['empty'],
                            errors=stats['error'],
                            skipped=stats['skipped'],
                            chunks=total_chunks
                        )

                        if limit and processed_count >= limit:
                            break

                    if limit and processed_count >= limit:
                        break

    tqdm.write("\n" + "=" * 80)
    tqdm.write(f"Completed: {processed_count} sequences, {total_chunks} chunks")
    tqdm.write(f"Stats: transcribed={stats['transcribed']}, empty={stats['empty']}, errors={stats['error']}, skipped={stats['skipped']}")
    tqdm.write("=" * 80)


def transcribe_sequence(sequence: SpeechSequence):
    headers = {}
    api_key = os.environ.get('STT_API_KEY')
    if api_key:
        headers['X-Api-Key'] = api_key

    response = requests.post(f'{STT_SERVER_URL}/transcribe',
                            files=[
                                ('files', (f'chunk_{i}.opus', io.BytesIO(chunk['data']), 'audio/opus'))
                                for i, chunk in enumerate(reversed(sequence.chunks))
                            ],
                            headers=headers,
                            timeout=300 + len(sequence.chunks) * 3
    )
    response.raise_for_status()  # Raise an exception for bad status codes

    transcript = response.json()

    # Extract segments (could be empty, which is valid)
    segments = transcript.get('segments', [])

    # Filter out known errors and asterisk patterns to prevent cleanup need
    # This matches the filtering logic in cleanup.py but applied during transcription
    filtered_segments = []
    for segment in segments:
        text = segment.get('text', '').strip().lower()

        if (
            not text or
            text in known_errors or
            text.startswith('*') and text.endswith('*')
        ):
            continue

        filtered_segments.append(segment)

    if not filtered_segments or all(
        segment['text'].strip() in remove_if_lonely for segment in filtered_segments
    ):
        return NO_SPEECH_DETECTED


    transcript['segments'] = segments = filtered_segments

    # Calculate duration from filtered segments if available, otherwise use 0
    duration = 0.0
    if segments:
        duration = segments[-1]['end']

        transcription_data = {
            'original': sequence.original_id,
            'start': sequence.start,
            'duration': duration,
            'end': sequence.start + timedelta(seconds=duration),
            **transcript
        }

        transcriptions.insert_one(transcription_data)

    transcribed_text = ''.join(segment['text'] for segment in segments)
    return transcribed_text



def mark_as_transcribed(seq: SpeechSequence):
    chunks_to_mark = seq.chunks[:-1] if seq.is_partial else seq.chunks
    if chunks_to_mark:
        chunks.update_many(
            {
                '_id': {'$in': [chunk['_id'] for chunk in chunks_to_mark]}
            },
            {'$set': {'transcribed_at': datetime.now(tz=UTC)}}
        )


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=None)
    args = parser.parse_args()
    process_speech_sequences(limit=args.limit, max_workers=1)
