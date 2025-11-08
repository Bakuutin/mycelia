from chunking import ( read_codec,
    sample_rate
)
from datetime import datetime, UTC

import logging

from lib.resources import call_resource
import time
from tqdm import tqdm
import torch

logger = logging.getLogger('diarization')



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

def apply_updates(updates):
    call_resource('tech.mycelia.mongo', {
        "action": "bulkWrite",
        "collection": "audio_chunks",
        "operations": [
            {
                "updateOne": {
                    "filter": {"_id": id},
                    "update": update,
                }
            } for id, update in updates
        ],
    })


def run_voice_activity_detection(limit=1000, verbose_logs=False):

    chunks_to_process = limit
    processed_chunks = 0

    cursor = call_resource('tech.mycelia.mongo', {
        "action": "find",
        "collection": "audio_chunks",
        "query": {
            "vad": None,
        },
        "sort": [("start", -1)],
        "limit": limit,
    })
    updates = []
    has_speech = 0
    start_time = time.time()
    pbar = tqdm(cursor, total=chunks_to_process, unit="chunks")
    for i, chunk in enumerate(pbar):
        audio = read_codec(chunk["data"], codec="opus", sample_rate=sample_rate)
        prob = get_voice_prob(audio)
        updates.append((
            chunk["_id"],
            {
                "$set": {
                    "vad.ran_at": datetime.now(UTC),
                    "vad.prob": prob,
                    "vad.has_speech": prob > vad_threshold,
                },
            }
        ))
        has_speech += prob > vad_threshold
        current_overall = processed_chunks + (i + 1)

        
        pbar.set_postfix({
            'has_speech': f"{(has_speech / (i+1)) * 100:.1f}%",
            'ts': chunk['start'].replace(microsecond=0).isoformat(),
        })
        if len(updates) >= 30:
            apply_updates(updates)
            updates = []

        if limit and i >= limit:
            break

    # Process any remaining updates
    if updates:
        apply_updates(updates)

    if verbose_logs:
        new_processed_chunks = processed_chunks + (i + 1)
        logger.info(f"VAD batch complete: {i + 1} chunks processed, {has_speech} with speech ({(has_speech / (i+1)) * 100:.1f}%)")
        logger.info(f"Overall VAD status: {new_processed_chunks}/{total_chunks} chunks processed")
