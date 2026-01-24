import { z } from "zod";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import * as path from "@std/path";

interface DocEntry {
  id: string;
  title: string;
  tags: string[];
  content: string;
}

// Cache for loaded documentation
let docsCache: Map<string, DocEntry> | null = null;
let lastLoadTime = 0;
const CACHE_TTL_MS = 60 * 1000; // Reload every 60 seconds in dev

// Path to docs directory (relative to project root)
const DOCS_DIR = path.join(Deno.cwd(), "..", "docs", "assistant");

/**
 * Extract Obsidian-style tags from content
 * Tags are words starting with # (but not ## headers)
 */
function extractTags(content: string): string[] {
  const tags: string[] = [];
  // Match #tag but not ##header or # header
  // Tags must be at word boundary, followed by word characters
  const tagRegex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g;
  let match;
  while ((match = tagRegex.exec(content)) !== null) {
    const tag = match[1].toLowerCase();
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Extract title from content (first # heading) or use filename
 */
function extractTitle(content: string, filename: string): string {
  // Look for first # heading (not ## or more)
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1].trim();
  }
  // Fall back to filename without extension, converted to title case
  return filename
    .replace(/\.md$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Load all markdown files from the docs directory
 */
async function loadDocs(): Promise<Map<string, DocEntry>> {
  const docs = new Map<string, DocEntry>();

  try {
    // Check if directory exists
    try {
      await Deno.stat(DOCS_DIR);
    } catch {
      console.warn(`[DocsResource] Docs directory not found: ${DOCS_DIR}`);
      return docs;
    }

    // Read all .md files from the directory
    for await (const entry of Deno.readDir(DOCS_DIR)) {
      if (entry.isFile && entry.name.endsWith(".md")) {
        const filePath = path.join(DOCS_DIR, entry.name);
        try {
          const content = await Deno.readTextFile(filePath);
          const id = entry.name.replace(/\.md$/, "");
          const title = extractTitle(content, entry.name);
          const tags = extractTags(content);

          docs.set(id, {
            id,
            title,
            tags,
            content,
          });
        } catch (err) {
          console.error(`[DocsResource] Failed to load ${entry.name}:`, err);
        }
      }
    }

    console.log(`[DocsResource] Loaded ${docs.size} documentation files`);
  } catch (err) {
    console.error("[DocsResource] Failed to load docs:", err);
  }

  return docs;
}

/**
 * Get docs with caching
 */
async function getDocs(): Promise<Map<string, DocEntry>> {
  const now = Date.now();
  if (!docsCache || now - lastLoadTime > CACHE_TTL_MS) {
    docsCache = await loadDocs();
    lastLoadTime = now;
  }
  return docsCache;
}

/**
 * Force reload docs (useful after changes)
 */
export function reloadDocs(): void {
  docsCache = null;
  lastLoadTime = 0;
}

// List available documentation topics
const listDocsSchema = z.object({
  action: z.literal("list").describe(
    "List all available documentation topics. Use this to discover what documentation is available."
  ),
  tag: z.string().optional().describe(
    "Filter by tag (e.g., 'objects', 'search', 'create'). Leave empty for all topics."
  ),
});

// Read specific documentation
const readDocSchema = z.object({
  action: z.literal("read").describe(
    "Read a specific documentation topic. Use the topic ID from the list action."
  ),
  topic: z.string().describe(
    "The topic ID to read (e.g., 'creating-people', 'time-queries')"
  ),
});

// Search documentation
const searchDocsSchema = z.object({
  action: z.literal("search").describe(
    "Search documentation by keyword. Returns matching topics."
  ),
  query: z.string().describe(
    "Search term to find in documentation titles and content"
  ),
});

const docsRequestSchema = z.discriminatedUnion("action", [
  listDocsSchema,
  readDocSchema,
  searchDocsSchema,
]);

export type DocsRequest = z.infer<typeof docsRequestSchema>;
export type DocsResponse = any;

export class DocsResource implements Resource<DocsRequest, DocsResponse> {
  code = "docs";
  description = `Reference documentation for Mycelia features and best practices.

Use this when you need detailed instructions on:
- How to create/update objects (people, events, relationships, promises)
- Search strategies for complex questions
- Understanding data formats (transcriptions, messages)
- Time query patterns
- Advanced search techniques

Actions:
- \`docs_list\`: See all available topics (optionally filter by tag)
- \`docs_read\`: Read a specific topic
- \`docs_search\`: Find topics by keyword`;

  schemas = {
    request: docsRequestSchema as z.ZodType<DocsRequest>,
    response: z.any(),
  };

  async use(input: DocsRequest, _auth: Auth): Promise<DocsResponse> {
    const docs = await getDocs();

    switch (input.action) {
      case "list": {
        const topics = Array.from(docs.values()).map((doc) => ({
          id: doc.id,
          title: doc.title,
          tags: doc.tags,
        }));

        if (input.tag) {
          const filtered = topics.filter((t) => t.tags.includes(input.tag!.toLowerCase()));
          return {
            count: filtered.length,
            filter: input.tag,
            topics: filtered,
          };
        }

        // Collect all unique tags
        const allTags = new Set<string>();
        docs.forEach((doc) => doc.tags.forEach((tag) => allTags.add(tag)));

        return {
          count: topics.length,
          topics,
          availableTags: Array.from(allTags).sort(),
        };
      }

      case "read": {
        const doc = docs.get(input.topic);
        if (!doc) {
          return {
            error: "Topic not found",
            availableTopics: Array.from(docs.keys()),
          };
        }

        return {
          id: doc.id,
          title: doc.title,
          tags: doc.tags,
          content: doc.content,
        };
      }

      case "search": {
        const query = input.query.toLowerCase();
        const matches: Array<{
          id: string;
          title: string;
          tags: string[];
          snippet: string;
        }> = [];

        docs.forEach((doc) => {
          const matchesQuery =
            doc.id.includes(query) ||
            doc.title.toLowerCase().includes(query) ||
            doc.content.toLowerCase().includes(query) ||
            doc.tags.some((t) => t.includes(query));

          if (matchesQuery) {
            matches.push({
              id: doc.id,
              title: doc.title,
              tags: doc.tags,
              snippet: doc.content.slice(0, 200) + "...",
            });
          }
        });

        return {
          query: input.query,
          count: matches.length,
          results: matches,
        };
      }

      default:
        throw new Error("Unknown docs action");
    }
  }

  extractActions(_input: DocsRequest) {
    return [
      {
        path: ["docs"],
        actions: ["read"],
      },
    ];
  }
}

export function getDocsResource(
  auth: Auth,
): (input: DocsRequest) => Promise<DocsResponse> {
  return auth.getResource<DocsRequest, DocsResponse>("docs");
}
