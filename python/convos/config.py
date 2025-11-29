"""Configuration and logging setup for conversation extraction."""

import logging
import os
import re
import signal
from logging.handlers import RotatingFileHandler
from pathlib import Path

# Signal handling for graceful shutdown
signal.signal(signal.SIGINT, signal.SIG_DFL)

# Setup logging
logger = logging.getLogger('convos')

# Scale for bucket processing
scale = "1day"

LOG_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
LOG_BACKUP_COUNT = 5
MASK = '***'
SENSITIVE_PATTERNS = [
    re.compile(r'(?i)(api[_-]?key|token|secret|password|auth(?:orization)?)[=:]\s*([^\s,;]+)'),
    re.compile(r'(?i)(bearer\s+)([A-Za-z0-9\-_\.=]+)'),
]


def _mask_sensitive_data(message: str) -> str:
    masked = message
    for pattern in SENSITIVE_PATTERNS:
        masked = pattern.sub(lambda match: f"{match.group(1)}{MASK}", masked)
    return masked


class SensitiveDataFilter(logging.Filter):
    """Masks common credential patterns before they hit any handlers."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True

        masked = _mask_sensitive_data(message)
        if masked != message:
            record.msg = masked
            record.args = ()
        return True


def setup_logging():
    """Setup logging configuration similar to daemon.py"""
    base_dir = Path(__file__).resolve().parent
    log_dir = base_dir / 'logs'
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / 'convos.log'

    level_name = os.environ.get('MYCELIA_CONVOS_LOG_LEVEL', 'INFO').upper()
    logger.setLevel(getattr(logging, level_name, logging.INFO))
    logger.propagate = False
    logger.handlers.clear()

    console = logging.StreamHandler()
    console.setLevel(logging.INFO)

    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=LOG_MAX_BYTES,
        backupCount=LOG_BACKUP_COUNT,
        encoding='utf-8'
    )
    file_handler.setLevel(logging.INFO)

    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')

    for handler in (console, file_handler):
        handler.setFormatter(formatter)
        handler.addFilter(SensitiveDataFilter())
        logger.addHandler(handler)

    logger.info(f"Logging to {log_file}")
