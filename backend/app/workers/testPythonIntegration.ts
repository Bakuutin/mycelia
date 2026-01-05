import { z } from "zod";
import { createPythonJobCapability } from "./python.ts";

/** Schema for test Python integration job data */
export const schema = z.object({
  type: z.literal("testPythonIntegration"),
});

const capability = createPythonJobCapability("testPythonIntegration", schema);

export const name = capability.name;
export const use = capability.use;



