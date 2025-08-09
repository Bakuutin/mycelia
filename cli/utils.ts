import ms from "ms";
import { CliConfig, getUrl } from "./config.ts";

export function parseDateOrRelativeTime(
  expr: string | undefined,
): Date | undefined {
  if (!expr) return undefined;
  try {
    const relativeMs = ms(expr);
    if (relativeMs) {
      return new Date(Date.now() - relativeMs);
    }
    return new Date(expr);
  } catch {
    throw new Error(
      `Invalid time expression: ${expr}. Use format like "5d" or "10m" or an ISO date`,
    );
  }
}

export async function getJWT(config: CliConfig) {
  const response = await fetch(
    getUrl("/api/login"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: config.token }),
    },
  );
  const { jwt, error } = await response.json();
  if (error) {
    throw new Error(`Authentication failed: ${error}`);
  }
  return jwt;
}
