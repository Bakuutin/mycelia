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
    getUrl("/oauth/token"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body:
        `grant_type=client_credentials&client_id=${config.clientId}&client_secret=${config.token}`,
    },
  );

  if (!response.ok) {
    const errorBody = await response.json();
    throw new Error(
      `Authentication failed: ${JSON.stringify(errorBody) || "Unknown error"}`,
    );
  }

  const { access_token, error } = await response.json();
  if (error) {
    throw new Error(`Authentication failed: ${error}`);
  }
  return access_token;
}
