import logging
import os
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from faster_whisper import WhisperModel


logging.basicConfig(
    level=os.getenv("WHISPER_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("mycelia.whisper")

APP_NAME = "Mycelia Whisper Server"
API_KEY = os.getenv("WHISPER_API_KEY")
MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
CACHE_DIR = os.getenv("WHISPER_CACHE_DIR")
BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "5"))


def parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


VAD_FILTER = parse_bool(os.getenv("WHISPER_VAD_FILTER"), True)
security = HTTPBearer(auto_error=False)

app = FastAPI(
    title=APP_NAME,
    version="0.1.0",
    description="OpenAI-compatible transcription server backed by faster-whisper.",
)


@lru_cache(maxsize=1)
def get_model() -> WhisperModel:
    kwargs = {
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
    }
    if CACHE_DIR:
        kwargs["download_root"] = CACHE_DIR

    logger.info(
        "Loading faster-whisper model",
        extra={
            "model": MODEL_NAME,
            "device": DEVICE,
            "compute_type": COMPUTE_TYPE,
            "cache_dir": CACHE_DIR,
        },
    )
    return WhisperModel(MODEL_NAME, **kwargs)


async def verify_api_key(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> None:
    if not API_KEY:
        return

    if not credentials or credentials.credentials != API_KEY:
        raise HTTPException(
            status_code=401,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def save_upload(upload: UploadFile) -> str:
    suffix = Path(upload.filename or "audio").suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        while chunk := await upload.read(1024 * 1024):
            temp_file.write(chunk)
        return temp_file.name


def build_transcript_response(
    *,
    audio_path: str,
    task: str,
    language: Optional[str],
    prompt: Optional[str],
) -> dict:
    transcribe_language = None if not language or language == "auto" else language
    segments, info = get_model().transcribe(
        audio_path,
        task=task,
        language=transcribe_language,
        initial_prompt=prompt,
        vad_filter=VAD_FILTER,
        beam_size=BEAM_SIZE,
    )

    payload_segments = []
    text_parts: list[str] = []

    for index, segment in enumerate(segments):
        text = segment.text.strip()
        if text:
            text_parts.append(text)

        payload_segments.append({
            "id": index,
            "start": float(segment.start),
            "end": float(segment.end),
            "text": text,
            "avg_logprob": getattr(segment, "avg_logprob", None),
            "no_speech_prob": getattr(segment, "no_speech_prob", None),
        })

    duration = float(getattr(info, "duration", 0.0) or 0.0)
    if duration == 0.0 and payload_segments:
        duration = payload_segments[-1]["end"]

    return {
        "task": task,
        "language": getattr(info, "language", None) or transcribe_language or "unknown",
        "duration": duration,
        "text": " ".join(text_parts).strip(),
        "segments": payload_segments,
    }


async def transcribe_upload(
    *,
    upload: UploadFile,
    task: str,
    language: Optional[str],
    prompt: Optional[str],
) -> dict:
    audio_path = await save_upload(upload)
    try:
        return build_transcript_response(
            audio_path=audio_path,
            task=task,
            language=language,
            prompt=prompt,
        )
    finally:
        try:
            os.unlink(audio_path)
        except FileNotFoundError:
            pass


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
    }


@app.get("/v1/models")
async def list_models(_: None = Depends(verify_api_key)) -> dict:
    return {
        "object": "list",
        "data": [
            {
                "id": MODEL_NAME,
                "object": "model",
                "created": 0,
                "owned_by": "mycelia-whisper",
            }
        ],
    }


@app.post("/v1/audio/transcriptions")
async def transcribe_audio(
    file: UploadFile = File(...),
    model: str = Form("whisper"),
    language: Optional[str] = Form(None),
    prompt: Optional[str] = Form(None),
    response_format: str = Form("json"),
    _: None = Depends(verify_api_key),
):
    del model

    result = await transcribe_upload(
        upload=file,
        task="transcribe",
        language=language,
        prompt=prompt,
    )

    if response_format == "text":
        return PlainTextResponse(result["text"])

    return JSONResponse(result)


@app.post("/asr")
async def asr(
    audio_file: UploadFile = File(...),
    task: str = Query("transcribe"),
    output: str = Query("json"),
    language: Optional[str] = Query(None),
    initial_prompt: Optional[str] = Query(None),
    _: None = Depends(verify_api_key),
):
    result = await transcribe_upload(
        upload=audio_file,
        task=task,
        language=language,
        prompt=initial_prompt,
    )

    if output == "txt":
        return PlainTextResponse(result["text"])

    return JSONResponse(result)


def main() -> None:
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("WHISPER_HOST", "0.0.0.0"),
        port=int(os.getenv("WHISPER_PORT", "9000")),
    )


if __name__ == "__main__":
    main()
