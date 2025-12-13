import type { Config } from "@/core/core";

import { TimeLayer } from "@/modules/time/index";
import {
  ObjectsLayer, RefreshObjectsTool,
} from "@/modules/objects/index";

export const config: Config = {
  layers: [
    TimeLayer(),
    ObjectsLayer(),

  ],
  tools: [
    RefreshObjectsTool,
  ],
};
