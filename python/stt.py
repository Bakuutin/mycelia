import io
import time
import wave
import os
import argparse
import requests
import concurrent.futures
from concurrent.futures import ThreadPoolExecutor
from lib.config import get_url

from lib.transcription import known_errors, remove_if_lonely
from utils import lazy, mongo

STT_SERVER_URL = os.environ.get('STT_SERVER_URL', 'http://localhost:8087').rstrip('/')

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



def get_speech_sequences(limit=10, filters=None, max_sequence_length=30) -> Iterator[SpeechSequence]:
    print('getting speech sequences')
    sequences_by_id: dict[ObjectId, SpeechSequence] = {}
    yielded = 0

    base_filters = {
        'transcribed_at': {'$eq': None},
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
                print(f"Error creating speech sequence for {original_id}: {e}")
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
    else:
        print(f'{len(sequences_by_id)} sequences left to yield')
        for seq in sequences_by_id.values():
            print(seq.start.strftime("%Y-%m-%d %H:%M:%S"), len(seq.chunks))


def process_sequence(sequence: SpeechSequence):
    try:
        print(f'{sequence.start.strftime("%Y-%m-%d %H:%M:%S")}\tlen {len(sequence.chunks)} chunks\tOriginalId {str(sequence.original_id)}\t started')
        start = time.time()
        result = transcribe_sequence(sequence)
        mark_as_transcribed(sequence)
        end = time.time()
        print(f'{sequence.start.strftime("%Y-%m-%d %H:%M:%S")}\tlen {len(sequence.chunks)} chunks\ttook {end - start}s {"empty" if result is NO_SPEECH_DETECTED else "transcribed"}')
    except Exception as e:
        print(f"Error processing sequence starting at {sequence.start}: {e}")



def process_speech_sequences(limit=None, max_workers=1):
    processed_count = 0
    batch_size = min(limit, 1000) if limit is not None else 1000

    while True:
        for sequence in get_speech_sequences(limit=batch_size):
            process_sequence(sequence)
            processed_count += 1
            if limit and processed_count >= limit:
                return
    # while limit is None or processed_count < limit:
    #     with ThreadPoolExecutor(max_workers=max_workers) as executor:
    #         futures = []
    #         for sequence in get_speech_sequences(limit=batch_size):
    #             futures.append(executor.submit(process_sequence, sequence))
    #             print(f'{len(futures)} futures scheduled')
    #             while len(futures) >= max_workers:
    #                 done, not_done = concurrent.futures.wait(futures, timeout=0.1)
    #                 futures = list(not_done)
    #                 processed_count += len(done)


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
    process_speech_sequences(limit=args.limit, max_workers=5)
