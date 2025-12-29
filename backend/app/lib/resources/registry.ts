import { defaultResourceManager } from "@/lib/auth/resources.ts";

import { MongoResource } from "@/lib/mongo/core.server.ts";
import { FsResource } from "@/lib/mongo/fs.server.ts";
import { RedisResource } from "@/lib/redis.ts";
import { TimelineResource } from "@/lib/timeline/resource.server.ts";
import { ProcessorResource } from "../processors/core.server.ts";
import { LLMResource } from "@/lib/llm/resource.server.ts";
import { TranscriptionResource } from "@/lib/transcription/resource.server.ts";
import { ObjectsResource } from "@/lib/objects/resource.server.ts";
import { ApiKeysResource } from "@/lib/auth/apikeys.resource.ts";
import { WorkerProgressResource } from "@/lib/resources/worker.ts";
import { MessengerResource } from "@/lib/messenger/resource.server.ts";

const resources = [
  MongoResource,
  FsResource,
  RedisResource,
  TimelineResource,
  ProcessorResource,
  LLMResource,
  TranscriptionResource,
  ObjectsResource,
  ApiKeysResource,
  WorkerProgressResource,
  MessengerResource,
];

export async function setupResources(): Promise<void> {
  for (const entry of resources) {
    defaultResourceManager.registerResource(entry);
  }
}
