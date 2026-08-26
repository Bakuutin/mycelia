import { memo, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TrackConfig, TrackRenderProps } from "@/types/tracks";
import { useTimelineRange } from "@/stores/timelineRange";
import { callResource } from "@/lib/api";
import { AuthenticatedMediaImage } from "@/components/media/AuthenticatedMediaImage";
import { BaseTrack } from "./BaseTrack";

export const PHOTOS_CONFIG: TrackConfig = {
  id: "photos",
  label: "Photos",
  description: "Imported photo times; all statuses, with density fallback",
  defaultVisible: true,
  defaultHeight: 48,
  color: "#f97316",
};

const STATUS_COLOR: Record<string, string> = {
  staged: "#94a3b8",
  queued: "#f59e0b",
  processing: "#3b82f6",
  ready: "#22c55e",
  failed: "#ef4444",
  budget_blocked: "#ef4444",
  recognition_disabled: "#a855f7",
  source_missing: "#ef4444",
  source_changed: "#ef4444",
};

export const PhotosTrack = memo(function PhotosTrack({
  scale,
  transform,
  width,
  height,
}: Omit<TrackRenderProps, "items"> & { items?: TrackRenderProps["items"] }) {
  const navigate = useNavigate();
  const { start, end } = useTimelineRange();
  const [data, setData] = useState<any>();

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      void callResource("media-library", {
        action: "timeline",
        start: start.toISOString(),
        end: end.toISOString(),
        detailLimit: Math.max(100, Math.min(2_000, Math.floor(width / 22))),
      }).then(setData).catch(() => setData(undefined));
    }, 250);
    return () => globalThis.clearTimeout(timer);
  }, [start.getTime(), end.getTime(), width]);

  const rescaled = useMemo(() => transform.rescaleX(scale), [scale, transform]);

  return (
    <BaseTrack
      config={PHOTOS_CONFIG}
      scale={scale}
      transform={transform}
      width={width}
      height={height}
      items={[]}
    >
      {data?.mode === "density" && (data.buckets ?? []).map((bucket: any) => {
        const x = rescaled(new Date(bucket.start));
        const max = Math.max(
          ...(data.buckets ?? []).map((entry: any) => Number(entry.count)),
          1,
        );
        const barHeight = Math.max(
          3,
          (Number(bucket.count) / max) * (height - 5),
        );
        const ready = Number(bucket.statuses?.ready ?? 0);
        const failed = Number(bucket.statuses?.failed ?? 0) +
          Number(bucket.statuses?.source_missing ?? 0);
        const fill = failed > 0
          ? "#ef4444"
          : ready === bucket.count
          ? "#22c55e"
          : "#f59e0b";
        return (
          <rect
            key={String(bucket.start)}
            x={x}
            y={height - barHeight}
            width={Math.max(
              2,
              width / Math.max((data.buckets ?? []).length, 1) - 1,
            )}
            height={barHeight}
            rx={1}
            fill={fill}
            opacity={0.8}
          >
            <title>{bucket.count} photos</title>
          </rect>
        );
      })}
      {data?.mode === "items" && (data.items ?? []).map((item: any) => {
        const x = rescaled(new Date(item.capturedAt));
        if (x < -16 || x > width + 16) return null;
        return (
          <g
            key={String(item.assetId)}
            className="cursor-pointer"
            onClick={(event) => {
              event.stopPropagation();
              navigate(`/media?assetId=${String(item.assetId)}`);
            }}
          >
            <foreignObject x={x - 13} y={3} width={26} height={26}>
              <div
                className="h-6 w-6 rounded-full border-2"
                style={{ borderColor: STATUS_COLOR[item.status] ?? "#94a3b8" }}
              >
                <AuthenticatedMediaImage
                  path={item.thumbnailUrl}
                  alt={item.fileName}
                  className="h-full w-full rounded-full object-cover"
                />
              </div>
            </foreignObject>
            <title>{item.shortCaption ?? item.fileName} · {item.status}</title>
          </g>
        );
      })}
      {Number(data?.unplacedTimeCount ?? 0) > 0 && (
        <g
          className="cursor-pointer"
          onClick={() => navigate("/media?placement=missing_time")}
        >
          <rect
            x={Math.max(0, width - 92)}
            y={height - 17}
            width={88}
            height={14}
            rx={7}
            fill="#64748b"
          />
          <text
            x={Math.max(4, width - 88)}
            y={height - 7}
            fontSize={9}
            fill="white"
          >
            Unplaced {data.unplacedTimeCount}
          </text>
        </g>
      )}
    </BaseTrack>
  );
});
