import type { Layer, LayerComponentProps } from "@/core/core";
import { useTimelineRange } from "@/stores/timelineRange";
import { useHistogramItems } from "./useHistogramItems";
import { HistogramBars } from "./HistogramLayer";

export const HistogramLayer = (): Layer => {
  return {
    component: ({ scale, transform, width }: LayerComponentProps) => {
      const { start, end } = useTimelineRange();
      const { items } = useHistogramItems(start, end);

      return (
        <HistogramBars
          items={items}
          scale={scale}
          transform={transform}
          width={width}
          height={60}
        />
      );
    },
  } as Layer;
};
