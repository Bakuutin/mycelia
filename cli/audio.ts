import { getJWT, parseDateOrRelativeTime } from "./utils.ts";
import { CliConfig, getUrl } from "./config.ts";

export async function importAudioFile(
  jwt: string,
  filePath: string,
  startTime: Date,
  metadata: Record<string, any> = {},
): Promise<void> {
  const file = await Deno.readFile(filePath);
  const fileName = filePath.split("/").pop() || "unknown";

  const formData = new FormData();
  formData.append("audio", new Blob([file], { type: "audio/wav" }), fileName);
  formData.append("start", startTime.toISOString());
  formData.append("metadata", JSON.stringify(metadata));

  const response = await fetch(getUrl("/api/audio/ingest"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  console.log(`Upload successful: ${result.original_id}`);
  if (result.message) {
    console.log(`Note: ${result.message}`);
  }
}

export async function handleAudioImport(
  config: CliConfig,
  file: string,
  startTime?: string,
  metadataStr?: string,
): Promise<void> {
  const jwt = await getJWT(config);
  const parsedStartTime = startTime
    ? parseDateOrRelativeTime(startTime)!
    : new Date();

  let metadata: Record<string, any> = {};
  if (metadataStr) {
    try {
      metadata = JSON.parse(metadataStr);
    } catch (error) {
      console.error("Error: Invalid metadata JSON");
      Deno.exit(1);
    }
  }

  try {
    const stat = await Deno.stat(file);
    if (!stat.isFile) {
      console.error("Error: Path must be a file");
      Deno.exit(1);
    }

    await importAudioFile(jwt, file, parsedStartTime, metadata);
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    Deno.exit(1);
  }
}

interface AudioDevice {
  id: string;
  name: string;
}

interface StreamingBuffer {
  buffer: Uint8Array;
  currentSize: number;
  chunkNumber: number;
  startTime: Date;
  maxSize: number;
}

class MicrophoneStreamer {
  private jwt: string;
  private metadata: Record<string, any>;
  private streamingBuffer: StreamingBuffer;
  private uploadPromises: Promise<void>[] = [];
  private totalChunksUploaded = 0;
  private totalBytes = 0;
  private ffmpegProcess?: Deno.ChildProcess;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;

  private static readonly CHUNK_DURATION_SECONDS = 10;
  private static readonly SAMPLE_RATE = 16000; // 16kHz
  private static readonly BYTES_PER_SAMPLE = 2; // 16-bit
  private static readonly CHUNK_SIZE_BYTES =
    MicrophoneStreamer.CHUNK_DURATION_SECONDS *
    MicrophoneStreamer.SAMPLE_RATE *
    MicrophoneStreamer.BYTES_PER_SAMPLE; // 320,000 bytes

  constructor(jwt: string, metadata: Record<string, any> = {}) {
    this.jwt = jwt;
    this.metadata = metadata;

    this.streamingBuffer = {
      buffer: new Uint8Array(MicrophoneStreamer.CHUNK_SIZE_BYTES),
      currentSize: 0,
      chunkNumber: 1,
      startTime: new Date(),
      maxSize: MicrophoneStreamer.CHUNK_SIZE_BYTES,
    };

    console.log(
      `📊 Streaming buffer initialized: ${MicrophoneStreamer.CHUNK_SIZE_BYTES} bytes per ${MicrophoneStreamer.CHUNK_DURATION_SECONDS}s chunk`,
    );
  }

  async startRecording(deviceId: string, duration?: number): Promise<void> {
    const audioInput = `:${deviceId}`;
    console.log(`🔧 Audio input parameter: ${audioInput}`);

    const ffmpegArgs = [
      "-f",
      "avfoundation",
      "-i",
      audioInput,
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      "pipe:1",
    ];

    if (duration) {
      ffmpegArgs.splice(2, 0, "-t", duration.toString());
    }

    console.log(`🔧 FFmpeg command: ffmpeg ${ffmpegArgs.join(" ")}`);

    const process = new Deno.Command("ffmpeg", {
      args: ffmpegArgs,
      stdout: "piped",
      stderr: "piped",
    });

    const startTime = new Date();
    console.log(`🕐 Recording started at: ${startTime.toISOString()}`);

    this.ffmpegProcess = process.spawn();
    console.log(`🚀 FFmpeg process spawned (PID: ${this.ffmpegProcess.pid})`);

    // Set up signal handlers for graceful shutdown
    this.setupCleanupHandlers();

    // Start processing audio stream
    await this.processAudioStream();
  }

  private setupCleanupHandlers(): void {
    const cleanup = async () => {
      console.log("\n🛑 Interrupt signal received, stopping recording...");
      await this.stop();
      Deno.exit(0);
    };

    Deno.addSignalListener("SIGINT", cleanup);
    Deno.addSignalListener("SIGTERM", cleanup);
  }

  private async processAudioStream(): Promise<void> {
    if (!this.ffmpegProcess) {
      throw new Error("FFmpeg process not started");
    }

    this.reader = this.ffmpegProcess.stdout.getReader();
    console.log("📥 Starting streaming audio processing...");

    try {
      while (true) {
        const { done, value } = await this.reader.read();
        if (done) {
          console.log("🔚 Audio stream ended");
          break;
        }

        await this.processAudioChunk(value);
      }
    } finally {
      this.reader.releaseLock();
      console.log("🔓 Released audio stream reader");
    }

    console.log(
      `📊 Stream processing complete: ${this.totalBytes} total bytes, ${this.totalChunksUploaded} chunks uploaded`,
    );

    // Wait for process to complete
    await this.waitForFFmpegCompletion();

    // Handle final chunk and cleanup
    await this.finalize();
  }

  private async processAudioChunk(value: Uint8Array): Promise<void> {
    this.totalBytes += value.length;
    let dataOffset = 0;

    // Process the incoming data, potentially spanning multiple buffer chunks
    while (dataOffset < value.length) {
      const remainingBufferSpace = this.streamingBuffer.maxSize -
        this.streamingBuffer.currentSize;
      const remainingData = value.length - dataOffset;
      const copySize = Math.min(remainingBufferSpace, remainingData);

      // Copy data into buffer
      this.streamingBuffer.buffer.set(
        value.slice(dataOffset, dataOffset + copySize),
        this.streamingBuffer.currentSize,
      );

      this.streamingBuffer.currentSize += copySize;
      dataOffset += copySize;

      // If buffer is full, upload it
      if (this.streamingBuffer.currentSize >= this.streamingBuffer.maxSize) {
        await this.uploadCurrentBuffer();
      }
    }
  }

  private async uploadCurrentBuffer(): Promise<void> {
    const chunkData = this.streamingBuffer.buffer.slice(
      0,
      this.streamingBuffer.currentSize,
    );
    const chunkStartTime = new Date(this.streamingBuffer.startTime);
    const chunkNum = this.streamingBuffer.chunkNumber;

    console.log(
      `🎯 Buffer full! Uploading chunk ${chunkNum} (${chunkData.length} bytes)`,
    );

    // Upload chunk in background
    const uploadPromise = this.uploadAudioChunk(
      chunkData,
      chunkStartTime,
      chunkNum,
    )
      .then(() => {
        this.totalChunksUploaded++;
        console.log(
          `📈 Progress: ${this.totalChunksUploaded} chunks uploaded, ${this.totalBytes} total bytes processed`,
        );
      })
      .catch((error) => {
        console.error(
          `⚠️  Chunk ${chunkNum} upload failed, but continuing recording: ${error.message}`,
        );
      });

    this.uploadPromises.push(uploadPromise);

    // Reset buffer for next chunk
    this.streamingBuffer.currentSize = 0;
    this.streamingBuffer.chunkNumber++;
    this.streamingBuffer.startTime = new Date();
  }

  private async uploadAudioChunk(
    audioData: Uint8Array,
    chunkStartTime: Date,
    chunkNumber: number,
  ): Promise<void> {
    console.log(`📤 Uploading chunk ${chunkNumber}...`);
    console.log(`📊 Chunk size: ${audioData.length} bytes`);
    console.log(`🕐 Chunk start time: ${chunkStartTime.toISOString()}`);

    const formData = new FormData();
    formData.append(
      "audio",
      new Blob([audioData], { type: "audio/wav" }),
      `microphone_chunk_${chunkNumber}.wav`,
    );
    formData.append("start", chunkStartTime.toISOString());
    formData.append("chunk_number", chunkNumber.toString());
    formData.append(
      "metadata",
      JSON.stringify({
        ...this.metadata,
        streaming: true,
        chunk_number: chunkNumber,
        chunk_duration_ms: Math.round((audioData.length / 2) / 16), // 16kHz, 16-bit samples
      }),
    );

    const uploadUrl = getUrl("/api/audio/ingest");

    try {
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.jwt}`,
        },
        body: formData,
      });

      console.log(
        `📡 Chunk ${chunkNumber} response: ${response.status} ${response.statusText}`,
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `❌ Chunk ${chunkNumber} upload failed: ${response.status}`,
        );
        console.error(`🔥 Error details: ${errorText}`);
        throw new Error(
          `Chunk ${chunkNumber} upload failed: ${response.status} ${errorText}`,
        );
      }

      const result = await response.json();
      console.log(`✅ Chunk ${chunkNumber} uploaded successfully!`);
      console.log(`🆔 Chunk ${chunkNumber} ID: ${result.original_id}`);
      if (result.message) {
        console.log(`💬 Server message: ${result.message}`);
      }
    } catch (error) {
      console.error(
        `💥 Failed to upload chunk ${chunkNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  private async waitForFFmpegCompletion(): Promise<void> {
    if (!this.ffmpegProcess) return;

    console.log("⏳ Waiting for FFmpeg process to complete...");
    const status = await this.ffmpegProcess.status;

    if (!status.success) {
      console.error(`❌ FFmpeg failed with exit code: ${status.code}`);
      const stderr = await this.ffmpegProcess.stderr.getReader().read();
      const errorOutput = new TextDecoder().decode(
        stderr.value || new Uint8Array(),
      );
      console.error("🔥 FFmpeg error output:", errorOutput);

      // Provide helpful hints for common errors
      if (errorOutput.includes("Audio device not found")) {
        console.error("\n💡 Troubleshooting:");
        console.error(
          "  1. Run: deno run --env cli.ts audio microphone --device list",
        );
        console.error(
          "  2. Make sure you're using an AUDIO device, not a video device",
        );
        console.error("  3. Try using the device index instead of the name");
        console.error(
          "  4. Check that the device name matches exactly (case sensitive)",
        );
      }

      throw new Error(`FFmpeg failed with exit code: ${status.code}`);
    }

    console.log("✅ FFmpeg completed successfully");
  }

  private async finalize(): Promise<void> {
    // Handle final partial chunk if any data remains
    if (this.streamingBuffer.currentSize > 0) {
      const finalChunkData = this.streamingBuffer.buffer.slice(
        0,
        this.streamingBuffer.currentSize,
      );
      const chunkStartTime = new Date(this.streamingBuffer.startTime);
      const chunkNum = this.streamingBuffer.chunkNumber;

      console.log(
        `📤 Uploading final partial chunk ${chunkNum} (${finalChunkData.length} bytes)`,
      );

      try {
        await this.uploadAudioChunk(finalChunkData, chunkStartTime, chunkNum);
        this.totalChunksUploaded++;
        console.log(`✅ Final chunk ${chunkNum} uploaded successfully`);
      } catch (error) {
        console.error(
          `❌ Final chunk ${chunkNum} upload failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Wait for all uploads to complete
    console.log(
      `⏳ Waiting for ${this.uploadPromises.length} chunk uploads to complete...`,
    );
    try {
      await Promise.allSettled(this.uploadPromises);
      console.log(`🎉 All chunk uploads completed!`);
    } catch (error) {
      console.error(
        `⚠️  Some uploads may have failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const recordingDuration =
      (new Date().getTime() - this.streamingBuffer.startTime.getTime()) / 1000;
    console.log(
      `⏱️  Total recording duration: ${recordingDuration.toFixed(2)}s`,
    );
    console.log(
      `📊 Final stats: ${this.totalBytes} bytes processed, ${this.totalChunksUploaded} chunks uploaded`,
    );
    console.log(`🎉 Streaming microphone recording complete!`);
  }

  async stop(): Promise<void> {
    if (this.ffmpegProcess) {
      try {
        console.log("💀 Sending SIGTERM to FFmpeg process...");
        this.ffmpegProcess.kill("SIGTERM");
        await this.ffmpegProcess.status;
        console.log("🏁 FFmpeg process terminated");
      } catch (error) {
        console.log("⚠️  FFmpeg process already terminated");
      }
    }

    // Upload remaining buffer if any data exists
    if (this.streamingBuffer && this.streamingBuffer.currentSize > 0) {
      console.log(
        `📤 Uploading remaining ${this.streamingBuffer.currentSize} bytes from buffer...`,
      );
      const remainingData = this.streamingBuffer.buffer.slice(
        0,
        this.streamingBuffer.currentSize,
      );
      const chunkStartTime = new Date(this.streamingBuffer.startTime);
      const chunkNum = this.streamingBuffer.chunkNumber;

      try {
        await this.uploadAudioChunk(remainingData, chunkStartTime, chunkNum);
        this.totalChunksUploaded++;
        console.log(`✅ Final chunk ${chunkNum} uploaded successfully on exit`);
      } catch (error) {
        console.error(
          `❌ Failed to upload final chunk on exit: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Wait for any pending uploads to complete
    if (this.uploadPromises.length > 0) {
      console.log(
        `⏳ Waiting for ${this.uploadPromises.length} pending uploads to complete...`,
      );
      try {
        await Promise.allSettled(this.uploadPromises);
        console.log("✅ All pending uploads completed");
      } catch (error) {
        console.error(
          `⚠️  Some uploads may have failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    console.log(
      `🎉 Recording session complete! ${this.totalChunksUploaded} total chunks uploaded`,
    );
  }
}

async function getAudioDevices(): Promise<AudioDevice[]> {
  const process = new Deno.Command("ffmpeg", {
    args: ["-f", "avfoundation", "-list_devices", "true", "-i", ""],
    stdout: "piped",
    stderr: "piped",
  });

  const child = process.spawn();
  await child.status;

  // FFmpeg outputs device list to stderr
  const stderr = await child.stderr.getReader().read();
  const output = new TextDecoder().decode(stderr.value || new Uint8Array());

  const devices: AudioDevice[] = [];
  const lines = output.split("\n");
  let inAudioSection = false;

  for (const line of lines) {
    if (
      line.includes("[AVFoundation indev @") && line.includes("audio devices:")
    ) {
      inAudioSection = true;
      continue;
    }
    if (
      inAudioSection && line.includes("[AVFoundation indev @") &&
      line.includes("video devices:")
    ) {
      inAudioSection = false;
      break;
    }
    if (
      inAudioSection && line.includes("[AVFoundation indev @") &&
      line.includes("]")
    ) {
      const deviceMatch = line.match(/\[(\d+)\]\s+(.+)/);
      if (deviceMatch) {
        devices.push({
          id: deviceMatch[1],
          name: deviceMatch[2].trim(),
        });
      }
    }
  }

  return devices;
}

async function listAudioDevices(): Promise<void> {
  console.log("🎤 Listing available audio devices...");

  const devices = await getAudioDevices();

  console.log("📋 Available audio input devices:");

  if (devices.length === 0) {
    console.log("  ⚠️  No audio input devices found");
  } else {
    for (const device of devices) {
      console.log(`  🎙️  ${device.id}: ${device.name}`);
    }
  }

  const randomDevice: AudioDevice =
    devices[Math.floor(Math.random() * devices.length)] ||
    { id: "0", name: "Default Audio Device" };

  console.log("\n💡 Usage:");
  console.log("  --device <index>           Use device by index number");
  console.log('  --device "<device name>"   Use device by exact name');
  console.log("\n📝 Examples:");
  console.log(`  --device ${randomDevice.id}`);
  console.log(`  --device "${randomDevice.name}"`);
}

async function resolveDeviceToId(device: string): Promise<string> {
  // If it's already a number, return it
  if (/^\d+$/.test(device)) {
    return device;
  }

  // Get device list and find matching name
  const devices = await getAudioDevices();
  const matchingDevice = devices.find((d) => d.name === device);

  if (!matchingDevice) {
    console.error(`❌ Audio device "${device}" not found`);
    console.error("\n📋 Available devices:");
    for (const d of devices) {
      console.error(`  🎙️  ${d.id}: ${d.name}`);
    }
    throw new Error(`Audio device "${device}" not found`);
  }

  console.log(`🔄 Resolved device "${device}" to ID: ${matchingDevice.id}`);
  return matchingDevice.id;
}

export async function handleMicrophoneStream(
  config: CliConfig,
  duration?: number,
  metadataStr?: string,
  device?: string,
): Promise<void> {
  // Handle device listing
  if (device === "list") {
    await listAudioDevices();
    return;
  }

  console.log("🎤 Initializing microphone recording...");
  console.log(`📋 Config: ${config.url}`);

  const jwt = await getJWT(config);
  console.log("✅ JWT authentication successful");

  let metadata: Record<string, any> = {};
  if (metadataStr) {
    try {
      metadata = JSON.parse(metadataStr);
      console.log(`📝 Metadata parsed: ${JSON.stringify(metadata)}`);
    } catch (error) {
      console.error("❌ Error: Invalid metadata JSON");
      Deno.exit(1);
    }
  } else {
    console.log("📝 No metadata provided");
  }

  try {
    console.log("🎬 Starting microphone stream...");
    console.log(
      duration
        ? `⏱️  Recording duration: ${duration}s`
        : "⏱️  Recording until Ctrl+C",
    );
    console.log("🛑 Press Ctrl+C to stop recording");

    // Determine audio input device
    let deviceId = "0"; // Default audio input device ID
    if (device) {
      console.log(`🔍 Resolving device: "${device}"`);
      deviceId = await resolveDeviceToId(device);
      console.log(`🎯 Using audio device ID: ${deviceId}`);
    } else {
      console.log("🎯 Using default audio input device (ID: 0)");
    }

    // Create and start the microphone streamer
    const streamer = new MicrophoneStreamer(jwt, metadata);
    await streamer.startRecording(deviceId, duration);
  } catch (error) {
    console.error(
      `💥 Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    Deno.exit(1);
  }
}
