/**
 * Provider-shaped helpers shared by every LLM worker. Extraction-agnostic:
 * this module knows about OpenAI-compatible request/response conventions,
 * not about conversations or entities.
 */

/**
 * OpenAI-compatible json_schema response format. Strict providers (vLLM,
 * OpenRouter passthrough) require the {name, schema} envelope — a bare JSON
 * schema is rejected with a validation error.
 */
export function buildJsonSchemaResponseFormat(
  name: string,
  schema: Record<string, unknown>,
): {
  type: "json_schema";
  json_schema: { name: string; schema: Record<string, unknown> };
} {
  return { type: "json_schema", json_schema: { name, schema } };
}

/**
 * Unified fallback policy for LLM workers: an explicit non-empty job value
 * wins, then the worker's env override; otherwise undefined so the LLM
 * resource applies the provider route's configured fallback (the common
 * per-route fallback managed in Settings → Inference).
 */
export function resolveWorkerFallbackModel(
  requested: string | undefined,
  envVar: string,
): string | undefined {
  const explicit = requested?.trim();
  if (explicit) return explicit;
  const env = Deno.env.get(envVar)?.trim();
  return env || undefined;
}

function stripMarkdownCodeBlock(content: string): string {
  let cleaned = content.trim();
  // Remove ```json or ``` at the start
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  // Remove trailing ```
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  return cleaned.trim();
}

/**
 * Robustly extract and parse JSON from LLM response that may contain extra text.
 * Handles cases where LLM adds explanatory text before or after the JSON.
 */
export function extractJsonFromText(content: string): any {
  const cleaned = stripMarkdownCodeBlock(content);

  // First, try to parse as-is (for clean JSON responses)
  try {
    return JSON.parse(cleaned);
  } catch (_e) {
    // Continue to more robust extraction
  }

  // Try to find JSON object {} or array []
  // Look for the first { or [ and find its matching closing bracket
  const jsonStart = Math.min(
    cleaned.indexOf("{") >= 0 ? cleaned.indexOf("{") : Infinity,
    cleaned.indexOf("[") >= 0 ? cleaned.indexOf("[") : Infinity,
  );

  if (jsonStart === Infinity) {
    const preview = cleaned.length > 200
      ? cleaned.slice(0, 200) + "..."
      : cleaned;
    throw new Error(
      `No JSON object or array found in response. Got: ${preview}`,
    );
  }

  // Find the matching closing bracket
  const startChar = cleaned[jsonStart];
  const endChar = startChar === "{" ? "}" : "]";
  let depth = 0;
  let jsonEnd = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = jsonStart; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === startChar) {
        depth++;
      } else if (char === endChar) {
        depth--;
        if (depth === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }
  }

  if (jsonEnd === -1) {
    throw new Error("Could not find complete JSON object/array in response");
  }

  const jsonStr = cleaned.substring(jsonStart, jsonEnd);
  return JSON.parse(jsonStr);
}
