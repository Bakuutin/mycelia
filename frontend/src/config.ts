import type { Config } from "@/core/core";

import { TimeLayer } from "@/modules/time/index";
import { ObjectsLayer, CreateObjectTool, RefreshObjectsTool } from "@/modules/objects/index";


export const config: Config = {
  layers: [
    TimeLayer(),
    ObjectsLayer(),
  ],
  tools: [
    CreateObjectTool,
    RefreshObjectsTool,
  ],
};
