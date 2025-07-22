export interface CliConfig {
  url: string;
  token: string;
}

export function getConfig(): CliConfig {
  const url = Deno.env.get("MYCELIA_URL");
  if (!url) {
    throw new Error("MYCELIA_URL is not set");
  }

  const token = Deno.env.get("MYCELIA_TOKEN");
  if (!token) {
    throw new Error("MYCELIA_TOKEN is not set");
  }

  return { url, token };
}

export function getUrl(path: string): string {
  const config = getConfig();
  return `${config.url}${path}`;
}
