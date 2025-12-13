import time
import torch
from datetime import datetime, UTC
from typing import Dict, Any, Callable
from lib.resources import call_resource
from chunking import read_codec, sample_rate

model, utils = torch.hub.load(
    repo_or_dir='snakers4/silero-vad',
    model='silero_vad',
)

(get_speech_timestamps,
 save_audio,
 read_audio,
 VADIterator,
 collect_chunks) = utils

VAD_THRESHOLD = 0.5


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
    call_resource('mongo', {
        "action": "bulkWrite",
        "collection": "audio_chunks",
        "operations": [
            {
                "updateOne": {
                    "filter": {"_id": chunk_id},
                    "update": update,
                }
            } for chunk_id, update in updates
        ],
    })


def process_vad_job(job_id: str, data: Dict[str, Any], progress_callback: Callable) -> Dict[str, Any]:
    start_time = time.time()

    limit = data.get("limit", 1000)
    batch_size = data.get("batchSize", 100)
    original_id = data.get("originalId")
    start_date = data.get("start")
    end_date = data.get("end")

    query = {
        "vad": None,
    }

    if original_id:
        query["original_id"] = original_id

    if start_date or end_date:
        query["start"] = {}
        if start_date:
            query["start"]["$gte"] = {"$date": start_date}
        if end_date:
            query["start"]["$lte"] = {"$date": end_date}

    result = call_resource('mongo', {
        "action": "getFirstBatch",
        "collection": "audio_chunks",
        "query": query,
        "options": {
            "sort": {"start": -1},
        },
        "batchSize": min(batch_size, limit) if limit else batch_size,
    })

    cursor_id = result.get("cursorId", "")
    has_more = result.get("hasMore", False)
    chunks = result.get("data", [])

    updates = []
    has_speech = 0
    total_processed = 0

    progress_callback({
        "processed": 0,
        "total": limit,
        "hasSpeech": 0,
    })

    while chunks:
        for chunk in chunks:
            if limit and total_processed >= limit:
                break

            audio = read_codec(chunk["data"], codec="opus", sample_rate=sample_rate)
            prob = get_voice_prob(audio)
            updates.append((
                chunk["_id"],
                {
                    "$set": {
                        "vad.ran_at": datetime.now(UTC),
                        "vad.prob": prob,
                        "vad.has_speech": prob > VAD_THRESHOLD,
                    },
                }
            ))
            has_speech += prob > VAD_THRESHOLD
            total_processed += 1

            if len(updates) >= 30:
                apply_updates(updates)
                updates = []

                progress_callback({
                    "processed": total_processed,
                    "total": limit,
                    "hasSpeech": has_speech,
                    "currentTimestamp": chunk.get('start', datetime.now(UTC)).isoformat() if 'start' in chunk else None,
                })

        if limit and total_processed >= limit:
            break

        if has_more and cursor_id:
            result = call_resource('mongo', {
                "action": "getMore",
                "collection": "audio_chunks",
                "cursorId": cursor_id,
                "batchSize": min(batch_size, limit - total_processed) if limit else batch_size,
            })
            has_more = result.get("hasMore", False)
            chunks = result.get("data", [])
        else:
            chunks = []

    if updates:
        apply_updates(updates)

    duration = time.time() - start_time

    progress_callback({
        "processed": total_processed,
        "total": total_processed,
        "hasSpeech": has_speech,
    })

    return {
        "processed": total_processed,
        "hasSpeech": has_speech,
        "duration": duration,
    }
