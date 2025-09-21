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
  CurvedTimeLayer,
} from "@/modules/audio/index.tsx";


export const config: Config = {
  layers: [
    TranscriptLayer(),
    TimeLayer({ formatter: SiFormatter }),
    AudioLayer(),
    CurvedTimeLayer({ height: 80 }),
    // TopicsLayer(),
  ],
  tools: [
    AudioPlayerTool,
    GainTool,
    DateTimePickerTool,
    AutoCenterTool,
  ],
};
