import subprocess
import os
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Header, Form
from faster_whisper import WhisperModel
import asyncio
import numpy as np
import io
import ffmpeg
import wave
import logging

sample_rate = 16000

device = "cuda"
model_size = "large-v3"

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('whisper_server.log')
    ]
)
logger = logging.getLogger(__name__)

# Authentication configuration
API_KEY = os.getenv("API_KEY")
if not API_KEY:
    logger.warning("API_KEY environment variable not set. Authentication disabled.")

logger.info(f"Initializing WhisperModel with size: {model_size}, device: {device}")
model = WhisperModel(model_size, device=device, num_workers=1, cpu_threads=1)
logger.info("WhisperModel initialized successfully")

# Authentication dependency
async def verify_api_key(x_api_key: str = Header(None)):
    """Verify API key from X-API-Key header"""
    if not API_KEY:
        # If no API key is configured, allow all requests
        return True

    if not x_api_key:
        logger.warning("Missing X-API-Key header")
        raise HTTPException(status_code=401, detail="Missing API key")

    if x_api_key != API_KEY:
        logger.warning(f"Invalid API key provided: {x_api_key[:8]}...")
        raise HTTPException(status_code=401, detail="Invalid API key")

    return True

def wav_to_array(source: io.BytesIO) -> np.ndarray:
    logger.debug("Converting WAV bytes to numpy array")
    wav_file = wave.open(source, 'rb')

    if wav_file.getnchannels() != 1:
        logger.error(f"WAV file must be mono, got {wav_file.getnchannels()} channels")
        raise ValueError("WAV file must be mono")

    frames = wav_file.readframes(wav_file.getnframes())
    sample_width = wav_file.getsampwidth()
    logger.debug(f"WAV file: {wav_file.getnframes()} frames, sample width: {sample_width}")

    # Get sample width to determine dtype
    if sample_width == 2:
        data = np.frombuffer(frames, dtype=np.int16)
    elif sample_width == 4:
        data = np.frombuffer(frames, dtype=np.int32)
    else:
        logger.error(f"Unsupported sample width: {sample_width}")
        raise ValueError("Unsupported sample width")

    # Normalize to float between -1.0 and 1.0
    normalized_data = data.astype(np.float32) / np.iinfo(data.dtype).max
    logger.debug(f"Converted WAV to array with shape: {normalized_data.shape}")
    return normalized_data

def read_codec(source: bytes, codec: str = "opus", sample_rate: int = sample_rate) -> np.ndarray:
    logger.info(f"Converting audio from {codec} format, size: {len(source)} bytes")
    process: subprocess.Popen = (
        ffmpeg
        .input('pipe:', codec=codec)  # Read from pipe in opus format
        .output(
            'pipe:',  # Output to pipe
            format='wav',  # Output format WAV
            acodec='pcm_s16le',  # 16-bit PCM
            ar=str(sample_rate),  # Set sample rate
            ac=1  # Force mono output
        )
        .overwrite_output()
        .run_async(
            pipe_stdin=True,  # Enable pipe input
            pipe_stdout=True,  # Enable pipe output
            pipe_stderr=True  # Capture any errors
        )
    )

    logger.debug("Running ffmpeg subprocess")
    output_data, stderr = process.communicate(input=source)

    if process.returncode != 0:
        logger.error(f"ffmpeg failed with return code {process.returncode}: {stderr.decode()}")
        raise Exception(f"ffmpeg failed with: {stderr.decode()}")

    logger.debug(f"ffmpeg conversion completed, output size: {len(output_data)} bytes")
    return wav_to_array(io.BytesIO(output_data))


async def file_to_array(file: UploadFile) -> np.ndarray:
    logger.info(f"Processing uploaded file: {file.filename}, size: {file.size} bytes")
    contents = await file.read()
    if not contents:
        logger.warning(f"Empty file received: {file.filename}")
        return np.array([])

    logger.debug(f"File {file.filename} read into memory, processing with read_codec")
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, read_codec, contents)

app = FastAPI(
    title="Audio Transcription API",
    description="API for transcribing audio files using Whisper",
    version="1.0.0"
)

@app.post("/transcribe")
async def transcribe(files: list[UploadFile] = File(...), prompt: str = Form(None), _: bool = Depends(verify_api_key)):
    logger.info(f"Received transcription request with {len(files)} files")
    if prompt:
        logger.info(f"Using prompt: {prompt[:100]}...")  # Log first 100 chars of prompt
    try:
        # Log file details
        for file in files:
            logger.info(f"File: {file.filename}, content-type: {file.content_type}")

        tasks = [file_to_array(file) for file in files]

        if not tasks:
            logger.error("No files provided for transcription")
            raise HTTPException(status_code=400, detail="No files provided")

        logger.info("Starting audio file processing and concatenation")
        sound_arrays = await asyncio.gather(*tasks)
        sound = np.concatenate(sound_arrays)
        duration = len(sound) / sample_rate
        logger.info(f"Audio concatenated, total duration: {duration:.2f} seconds")

        logger.info("Starting transcription with Whisper model")
        transcribe_kwargs = {"multilingual": True}
        if prompt:
            transcribe_kwargs["initial_prompt"] = prompt
        segments, info = model.transcribe(sound, **transcribe_kwargs)
        logger.info(f"Transcription completed. Detected language: {info.language}")

        # Convert segments to list to count them
        segments_list = list(segments)
        logger.info(f"Generated {len(segments_list)} transcription segments")

        return {
            'language': info.language,
            'top_language_probs': info.all_language_probs[:5],
            'segments': [
                {
                    'text': s.text,
                    'start': s.start,
                    'end': s.end,
                    'no_speech_prob': s.no_speech_prob,
                } for s in segments_list
            ]
        }
    except HTTPException:
        # Re-raise HTTP exceptions as they're already handled
        raise
    except Exception as e:
        logger.error(f"Transcription failed with error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))






if __name__ == '__main__':
    import uvicorn
    logger.info("Starting Whisper transcription server on 0.0.0.0:8081")
    uvicorn.run(app, host='0.0.0.0', port=8081)