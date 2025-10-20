import { Layer, LayerComponentProps, Tool } from "@/core.ts";
import React, { useMemo, useRef } from "react";

import { AudioPlayer, useDateStore } from "./player.tsx";
import { TimelineItems } from "./TimelineItems.tsx";
import { CursorLine } from "./cursorLine.tsx";
import { useAudioItems } from "./useAudioItems.ts";
import { useTimelineRange } from "@/stores/timelineRange.ts";
import { PlayPauseButton } from "./PlayPauseButton.tsx";
import GainSlider from "./GainSlider.tsx";
import { useTranscripts } from "./useTranscripts.ts";

const day = 1000 * 60 * 60 * 24;

export const AudioPlayerTool: Tool = {
  component: () => {
    return (
      <>
        <PlayPauseButton />
        <AudioPlayer />
      </>
    );
  },
};

export const GainTool: Tool = {
  component: () => {
    return <GainSlider />;
  },
};

export const DateTimePickerTool: Tool = {
  component: () => {
    const { currentDate, resetDate } = useDateStore();

    const handleDateTimeChange = (
      event: React.ChangeEvent<HTMLInputElement>,
    ) => {
      const newDate = new Date(event.target.value);
      resetDate(newDate);
    };

    const formatDateTimeLocal = (date: Date | null) => {
      if (!date) return "";
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      const seconds = String(date.getSeconds()).padStart(2, "0");
      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    };

    return (
      <input
        type="datetime-local"
        value={formatDateTimeLocal(currentDate)}
        onChange={handleDateTimeChange}
        className="px-2 py-1 text-white [&::-webkit-calendar-picker-indicator]:filter [&::-webkit-calendar-picker-indicator]:invert"
        step="1"
      />
    );
  },
};

export const AudioLayer: () => Layer = () => {
  return {
    component: ({ scale, transform, width }: LayerComponentProps) => {
      const { currentDate, resetDate, setIsPlaying } = useDateStore();

      const { start, end, setRange } = useTimelineRange();

      const resolution = useMemo(() => {
        const duration = end.getTime() - start.getTime();
        if (duration > 300 * day) {
          return "1week";
        } else if (duration > 50 * day) {
          return "1day";
        } else if (duration > day) {
          return "1hour";
        } else {
          return "5min";
        }
      }, [start, end]);

      const { items } = useAudioItems(start, end, resolution);
      React.useEffect(() => {
        if (!currentDate) return;
        const duration = end.getTime() - start.getTime();
        const half = duration / 2;
        const newStart = new Date(currentDate.getTime() - half);
        const newEnd = new Date(currentDate.getTime() + half);
        setRange(newStart, newEnd);
      }, [currentDate]);

      return (
        <svg
          className="w-full h-full zoomable"
          width={width}
          height={35}
          onClick={(event) => {
            const svgElement = event.currentTarget;
            const rect = svgElement.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const newScale = transform.rescaleX(scale);
            const clickedDate = newScale.invert(x);
            resetDate(clickedDate);
            setIsPlaying(true);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setIsPlaying(false);
            resetDate(null);
          }}
        >
          <g>
            <TimelineItems
              items={items as any}
              scale={scale}
              transform={transform}
            />
            {currentDate !== null && (
              <CursorLine
                position={transform.applyX(scale(currentDate))}
                height={80}
              />
            )}
          </g>
        </svg>
      );
    },
  } as Layer;
};

