import { GoogleAuth } from "google-auth-library";

let auth: GoogleAuth | undefined;

function getGoogleAuth(): GoogleAuth {
  auth ??= new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  return auth;
}

export async function getGoogleAccessToken(): Promise<string> {
  const client = await getGoogleAuth().getClient();
  const token = await client.getAccessToken();
  const value = typeof token === "string" ? token : token?.token;
  if (!value) throw new Error("Google ADC did not return an access token");
  return value;
}

export async function inspectGoogleAdc(): Promise<{
  configured: boolean;
  credentialPathConfigured: boolean;
  error?: string;
}> {
  try {
    await getGoogleAccessToken();
    return {
      configured: true,
      credentialPathConfigured: Boolean(
        Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS"),
      ),
    };
  } catch (error) {
    return {
      configured: false,
      credentialPathConfigured: Boolean(
        Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS"),
      ),
      error: sanitizeGoogleError(error),
    };
  }
}

export function sanitizeGoogleError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/ya29\.[A-Za-z0-9._~-]+/g, "[redacted]")
    .replace(/refresh_token[^,}\n]*/gi, "refresh_token=[redacted]")
    .slice(0, 500);
}
