import {
  coverageColor,
  type DiarizationCoverageState,
} from "./diarizationCoverage";

export interface TimelineLegendItem {
  id: string;
  label: string;
  color: string;
  opacity: number;
  stroke?: string;
  strokeDasharray?: string;
}

const SPEAKER_IDENTITY_APPEARANCE = {
  matched: {
    id: "matched",
    label: "Sky",
    color: "#22c55e",
    opacity: 0.82,
  },
  rejected: {
    id: "rejected",
    label: "Not Sky",
    color: "#64748b",
    opacity: 0.82,
  },
  uncertain: {
    id: "uncertain",
    label: "Uncertain",
    color: "#f59e0b",
    opacity: 0.82,
  },
  unclassified: {
    id: "unclassified",
    label: "Unclassified",
    color: "#cbd5e1",
    opacity: 0.82,
  },
} as const satisfies Record<string, TimelineLegendItem>;

export const SPEAKER_IDENTITY_LEGEND = Object.values(
  SPEAKER_IDENTITY_APPEARANCE,
);

export const SPEAKER_IDENTITY_VALIDITY_LEGEND: TimelineLegendItem[] = [
  {
    id: "provisional",
    label: "Pilot result",
    color: "#94a3b8",
    opacity: 0.58,
    stroke: "#a855f7",
    strokeDasharray: "4 2",
  },
];

export function speakerIdentityAppearance(
  state?: string,
  validity?: string,
): TimelineLegendItem {
  const appearance = state && state in SPEAKER_IDENTITY_APPEARANCE
    ? SPEAKER_IDENTITY_APPEARANCE[
      state as keyof typeof SPEAKER_IDENTITY_APPEARANCE
    ]
    : SPEAKER_IDENTITY_APPEARANCE.unclassified;
  if (validity === "provisional") {
    return {
      ...appearance,
      label: `Pilot · ${appearance.label}`,
      opacity: 0.58,
      stroke: "#a855f7",
      strokeDasharray: "4 2",
    };
  }
  return appearance;
}

export function coverageOpacity(state: DiarizationCoverageState): number {
  return state === "pending" ? 0.45 : 0.86;
}

export const DIARIZATION_BUILDING_COLOR = "#a855f7";

const COVERAGE_LABELS: Record<DiarizationCoverageState, string> = {
  diarized: "Done",
  processing: "Processing",
  pending: "Pending",
  needs_attention: "Needs attention",
};

export const DIARIZATION_COVERAGE_LEGEND: TimelineLegendItem[] = [
  ...(
    [
      "diarized",
      "processing",
      "pending",
      "needs_attention",
    ] as const
  ).map((state) => ({
    id: state,
    label: COVERAGE_LABELS[state],
    color: coverageColor(state),
    opacity: coverageOpacity(state),
  })),
  {
    id: "building",
    label: "Rebuilding",
    color: DIARIZATION_BUILDING_COLOR,
    opacity: 0.9,
  },
];
