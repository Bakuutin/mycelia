import { load as loadEnv } from "@std/dotenv";
import { existsSync } from "@std/fs/exists";

if (existsSync(".env")) {
  await loadEnv({ envPath: ".env", export: true });
}

if (existsSync("../.env")) {
  await loadEnv({ envPath: "../.env", export: true });
}

export const env = {
  REDIS_PASSWORD: Deno.env.get("REDIS_PASSWORD"),
  REDIS_HOST: Deno.env.get("REDIS_HOST") || "localhost",
  REDIS_PORT: parseInt(Deno.env.get("REDIS_PORT") || "6379"),

  MONGO_URL: Deno.env.get("MONGO_URL") as string,
  DATABASE_NAME: Deno.env.get("DATABASE_NAME") as string,

  PYTHON_WORKER_URL: Deno.env.get("PYTHON_WORKER_URL") || "http://localhost:8000",

  get SECRET_KEY() { return Deno.env.get("SECRET_KEY") as string; },

  MYCELIA_FRONTEND_HOST: Deno.env.get("MYCELIA_FRONTEND_HOST") || "http://localhost:3001",

  OTEL_EXPORTER_OTLP_ENDPOINT: Deno.env.get("OTEL_EXPORTER_OTLP_ENDPOINT") ?? "http://localhost:4318",

  MYCELIA_URL: Deno.env.get("MYCELIA_URL"),
  MYCELIA_TOKEN: Deno.env.get("MYCELIA_TOKEN"),
  MYCELIA_CLIENT_ID: Deno.env.get("MYCELIA_CLIENT_ID"),
};
