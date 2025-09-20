import type { Config } from "@/core.ts";

import { SiFormatter, TimeLayer } from "@/modules/time/index.tsx";
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
    TopicsLayer(),
  ],
  tools: [
    AudioPlayerTool,
    GainTool,
    DateTimePickerTool,
    AutoCenterTool,
  ],
};
