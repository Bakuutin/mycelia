import { z } from "zod";
import { createPythonJobCapability } from "./python.ts";
import { zDateOrString } from "@/lib/zod-json-schema.ts";

/** Schema for transcription job data */
export const schema = z.object({
  type: z.literal("transcription"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
});

const capability = createPythonJobCapability("transcription", schema);

export const name = capability.name;
export const use = capability.use;



