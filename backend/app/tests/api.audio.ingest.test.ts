import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { action } from "@/routes/api.audio.ingest.tsx";

function createMockRequest(formData: FormData, bearerToken: string): Request {
  return new Request("http://localhost/api/audio/ingest", {
    method: "POST",
    headers: {
      "Authorization": bearerToken,
    },
    body: formData,
  });
}

async function loadSampleAudioFile(name = "test.wav"): Promise<File> {
  const samplePath = new URL("./sample_audio.wav", import.meta.url);
  const fileData = await Deno.readFile(samplePath);
  return new File([fileData], name, { type: "audio/wav" });
}

Deno.test(
  "audio ingest endpoint should handle single audio file upload",
  withFixtures(
    ["Admin", "Mongo", "BearerFactory", "ServerAuth"],
    async (auth: Auth, _, bearerFactory) => {
      const bearerToken = await bearerFactory(auth);

      const formData = new FormData();
      const audioFile = await loadSampleAudioFile("single_upload.wav");
      formData.append("audio", audioFile);

      const data = {
        start: new Date().toISOString(),
        chunk_number: 0,
        metadata: { test: true },
      };
      formData.append("data", JSON.stringify(data));

      const request = createMockRequest(formData, bearerToken);
      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.chunk_id).toBeDefined();
      expect(result.source_file_id).toBeDefined();
      expect(result.chunk_number).toBe(0);
      expect(result.file_size).toBeGreaterThan(0);
      expect(result.streaming).toBe(false);
      expect(result.message).toContain("processed and stored successfully");
    },
  ),
);
