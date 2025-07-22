import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { ResourceManager } from "@/lib/auth/resources.ts";
import { withFixtures } from "./fixtures.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";

Deno.test(
  "fixtures are available",
  withFixtures([
    "Admin",
    ResourceManager,
  ], async (admin: Auth, resourceManager: ResourceManager) => {
    expect(admin.principal).toBe("admin");
    expect(admin.resourceManager).toBe(resourceManager);
  }),
);

Deno.test(
  "in-memory mongo is available",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (admin: Auth) => {
    const mongoResource = await getMongoResource(admin);
    await mongoResource({
      action: "insertOne",
      collection: "test",
      doc: { name: "test" },
    });

    const result = await mongoResource({
      action: "find",
      collection: "test",
      query: {},
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toEqual("test");
  }),
);
