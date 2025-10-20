import { defaultResourceManager } from "@/lib/auth/resources.ts";

import { MongoResource } from "@/lib/mongo/core.server.ts";
import { KafkaResource } from "@/lib/kafka/index.ts";
import { FsResource } from "@/lib/mongo/fs.server.ts";
import { RedisResource } from "@/lib/redis.ts";
import { TimelineResource } from "@/lib/timeline/resource.server.ts";
import { ProcessorResource } from "../processors/core.server.ts";

const resources = [
  MongoResource,
  KafkaResource,
  FsResource,
  RedisResource,
  TimelineResource,
  ProcessorResource,
];

export async function setupResources(): Promise<void> {
  for (const entry of resources) {
    defaultResourceManager.registerResource(entry);
  }
}
