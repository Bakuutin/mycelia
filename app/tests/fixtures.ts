import {
  Auth,
  defaultResourceManager,
  Policy,
  ResourceManager,
  signJWT,
} from "@/lib/auth/index.ts";
import { FsResource, getFsResource } from "@/lib/mongo/fs.server.ts";
import { MongoResource } from "@/lib/mongo/core.server.ts";
import MongoMemoryServer from "mongodb-memory-server";
import { MongoClient, UUID } from "mongodb";

export type Fixture = {
  token: any;
  dependencies?: any[];
  factory?: (...args: any[]) => Promise<any> | any;
  teardown?: (setup: any) => Promise<void> | void;
};

export const testFixtures = new Map<any, Fixture>();

function defineFixture(fixture: Fixture) {
  testFixtures.set(fixture.token, fixture);
}

function resolveFixtures(tokens: any[] | undefined): Fixture[] {
  if (!tokens) {
    return [];
  }
  return tokens.flatMap((token) => {
    const fixture = testFixtures.get(token);
    if (!fixture) {
      throw new Error(`Fixture ${token} not found`);
    }
    return [...resolveFixtures(fixture.dependencies), fixture];
  });
}

function dropDuplicates<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

const inMemoryMongo = await MongoMemoryServer.MongoMemoryServer.create();

addEventListener("unload", async () => {
  await inMemoryMongo?.stop();
});

defineFixture({
  token: ResourceManager,
  factory: () => defaultResourceManager,
});

defineFixture({
  token: "AuthFactory",
  dependencies: [ResourceManager],
  factory: (resourceManager: ResourceManager) => {
    return ({
      principal = "test",
      policies = [],
    }: {
      principal?: string;
      policies?: Policy[];
    }) => {
      return new Auth({
        principal,
        policies,
        resourceManager,
      });
    };
  },
});

defineFixture({
  token: "Admin",
  dependencies: ["AuthFactory"],
  factory: (authFactory) =>
    authFactory({
      principal: "admin",
      policies: [
        {
          action: "*",
          resource: "**",
          effect: "allow",
        },
      ],
    }),
});

defineFixture({
  token: "BearerFactory",
  factory: () => {
    Deno.env.set("SECRET_KEY", new UUID().toString());
    return async (auth: Auth) =>
      `Bearer ${await signJWT(
        auth.principal,
        auth.principal,
        auth.policies,
        "1 hour",
      )}`;
  },
});

defineFixture({
  token: "Mongo",
  dependencies: [ResourceManager],
  factory: async (resourceManager: ResourceManager) => {
    const resource = new MongoResource();
    const mongoUrl = inMemoryMongo.getUri();
    const client = new MongoClient(mongoUrl);
    const db = client.db(new UUID().toString());
    const fs = new FsResource();
    resource.getRootDB = async () => db;
    fs.getRootDB = async () => db;
    resourceManager.registerResource(resource);
    resourceManager.registerResource(fs);

    return {
      client,
      db,
      resourceManager,
    };
  },
  teardown: async ({ client, db }) => {
    await db.dropDatabase();
    await client.close();
  },
});

defineFixture({
  token: "uploadedFile",
  dependencies: ["Admin", "Mongo"],
  factory: async (auth: Auth) => {
    const fs = await getFsResource(auth);
    return fs({
      action: "upload",
      bucket: "test",
      filename: "file.bin",
      data: new Uint8Array([1, 2, 3]),
      metadata: { foo: "bar" },
    });
  },
});

export function withFixtures(
  dependencies: any[],
  testFn: (...args: any[]) => Promise<void>,
) {
  return async () => {
    const resolved = new Map<any, any>();
    const fixtures = dropDuplicates(resolveFixtures(dependencies));
    for (const fixture of fixtures) {
      const args = fixture.dependencies?.map((dep) => resolved.get(dep)) ?? [];
      resolved.set(fixture.token, await fixture.factory?.(...args));
    }

    try {
      const args = dependencies.map((dep) => resolved.get(dep));
      await testFn(...args);
    } finally {
      for (const fixture of fixtures) {
        await fixture.teardown?.(resolved.get(fixture.token));
      }
      defaultResourceManager.resources.clear();
    }
  };
}
