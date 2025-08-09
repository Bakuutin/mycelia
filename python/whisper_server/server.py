import subprocess
from fastapi import FastAPI, UploadFile, File, HTTPException
from faster_whisper import WhisperModel
import asyncio
import numpy as np
import io
import ffmpeg
import wave

sample_rate = 16000

device = "cuda"
model_size = "large-v3"
model = WhisperModel(model_size, device=device, compute_type="float16", num_workers=5, cpu_threads=10)

def wav_to_array(source: io.BytesIO) -> np.ndarray:
    wav_file = wave.open(source, 'rb')

    if wav_file.getnchannels() != 1:
        raise ValueError("WAV file must be mono")
    frames = wav_file.readframes(wav_file.getnframes())
    
    # Get sample width to determine dtype
    if wav_file.getsampwidth() == 2:
        data = np.frombuffer(frames, dtype=np.int16)
    elif wav_file.getsampwidth() == 4:
        data = np.frombuffer(frames, dtype=np.int32)
    else:
        raise ValueError("Unsupported sample width")
        
    # Normalize to float between -1.0 and 1.0
    return data.astype(np.float32) / np.info(data.dtype).max

def read_codec(source: bytes, codec: str = "opus", sample_rate: int = sample_rate) -> np.ndarray:
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
            
    output_data, stderr = process.communicate(input=source)

    if process.returncode != 0:
        raise Exception(f"ffmpeg failed with: {stderr.decode()}")
    return wav_to_array(io.BytesIO(output_data))


async def file_to_array(file: UploadFile) -> np.ndarray:
    contents = await file.read()
    if not contents:
        return np.array([])
    
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, read_codec, contents)

app = FastAPI(
    title="Audio Transcription API",
    description="API for transcribing audio files using Whisper",
    version="1.0.0"
)

@app.post("/transcribe")
async def transcribe(files: list[UploadFile] = File(...)):
    try:
        tasks = [file_to_array(file) for file in files]
        
        if not tasks:
            raise HTTPException(status_code=400, detail="No files provided")

        sound = np.concatenate(await asyncio.gather(*tasks))

        segments, info = model.transcribe(sound, multilingual=True)
        
        return {
            'language': info.language,
            'top_language_probs': info.all_language_probs[:5],
            'segments': [
                {
                    'text': s.text,
                    'start': s.start,
                    'end': s.end,
                    'no_speech_prob': s.no_speech_prob,
                } for s in segments
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))






if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8081)