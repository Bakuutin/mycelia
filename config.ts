import type { Config } from "@/core.ts";

import { SiFormatter, TimeLayer } from "@/modules/time/index.tsx";
import { AudioLayer } from "@/modules/audio/index.tsx";

export const config: Config = {
  layers: [
    TimeLayer({ formatter: SiFormatter }),
    TimeLayer(),
    AudioLayer(),
  ],
};
