import { Layer } from "@/core.ts";

export const audio: Layer = {
  name: "audio",
  description: "Audio layer",
  enabled: true,
  config: {},
  component: () => <div>Audio</div>,
};
