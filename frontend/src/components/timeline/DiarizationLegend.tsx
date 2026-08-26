import React, { memo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DIARIZATION_COVERAGE_LEGEND,
  SPEAKER_IDENTITY_LEGEND,
  SPEAKER_IDENTITY_VALIDITY_LEGEND,
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
            className="h-2.5 w-2.5 rounded-sm border"
            style={{
              backgroundColor: item.color,
              opacity: item.opacity,
              borderColor: item.stroke ?? "rgb(0 0 0 / 0.1)",
              borderStyle: item.strokeDasharray ? "dashed" : "solid",
              borderWidth: item.stroke ? 2 : 1,
            }}
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
  const [searchParams, setSearchParams] = useSearchParams();
  if (!showCoverage && !showIdentity) return null;

  const speakerFilter = searchParams.get("speakerIdentity") ?? "all";
  const statusFilter = searchParams.get("speakerIdentityStatus") ?? "all";
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };
  const filterClass = (selected: boolean) =>
    `rounded border px-1.5 py-0.5 font-medium transition-colors ${
      selected
        ? "border-primary bg-primary/10 text-primary"
        : "border-border bg-background text-muted-foreground hover:text-foreground"
    }`;

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
        <>
          <LegendGroup label="Speaker" items={SPEAKER_IDENTITY_LEGEND} />
          <LegendGroup
            label="Result"
            items={SPEAKER_IDENTITY_VALIDITY_LEGEND}
          />
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-medium text-foreground/75">Filter:</span>
            {(["all", "sky", "uncertain"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={speakerFilter === value}
                className={filterClass(speakerFilter === value)}
                onClick={() => setFilter("speakerIdentity", value)}
              >
                {value === "all"
                  ? "All voices"
                  : value === "sky"
                  ? "Sky"
                  : "Uncertain"}
              </button>
            ))}
            {(["all", "verified", "provisional"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={statusFilter === value}
                className={filterClass(statusFilter === value)}
                onClick={() => setFilter("speakerIdentityStatus", value)}
              >
                {value === "all"
                  ? "Any status"
                  : value === "verified"
                  ? "Verified"
                  : "Pilot"}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
});
