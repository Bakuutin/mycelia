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
import { MongoClient, UUID } from "mongodb";
import { KafkaResource } from "@/lib/kafka/index.ts";
import RequestQueue from "kafkajs/src/network/requestQueue/index.js";

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
  .withReuse()
  .start();

console.log("Starting mongo container");
const mongoContainer = await new GenericContainer("mongo:8.0")
  .withExposedPorts(27017)
  .withReuse()
  .start();

console.log("Starting kafka container");
const kafkaPort = 9992;
const kafkaContainer = await new GenericContainer("bitnami/kafka:latest")
  .withExposedPorts({
    container: 9092,
    host: kafkaPort,
  })
  .withEnvironment({
    KAFKA_CFG_NODE_ID: "0",
    KAFKA_CFG_PROCESS_ROLES: "controller,broker",
    KAFKA_CFG_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
    KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP:
      "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT",
    KAFKA_CFG_CONTROLLER_QUORUM_VOTERS: "0@localhost:9093",
    KAFKA_CFG_LISTENERS: "PLAINTEXT://:9092,CONTROLLER://:9093",
    KAFKA_CFG_ADVERTISED_LISTENERS:
      `PLAINTEXT://localhost:${kafkaPort},CONTROLLER://:9093`,
    KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE: "true",
  })
  .withReuse()
  .start();

RequestQueue.prototype.scheduleCheckPendingRequests = () => {};

const sampleAudioFile = await Deno.readFile("app/tests/sample_audio.wav");

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
    const mongoUri = `mongodb://${mongoContainer.getHost()}:${
      mongoContainer.getMappedPort(27017)
    }`;
    const databaseName = new UUID().toString();
    Deno.env.set("MONGO_URL", "SHOULD_NOT_BE_USED");
    Deno.env.set("DATABASE_NAME", databaseName);
    const resource = new MongoResource();
    const client = new MongoClient(
      mongoUri,
      {
        timeoutMS: 1000,
      },
    );
    await client.connect();
    const isolatedDB = client.db(databaseName);
    const fs = new FsResource();
    resource.getRootDB = async () => isolatedDB;
    fs.getRootDB = async () => isolatedDB;
    defaultResourceManager.registerResource(resource);
    defaultResourceManager.registerResource(fs);

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
  factory: async () => {
    const resource = new KafkaResource({
      clientId: "mycelia-test",
      brokers: [`localhost:${kafkaPort}`],
      enforceRequestTimeout: false,
    });
    defaultResourceManager.registerResource(resource);

    const admin = resource.kafka.admin();
    return {
      resource,
      admin,
    };
  },
  teardown: async ({ admin }) => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await admin.connect();

      const allTopics = await admin.listTopics();
      const userTopics = allTopics.filter((t: string) => !t.startsWith("__"));

      if (userTopics.length > 0) {
        await admin.deleteTopics({ topics: userTopics });
      }

      await admin.disconnect();
    } catch (error) {
      console.error("Error during Kafka teardown:", error);
    }
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
  factory: async () => {
    const { generateApiKey } = await import("@/lib/auth/tokens.ts");
    const policies = [{ resource: "*", action: "*", effect: "allow" as const }];
    return await generateApiKey("test-owner", "test-key", policies);
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
