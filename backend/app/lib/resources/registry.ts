import { defaultResourceManager } from "@/lib/auth/resources.ts";

import { MongoResource } from "@/lib/mongo/core.server.ts";
import { FsResource } from "@/lib/mongo/fs.server.ts";
import { RedisResource } from "@/lib/redis.ts";
import { TimelineResource } from "@/lib/timeline/resource.server.ts";
import { LLMResource } from "@/lib/llm/resource.server.ts";
import { TranscriptionResource } from "@/lib/transcription/resource.server.ts";
import { ObjectsResource } from "@/lib/objects/resource.server.ts";
import { ApiKeysResource } from "@/lib/auth/apikeys.resource.ts";
import { JobsResource } from "@/lib/resources/worker.ts";
import { MessengerResource } from "@/lib/messenger/resource.server.ts";
import { SearchResource } from "@/lib/search/resource.server.ts";
import { DocsResource } from "@/lib/docs/resource.server.ts";
import { ConfigResource } from "@/lib/config/resource.server.ts";
import { TimelineTimeZonesResource } from "@/lib/timezones/resource.server.ts";
import { LocationResource } from "@/lib/location/resource.server.ts";
import { SpeakerSegmentsResource } from "@/lib/speakers/resource.server.ts";
import { ChatResource } from "@/lib/chat/resource.server.ts";

const resources = [
  MongoResource,
  FsResource,
  RedisResource,
  TimelineResource,
  LLMResource,
  TranscriptionResource,
  ObjectsResource,
  ApiKeysResource,
  JobsResource,
  MessengerResource,
  SearchResource,
  DocsResource,
  ConfigResource,
  TimelineTimeZonesResource,
  LocationResource,
  SpeakerSegmentsResource,
  ChatResource,
];

export async function setupResources(): Promise<void> {
  for (const entry of resources) {
    defaultResourceManager.registerResource(entry);
  }
}
