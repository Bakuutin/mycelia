import { Binary } from "mongodb";
import { Buffer } from "node:buffer";

export async function combineChunks(chunks: any[]): Promise<Uint8Array> {
  const tempFiles: string[] = [];
  
  try {
    // 1. Write chunks to temporary files
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      let data: Uint8Array;
      
      if (chunk.data instanceof Uint8Array) {
        data = chunk.data;
      } else if (chunk.data instanceof Binary) {
        data = new Uint8Array(chunk.data.buffer);
      } else if (chunk.data && typeof chunk.data === "object" && "$binary" in chunk.data) {
        data = new Uint8Array(Buffer.from(chunk.data.$binary.base64, "base64"));
      } else if (Buffer.isBuffer(chunk.data)) {
        data = new Uint8Array(chunk.data);
      } else {
        throw new Error(`Unsupported chunk data format at index ${i}`);
      }
      
      const tempPath = await Deno.makeTempFile({ suffix: ".opus" });
      await Deno.writeFile(tempPath, data);
      tempFiles.push(tempPath);
    }

    if (tempFiles.length === 0) {
      throw new Error("No valid audio chunks to combine");
    }

    // 2. Create concat file for ffmpeg
    const concatFilePath = await Deno.makeTempFile({ suffix: ".txt" });
    const concatContent = tempFiles.map(path => `file '${path}'`).join("\n");
    await Deno.writeTextFile(concatFilePath, concatContent);
    tempFiles.push(concatFilePath);

    // 3. Combine using ffmpeg
    const outputPath = await Deno.makeTempFile({ suffix: ".wav" });
    
    const ffmpegArgs = [
      "-f", "concat",
      "-safe", "0",
      "-i", concatFilePath,
      "-acodec", "pcm_s16le",
      "-ar", "16000",
      "-ac", "1",
      "-y",
      outputPath,
    ];

    console.log(`Running FFmpeg: ffmpeg ${ffmpegArgs.join(" ")}`);

    const process = new Deno.Command("ffmpeg", {
      args: ffmpegArgs,
      stdout: "piped",
      stderr: "piped",
    });

    const child = process.spawn();
    const status = await child.status;

        if (!status.success) {
        const stderr = await child.stderr.getReader().read();
        const errorMsg = new TextDecoder().decode(stderr.value || new Uint8Array());
        throw new Error(`ffmpeg concat failed: ${errorMsg}`);
        }

    const combinedData = await Deno.readFile(outputPath);
    await Deno.remove(outputPath);
    
    return combinedData;
  } finally {
    // Cleanup temp files
    for (const path of tempFiles) {
      try {
        await Deno.remove(path);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}




