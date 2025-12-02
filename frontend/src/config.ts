import type { Config } from "@/core/core";

import { ClearSelectionTool, TimeLayer } from "@/modules/time/index";
import {
  CreateObjectTool,
  ObjectsLayer,
  RefreshObjectsTool,
} from "@/modules/objects/index";
import { AudioPlayerTool } from "@/modules/audio/index";

export const config: Config = {
  layers: [
    TimeLayer(),
    ObjectsLayer(),

  ],
  tools: [
    CreateObjectTool,
    RefreshObjectsTool,
    AudioPlayerTool,
    ClearSelectionTool,
  ],
};
