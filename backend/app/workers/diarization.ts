import { z } from "zod";
import { createPythonJobCapability } from "./python.ts";
import { zDateOrString } from "@/lib/zod-json-schema.ts";

/** Schema for diarization job data */
export const schema = z.object({
  type: z.literal("diarization"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
});

const capability = createPythonJobCapability("diarization", schema);

export const name = capability.name;
export const use = capability.use;



