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
