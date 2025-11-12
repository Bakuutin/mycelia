import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { ObjectsResource } from "@/lib/objects/resource.server.ts";
import { ObjectId } from "mongodb";

async function getObjectsResource(auth: Auth) {
  return auth.getResource("tech.mycelia.objects");
}

Deno.test(
  "objects resource is registered",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const resource = await getObjectsResource(admin);
    expect(resource).toBeDefined();
  }),
);

Deno.test(
  "create object with basic fields",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    const result = await objectsResource({
      action: "create",
      object: {
        name: "Test Object",
        details: "This is a test object",
        icon: { text: "📦" },
        color: "#ff0000",
      },
    });

    expect(result.insertedId).toBeDefined();
    expect(result.insertedId).toBeInstanceOf(ObjectId);

    await new Promise((resolve) => setTimeout(resolve, 50));
  }),
);

Deno.test(
  "create object with custom fields (passthrough)",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    const result = await objectsResource({
      action: "create",
      object: {
        name: "Object with Custom Fields",
        customField1: "custom value",
        customField2: 42,
        nestedCustom: {
          foo: "bar",
        },
      },
    });

    expect(result.insertedId).toBeDefined();

    const retrieved = await objectsResource({
      action: "get",
      id: result.insertedId.toString(),
    });

    expect(retrieved.name).toBe("Object with Custom Fields");
    expect(retrieved.customField1).toBe("custom value");
    expect(retrieved.customField2).toBe(42);
    expect(retrieved.nestedCustom).toEqual({ foo: "bar" });
  }),
);

Deno.test(
  "get object returns version 0 for objects without version",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    const createResult = await objectsResource({
      action: "create",
      object: {
        name: "Test Object",
      },
    });

    const retrieved = await objectsResource({
      action: "get",
      id: createResult.insertedId.toString(),
    });

    expect(retrieved.version).toBe(1);
    expect(retrieved.name).toBe("Test Object");
  }),
);

Deno.test(
  "update object field with correct version",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    const createResult = await objectsResource({
      action: "create",
      object: {
        name: "Original Name",
        details: "Original details",
      },
    });

    const updated = await objectsResource({
      action: "update",
      id: createResult.insertedId.toString(),
      version: 1,
      field: "name",
      value: "Updated Name",
    });

    expect(updated.name).toBe("Updated Name");
    expect(updated.details).toBe("Original details");
    expect(updated.version).toBe(2);
  }),
);

Deno.test(
  "update nested field",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    const subjectId = new ObjectId();
    const objectId = new ObjectId();

    const createResult = await objectsResource({
      action: "create",
      object: {
        name: "Test",
        relationship: {
          subject: subjectId.toString(),
          object: objectId.toString(),
          symmetrical: false,
        },
      },
    });

    const updated = await objectsResource({
      action: "update",
      id: createResult.insertedId.toString(),
      version: 1,
      field: "relationship.symmetrical",
      value: true,
    });

    expect(updated.relationship.symmetrical).toBe(true);
    expect(updated.version).toBe(2);
  }),
);

Deno.test(
  "update with wrong version throws 409 conflict",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    const createResult = await objectsResource({
      action: "create",
      object: {
        name: "Test Object",
      },
    });

    try {
      await objectsResource({
        action: "update",
        id: createResult.insertedId.toString(),
        version: 999,
        field: "name",
        value: "This should fail",
      });
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.code).toBe(409);
      expect(error.message).toContain("modified by another user");
      expect(error.current).toBe(1);
      expect(error.expected).toBe(999);
      expect(error.latestObject).toBeDefined();
    }
  }),
);

Deno.test(
  "concurrent updates: second update fails with conflict",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    const createResult = await objectsResource({
      action: "create",
      object: {
        name: "Test",
        details: "Original",
      },
    });

    await objectsResource({
      action: "update",
      id: createResult.insertedId.toString(),
      version: 1,
      field: "name",
      value: "First Update",
    });

    try {
      await objectsResource({
        action: "update",
        id: createResult.insertedId.toString(),
        version: 1,
        field: "details",
        value: "Second Update",
      });
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.code).toBe(409);
      expect(error.current).toBe(2);
    }
  }),
);

Deno.test(
  "delete object",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    const createResult = await objectsResource({
      action: "create",
      object: {
        name: "To Delete",
      },
    });

    const deleteResult = await objectsResource({
      action: "delete",
      id: createResult.insertedId.toString(),
    });

    expect(deleteResult.deletedCount).toBe(1);

    try {
      await objectsResource({
        action: "get",
        id: createResult.insertedId.toString(),
      });
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.message).toContain("not found");
    }
  }),
);

Deno.test(
  "list objects with filters",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    await objectsResource({
      action: "create",
      object: { name: "Person 1", isPerson: true },
    });

    await objectsResource({
      action: "create",
      object: { name: "Event 1", isEvent: true },
    });

    await objectsResource({
      action: "create",
      object: { name: "Person 2", isPerson: true },
    });

    const people = await objectsResource({
      action: "list",
      filters: { isPerson: true },
    });

    expect(people).toHaveLength(2);
    expect(people.every((p: any) => p.isPerson)).toBe(true);
  }),
);

Deno.test(
  "list objects with search term",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    await objectsResource({
      action: "create",
      object: { name: "JavaScript Developer" },
    });

    await objectsResource({
      action: "create",
      object: { name: "Python Developer" },
    });

    await objectsResource({
      action: "create",
      object: { name: "JavaScript Framework" },
    });

    const results = await objectsResource({
      action: "list",
      options: {
        searchTerm: "JavaScript",
      },
    });

    expect(results).toHaveLength(2);
    expect(results.every((r: any) => r.name.includes("JavaScript"))).toBe(true);
  }),
);

