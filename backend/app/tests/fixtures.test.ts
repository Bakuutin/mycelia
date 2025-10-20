import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { ResourceManager } from "@/lib/auth/resources.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";

Deno.test(
  "fixtures are available",
  withFixtures([
    "Admin",
  ], async (admin: Auth) => {
    expect(admin.principal).toBe("admin");
  }),
);

Deno.test(
  "in-memory mongo is available",
  withFixtures([
    "Admin",
    "accessLogger",
    "Mongo",
  ], async (admin: Auth, accessLogger: any) => {
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

    expect(accessLogger).toHaveBeenCalledWith(admin, mongoResource, [
      {
        path: "db.test",
        actions: ["write"],
      },
    ]);

    expect(accessLogger).toHaveBeenCalledWith(admin, mongoResource, [
      {
        path: "db.test",
        actions: ["read"],
      },
    ]);
  }),
);
