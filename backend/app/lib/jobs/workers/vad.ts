import { z } from "zod";
import { createPythonJobCapability } from "./python.ts";

/** Schema for VAD job data */
export const schema = z.object({
  type: z.literal("vad"),
  start: z.coerce.date().optional(),
  end: z.coerce.date().optional(),
  originalId: z.string().optional(),
  limit: z.number().default(1000),
  batchSize: z.number().default(100),
});

const capability = createPythonJobCapability("vad", schema);

export const name = capability.name;
export const use = capability.use;