Deno.test(
  "list objects with hasTimeRanges filter",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    await objectsResource({
      action: "create",
      object: {
        name: "Object 1",
        timeRanges: [{ start: new Date(), end: new Date() }],
      },
    });

    await objectsResource({
      action: "create",
      object: { name: "Object 2" },
    });

    const withTimeRanges = await objectsResource({
      action: "list",
      options: {
        hasTimeRanges: true,
      },
    });

    expect(withTimeRanges).toHaveLength(1);
    expect(withTimeRanges[0].name).toBe("Object 1");
  }),
);

Deno.test(
  "list objects with pagination",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    for (let i = 0; i < 10; i++) {
      await objectsResource({
        action: "create",
        object: { name: `Object ${i}` },
      });
    }

    const firstPage = await objectsResource({
      action: "list",
      options: {
        limit: 3,
        skip: 0,
      },
    });

    const secondPage = await objectsResource({
      action: "list",
      options: {
        limit: 3,
        skip: 3,
      },
    });

    expect(firstPage).toHaveLength(3);
    expect(secondPage).toHaveLength(3);
    expect(firstPage[0]._id).not.toEqual(secondPage[0]._id);
  }),
);

Deno.test(
  "getRelationships returns relationships for an object",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    const person1 = await objectsResource({
      action: "create",
      object: { name: "Alice", isPerson: true },
    });

    const person2 = await objectsResource({
      action: "create",
      object: { name: "Bob", isPerson: true },
    });

    const relationship = await objectsResource({
      action: "create",
      object: {
        name: "Friends",
        isRelationship: true,
        relationship: {
          subject: person1.insertedId.toString(),
          object: person2.insertedId.toString(),
          symmetrical: true,
        },
        timeRanges: [{ start: new Date() }],
      },
    });

    const relationships = await objectsResource({
      action: "getRelationships",
      id: person1.insertedId.toString(),
    });

    expect(relationships).toHaveLength(1);
    expect(relationships[0].relationship.name).toBe("Friends");
    expect(relationships[0].other._id).toEqual(person2.insertedId);
  }),
);

Deno.test(
  "getHistory returns change history",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    const createResult = await objectsResource({
      action: "create",
      object: {
        name: "Original",
        details: "First version",
      },
    });

    const id = createResult.insertedId.toString();

    await objectsResource({
      action: "update",
      id,
      version: 1,
      field: "name",
      value: "Updated Name",
    });

    await objectsResource({
      action: "update",
      id,
      version: 2,
      field: "details",
      value: "Updated Details",
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const history = await objectsResource({
      action: "getHistory",
      id,
    });

    expect(history.length).toBeGreaterThanOrEqual(3);

    const createEntry = history.find((h: any) => h.action === "create");
    expect(createEntry).toBeDefined();
    expect(createEntry.userId).toBe("admin");
    expect(createEntry.version).toBe(1);

    const nameUpdate = history.find(
      (h: any) => h.action === "update" && h.field === "name"
    );
    expect(nameUpdate).toBeDefined();
    expect(nameUpdate.oldValue).toBe("Original");
    expect(nameUpdate.newValue).toBe("Updated Name");
    expect(nameUpdate.version).toBe(2);

    const detailsUpdate = history.find(
      (h: any) => h.action === "update" && h.field === "details"
    );
    expect(detailsUpdate).toBeDefined();
    expect(detailsUpdate.oldValue).toBe("First version");
    expect(detailsUpdate.newValue).toBe("Updated Details");
    expect(detailsUpdate.version).toBe(3);
  }),
);

Deno.test(
  "getHistory with pagination",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    const createResult = await objectsResource({
      action: "create",
      object: { name: "Test" },
    });

    const id = createResult.insertedId.toString();

    for (let i = 0; i < 10; i++) {
      await objectsResource({
        action: "update",
        id,
        version: i + 1,
        field: "name",
        value: `Update ${i}`,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    const firstPage = await objectsResource({
      action: "getHistory",
      id,
      limit: 5,
      skip: 0,
    });

    const secondPage = await objectsResource({
      action: "getHistory",
      id,
      limit: 5,
      skip: 5,
    });

    expect(firstPage).toHaveLength(5);
    expect(secondPage).toHaveLength(5);
    expect(firstPage[0].timestamp.getTime()).toBeGreaterThan(
      secondPage[0].timestamp.getTime()
    );
  }),
);

Deno.test(
  "list with includeRelationships performs lookups",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    const subject = await objectsResource({
      action: "create",
      object: { name: "Subject", icon: { text: "👤" } },
    });

    const object = await objectsResource({
      action: "create",
      object: { name: "Object", icon: { text: "📦" } },
    });

    await objectsResource({
      action: "create",
      object: {
        name: "Relationship",
        isRelationship: true,
        relationship: {
          subject: subject.insertedId.toString(),
          object: object.insertedId.toString(),
          symmetrical: false,
        },
        timeRanges: [{ start: new Date() }],
      },
    });

    const results = await objectsResource({
      action: "list",
      options: {
        hasTimeRanges: true,
        includeRelationships: true,
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].subjectObject).toBeDefined();
    expect(results[0].objectObject).toBeDefined();
    expect(results[0].subjectObject.name).toBe("Subject");
    expect(results[0].objectObject.name).toBe("Object");
  }),
);

Deno.test(
  "delete records history",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const objectsResource = await getObjectsResource(admin);

    const createResult = await objectsResource({
      action: "create",
      object: { name: "To Delete" },
    });

    const id = createResult.insertedId.toString();

    await objectsResource({
      action: "delete",
      id,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const history = await objectsResource({
      action: "getHistory",
      id,
    });

    const deleteEntry = history.find((h: any) => h.action === "delete");
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry.userId).toBe("admin");
    expect(deleteEntry.field).toBeNull();
  }),
);
