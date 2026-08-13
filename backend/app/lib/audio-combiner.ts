import { Binary } from "bson";
import { Buffer } from "node:buffer";
import { Binary as MongoBinary } from "mongodb";
import { teeOutput } from "./subprocess.ts";

export async function combineChunks(chunks: any[]): Promise<Uint8Array> {
  const tempFiles: string[] = [];

  try {
    // 1. Write chunks to temporary files
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      let data: Uint8Array;

      if (chunk.data instanceof Uint8Array) {
        data = chunk.data;
      } else if (
        chunk.data instanceof Binary || chunk.data instanceof MongoBinary
      ) {
        data = new Uint8Array(chunk.data.buffer);
      } else if (
        chunk.data && typeof chunk.data === "object" && "$binary" in chunk.data
      ) {
        data = new Uint8Array(Buffer.from(chunk.data.$binary.base64, "base64"));
      } else if (Buffer.isBuffer(chunk.data)) {
        data = new Uint8Array(chunk.data);
      } else {
        throw new Error(
          `Unsupported chunk data format at index ${i}: ${typeof chunk.data}`,
        );
      }

      const tempPath = await Deno.makeTempFile({ suffix: ".opus" });
      await Deno.writeFile(tempPath, data);
      tempFiles.push(tempPath);
    }

    if (tempFiles.length === 0) {
      throw new Error("No valid audio chunks to combine");
    }

    // 2. Combine using ffmpeg. Audio chunks can carry absolute Opus packet
    // timestamps (for example, chunk 72 starts around PTS 720s). The concat
    // demuxer preserves/accumulates those offsets and can turn a few minutes of
    // audio into a multi-hour WAV. Decode every input separately and reset its
    // PTS before concatenating so only the actual packet durations are joined.
    const outputPath = await Deno.makeTempFile({ suffix: ".wav" });
    const inputArgs = tempFiles.flatMap((path) => ["-i", path]);
    const normalizedInputs = tempFiles.map((_, index) =>
      `[${index}:a]asetpts=PTS-STARTPTS[a${index}]`
    );
    const concatInputs = tempFiles.map((_, index) => `[a${index}]`).join("");
    const filterGraph = [
      ...normalizedInputs,
      `${concatInputs}concat=n=${tempFiles.length}:v=0:a=1[outa]`,
    ].join(";");

    const ffmpegArgs = [
      ...inputArgs,
      "-filter_complex",
      filterGraph,
      "-map",
      "[outa]",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-y",
      outputPath,
    ];

    console.log(`Running FFmpeg: ffmpeg ${ffmpegArgs.join(" ")}`);

    const process = new Deno.Command("ffmpeg", {
      args: ffmpegArgs,
      stdout: "piped",
      stderr: "piped",
    });

    const { success, stderr } = await teeOutput(process, (stream, line) => {
      if (stream === "stderr" && line.includes("invalid dropping")) {
        return;
      }
      console.log(`[ffmpeg:${stream}] ${line}`);
    });

    if (!success) {
      const errorMsg = new TextDecoder().decode(stderr);
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
