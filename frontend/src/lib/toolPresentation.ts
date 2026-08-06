/**
 * Presentation helpers for assistant tool calls in chat: friendly names,
 * human-readable one-line summaries, and unwrapping of the backend's
 * serialized tool outputs.
 */

/** Formats a tool name for display (e.g. "objects_create" -> "Objects Create"). */
export function formatToolName(toolName: string): string {
  return toolName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Backend tools return `{ type: "json" | "text", value }` (EJSON-encoded).
 * Unwraps to the plain value; `$oid` wrappers are flattened to hex strings so
 * ids can be used directly in links.
 */
export function parseToolOutput(output: unknown): unknown {
  if (
    output && typeof output === "object" && "value" in output &&
    ((output as any).type === "json" || (output as any).type === "text")
  ) {
    return flattenEjson((output as any).value);
  }
  return flattenEjson(output);
}

function flattenEjson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(flattenEjson);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === "$oid") return obj.$oid;
    if (keys.length === 1 && keys[0] === "$date") return obj.$date;
    const result: Record<string, unknown> = {};
    for (const key of keys) result[key] = flattenEjson(obj[key]);
    return result;
  }
  return value;
}

export interface ToolObjectRef {
  id: string;
  name?: string;
  type?: string;
  url: string;
}

/**
 * Extracts an object reference ({id, name, type, url}) from a write-tool
 * result, if present. Backend objects_create/update/merge return these
 * fields at the top level; split returns newObjectRef.
 */
export function getObjectRefFromOutput(output: unknown): ToolObjectRef | null {
  const value = parseToolOutput(output) as any;
  if (!value || typeof value !== "object") return null;
  const candidate = value.newObjectRef ?? value;
  const id = typeof candidate.id === "string"
    ? candidate.id
    : typeof candidate.url === "string"
    ? candidate.url.split("/").pop()
    : undefined;
  if (!id || !/^[a-fA-F0-9]{24}$/.test(id)) return null;
  return {
    id,
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    type: typeof candidate.type === "string" ? candidate.type : undefined,
    url: typeof candidate.url === "string" ? candidate.url : `/objects/${id}`,
  };
}

/** Tools whose completion deserves a prominent "action card" in the chat. */
export const WRITE_TOOLS = new Set([
  "objects_create",
  "objects_update",
  "objects_delete",
  "objects_merge",
  "objects_split",
]);

interface SummarizeArgs {
  toolName: string;
  input?: any;
  output?: unknown;
  state: string;
}

function countOf(value: any): number | undefined {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    if (typeof value.total === "number") return value.total;
    for (const key of ["objects", "results", "candidates", "groups"]) {
      if (Array.isArray(value[key])) return value[key].length;
    }
  }
  return undefined;
}

/**
 * One-line human summary of a tool call, phrased for its current state
 * (running vs completed). Falls back to the formatted tool name.
 */
export function summarizeToolCall(
  { toolName, input, output, state }: SummarizeArgs,
): string {
  const done = state === "output-available";
  const failed = state === "output-error";
  const value = done ? parseToolOutput(output) as any : undefined;
  const name = (v: any) => v?.name ? `"${v.name}"` : "";

  const summary = (() => {
    switch (toolName) {
      case "search_searchTranscriptions":
      case "search_searchMessages":
      case "search_searchObjects": {
        const target = toolName.replace("search_search", "").toLowerCase();
        const query = input?.query ? ` for "${input.query}"` : "";
        if (!done) return `Searching ${target}${query}…`;
        const count = countOf(value);
        return `Searched ${target}${query}${
          count !== undefined ? ` — ${count} result${count === 1 ? "" : "s"}` : ""
        }`;
      }
      case "objects_create": {
        const type = value?.type ?? (input?.object?.isEvent ? "event" : "object");
        const label = name(value) || (input?.object?.name ? `"${input.object.name}"` : "");
        return done ? `Created ${type} ${label}` : `Creating ${type} ${label}…`;
      }
      case "objects_update": {
        const field = input?.field ? ` (${input.field})` : "";
        return done
          ? `Updated ${name(value) || "object"}${field}`
          : `Updating object${field}…`;
      }
      case "objects_delete":
        return done
          ? `Deleted ${name(value) || "object"}`
          : "Deleting object…";
      case "objects_merge": {
        const loserCount = input?.loserIds?.length;
        const into = name(value);
        return done
          ? `Merged ${loserCount ?? "several"} object${loserCount === 1 ? "" : "s"} into ${into || "one"}`
          : `Merging ${loserCount ?? ""} objects…`;
      }
      case "objects_split":
        return done
          ? `Split off ${value?.newObjectRef?.name ? `"${value.newObjectRef.name}"` : "a new object"}`
          : "Splitting object…";
      case "objects_get":
        return done ? `Read ${name(value) || "object"}` : "Reading object…";
      case "objects_list": {
        if (!done) return "Listing objects…";
        const count = countOf(value);
        return `Listed objects${count !== undefined ? ` — ${count}` : ""}`;
      }
      case "objects_getRelationships":
        return done ? "Explored relationships" : "Exploring relationships…";
      case "objects_exploreTimeRange":
        return done ? "Explored time range" : "Exploring time range…";
      case "objects_findDuplicates": {
        if (!done) return "Looking for duplicates…";
        const count = countOf(value);
        return `Found ${count ?? "possible"} duplicate group${count === 1 ? "" : "s"}`;
      }
      case "objects_getHistory":
        return done ? "Read object history" : "Reading object history…";
      case "objects_getCounts":
        return done ? "Read object counts" : "Reading object counts…";
      case "docs_search":
      case "docs_list":
      case "docs_read": {
        const doc = input?.name ? ` "${input.name}"` : "";
        return done ? `Checked documentation${doc}` : `Checking documentation${doc}…`;
      }
      default: {
        if (toolName.startsWith("mongo_")) {
          const op = toolName.slice(6);
          const collection = input?.collection ? ` ${input.collection}` : "";
          return done
            ? `Queried${collection} (${op})`
            : `Querying${collection} (${op})…`;
        }
        return done ? formatToolName(toolName) : `${formatToolName(toolName)}…`;
      }
    }
  })();

  return failed ? `${summary.replace(/…$/, "")} — failed` : summary;
}
