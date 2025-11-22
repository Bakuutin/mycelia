#%%
from discovery import Importer

import logging
from datetime import datetime, UTC
from diarization import run_voice_activity_detection
import time
import json

import platform

import io
from pydub import AudioSegment
from datetime import timedelta

from lib.resources import call_resource


import settings

#%%

logger = logging.getLogger('daemon')

import os
log_dir = os.path.expanduser('~/Library/mycelia/logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, 'daemon.log')
summary_log_file = os.path.join(log_dir, 'daemon.summary.log')

console = logging.StreamHandler()
console.setLevel(logging.INFO)

file_handler = logging.FileHandler(log_file)
file_handler.setLevel(logging.DEBUG)

formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
console.setFormatter(formatter)
file_handler.setFormatter(formatter)

logging.basicConfig(level=logging.DEBUG, handlers=[console, file_handler])

summary_logger = logging.getLogger('daemon.summary')
summary_logger.setLevel(logging.INFO)
if not summary_logger.handlers:
    summary_handler = logging.FileHandler(summary_log_file)
    summary_handler.setLevel(logging.INFO)
    summary_handler.setFormatter(logging.Formatter('%(message)s'))
    summary_logger.addHandler(summary_handler)
summary_logger.propagate = False

logger.info(f"Logging to {log_file}")
logger.info(f"Cycle summaries recorded in {summary_log_file}")


def _serialize(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def record_cycle_summary(summary: dict):
    summary_logger.info(json.dumps(summary, default=_serialize))


def count_source_files(query=None):
    return call_resource('tech.mycelia.mongo', {
        "action": "count",
        "collection": "source_files",
        "query": query or {},
    })


def count_pending_vad_chunks():
    return call_resource('tech.mycelia.mongo', {
        "action": "count",
        "collection": "audio_chunks",
        "query": {"vad": None},
    })


def import_new_files():
    total_before = count_source_files()
    summary = {
        "importer_count": len(settings.importers),
        "errors": 0,
        "new_files": 0,
        "sources": [],
    }

    for importer in settings.importers:
        check_time = datetime.now(UTC)
        try:
            new_count = importer.run(quiet=True)
        except Exception:
            summary["errors"] += 1
            logger.exception('Error importing files via %s', importer.code)
            summary["sources"].append({
                "code": importer.code,
                "new_files": 0,
                "checked_at": check_time,
            })
            continue
        summary["new_files"] += new_count
        summary["sources"].append({
            "code": importer.code,
            "new_files": new_count,
            "checked_at": check_time,
        })

    total_after = count_source_files()
    summary["total_files"] = total_after
    return summary


importer_map = {importer.code: importer for importer in settings.importers}
unknown_importer = Importer(code="unknown")


def ingests_missing_sources(limit=None, retry_errors=False):
    base_query = {
        "ingested": False,
        "$or": [
            {
                "path": {"$exists": True},
                "platform.node": platform.node(),
            },
            {"platform.importer": {"$in": list(importer_map.keys())}},
        ],
    }

    if not retry_errors:
        base_query["ingestion.error"] = {"$exists": False}

    total_pending = call_resource('tech.mycelia.mongo', {
        "action": "count",
        "collection": "source_files",
        "query": base_query
    })

    already_ingested = call_resource('tech.mycelia.mongo', {
        "action": "count",
        "collection": "source_files",
        "query": {"ingested": True}
    })

    errored_count = call_resource('tech.mycelia.mongo', {
        "action": "count",
        "collection": "source_files",
        "query": {
            "ingested": False,
            "ingestion.error": {"$exists": True}
        }
    })

    total_files = already_ingested + total_pending + errored_count
    summary = {
        "pending": total_pending,
        "ingested": already_ingested,
        "errored": errored_count,
        "total": total_files,
        "processed": 0,
        "errors": 0,
        "limit": limit,
        "remaining": total_pending,
    }

    if total_pending == 0:
        if errored_count > 0:
            logger.debug(f"✓ Ingestion complete: {already_ingested}/{total_files} files successfully ingested, {errored_count} errored files cached")
        else:
            logger.debug(f"✓ Ingestion complete: {already_ingested}/{total_files} files successfully ingested")
        summary["status"] = "idle"
        summary["remaining"] = 0
        return summary

    logger.info(f"Starting ingestion: {total_pending} pending, {already_ingested} already ingested, {errored_count} errored (Total: {total_files} files)")

    query = call_resource('tech.mycelia.mongo', {
        "action": "find",
        "collection": "source_files",
        "query": base_query,
        "sort": [('start', -1)],
        "limit": limit,
    })

    processed = 0
    errors = 0

    for idx, source in enumerate(query, 1):
        file_path = source.get('path', str(source['_id']))
        file_name = os.path.basename(file_path) if 'path' in source else str(source['_id'])

        logger.info(f"Processing [{idx}/{min(limit or total_pending, total_pending)}]: {file_name}")

        try:
            importer = importer_map.get(
                source['platform'].get('importer'),
                unknown_importer
            )
            importer.upload(source)
            call_resource('tech.mycelia.mongo', {
                "action": "updateOne",
                "collection": "source_files",
                "query": {"_id": source["_id"]},
                "update": {"$set": {
                "ingested": True,
                "ingested_at": datetime.now(tz=UTC),
            }}
            })
            processed += 1
            logger.info(f"✓ Successfully ingested: {file_name}")
        except Exception as e:
            errors += 1
            error_msg = str(e)
            logger.error(f"✗ Error ingesting {file_name}: {error_msg[:100]}")

            call_resource('tech.mycelia.mongo', {
                "action": "updateOne",
                "collection": "source_files",
                "query": {"_id": source["_id"]},
                "update": {"$set": {
                    "ingestion": {
                        "error": error_msg,
                        "last_attempt": datetime.now(tz=UTC),
                    }
                }}
            })

    remaining = total_pending - processed - errors
    new_ingested_total = already_ingested + processed
    new_errored_total = errored_count + errors
    logger.info(f"Batch complete: {processed} processed, {errors} errors, {remaining} remaining")
    logger.info(f"Overall status: {new_ingested_total}/{total_files} ingested, {new_errored_total} errored")
    summary.update({
        "processed": processed,
        "errors": errors,
        "remaining": remaining,
        "ingested": new_ingested_total,
        "errored": new_errored_total,
        "status": "working" if remaining > 0 else "caught_up",
    })
    return summary


def run_vad_stage(limit=1000):
    pending_before = count_pending_vad_chunks()
    summary = {
        "pending_before": pending_before,
        "pending_after": pending_before,
        "processed": 0,
    }

    if pending_before == 0:
        logger.debug("No audio chunks waiting for VAD")
        summary["status"] = "idle"
        return summary

    logger.debug(f"Pending VAD chunks: {pending_before}. Processing up to {limit or '∞'} per cycle.")

    target = pending_before if not limit else min(limit, pending_before) or limit
    progress_state = {
        "last_logged": 0,
        "last_time": 0.0,
    }

    def log_progress(progress: dict):
        processed = progress.get("processed", 0)
        if processed <= progress_state["last_logged"]:
            return

        now = time.time()
        if processed - progress_state["last_logged"] < 25 and (now - progress_state["last_time"]) < 10:
            return

        speech_count = progress.get("has_speech", 0)
        pct = min((processed / target) * 100 if target else 0, 100)
        speech_pct = (speech_count / processed * 100) if processed else 0
        chunk_ts = progress.get("last_chunk_ts")
        ts_hint = ""
        if chunk_ts:
            ts = chunk_ts.replace(microsecond=0) if hasattr(chunk_ts, "replace") else chunk_ts
            ts_hint = f" latest chunk {ts}"

        logger.info(f"   VAD progress: {processed}/{target} chunks ({pct:.0f}%), speech in {speech_pct:.0f}%." + ts_hint)
        progress_state["last_logged"] = processed
        progress_state["last_time"] = now

    run_voice_activity_detection(limit=limit, progress_callback=log_progress)
    pending_after = count_pending_vad_chunks()
    processed = max(pending_before - pending_after, 0)
    summary.update({
        "pending_after": pending_after,
        "processed": processed,
        "status": "working" if pending_after > 0 else "cleared",
    })

    if pending_after == 0:
        logger.info("✓ VAD backlog cleared")
    else:
        logger.info(f"VAD backlog updated: {pending_after} chunk(s) remaining")
    return summary





def list_errored_files():
    errored_files = call_resource('tech.mycelia.mongo', {
        "action": "find",
        "collection": "source_files",
        "query": {
            "ingested": False,
            "ingestion.error": {"$exists": True}
        },
        "sort": [('ingestion.last_attempt', -1)]
    })

    count = 0
    for source in errored_files:
        count += 1
        file_path = source.get('path', str(source['_id']))
        file_name = os.path.basename(file_path) if 'path' in source else str(source['_id'])
        error = source['ingestion']['error'][:100]
        last_attempt = source['ingestion']['last_attempt'].strftime('%Y-%m-%d %H:%M:%S')
        print(f"{count}. {file_name}")
        print(f"   ID: {source['_id']}")
        print(f"   Error: {error}")
        print(f"   Last attempt: {last_attempt}")
        print()

    if count == 0:
        print("No errored files found")
    else:
        print(f"Total: {count} errored files")

    return count


def clear_error(file_id):
    result = call_resource('tech.mycelia.mongo', {
        "action": "updateOne",
        "collection": "source_files",
        "query": {"_id": file_id},
        "update": {"$unset": {"ingestion": ""}}
    })
    if result.modified_count > 0:
        logger.info(f"Cleared error for file {file_id}")
        return True
    else:
        logger.warning(f"File {file_id} not found or no error to clear")
        return False


def clear_all_errors():
    result = call_resource('tech.mycelia.mongo', {
        "action": "updateMany",
        "collection": "source_files",
        "query": {"ingestion.error": {"$exists": True}},
        "update": {"$unset": {"ingestion": ""}}
    })
    logger.info(f"Cleared errors for {result.modified_count} files")
    return result.modified_count


def add_missing_durations():
    query = {
        "duration": {"$exists": False}
    }

    cursor = call_resource('tech.mycelia.mongo', {
        "action": "find",
        "collection": "source_files",
        "query": query
    })
    for original in cursor:
        # Find the latest chunk for this original
        latest_chunk = call_resource('tech.mycelia.mongo', {
            "action": "findOne",
            "collection": "audio_chunks",
            "query": {"meta.original_id": original["_id"]},
            "sort": [("start", -1)],
            "limit": 1
        })
        if latest_chunk:
            end = latest_chunk["start"] + timedelta(seconds=AudioSegment.from_file(io.BytesIO(latest_chunk['data']), format="ogg").duration_seconds)
            duration = end - original["start"]
            call_resource('tech.mycelia.mongo', {
                "action": "updateOne",
                "collection": "source_files",
                "query": {"_id": original["_id"]},
                "update": {
                    "$set": {
                        "duration": duration.total_seconds()
                    }
                }
            })


def add_missing_ends():
    for original in call_resource('tech.mycelia.mongo', {
        "action": "find",
        "collection": "source_files",
        "query": {
            "duration": {"$exists": True},
            "end": {"$exists": False}
        }
    }):
        call_resource('tech.mycelia.mongo', {
            "action": "updateOne",
            "collection": "source_files",
            "query": {"_id": original["_id"]},
            "update": {
                "$set": {
                    "end": original["start"] + timedelta(seconds=original["duration"])
                }
            }
        })

#%%

import_new_files()

#%%

def main():
    cycle_started = datetime.now(UTC)

    import_summary = import_new_files()
    ingestion_summary = ingests_missing_sources(limit=20)
    vad_summary = run_vad_stage(limit=1000)

    cycle_finished = datetime.now(UTC)
    duration_s = (cycle_finished - cycle_started).total_seconds()
    next_idle_delay = max(10 - duration_s, 0)
    next_check_eta = (cycle_finished + timedelta(seconds=next_idle_delay)) if next_idle_delay else None

    if import_summary["new_files"]:
        logger.info(f"Imported {import_summary['new_files']} new file(s); {import_summary['total_files']} total tracked.")
    if import_summary["errors"]:
        logger.warning(f"{import_summary['errors']} importer(s) failed; check logs above.")
    if import_summary["new_files"] == 0:
        for source in import_summary.get("sources", []):
            checked_local = source["checked_at"].astimezone().strftime('%H:%M:%S')
            if next_check_eta:
                next_local = next_check_eta.astimezone().strftime('%H:%M:%S')
                logger.info(f"{source['code']}: no new recordings (checked {checked_local}); next scan ≈{next_local}.")
            else:
                logger.info(f"{source['code']}: no new recordings (checked {checked_local}); next scan already running.")
    else:
        for source in import_summary.get("sources", []):
            if source["new_files"]:
                logger.info(f"{source['code']}: {source['new_files']} new file(s) added.")

    if ingestion_summary["processed"]:
        logger.info(
            f"Ingested {ingestion_summary['processed']} file(s) "
            f"(limit {ingestion_summary['limit'] or '∞'}); "
            f"{ingestion_summary['remaining']} remaining."
        )
    if ingestion_summary["errors"]:
        logger.warning(f"{ingestion_summary['errors']} file(s) failed ingestion; {ingestion_summary['errored']} total marked errored.")

    if vad_summary["processed"]:
        logger.info(f"VAD processed {vad_summary['processed']} chunk(s); {vad_summary['pending_after']} remaining.")
    if vad_summary.get("status") == "cleared":
        logger.info("VAD backlog cleared.")

    overview = (
        f"[{cycle_finished.strftime('%Y-%m-%d %H:%M:%S')}] "
        f"new={import_summary['new_files']} "
        f"ingest+{ingestion_summary['processed']} "
        f"(pending {ingestion_summary['pending']}→{ingestion_summary['remaining']}) "
        f"vad+{vad_summary['processed']} "
        f"(pending {vad_summary['pending_before']}→{vad_summary['pending_after']}) "
        f"errors={import_summary['errors'] + ingestion_summary['errors']} "
        f"{duration_s:.1f}s"
    )
    logger.info(overview)

    record_cycle_summary({
        "started_at": cycle_started,
        "finished_at": cycle_finished,
        "duration_s": duration_s,
        "import": import_summary,
        "ingestion": ingestion_summary,
        "vad": vad_summary,
    })


if __name__ == '__main__':
    while True:
        start = time.time()
        try:
            main()
        except Exception as e:
            logger.exception(f"Error in main: {e}")
            time.sleep(10)
            continue
        end = time.time()
        if end - start < 10:
            logger.info("Sleeping for a few seconds")
            time.sleep(10)

#%%