import type { Config } from "@/core.ts";

import { SiFormatter, TimeLayer } from "@/modules/time/index.tsx";

export const config: Config = {
  layers: [
    TimeLayer({ formatter: SiFormatter }),
    TimeLayer(),
  ],
};
