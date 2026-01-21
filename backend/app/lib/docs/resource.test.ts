import { expect } from "@std/expect";
import { Auth, defaultResourceManager } from "@/lib/auth/index.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { DocsResource, type DocsRequest, reloadDocs } from "@/lib/docs/resource.server.ts";

// Helper to get docs resource
function getDocsResource(auth: Auth) {
  const resource = new DocsResource();
  defaultResourceManager.registerResource(resource);
  return auth.getResource<DocsRequest, any>("docs");
}

// Force reload before each test to ensure fresh state
function beforeTest() {
  reloadDocs();
}

Deno.test(
  "docs resource is registered",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);
    expect(resource).toBeDefined();
  }),
);

// ============================================================================
// list action tests
// ============================================================================

Deno.test(
  "docs_list returns all topics",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "list",
    });

    expect(result.count).toBeGreaterThan(0);
    expect(result.topics).toBeDefined();
    expect(Array.isArray(result.topics)).toBe(true);
    expect(result.availableTags).toBeDefined();
    expect(Array.isArray(result.availableTags)).toBe(true);
  }),
);

Deno.test(
  "docs_list returns topics with correct structure",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "list",
    });

    const topic = result.topics[0];
    expect(topic.id).toBeDefined();
    expect(typeof topic.id).toBe("string");
    expect(topic.title).toBeDefined();
    expect(typeof topic.title).toBe("string");
    expect(topic.tags).toBeDefined();
    expect(Array.isArray(topic.tags)).toBe(true);
  }),
);

Deno.test(
  "docs_list filters by tag",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "list",
      tag: "objects",
    });

    expect(result.filter).toBe("objects");
    expect(result.topics.every((t: any) => t.tags.includes("objects"))).toBe(true);
  }),
);

Deno.test(
  "docs_list with unknown tag returns empty",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "list",
      tag: "nonexistent_tag_xyz",
    });

    expect(result.count).toBe(0);
    expect(result.topics).toHaveLength(0);
  }),
);

// ============================================================================
// read action tests
// ============================================================================

Deno.test(
  "docs_read returns topic content",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "read",
      topic: "objects-overview",
    });

    expect(result.id).toBe("objects-overview");
    expect(result.title).toBeDefined();
    expect(result.content).toBeDefined();
    expect(typeof result.content).toBe("string");
    expect(result.content.length).toBeGreaterThan(100);
    expect(result.tags).toBeDefined();
    expect(Array.isArray(result.tags)).toBe(true);
  }),
);

Deno.test(
  "docs_read returns error for unknown topic",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "read",
      topic: "nonexistent_topic_xyz",
    });

    expect(result.error).toBe("Topic not found");
    expect(result.availableTopics).toBeDefined();
    expect(Array.isArray(result.availableTopics)).toBe(true);
  }),
);

Deno.test(
  "docs_read content includes markdown formatting",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "read",
      topic: "creating-people",
    });

    expect(result.content).toContain("#"); // Has headers
    expect(result.content).toContain("```"); // Has code blocks
  }),
);

Deno.test(
  "docs_read extracts tags from content",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "read",
      topic: "creating-people",
    });

    // The file has #objects #people #create tags
    expect(result.tags).toContain("objects");
    expect(result.tags).toContain("people");
    expect(result.tags).toContain("create");
  }),
);

// ============================================================================
// search action tests
// ============================================================================

Deno.test(
  "docs_search finds topics by keyword in title",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "search",
      query: "relationship",
    });

    expect(result.query).toBe("relationship");
    expect(result.count).toBeGreaterThan(0);
    expect(result.results.some((r: any) => 
      r.title.toLowerCase().includes("relationship") || 
      r.id.includes("relationship")
    )).toBe(true);
  }),
);

Deno.test(
  "docs_search finds topics by keyword in content",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "search",
      query: "symmetrical",
    });

    expect(result.count).toBeGreaterThan(0);
  }),
);

Deno.test(
  "docs_search finds topics by tag",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "search",
      query: "create",
    });

    expect(result.count).toBeGreaterThan(0);
  }),
);

Deno.test(
  "docs_search is case insensitive",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const lowerResult = await resource({
      action: "search",
      query: "objects",
    });

    const upperResult = await resource({
      action: "search",
      query: "OBJECTS",
    });

    expect(lowerResult.count).toBe(upperResult.count);
  }),
);

Deno.test(
  "docs_search returns empty for no matches",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "search",
      query: "xyznonexistent123",
    });

    expect(result.count).toBe(0);
    expect(result.results).toHaveLength(0);
  }),
);

Deno.test(
  "docs_search results include snippets",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "search",
      query: "time",
    });

    expect(result.results[0].snippet).toBeDefined();
    expect(typeof result.results[0].snippet).toBe("string");
  }),
);

// ============================================================================
// Content verification tests
// ============================================================================

Deno.test(
  "time-queries doc contains correct time unit info",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "read",
      topic: "time-queries",
    });

    // Verify m means minutes, not months
    expect(result.content).toContain("m = minutes");
    expect(result.content).toContain("30d");
  }),
);

Deno.test(
  "creating-relationships doc has example JSON",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "read",
      topic: "creating-relationships",
    });

    expect(result.content).toContain("isRelationship");
    expect(result.content).toContain("subject");
    expect(result.content).toContain("object");
    expect(result.content).toContain("symmetrical");
  }),
);

Deno.test(
  "research-strategies doc has practical examples",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    const result = await resource({
      action: "read",
      topic: "research-strategies",
    });

    expect(result.content).toContain("deepResearch");
    expect(result.content).toContain("Strategy");
  }),
);

// ============================================================================
// Expected topics exist
// ============================================================================

const expectedTopics = [
  "objects-overview",
  "creating-people",
  "creating-relationships",
  "creating-events",
  "time-queries",
  "research-strategies",
  "transcriptions-format",
  "messages-format",
  "updating-objects",
  "promises-tasks",
  "search-tips",
];

for (const topicId of expectedTopics) {
  Deno.test(
    `docs contains expected topic: ${topicId}`,
    withFixtures(["Admin"], async (admin: Auth) => {
      beforeTest();
      const resource = getDocsResource(admin);

      const result = await resource({
        action: "read",
        topic: topicId,
      });

      expect(result.error).toBeUndefined();
      expect(result.id).toBe(topicId);
      expect(result.content.length).toBeGreaterThan(50);
    }),
  );
}

// ============================================================================
// Tag extraction tests
// ============================================================================

Deno.test(
  "extracts obsidian-style tags correctly",
  withFixtures(["Admin"], async (admin: Auth) => {
    beforeTest();
    const resource = getDocsResource(admin);

    // List all topics and verify tags are extracted
    const result = await resource({
      action: "list",
    });

    // All topics should have at least one tag
    expect(result.topics.every((t: any) => t.tags.length > 0)).toBe(true);
    
    // Tags should be lowercase
    const allTags = result.topics.flatMap((t: any) => t.tags);
    expect(allTags.every((t: string) => t === t.toLowerCase())).toBe(true);
  }),
);
