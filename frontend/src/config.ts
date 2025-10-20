import type { Config } from "@/core/core";

import { TimeLayer } from "@/modules/time/index";
import {
  AudioLayer,
  AudioPlayerTool,
  GainTool,
  TranscriptLayer,
  DateTimePickerTool,
} from "@/modules/audio/index";
import { EventsLayer, CreateEventTool } from "@/modules/events/index";


export const config: Config = {
  layers: [
    TranscriptLayer(),
    TimeLayer(),
    EventsLayer(),
    AudioLayer(),
  ],
  tools: [
    AudioPlayerTool,
    GainTool,
    DateTimePickerTool,
    CreateEventTool,
  ],
};
