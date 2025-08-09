import type { Config } from "@/core.ts";
import type { ResourceRegistryConfig } from "@/lib/resources/registry.ts";

import { SiFormatter, TimeLayer } from "@/modules/time/index.tsx";
import {
  AudioLayer,
  AudioPlayerTool,
  GainTool,
} from "@/modules/audio/index.tsx";

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
};

// Backend resources configuration
export const resources: ResourceRegistryConfig = {
  resources: [
    {
      module: "@/lib/mongo/core.server.ts",
      export: "MongoResource",
      enabled: true,
    },
    {
      module: "@/lib/mongo/fs.server.ts", 
      export: "FsResource",
      enabled: true,
    },
    {
      module: "@/lib/kafka/index.ts",
      export: "KafkaResource",
      enabled: true,
    },
    {
      module: "@/lib/redis.ts",
      export: "RedisResource",
      enabled: true,
    },
    {
      module: "@/lib/timeline/resource.server.ts",
      export: "TimelineResource",
      enabled: true,
    },
    // Add custom resources here:
    // {
    //   module: "./my-custom-resource.ts",
    //   export: "MyCustomResource", 
    //   enabled: true,
    //   args: ["constructor", "arguments"],
    // },
  ],
  customModules: [
    // Add custom module paths here:
    // "./plugins/my-plugin/index.ts",
  ],
};
