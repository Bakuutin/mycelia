import {
  Auth,
  defaultResourceManager,
  Policy,
  ResourceManager,
  signJWT,
} from "@/lib/auth/index.ts";
import { FsResource, getFsResource } from "@/lib/mongo/fs.server.ts";
import { MongoResource } from "@/lib/mongo/core.server.ts";
import { GenericContainer } from "testcontainers";
import { getAvailablePort } from "@std/net/get-available-port";
import { MongoClient, UUID } from "mongodb";
import { KafkaResource } from "@/lib/kafka/index.ts";
import RequestQueue from "npm:kafkajs/src/network/requestQueue/index.js";


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

console.log("Starting redis container");
const redisContainer = await new GenericContainer("redis")
  .withExposedPorts(6379)
  .start();

console.log("Starting mongo container");
const mongoContainer = await new GenericContainer("mongo:8.0")
  .withExposedPorts(27017)
  .start();

console.log("Starting kafka container");
const kafkaPort = getAvailablePort();
const kafkaContainer = await new GenericContainer("bitnami/kafka:latest")
    .withExposedPorts({
      container: 9992,
      host: kafkaPort,
    })
    .withEnvironment({
      KAFKA_CFG_NODE_ID: "0",
      KAFKA_CFG_PROCESS_ROLES: "controller,broker",
      KAFKA_CFG_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
      KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP: "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,HOST:PLAINTEXT",
      KAFKA_CFG_CONTROLLER_QUORUM_VOTERS: "0@localhost:9093",
      KAFKA_CFG_LISTENERS: "PLAINTEXT://:9092,CONTROLLER://:9093,HOST://:9992",
      KAFKA_CFG_ADVERTISED_LISTENERS: `PLAINTEXT://:9092,CONTROLLER://:9093,HOST://localhost:${kafkaPort}`,
    })
    .start();

RequestQueue.prototype.scheduleCheckPendingRequests = () => {}

addEventListener("unload", async () => {
  await redisContainer.stop();
  await mongoContainer.stop();
  await kafkaContainer.stop();
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
    const client = new MongoClient(
      `mongodb://${mongoContainer.getHost()}:${
        mongoContainer.getMappedPort(27017)
      }`,
      {
        timeoutMS: 1000,
      },
    );
    await client.connect();
    const isolatedDB = client.db(new UUID().toString());
    const fs = new FsResource();
    resource.getRootDB = async () => isolatedDB;
    fs.getRootDB = async () => isolatedDB;
    resourceManager.registerResource(resource);
    resourceManager.registerResource(fs);

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
  token: "Kafka",
  dependencies: [ResourceManager],
  factory: async (resourceManager: ResourceManager) => {
    const resource = new KafkaResource({
      clientId: "mycelia-test",
      brokers: [`localhost:${kafkaPort}`],
      enforceRequestTimeout: false,
    });
    resourceManager.registerResource(resource);
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

console.log("All fixtures defined");

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
