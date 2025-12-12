// NOTE: This file runs under Deno, but TypeScript tooling in some editors
// may not include Deno globals for this workspace.
declare const Deno: any;
import { generateApiKeyWithId } from "@/lib/auth/tokens.ts";

const secretsFile = Deno.env.get("MYCELIA_SECRETS_FILE") ?? "/run/mycelia/mycelia.env";

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

async function main() {
  // If credentials are already present, do nothing.
  if (await fileExists(secretsFile)) {
    const existing = parseEnvFile(await Deno.readTextFile(secretsFile));
    if (existing.MYCELIA_TOKEN && existing.MYCELIA_CLIENT_ID) {
      console.log(`Credentials already exist at ${secretsFile}`);
      return;
    }
  }

  const owner = Deno.env.get("MYCELIA_INIT_OWNER") ?? "admin";
  const name = Deno.env.get("MYCELIA_INIT_TOKEN_NAME") ?? "docker_init";

  const { apiKey, clientId } = await generateApiKeyWithId(owner, name, [
    { resource: "**", action: "**", effect: "allow" },
  ]);

  const dir = secretsFile.includes("/") ? secretsFile.slice(0, secretsFile.lastIndexOf("/")) : ".";
  await Deno.mkdir(dir, { recursive: true });

  const contents = [
    "# Auto-generated on first run. Safe to persist in docker volume.",
    `MYCELIA_TOKEN=${apiKey}`,
    `MYCELIA_CLIENT_ID=${clientId}`,
    "",
  ].join("\n");

  await Deno.writeTextFile(secretsFile, contents, { create: true });

  console.log(`Wrote credentials to ${secretsFile}`);
  console.log(`MYCELIA_TOKEN=${apiKey}`);
  console.log(`MYCELIA_CLIENT_ID=${clientId}`);
}

await main();
