import { defaultResourceManager } from "@/lib/auth/resources.ts";

import { MongoResource } from "@/lib/mongo/core.server.ts";
import { FsResource } from "@/lib/mongo/fs.server.ts";
import { RedisResource } from "@/lib/redis.ts";
import { TimelineResource } from "@/lib/timeline/resource.server.ts";
import { ProcessorResource } from "../processors/core.server.ts";
import { LLMResource } from "@/lib/llm/resource.server.ts";
import { DaemonResource } from "@/services/supervisor/resource.server.ts";

const resources = [
  MongoResource,
  FsResource,
  RedisResource,
  TimelineResource,
  ProcessorResource,
  LLMResource,
  DaemonResource,
];

export async function setupResources(): Promise<void> {
  for (const entry of resources) {
    defaultResourceManager.registerResource(entry);
  }
}
