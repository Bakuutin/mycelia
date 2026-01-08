import { z } from "zod";
import { createPythonJobCapability } from "./python.ts";
import { zDateOrString } from "@/lib/zod-json-schema.ts";

/** Schema for diarization job data */
export const schema = z.object({
  type: z.literal("diarization"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
});

const capability = createPythonJobCapability("diarization", schema, [
  { resource: "db/transcriptions", action: "read", effect: "allow" },
  { resource: "db/transcriptions", action: "update", effect: "allow" },
]);

export default capability;



