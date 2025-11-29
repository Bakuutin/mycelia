"""
Shared utilities for worker processes (STT, diarization, etc.)
"""
import os
import socket
import logging
from logging.handlers import RotatingFileHandler
from typing import Iterator
from datetime import datetime
from pytz import UTC
from bson import ObjectId

from .resources import call_resource


def setup_worker_logging(log_name: str) -> logging.Logger:
    """
    Set up logging for a worker with rotating file handler.

    Args:
        log_name: Name of the log file (e.g., 'stt', 'diarization_worker')

    Returns:
        Configured logger instance
    """
    log_dir = os.path.join(os.path.dirname(__file__), '..', 'logs')
    os.makedirs(log_dir, exist_ok=True)

    logger = logging.getLogger(log_name)
    logger.setLevel(logging.INFO)
    logger.propagate = False

    if logger.handlers:
        logger.handlers.clear()

    file_handler = RotatingFileHandler(
        os.path.join(log_dir, f'{log_name}.log'),
        maxBytes=10*1024*1024,
        backupCount=5
    )
    file_handler.setFormatter(logging.Formatter('%(message)s'))
    logger.addHandler(file_handler)

    return logger


def get_worker_id() -> str:
    """Generate a unique worker ID based on hostname and process ID."""
    return f"{socket.gethostname()}_{os.getpid()}"


def mongo_cursor(collection: str, query: dict, options: dict, batch_size: int = 200) -> Iterator[dict]:
    """
    Create a MongoDB cursor and iterate through results in batches.

    Args:
        collection: MongoDB collection name
        query: MongoDB query filter
        options: MongoDB query options (sort, etc.)
        batch_size: Number of documents per batch

    Yields:
        Documents from the collection
    """
    result = call_resource('tech.mycelia.mongo', {
        "action": "getFirstBatch",
        "collection": collection,
        "query": query,
        "options": options,
        "batchSize": batch_size,
    })
    cursor_id = result.get("cursorId")

    while result.get("data", []):
        for c in result['data']:
            yield c

        if not result.get("hasMore", False):
            return

        result = call_resource('tech.mycelia.mongo', {
            "action": "getMore",
            "collection": collection,
            "cursorId": cursor_id,
            "batchSize": batch_size,
        })


def claim_chunks(chunk_ids: list[ObjectId], worker_id: str, collection: str = 'audio_chunks') -> bool:
    """
    Claim chunks for processing by setting processing_by field.

    Args:
        chunk_ids: List of chunk ObjectIds to claim
        worker_id: Worker identifier
        collection: MongoDB collection name

    Returns:
        True if all chunks were successfully claimed, False otherwise
    """
    result = call_resource('tech.mycelia.mongo', {
        "action": "updateMany",
        "collection": collection,
        "query": {
            '_id': {'$in': chunk_ids},
            'processing_by': None
        },
        "update": {
            '$set': {'processing_by': worker_id, 'claimed_at': datetime.now(tz=UTC)},
        }
    })

    success = result['modifiedCount'] == len(chunk_ids)
    return success


def release_chunks(chunk_ids: list[ObjectId], worker_id: str, collection: str = 'audio_chunks'):
    """
    Release chunks by clearing processing_by field.

    Args:
        chunk_ids: List of chunk ObjectIds to release
        worker_id: Worker identifier
        collection: MongoDB collection name
    """
    call_resource('tech.mycelia.mongo', {
        "action": "updateMany",
        "collection": collection,
        "query": {
            '_id': {'$in': chunk_ids},
            'processing_by': worker_id
        },
        "update": {
            '$set': {'processing_by': None, 'claimed_at': None},
        }
    })
