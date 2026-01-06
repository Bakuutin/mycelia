import {
  Auth,
  defaultResourceManager,
  Policy,
  Resource,
  ResourceManager,
  signJWT,
} from "@/lib/auth/index.ts";
import { FsResource, getFsResource } from "@/lib/mongo/fs.server.ts";
import { redis } from "@/lib/redis.ts";
import { MongoResource } from "@/lib/mongo/core.server.ts";
import { GenericContainer } from "testcontainers";
import { MongoDBContainer } from "@testcontainers/mongodb";
import { MongoClient, UUID } from "mongodb";
import { TimelineResource } from "@/lib/timeline/resource.server.ts";
import { generateApiKey } from "@/lib/auth/tokens.ts";
import { accessLogger } from "@/lib/auth/core.server.ts";
import { fn } from "@std/expect";
import { ObjectsResource } from "@/lib/objects/resource.server.ts";
import { MessengerResource } from "@/lib/messenger/resource.server.ts";
import { z } from "zod";
import type { Request } from "express";

import { discoverJobWorkers, jobRegistry } from "@/lib/jobs/job-registry.ts";
await discoverJobWorkers();

export type Fixture = {
  token: any;
  dependencies?: any[];
  factory?: (...args: any[]) => Promise<any> | any;
  teardown?: (setup: any) => Promise<void> | void;
};

export const testFixtures = new Map<any, Fixture>();

