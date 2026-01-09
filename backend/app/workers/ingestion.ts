import { z } from "zod";
import { createPythonJobCapability } from "./python.ts";

/** Schema for ingestion job data */
export const schema = z.object({
  type: z.literal("ingestion"),
  source: z.string().optional(),
});

const capability = createPythonJobCapability("ingestion", schema, [
  { resource: "db/audio_chunks", action: "write", effect: "allow" },
]);

export default capability;



