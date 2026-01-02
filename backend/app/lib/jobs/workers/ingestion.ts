import { z } from "zod";
import { createPythonJobCapability } from "./python.ts";

/** Schema for ingestion job data */
export const schema = z.object({
  type: z.literal("ingestion"),
  source: z.string().optional(),
});

const capability = createPythonJobCapability("ingestion", schema);

export const name = capability.name;
export const use = capability.use;


