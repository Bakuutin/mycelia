import type { Config } from "@/core.ts";

import { TimeLayer } from "@/modules/time/index.tsx";
import { MapLayer } from "@/modules/map/index.tsx";
import {
  AudioLayer,
  AudioPlayerTool,
  DateTimePickerTool,
  GainTool,
  TranscriptLayer,
} from "@/modules/audio/index.tsx";
import { CreateEventTool, EventsLayer } from "@/modules/events/index.tsx";

export const config: Config = {
  layers: [
    TranscriptLayer(),
    // TopicsLayer(),
    TimeLayer(),
    EventsLayer(),
    AudioLayer(),
    // CurvedTimeLayer({ height: 100 }),
    // CurvedTopicsLayer(),
  ],
  tools: [
    AudioPlayerTool,
    GainTool,
    DateTimePickerTool,
    CreateEventTool,
  ],
};
