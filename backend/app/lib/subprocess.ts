export interface TeeOutputResult {
  success: boolean;
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

export type Logger = (stream: "stdout" | "stderr", line: string) => void;

const basicLogger = (stream: "stdout" | "stderr", line: string) => {
  if (stream === "stdout") {
    console.log(`[${stream}] ${line}`);
  } else {
    console.error(`[${stream}] ${line}`);
  }
};

/**
 * Runs a Deno.Command, consuming stdout/stderr concurrently to avoid deadlock.
 * Optionally logs output lines as they arrive.
 */
export async function teeOutput(
  process: Deno.Command,
  logger: Logger = basicLogger,
): Promise<TeeOutputResult> {
  const child = process.spawn();

  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];

  const readStream = async (
    stream: ReadableStream<Uint8Array>,
    chunks: Uint8Array[],
    streamName: "stdout" | "stderr",
  ) => {
    const reader = stream.getReader();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);

      buffer += new TextDecoder().decode(value);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line) {
          logger(streamName, line);
        }
      }
    }

    if (buffer) {
      logger(streamName, buffer);
    }
  };

  const [status] = await Promise.all([
    child.status,
    readStream(child.stdout, stdoutChunks, "stdout"),
    readStream(child.stderr, stderrChunks, "stderr"),
  ]);

  const concat = (chunks: Uint8Array[]): Uint8Array => {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  };

  return {
    success: status.success,
    code: status.code,
    stdout: concat(stdoutChunks),
    stderr: concat(stderrChunks),
  };
}
