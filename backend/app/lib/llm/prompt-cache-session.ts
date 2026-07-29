import { createHash } from "node:crypto";

/**
 * Build an OpenRouter sticky-session key from the part of a request that can
 * actually be reused by a provider prompt cache. The dynamic transcript or
 * conversation must not be included: it belongs after the stable prefix.
 *
 * The digest keeps prompts out of logs and makes a prompt/schema edit start a
 * fresh provider session instead of pinning an unrelated request stream.
 */
export function createPromptCacheSessionId(
  task: string,
  stablePrefix: unknown,
): string {
  const scope = task.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!scope) throw new Error("Prompt-cache task scope must not be empty");

  const digest = createHash("sha256")
    .update(JSON.stringify(stablePrefix))
    .digest("hex")
    .slice(0, 16);

  return `${scope}:v1:${digest}`;
}
