import logging
import os

logger = logging.getLogger("convos")


def setup_logging() -> None:
    log_dir = os.path.expanduser("~/Library/mycelia/logs")
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, "convos.log")

    console = logging.StreamHandler()
    console.setLevel(logging.INFO)

    file_handler = logging.FileHandler(log_file)
    file_handler.setLevel(logging.DEBUG)

    formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    console.setFormatter(formatter)
    file_handler.setFormatter(formatter)

    logging.basicConfig(level=logging.DEBUG, handlers=[console, file_handler])
    logger.info(f"Logging to {log_file}")


__all__ = ["logger", "setup_logging"]
