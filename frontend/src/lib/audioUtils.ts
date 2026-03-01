/**
 * Audio processing utilities for WAV creation and audio buffer manipulation
 * Based on diarizator/webui/src/utils/audioUtils.ts
 */

/**
 * Creates a WAV header for the given audio parameters
 */
export function createWAVHeader(
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
  dataLength: number
): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  // WAV file header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  return buffer;
}

/**
 * Creates a WAV blob from Float32Array audio buffer
 */
export function createWAVBlob(
  audioBuffer: Float32Array,
  sampleRate: number
): Blob {
  const length = audioBuffer.length;
  const arrayBuffer = new ArrayBuffer(length * 2);
  const view = new DataView(arrayBuffer);

  // Convert to 16-bit PCM
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, audioBuffer[i]));
    view.setInt16(i * 2, sample * 0x7fff, true);
  }

  // Create WAV blob
  return new Blob(
    [createWAVHeader(sampleRate, 1, 16, arrayBuffer.byteLength), arrayBuffer],
    { type: "audio/wav" }
  );
}

/**
 * Creates an AudioContext with fallback for older browsers
 */
export function createAudioContext(options?: AudioContextOptions): AudioContext {
  const AudioContextClass =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new AudioContextClass(options);
}

/**
 * Decodes audio data to AudioBuffer
 */
export async function decodeAudioData(
  audioContext: AudioContext,
  arrayBuffer: ArrayBuffer
): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    audioContext.decodeAudioData(
      arrayBuffer,
      (audioBuffer) => resolve(audioBuffer),
      (error) => reject(error)
    );
  });
}

/**
 * Extracts audio samples from AudioBuffer as Float32Array (mono)
 */
export function extractAudioSamples(audioBuffer: AudioBuffer): Float32Array {
  // Mix down to mono if stereo
  const channelData = audioBuffer.getChannelData(0);

  if (audioBuffer.numberOfChannels === 1) {
    return new Float32Array(channelData);
  }

  // Mix stereo to mono
  const leftChannel = audioBuffer.getChannelData(0);
  const rightChannel = audioBuffer.getChannelData(1);
  const mono = new Float32Array(leftChannel.length);

  for (let i = 0; i < leftChannel.length; i++) {
    mono[i] = (leftChannel[i] + rightChannel[i]) / 2;
  }

  return mono;
}

/**
 * Resamples audio samples to a target sample rate
 */
export async function resampleAudio(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Promise<Float32Array> {
  if (sourceSampleRate === targetSampleRate) {
    return samples;
  }

  // Create offline context for resampling
  const duration = samples.length / sourceSampleRate;
  const targetLength = Math.ceil(duration * targetSampleRate);
  const offlineContext = new OfflineAudioContext(1, targetLength, targetSampleRate);

  // Create buffer with source samples
  const sourceBuffer = offlineContext.createBuffer(1, samples.length, sourceSampleRate);
  sourceBuffer.getChannelData(0).set(samples);

  // Create source node and connect
  const source = offlineContext.createBufferSource();
  source.buffer = sourceBuffer;
  source.connect(offlineContext.destination);
  source.start();

  // Render resampled audio
  const renderedBuffer = await offlineContext.startRendering();
  return renderedBuffer.getChannelData(0);
}

/**
 * Converts any audio blob to WAV format at 16kHz mono (for speaker recognition)
 */
export async function convertBlobToWav(
  blob: Blob,
  targetSampleRate: number = 16000
): Promise<Blob> {
  // Decode the audio data
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = createAudioContext();
  const audioBuffer = await decodeAudioData(audioContext, arrayBuffer);

  // Extract mono samples
  let samples = extractAudioSamples(audioBuffer);

  // Resample to target rate if needed
  if (audioBuffer.sampleRate !== targetSampleRate) {
    samples = await resampleAudio(samples, audioBuffer.sampleRate, targetSampleRate);
  }

  // Close audio context
  audioContext.close();

  // Create WAV blob
  return createWAVBlob(samples, targetSampleRate);
}
