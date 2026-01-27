import React, { memo, useMemo } from "react";
import type { TrackConfig, TrackRenderProps } from "@/types/tracks";

interface BaseTrackProps extends TrackRenderProps {
  config: TrackConfig;
  children: React.ReactNode;
}

export const BaseTrack = memo(function BaseTrack({
  config,
  width,
  height,
  children,
}: BaseTrackProps) {
  return (
    <svg
      className="w-full zoomable"
      width={width}
      height={height}
      style={{ display: "block" }}
    >
      {children}
    </svg>
  );
});
