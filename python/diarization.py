from chunking import (
    audio_chunks_collection, read_codec,
    sample_rate
)
from datetime import datetime, UTC
from pymongo.collection import Collection

from utils import mongo
import logging


import time
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


def run_voice_activity_detection(limit=1000, verbose_logs=False):

    total_chunks = audio_chunks_collection.estimated_document_count()

    if verbose_logs:
        # very slow on large collections
        pending_chunks = audio_chunks_collection.count_documents({"vad": None})

        processed_chunks = total_chunks - pending_chunks

        if pending_chunks == 0:
            logger.info(f"✓ VAD complete: {processed_chunks}/{total_chunks} chunks processed")
            return

        chunks_to_process = min(limit, pending_chunks) if limit else pending_chunks
        logger.info(f"Starting VAD: {chunks_to_process} chunks to process, {processed_chunks} already processed (Total: {total_chunks} chunks)")
    else:
        chunks_to_process = limit
        processed_chunks = total_chunks - limit

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
    start_time = time.time()
    pbar = tqdm(cursor, total=chunks_to_process, unit="chunks")
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
        current_overall = processed_chunks + (i + 1)

        elapsed_time = time.time() - start_time
        chunks_processed_now = i + 1
        speed = chunks_processed_now / elapsed_time if elapsed_time > 0 else 0

        remaining_overall = total_chunks - current_overall
        eta_seconds = remaining_overall / speed if speed > 0 else 0

        if eta_seconds < 60:
            eta_str = f"{int(eta_seconds)}s"
        elif eta_seconds < 3600:
            eta_str = f"{int(eta_seconds / 60)}m {int(eta_seconds % 60)}s"
        else:
            hours = int(eta_seconds / 3600)
            minutes = int((eta_seconds % 3600) / 60)
            eta_str = f"{hours}h {minutes}m"

        pbar.set_postfix({
            'overall': f"{current_overall}/{total_chunks}",
            'eta_all': eta_str,
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

    if verbose_logs:
        new_processed_chunks = processed_chunks + (i + 1)
        logger.info(f"VAD batch complete: {i + 1} chunks processed, {has_speech} with speech ({(has_speech / (i+1)) * 100:.1f}%)")
        logger.info(f"Overall VAD status: {new_processed_chunks}/{total_chunks} chunks processed")
