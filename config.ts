import type { Config } from "@/core.ts"

import { TimeLayer, SiFormatter } from "@/modules/time/index.tsx"

export const config: Config = {
    layers: [
        TimeLayer({formatter: SiFormatter}),
        TimeLayer(),
    ]
}