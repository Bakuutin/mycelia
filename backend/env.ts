import { load as loadEnv } from "@std/dotenv";
import { existsSync } from "@std/fs/exists";

if (
  Deno.permissions.querySync({ name: "read", path: ".env" }).state ===
    "granted" &&
  existsSync(".env")
) {
  await loadEnv({ envPath: ".env", export: true });
}

if (
  Deno.permissions.querySync({ name: "read", path: "../.env" }).state ===
    "granted" &&
  existsSync("../.env")
) {
  await loadEnv({ envPath: "../.env", export: true });
}

export const env = {
  REDIS_PASSWORD: Deno.env.get("REDIS_PASSWORD"),
  REDIS_HOST: Deno.env.get("REDIS_HOST") || "localhost",
  REDIS_PORT: parseInt(Deno.env.get("REDIS_PORT") || "6379"),

  MONGO_URL: Deno.env.get("MONGO_URL") as string,
  DATABASE_NAME: Deno.env.get("DATABASE_NAME") as string,

  PYTHON_WORKER_URL: Deno.env.get("PYTHON_WORKER_URL") ||
    "http://localhost:8000",

  get SECRET_KEY() {
    const key = Deno.env.get("SECRET_KEY");
    if (!key || key === "change-me-please") {
      throw new Error("SECRET_KEY environment variable is required");
    }
    return key;
  },

  MYCELIA_FRONTEND_HOST: Deno.env.get("MYCELIA_FRONTEND_HOST") ||
    "http://localhost:3001",

  OTEL_EXPORTER_OTLP_ENDPOINT: Deno.env.get("OTEL_EXPORTER_OTLP_ENDPOINT") ??
    "http://localhost:4318",

  MYCELIA_URL: Deno.env.get("MYCELIA_URL") || "http://backend:5173",
  MYCELIA_TOKEN: Deno.env.get("MYCELIA_TOKEN"),
  MYCELIA_CLIENT_ID: Deno.env.get("MYCELIA_CLIENT_ID"),

  // Job Queue Configuration
  JOB_TRIGGERS_FAST: Deno.env.get("JOB_TRIGGERS_FAST") === "true",
  JOB_DEBOUNCE_MS: Deno.env.get("JOB_DEBOUNCE_MS")
    ? parseInt(Deno.env.get("JOB_DEBOUNCE_MS")!)
    : undefined,
  JOB_INTERVAL_SECONDS: Deno.env.get("JOB_INTERVAL_SECONDS")
    ? parseInt(Deno.env.get("JOB_INTERVAL_SECONDS")!)
    : undefined,

  // Transcription Configuration
  TRANSCRIPTION_LANGUAGE: Deno.env.get("TRANSCRIPTION_LANGUAGE") || "auto",
  // Number of ready sequences kept in one worker job. The worker pre-assembles
  // the next sequence while Whisper is transcribing the current one.
  TRANSCRIPTION_BATCH_SIZE: (() => {
    const raw = Number(Deno.env.get("TRANSCRIPTION_BATCH_SIZE") || "1");
    return Number.isInteger(raw) && raw > 0 ? Math.min(raw, 8) : 1;
  })(),
};
