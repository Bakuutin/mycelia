import { env } from "#/env.ts";

export interface CliConfig {
  url: string;
  token: string;
  clientId: string;
}

export function getConfig(): CliConfig {
  if (!env.MYCELIA_URL) {
    throw new Error("MYCELIA_URL is not set");
  }

  if (!env.MYCELIA_TOKEN) {
    throw new Error("MYCELIA_TOKEN is not set");
  }

  if (!env.MYCELIA_CLIENT_ID) {
    throw new Error("MYCELIA_CLIENT_ID is not set");
  }

  return {
    url: env.MYCELIA_URL,
    token: env.MYCELIA_TOKEN,
    clientId: env.MYCELIA_CLIENT_ID,
  };
}

export function getUrl(path: string): string {
  const config = getConfig();
  return `${config.url}${path}`;
}
