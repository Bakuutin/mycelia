import { z } from "zod";
import { NetworkJobCapability } from "./python.ts";

export default new NetworkJobCapability({
  name: "testPythonIntegration",
  schema: z.object({
    type: z.literal("testPythonIntegration"),
  }),
  policies: [
    { resource: "db/testPythonIntegration", action: "read", effect: "allow" },
  ],
  url: `${Deno.env.get("PYTHON_WORKER_URL")}/jobs/testPythonIntegration`,
})
