import io
import time
import wave
import os
import argparse
import requests
import concurrent.futures
from concurrent.futures import ThreadPoolExecutor

from utils import lazy, mongo

STT_SERVER_URL = os.environ.get('STT_SERVER_URL', 'http://localhost:8087')

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

from pydantic import BaseModel
from datetime import datetime, timedelta
from bson import ObjectId
from typing import Any, Optional, List

class SpeechSequence(BaseModel):
    original_id: ObjectId
    chunks: list[Any] = [] 
    
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
            
        

def get_speech_sequences(limit=10, filters=None) -> Iterator[SpeechSequence]:
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
        seq = sequences_by_id.get(original_id)

        print(original_id, chunk['index'], seq and seq.min_index)

        if seq and seq.min_index - 1 != chunk['index']:
            assert chunk not in seq.chunks
            print('index mismatch', chunk['original_id'])
            print(chunk['_id'], [c['_id'] for c in seq.chunks])
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
        
        
        if i % 5 == 0:
            for existing_id, seq in tuple(sequences_by_id.items()):
                if seq.start - start> timedelta(seconds=20):
                    yield seq
                    yielded += 1
                    del sequences_by_id[existing_id]
    
    if limit is None:
        for seq in sequences_by_id.values():
            yield seq


def process_sequence(sequence: SpeechSequence):
    try:
        print(f'{sequence.start.strftime("%Y-%m-%d %H:%M:%S")}\tlen {len(sequence.chunks)} chunks\t started')
        start = time.time()
        text = transcribe_sequence(sequence)

        # Only mark as transcribed if we got a result (even if empty string)
        # text is None only for actual failures (network errors, etc.)
        if text is not None:
            mark_as_transcribed(sequence)
            end = time.time()
            status = "transcribed" if text.strip() else "no speech detected"
            print(f'{sequence.start.strftime("%Y-%m-%d %H:%M:%S")}\tlen {len(sequence.chunks)} chunks\ttook {end - start}s - {status}', repr(text))
            return True
        else:
            end = time.time()
            print(f'{sequence.start.strftime("%Y-%m-%d %H:%M:%S")}\tlen {len(sequence.chunks)} chunks\ttook {end - start}s - transcription failed')
            return False
    except Exception as e:
        print(f"Error processing sequence starting at {sequence.start}: {e}")
        return False
        

def process_speech_sequences(limit=None, max_workers=1):
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = []
        for sequence in get_speech_sequences(limit=limit):
            futures.append(executor.submit(process_sequence, sequence))
            print(f'{len(futures)} futures scheduled')
            while futures:
                futures = [f for f in futures if not f.done()]
                time.sleep(0.1)
        
    


def transcribe_sequence(sequence: SpeechSequence):
    try:
        response = requests.post(f'{STT_SERVER_URL}/transcribe', files=[
            ('files', (f'chunk_{i}.opus', io.BytesIO(chunk['data']), 'audio/opus'))
            for i, chunk in enumerate(reversed(sequence.chunks))
        ])
        response.raise_for_status()  # Raise an exception for bad status codes

        transcript = response.json()

        # Extract segments (could be empty, which is valid)
        segments = transcript.get('segments', [])

        # Calculate duration from segments if available, otherwise use 0
        duration = 0.0
        if segments:
            duration = segments[-1]['end']

        # Store the transcription (even if empty segments - no speech is valid)
        transcription_data = {
            'original': sequence.original_id,
            'start': sequence.start,
            'duration': duration,
            'end': sequence.start + timedelta(seconds=duration),
            **transcript
        }

        transcriptions.insert_one(transcription_data)

        # Return the transcribed text (empty string if no segments)
        transcribed_text = ' '.join(segment['text'] for segment in segments)
        return transcribed_text

    except requests.RequestException as e:
        print(f"Request error transcribing sequence starting at {sequence.start}: {e}")
        return None
    except Exception as e:
        print(f"Unexpected error transcribing sequence starting at {sequence.start}: {e}")
        return None



def mark_as_transcribed(seq: SpeechSequence):
    chunks.update_many(
        {
            '_id': {'$in': [chunk['_id'] for chunk in seq.chunks]}
        },
        {'$set': {'transcribed_at': datetime.now(tz=UTC)}}
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=None)
    args = parser.parse_args()
    process_speech_sequences(limit=args.limit, max_workers=5)
