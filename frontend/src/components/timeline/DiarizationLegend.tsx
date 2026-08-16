import React, { memo } from "react";
import {
  DIARIZATION_COVERAGE_LEGEND,
  SPEAKER_IDENTITY_LEGEND,
  type TimelineLegendItem,
} from "@/lib/timelineDiarization";

interface LegendGroupProps {
  label: string;
  items: TimelineLegendItem[];
}

const LegendGroup = memo(function LegendGroup({
  label,
  items,
}: LegendGroupProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="font-medium text-foreground/75">{label}:</span>
      {items.map((item) => (
        <span
          key={item.id}
          className="inline-flex items-center gap-1 whitespace-nowrap"
          title={`${label}: ${item.label}`}
        >
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-sm border border-black/10"
            style={{ backgroundColor: item.color, opacity: item.opacity }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
});

interface DiarizationLegendProps {
  showCoverage: boolean;
  showIdentity: boolean;
}

export const DiarizationLegend = memo(function DiarizationLegend({
  showCoverage,
  showIdentity,
}: DiarizationLegendProps) {
  if (!showCoverage && !showIdentity) return null;

  return (
    <div
      aria-label="Diarization color legend"
      className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border/30 bg-muted/15 px-2 py-1.5 text-[11px] text-muted-foreground"
    >
      <span className="font-semibold text-foreground/85">
        Diarization colors
      </span>
      {showCoverage && (
        <LegendGroup
          label="Coverage"
          items={DIARIZATION_COVERAGE_LEGEND}
        />
      )}
      {showIdentity && (
        <LegendGroup label="Speaker" items={SPEAKER_IDENTITY_LEGEND} />
      )}
    </div>
  );
});
