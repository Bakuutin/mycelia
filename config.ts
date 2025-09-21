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
  AutoCenterTool,
} from "@/modules/audio/index.tsx";


export const config: Config = {
  layers: [
    TranscriptLayer(),
    TimeLayer({ formatter: SiFormatter }),
    TimeLayer(),
    AudioLayer(),
    MapLayer({ height: 80, curvatureK: 2, gridLines: 8 }),
    // TopicsLayer(),
  ],
  tools: [
    AudioPlayerTool,
    GainTool,
    DateTimePickerTool,
    AutoCenterTool,
  ],
};