export const TranscriptLayer: () => Layer = () => {
  return {
    component: () => {
      const { currentDate, resetDate } = useDateStore();
      const { transcripts } = useTranscripts(currentDate);
      const containerRef = useRef<HTMLDivElement | null>(null);
      const itemRefs = useRef<Record<string, HTMLParagraphElement | null>>({});
      // useEffect(() => {
      //   if (!currentDate) return;
      //   const active = transcripts.find((t) => t.start <= currentDate && currentDate <= t.end);
      //   if (!active) return;
      //   const el = itemRefs.current[String(active._id)];
      //   if (el && containerRef.current) {
      //     el.scrollIntoView({ block: "nearest" });
      //   }
      // }, [currentDate, transcripts.map((t) => t._id).join(",")]);

      return (
        <div>
          <div
            ref={containerRef}
            className="mt-2 space-y-1 h-32 overflow-y-auto overscroll-none"
          >
            {transcripts.length === 0
              ? (
                <div className="h-full flex items-center text-gray-400 italic">
                  <p className="text-sm">
                    ... transcripts will be shown here...
                  </p>
                </div>
              )
              : (
                transcripts.map((transcript) => {
                  const isActive = !!currentDate &&
                    transcript.start <= currentDate;
                  const base = "text-sm italic p-1 rounded whitespace-pre-wrap";
                  const cls = isActive ? `${base} text-yellow-600` : `${base}`;
                  const formatTime = (d: Date) =>
                    d.toLocaleTimeString([], {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    });
                  return (
                    <div
                      key={transcript._id}
                      className="flex items-start gap-2"
                    >
                      <div className="w-20 shrink-0 text-xs text-gray-400 text-right font-mono leading-6">
                        {formatTime(transcript.start)}
                      </div>
                      <p
                        ref={(el) => {
                          itemRefs.current[String(transcript._id)] = el;
                        }}
                        className={cls}
                      >
                        {transcript.segments.map((segment, idx) => (
                          <span
                            onClick={() => {
                              resetDate(new Date(segment.start));
                            }}
                            key={idx}
                          >
                            {segment.text}
                          </span>
                        ))}
                      </p>
                    </div>
                  );
                })
              )}
          </div>
        </div>
      );
    },
  } as Layer;
};

export const TopicsLayer: () => Layer = () => {
  return {
    component: ({ width }: LayerComponentProps) => {
      let { start, end } = useTimelineRange();
      const { currentDate } = useDateStore();
      const centerMs = currentDate
        ? currentDate.getTime()
        : (start.getTime() + end.getTime()) / 2;
      start = new Date(centerMs - 1000 * 60 * 30);
      end = new Date(centerMs + 1000 * 60 * 30);

      const resolution = "5min";

      const { items } = useAudioItems(start, end, resolution);

      const sToShift = (s: any) => {
        return (s.ts - centerMs) / 100 / (s.siblingCount) + width / 2;
      };

      const layout = useMemo(() => {
        return items
          .filter((i) => (i.topics?.length ?? 0) > 0)
          .flatMap((i) => {
            const topics = i.topics || [];
            const startMs = i.start.getTime();
            const segmentMs = startMs + 2.5 * 60 * 100;
            return topics.map((topic, idx) => {
              const segStartMs = startMs + idx * segmentMs;
              const seg = {
                id: `${i.id}-${idx}`,
                ts: segStartMs,
                topic,
                siblingCount: topics.length,
                idx,
              };
              return { ...seg, x: sToShift(seg) };
            });
          });
      }, [items, currentDate, centerMs]);

      const baselineY = 14;

      return (
        <div className="relative h-[28px]">
          {layout.map((p) => {
            const referenceX = width / 2;
            const delta = Math.abs(p.x - referenceX);
            const anchor: "start" | "middle" | "end" = delta < width * 0.05
              ? "middle"
              : (p.x < referenceX ? "end" : "start");
            return (
              <span
                key={`topics-${p.id}`}
                style={{
                  transform: `translate(${p.x}px, ${baselineY}px)`,
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: "100%",
                  height: "30px",
                }}
                className="text-[10px] fill-white opacity-90"
              >
                {p.idx === 0 && (
                  <span className="text-yellow-600">
                    {new Date(p.ts).toLocaleTimeString([], {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )} {JSON.stringify(p.topic)}
              </span>
            );
          })}
        </div>
      );
    },
  } as Layer;
};
