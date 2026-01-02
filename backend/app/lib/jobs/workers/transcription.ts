import { z } from "zod";
import { createPythonJobCapability } from "./python.ts";

/** Schema for transcription job data */
export const schema = z.object({
  type: z.literal("transcription"),
  start: z.coerce.date().optional(),
  end: z.coerce.date().optional(),
});

const capability = createPythonJobCapability("transcription", schema);

export const name = capability.name;
export const use = capability.use;


