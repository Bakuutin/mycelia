import type { Config } from "@/core.ts";

import { SiFormatter, TimeLayer } from "@/modules/time/index.tsx";
import { MapLayer } from "@/modules/map/index.tsx";
import {
  AudioLayer,
  AudioPlayerTool,
  GainTool,
  TranscriptLayer,
  DateTimePickerTool,
  TopicsLayer,
  CurvedTimeLayer,
  CurvedTopicsLayer,
} from "@/modules/audio/index.tsx";


export const config: Config = {
  layers: [
    TranscriptLayer(),
    TopicsLayer(),
    TimeLayer(),
    AudioLayer(),
    CurvedTimeLayer({ height: 80 }),
    CurvedTopicsLayer(),
  ],
  tools: [
    AudioPlayerTool,
    GainTool,
    DateTimePickerTool,
  ],
};
