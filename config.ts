import type { Config } from "@/core.ts";

import { SiFormatter, TimeLayer } from "@/modules/time/index.tsx";
import {
  AudioLayer,
  AudioPlayerTool,
  GainTool,
} from "@/modules/audio/index.tsx";
import { MongoResource } from "@/lib/mongo/core.server.ts";
import { KafkaResource } from "@/lib/kafka/index.ts";
import { FsResource } from "@/lib/mongo/fs.server.ts";
import { RedisResource } from "@/lib/redis.ts";
import { TimelineResource } from "@/lib/timeline/resource.server.ts";

export const config: Config = {
  layers: [
    TimeLayer({ formatter: SiFormatter }),
    TimeLayer(),
    AudioLayer(),
  ],
  tools: [
    AudioPlayerTool,
    GainTool,
  ],
  resources: [
    new MongoResource(),
    new FsResource(),
    new KafkaResource(),
    new RedisResource(),
    new TimelineResource(),
  ],
};
