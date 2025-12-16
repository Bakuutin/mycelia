import type { Config } from "@/core/core";

import { TimeLayer } from "@/modules/time/index";
import {
  ObjectsLayer, RefreshObjectsTool,
} from "@/modules/objects/index";
import { HistogramLayer } from "@/modules/histogram/index";
import { ProcessingLayer } from "@/modules/histogram/ProcessingLayer";

export const config: Config = {
  layers: [
    TimeLayer(),
    ProcessingLayer(),
    HistogramLayer(),
    ObjectsLayer(),

  ],
  tools: [
    RefreshObjectsTool,
  ],
};
