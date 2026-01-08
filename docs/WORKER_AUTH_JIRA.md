# Jira Ticket: Implement Short-lived Job Keys for Workers


Currently, workers in Mycelia may rely on long-lived API keys or broad "system" permissions to interact with the server. To enhance security, isolation, and auditability, we need to transition to a **Short-lived Job Key** model. 

In this model, when a job is dispatched to a worker (e.g., audio transcription, chunking), the dispatcher generates a unique, time-limited JWT specifically for that job. This token should be scoped to only the resources necessary for that specific task.

The Job file is run via runner.ts that is run in parallel in deno

- Each capability defines permissions it needs, no default value, if requested full permissions show a warning too broad permissions

run worker like this

```ts
// host.ts
const jobEnv = {
  MYCELIA_JWT: "tmp-job-key",
  MYCELIA_URL: Deno.env.get("MYCELIA_URL") || "http://backend:5173",
  MYCELIA_SDK_PATH: Deno.cwd(), // Path to the backend root where app/ resides
};

const cmd = new Deno.Command("deno", {
  args: [
    "run",
    "-E", // allow env in the *child* process
    `--config=${jobEnv.MYCELIA_SDK_PATH}/deno.json`, // Use the SDK's import maps
    `--allow-read=${jobEnv.MYCELIA_SDK_PATH}`,       // Allow access to source code
    `--allow-net=${jobEnv.MYCELIA_URL}`,             // Allow talking back to the API
    "workerLauncher.ts",
  ],
  env: jobEnv,      // child's environment (not host env)
  stdin: "null",
  stdout: "piped",
  stderr: "piped",
});

const { code, stdout, stderr } = await cmd.output();

console.log("exit:", code);
console.log(new TextDecoder().decode(stdout));
console.error(new TextDecoder().decode(stderr));
```

How workerLauncher.ts should look like:

```ts
import { verifyToken, Auth } from "@/lib/auth/core.server.ts";
import { jobRegistry, discoverJobWorkers } from "@/lib/jobs/job-registry.ts";

/**
 * Worker Launcher - Entry point for isolated job processes
 * 
 * 1. Validates the short-lived JWT from environment
 * 2. Loads the target worker capability
 * 3. Executes the job with limited permissions
 */

async function main() {
  const jwt = Deno.env.get("MYCELIA_JWT");
  const workerPath = Deno.args[0]; // e.g. "backend/app/workers/transcription.ts"
  const jobDataRaw = await Deno.readAll(Deno.stdin);
  const jobData = JSON.parse(new TextDecoder().decode(jobDataRaw));

  if (!jwt) {
    console.error("Missing MYCELIA_JWT environment variable");
    Deno.exit(1);
  }

  // Verify the short-lived token
  const auth = await verifyToken(jwt);
  if (!auth) {
    console.error("Invalid or expired MYCELIA_JWT");
    Deno.exit(1);
  }

  // Discover workers and find the one for this job
  await discoverJobWorkers();
  const capability = jobRegistry.get(jobData.type);

  if (!capability) {
    console.error(`No capability found for job type: ${jobData.type}`);
    Deno.exit(1);
  }

  try {
    // Execute job. The worker's internal calls (e.g. getMongoResource) 
    // will use the permissions from the JWT via updated getServerAuth()
    const result = await capability.use(jobData);
    console.log(JSON.stringify(result));
    Deno.exit(0);
  } catch (err) {
    console.error(`Job failed: ${err.message}`);
    Deno.exit(1);
  }
}

main();
```

## Implementation Details

### 1. Update `getServerAuth` for Context Awareness

Modify `backend/app/lib/auth/core.server.ts` to prioritize the environment's `MYCELIA_JWT` if present. This allows workers to automatically use their job-specific identity without changing existing code that calls `getServerAuth()`.

```ts
export const getServerAuth = async (): Promise<Auth> => {
  const token = Deno.env.get("MYCELIA_JWT");
  if (token) {
    const auth = await verifyToken(token);
    if (auth) return auth;
    console.warn("MYCELIA_JWT found but invalid, falling back to system permissions");
  }

  return new Auth({
    principal: "server",
    policies: [{ resource: "**", action: "*", effect: "allow" }],
  });
};
```

### 2. Define Policies in Job Capabilities

Add a `policies` field to `JobCapability` interface to declare required permissions.

```ts
// backend/app/lib/jobs/job-registry.ts
export interface JobCapability extends Capability<Job<JobData>, JobResult> {
  name: string;
  use: (job: Job<JobData>) => Promise<JobResult>;
  schema: z.ZodType<JobData>;
  policies: Policy[]; // Required: define what this worker can do
  // ...
}
```

Example usage in `transcription.ts`:

```ts
export const capability: JobCapability = {
  name: "transcription",
  schema: transcriptionSchema,
  policies: [
    { resource: "audio_chunks/**", action: "read", effect: "allow" },
    { resource: "transcriptions/**", action: "write", effect: "allow" },
    { resource: "jobs", action: "update", effect: "allow" }
  ],
  use: async (job) => { /* ... */ }
};
```

### 3. Token Generation in Dispatcher (`runner.ts`)

When starting a child process, the dispatcher must:
1. Look up the `policies` from the capability.
2. Sign a JWT with a short expiration (e.g., 5-15 mins).
3. Set the `principal` to `job:<job_id>`.

```ts
const token = await signJWT(
  "job-system",
  `job:${job.id}`,
  capability.policies,
  "15 minutes"
);
```

### 4. SDK Path and File System Access

To ensure the worker can import project modules and workers, the host must grant read access to the source code and point Deno to the correct configuration.

- **`MYCELIA_SDK_PATH`**: The absolute path to the backend directory.
- **`--config`**: Points Deno to `deno.json` so that `@/` and `#/` imports resolve correctly in the child process.
- **`--allow-read`**: Restricted to the SDK path to prevent the worker from reading sensitive system files outside the project.

```ts
const sdkPath = Deno.cwd(); 

const cmd = new Deno.Command("deno", {
  args: [
    "run",
    "-E",
    `--config=${sdkPath}/deno.json`,
    `--allow-read=${sdkPath}`,
    `--allow-net=${Deno.env.get("MYCELIA_URL")}`,
    "workerLauncher.ts",
    job.data.workerPath // path to worker file relative to sdkPath
  ],
  // ...
});
```

## Security & Audit Goals
- **Isolation**: If a worker process is compromised, it only has access to resources defined in its policies.
- **Auditability**: Access logs will show `job:<id>` as the principal, making it easy to trace database changes back to specific job executions.
- **Least Privilege**: Workers no longer run with full "server" permissions by default.
