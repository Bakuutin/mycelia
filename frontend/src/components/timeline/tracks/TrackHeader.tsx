import React, { memo } from "react";
import type { TrackConfig } from "@/types/tracks";

interface TrackHeaderProps {
  config: TrackConfig;
}

export const TrackHeader = memo(function TrackHeader({
  config,
}: TrackHeaderProps) {
  return (
    <div
      className="track-header absolute left-0 top-0 px-2 py-0.5 text-xs font-medium text-muted-foreground bg-background/80 backdrop-blur-sm rounded-br z-10"
      style={{ pointerEvents: "none" }}
    >
      {config.label}
    </div>
  );
});
