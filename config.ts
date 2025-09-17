import type { Config } from "@/core.ts";

import { SiFormatter, TimeLayer } from "@/modules/time/index.tsx";
import {
  AudioLayer,
  AudioPlayerTool,
  GainTool,
  TranscriptLayer,
  DateTimePickerTool,
} from "@/modules/audio/index.tsx";


export const config: Config = {
  layers: [
    TimeLayer({ formatter: SiFormatter }),
    TimeLayer(),
    AudioLayer(),
    TranscriptLayer(),
  ],
  tools: [
    AudioPlayerTool,
    GainTool,
    DateTimePickerTool,
  ],
};
