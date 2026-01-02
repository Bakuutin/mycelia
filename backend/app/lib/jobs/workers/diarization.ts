import { z } from "zod";
import { createPythonJobCapability } from "./python.ts";

/** Schema for diarization job data */
export const schema = z.object({
  type: z.literal("diarization"),
  start: z.coerce.date().optional(),
  end: z.coerce.date().optional(),
});

const capability = createPythonJobCapability("diarization", schema);

export const name = capability.name;
export const use = capability.use;