export function defineFixture(fixture: Fixture) {
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

console.log("Starting redis container");
const redisContainer = await new GenericContainer("redis")
  .withExposedPorts(6379)
  .withReuse()
  .start();

redis.options.host = "localhost";
redis.options.password = undefined;
redis.options.port = redisContainer.getMappedPort(6379);
await redis.connect();

console.log("Starting mongo container");
const mongoContainer = await new MongoDBContainer("mongo:8.0")
  .withReuse()
  .start();

const sampleAudioFile = await  Deno.readFile("app/tests/sample_audio.wav");

addEventListener("unload", async () => {
  await redisContainer.stop();
  await mongoContainer.stop();
});

defineFixture({
  token: ResourceManager,
  factory: () => defaultResourceManager,
});

defineFixture({
  token: "SampleAudioFile",
  factory: () =>
    new File([sampleAudioFile], "sample.wav", { type: "audio/wav" }),
});

defineFixture({
  token: "AuthFactory",
  factory: () => {
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
  factory: async () => {
    const mongoUri = mongoContainer.getConnectionString();
    const databaseName = new UUID().toString();
    Deno.env.set("MONGO_URL", mongoUri);
    Deno.env.set("DATABASE_NAME", databaseName);
    const resource = new MongoResource();
    const client = new MongoClient(
      mongoUri,
      {
        timeoutMS: 1000,
        directConnection: true,
      },
    );
    await client.connect();
    const isolatedDB = client.db(databaseName);
    const fs = new FsResource();
    const timeline = new TimelineResource();
    const objects = new ObjectsResource();
    const messenger = new MessengerResource();
    resource.getRootDB = async () => isolatedDB;
    fs.getRootDB = async () => isolatedDB;
    objects.getRootDB = async () => isolatedDB;
    defaultResourceManager.registerResource(resource);
    defaultResourceManager.registerResource(fs);
    defaultResourceManager.registerResource(timeline);
    defaultResourceManager.registerResource(objects);
    defaultResourceManager.registerResource(messenger);

    return {
      db: isolatedDB,
      client,
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

defineFixture({
  token: "ServerAuth",
  dependencies: ["Admin", "BearerFactory"],
  factory: async (
    auth: Auth,
    bearerFactory: (auth: Auth) => Promise<string>,
  ) => {
    const bearerToken = await bearerFactory(auth);
    const token = bearerToken.replace("Bearer ", "");
    Deno.env.set("MYCELIA_TOKEN", token);
    return auth;
  },
  teardown: () => {
    Deno.env.delete("MYCELIA_TOKEN");
  },
});

defineFixture({
  token: "TestApiKey",
  dependencies: ["Mongo", "ServerAuth"],
  factory: async (auth: Auth) => {
    const policies = [{
      resource: "**",
      action: "*",
      effect: "allow" as const,
    }];
    return await generateApiKey("test-owner", "test-key", policies);
  },
});

defineFixture({
  token: "AdminAuthHeaders",
  dependencies: ["Admin", "BearerFactory"],
  factory: async (
    auth: Auth,
    bearerFactory: (auth: Auth) => Promise<string>,
  ) => {
    return {
      "Authorization": await bearerFactory(auth),
    };
  },
});

defineFixture({
  token: "accessLogger",
  factory: () => {
    const stub = fn(() => {}) as any;
    accessLogger.log = (auth, resource, actions) =>
      stub(auth.principal, resource.code, actions);
    return stub;
  },
});

defineFixture({
  token: "MockRedisXadd",
  factory: () => {
    const originalXadd = redis.xadd;
    const calls: Array<{ args: any[] }> = [];
    const mockXadd = fn(async (...args: any[]) => {
      calls.push({ args });
      return "1234567890-0";
    });
    redis.xadd = mockXadd as any;
    return {
      mock: Object.assign(mockXadd, {
        calls,
      }),
      original: originalXadd,
      restore: () => {
        redis.xadd = originalXadd;
      },
    };
  },
  teardown: ({ restore }) => {
    restore();
  },
});

defineFixture({
  token: "MockRedisXaddError",
  factory: () => {
    const originalXadd = redis.xadd;
    const mockXadd = fn(async () => {
      throw new Error("Redis connection failed");
    });
    redis.xadd = mockXadd as any;
    return {
      mock: mockXadd,
      original: originalXadd,
      restore: () => {
        redis.xadd = originalXadd;
      },
    };
  },
  teardown: ({ restore }) => {
    restore();
  },
});

defineFixture({
  token: "TestAuth",
  dependencies: ["AuthFactory"],
  factory: (authFactory) => authFactory({ principal: "test-user" }),
});

defineFixture({
  token: "TestResource",
  factory: () => {
    return {
      mongo: {
        code: "mongo",
        schemas: {
          request: z.any(),
          response: z.any(),
        },
        use: async () => ({}),
        extractActions: () => [{ path: ["db", "objects"], actions: ["read"] }],
      } as Resource<any, any>,
      redis: {
        code: "redis",
        schemas: {
          request: z.any(),
          response: z.any(),
        },
        use: async () => ({}),
        extractActions: () => [{ path: ["key"], actions: ["get"] }],
      } as Resource<any, any>,
      mongoMultiple: {
        code: "mongo",
        schemas: {
          request: z.any(),
          response: z.any(),
        },
        use: async () => ({}),
        extractActions: () => [
          { path: ["db", "users"], actions: ["read"] },
          { path: ["db", "posts"], actions: ["write"] },
        ],
      } as Resource<any, any>,
    };
  },
});

defineFixture({
  token: "ExpressRequestFactory",
  factory: () => {
    return (options: {
      method?: string;
      headers?: Record<string, string>;
      body?: any;
      query?: Record<string, string>;
    }) => {
      const contentType = options.headers?.["content-type"] || "";
      let body = options.body;
      
      if (typeof body === "string") {
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams(body);
          body = Object.fromEntries(params.entries());
        } else if (contentType.includes("application/json")) {
          try {
            body = JSON.parse(body);
          } catch {
            // Ignore parse errors
          }
        }
      }
      
      return {
        method: options.method || "GET",
        headers: options.headers || {},
        body: body,
        query: options.query || {},
        get: (name: string) => options.headers?.[name.toLowerCase()] || undefined,
      } as unknown as Request;
    };
  },
});

console.log("All fixtures defined");

export function withFixtures(
  dependencies: any[],
  testFn: (...args: any[]) => Promise<void> | void,
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
      defaultResourceManager.clearResources();
    }
  };
}
