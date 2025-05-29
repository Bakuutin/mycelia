from chunking import (
    audio_chunks_collection, read_codec,
    sample_rate
)
from datetime import datetime, UTC
from pymongo.collection import Collection

from utils import mongo
import logging

from tqdm import tqdm
import torch
from pymongo import UpdateOne

logger = logging.getLogger('diarization')


diarization_coll: Collection =  mongo['diarizations']


model, utils = torch.hub.load(repo_or_dir='snakers4/silero-vad',
                             model='silero_vad',
                             )

(get_speech_timestamps,
 save_audio,
 read_audio,
 VADIterator,
 collect_chunks) = utils


vad_threshold = 0.5


@torch.no_grad()
def get_voice_prob(audio):
    tensor = torch.from_numpy(audio).float()
    sampling_rate: int = 16000
    window_size_samples: int = 512

    model.reset_states()

    audio_length_samples = len(audio)
    max_prob = 0
    for current_start_sample in range(0, audio_length_samples, window_size_samples):
        chunk = tensor[current_start_sample: current_start_sample + window_size_samples]
        if len(chunk) < window_size_samples:
            chunk = torch.nn.functional.pad(chunk, (0, int(window_size_samples - len(chunk))))
        speech_prob = model(chunk, sampling_rate).item()
        if speech_prob > max_prob:
            max_prob = speech_prob
    return max_prob



def run_voice_activity_detection(limit=1000):
    cursor = audio_chunks_collection.find(
        {   
            "vad": None,
        },
        sort=[("start", -1)],
        batch_size=300,
        limit=limit,
    )
    updates = []
    has_speech = 0
    pbar = tqdm(cursor, total=limit, unit="chunks")
    for i, chunk in enumerate(pbar):
        audio = read_codec(chunk["data"], codec="opus", sample_rate=sample_rate)
        prob = get_voice_prob(audio)
        updates.append(UpdateOne(
            {"_id": chunk["_id"]},
            {
                "$set": {
                    "vad.ran_at": datetime.now(UTC),
                    "vad.prob": prob,
                    "vad.has_speech": prob > vad_threshold,
                },
            }
        ))
        has_speech += prob > vad_threshold
        pbar.set_postfix({
            'has_speech': f"{(has_speech / (i+1)) * 100:.1f}%",
            'ts': chunk['start'].replace(microsecond=0).isoformat(),
        })
        if len(updates) >= 30:
            audio_chunks_collection.bulk_write(updates)
            updates = []

        if limit and i >= limit:
            break
    
    # Process any remaining updates
    if updates:
        audio_chunks_collection.bulk_write(updates)

