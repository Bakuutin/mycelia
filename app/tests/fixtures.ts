import { Container, Token } from "@needle-di/core";
import { Auth, ResourceManager } from "@/lib/auth/index.ts";
import { FsResource, getFsResource } from "@/lib/mongo/fs.server.ts";
import { MongoResource } from "@/lib/mongo/core.server.ts";
import MongoMemoryServer from "mongodb-memory-server";
import { MongoClient } from "mongodb";

export const testFixtures = new Container();

export const SETUP = Symbol("SETUP");
export const TEARDOWN = Symbol("TEARDOWN");


testFixtures.bind({
  provide: ResourceManager,
  useFactory: () => {
    return new ResourceManager();
  },
});

testFixtures.bind({
  provide: "Admin",
  useFactory: () => {
    return new Auth({
      principal: "admin",
      policies: [
        {
          action: "*",
          resource: "**",
          effect: "allow",
        },
      ],
      resourceManager: testFixtures.get(ResourceManager),
    });
  },
});

testFixtures.bind({
  provide: FsResource,
  useFactory: () => {
    return new FsResource();
  },
});

testFixtures.bind({
  provide: "Mongo",
  useFactory: () => {
    const utils = {} as Record<string | symbol, any>;

    utils[SETUP] = async () => {
        if (utils.resourceManager) {
            return;
        }
    

      const resourceManager = testFixtures.get(ResourceManager);
      utils.resource = new MongoResource();
      utils.inMemoryMongo = await MongoMemoryServer.MongoMemoryServer.create();
      const mongoUrl = utils.inMemoryMongo.getUri();
      utils.client = new MongoClient(mongoUrl);
      utils.db = utils.client.db("mycelia-test-db");
      utils.fs = new FsResource();
      utils.resource.getRootDB = async () => utils.db;
      utils.fs.getRootDB = async () => utils.db;

      resourceManager.registerResource(utils.resource);
      resourceManager.registerResource(utils.fs);
    }

    utils[TEARDOWN] = async () => {
        await utils.inMemoryMongo?.stop();
        await utils.client?.close();
    };

    return utils;
  },
});



testFixtures.bind({
    provide: "uploadedFile",
    useFactory: () => {
        const utils = {} as Record<string | symbol, any>;
        utils[SETUP] = async () => {
            const mongo = testFixtures.get("Mongo") as any;
            const auth = testFixtures.get("Admin") as Auth;
            await mongo[SETUP]();
            
            const fs = await getFsResource(auth);
            utils.uploadId = await fs({
                action: "upload",
                bucket: "test",
                filename: "file.bin",
                data: new Uint8Array([1, 2, 3]),
                metadata: { foo: "bar" },
            });
        }
        utils[TEARDOWN] = async () => {
            const mongo = testFixtures.get("Mongo") as any;
            await mongo[TEARDOWN]();
        }
        return utils;
    },
});



export function withFixtures(
  fixtures: Token<any>[],
  testFn: (...args: any[]) => Promise<void>,
) {
  return async () => {
    const args = fixtures.map((fixture) => testFixtures.get(fixture));
    try {
      for (const arg of args) {
        if (arg[SETUP]) {
          await arg[SETUP]();
        }
      }
      await testFn(...args);
    } finally {
      for (const arg of args) {
        if (arg[TEARDOWN]) {
          await arg[TEARDOWN]();
        }
      }
    }
  };
}
