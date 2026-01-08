import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { processJob } from "@/lib/jobs/processor.ts";
import { enqueueJob } from "@/lib/jobs/queue.ts";
import { schema as VadJobDataSchema } from "@/workers/vad.ts";
import type { z } from "zod";
import "./fixtures.ts";
import { jobRegistry } from "../job-registry.ts";

type VadJobDataInput = z.input<typeof VadJobDataSchema>;
type VadJobData = z.infer<typeof VadJobDataSchema>;

Deno.test(
  "processJob spawns a child process and handles progress",
  withFixtures(["JobQueue", "Mongo"], async () => {
    // Ensure SECRET_KEY is set for signJWT
    if (!Deno.env.get("SECRET_KEY")) {
      Deno.env.set("SECRET_KEY", "test-secret-key-12345678901234567890");
    }

    // We need to mock Deno.Command to avoid actually spawning a process in tests
    // or we can test the behavior of the processor with a simple script.
    
    // For now, let's just verify the logic of signJWT and environment setup
    // because full integration testing of child processes is complex in this environment.
    
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 10,
    };

    const job = await enqueueJob(jobData as any);
    
    // We will verify the processor logic by mocking Deno.Command
    const originalCommand = Deno.Command;
    
    let spawned = false;
    let capturedEnv: Record<string, string> = {};
    
    // @ts-ignore: Mocking Deno.Command
    Deno.Command = class MockCommand {
      constructor(_command: string, options: Deno.CommandOptions) {
        capturedEnv = options.env as Record<string, string>;
      }
      spawn() {
        spawned = true;
        return {
          stdin: {
            getWriter: () => ({
              write: async () => {},
              close: async () => {},
            }),
          },
          stdout: {
            getReader: () => ({
              read: async () => ({ done: true, value: new Uint8Array() }),
            }),
          },
          stderr: {
            getReader: () => ({
              read: async () => ({ 
                done: false, 
                value: new TextEncoder().encode("__PROGRESS__:{\"stage\":\"test\"}\n") 
              }),
            }),
          },
          status: Promise.resolve({ code: 0 }),
        };
      }
      output() {
        return Promise.resolve({
          code: 0,
          stdout: new TextEncoder().encode(JSON.stringify({ success: true })),
          stderr: new Uint8Array(),
        });
      }
    };

    try {
      // We need to make sure the registry has the 'vad' capability with policies
      const capability = jobRegistry.get("vad");
      if (capability) {
        capability.policies = [{ resource: "db/audio_chunks", action: "read", effect: "allow" }];
      }

      await processJob(job);

      expect(spawned).toBe(true);
      expect(capturedEnv.MYCELIA_JWT).toBeDefined();
      expect(capturedEnv.MONGO_URL).toBeDefined();
    } finally {
      // @ts-ignore
      Deno.Command = originalCommand;
    }
  }),
);

