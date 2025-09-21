import { Layer, LayerComponentProps, Tool } from "@/core.ts";
import React, { useEffect, useMemo, useRef } from "react";

import { AudioPlayer, useDateStore } from "./player.tsx";
import { TimelineItems } from "./TimelineItems.tsx";
import { CursorLine } from "./cursorLine.tsx";
import { useAudioItems } from "./useAudioItems.ts";
import { useTimelineRange } from "@/stores/timelineRange.ts";
import { PlayPauseButton } from "./PlayPauseButton.tsx";
import GainSlider from "./GainSlider.tsx";
import { useTranscripts } from "./useTranscripts.ts";

import { formatDuration } from "@/modules/time/formatters/si.ts";


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
    
    const handleDateTimeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const newDate = new Date(event.target.value);
      resetDate(newDate);
    };
    
    const formatDateTimeLocal = (date: Date | null) => {
      if (!date) return "";
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
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

export const AutoCenterTool: Tool = {
  component: () => {
    const { autoCenter, toggleAutoCenter } = useTimelineRange();
    return (
      <button
        type="button"
        onClick={toggleAutoCenter}
        className={autoCenter ? "px-2 py-1 bg-yellow-700 rounded" : "px-2 py-1 bg-gray-700 rounded"}
        title={autoCenter ? "Auto-center: ON" : "Auto-center: OFF"}
      >
        {autoCenter ? "Auto-Center" : "Pan Mode"}
      </button>
    );
  },
};

export const AudioLayer: () => Layer = () => {
  return {
    component: ({ scale, transform, width }: LayerComponentProps) => {
      const { currentDate, resetDate, setIsPlaying } = useDateStore();

      const { start, end, autoCenter, setRange } = useTimelineRange();

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
        if (!autoCenter || !currentDate) return;
        const duration = end.getTime() - start.getTime();
        const half = duration / 2;
        const newStart = new Date(currentDate.getTime() - half);
        const newEnd = new Date(currentDate.getTime() + half);
        setRange(newStart, newEnd);
      }, [autoCenter, currentDate]);

      return (
        <svg
          className="w-full h-full zoomable"
          width={width}
          height={40}
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
    component: ({ scale, transform, width }: LayerComponentProps) => {
      const { currentDate } = useDateStore();
      const { transcripts } = useTranscripts(currentDate);
      const containerRef = useRef<HTMLDivElement | null>(null);
      const itemRefs = useRef<Record<string, HTMLParagraphElement | null>>({});
      useEffect(() => {
        if (!currentDate) return;
        const active = transcripts.find((t) => t.start <= currentDate && currentDate <= t.end);
        if (!active) return;
        const el = itemRefs.current[String(active._id)];
        if (el && containerRef.current) {
          el.scrollIntoView({ block: "nearest" });
        }
      }, [currentDate, transcripts.map((t) => t._id).join(",")]);
      
      return (
        <div>
          <div
            ref={containerRef}
            className="mt-2 space-y-1 h-32 overflow-y-auto overscroll-none"
          >
            {transcripts.length === 0 ? (
              <div className="h-full flex items-center text-gray-400 italic">
                <p className="text-sm">... transcripts will be shown here...</p>
              </div>
            ) : (
              transcripts.map((transcript) => {
                const isActive = !!currentDate && transcript.start <= currentDate;
                const base = "text-sm italic p-1 rounded whitespace-pre-wrap";
                const cls = isActive ? `${base} text-yellow-600` : `${base}`;
                const formatTime = (d: Date) => d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
                return (
                  <div key={transcript._id} className="flex items-start gap-2">
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
                        <span key={idx}>{segment.text}</span>
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
    component: ({ scale, transform, width }: LayerComponentProps) => {
      const { start, end } = useTimelineRange();
      const { currentDate } = useDateStore();

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

      const newScale = transform.rescaleX(scale);

      const layout = useMemo(() => {
        const viewCenterMs = (start.getTime() + end.getTime()) / 2;
        const halfWindowSec = Math.max(1, (end.getTime() - start.getTime()) / 2000);
        const candidates = items
          .filter((i) => (i.topics?.length ?? 0) > 0)
          .flatMap((i) => {
            const topics = i.topics || [];
            const startMs = i.start.getTime();
            const endMs = i.end.getTime();
            const durationMs = Math.max(1, endMs - startMs);
            const segmentMs = durationMs / topics.length;
            return topics.map((topic, idx) => {
              const segStartMs = startMs + idx * segmentMs;
              const segEndMs = segStartMs + segmentMs;
              const segMidMs = segStartMs + segmentMs / 2;
              const anchorX = newScale(new Date(segMidMs));
              const distanceSec = Math.abs(segMidMs - viewCenterMs) / 1000;
              const normalizedDistance = Math.min(1, distanceSec / halfWindowSec);
              const isActive = !!currentDate && currentDate.getTime() >= segStartMs && currentDate.getTime() <= segEndMs;
              return { id: `${i.id}-${idx}`, anchorX, topic, isActive, normalizedDistance };
            });
          })
          .sort((a, b) => a.normalizedDistance - b.normalizedDistance || a.anchorX - b.anchorX);

        const laneEnds: number[] = [];
        const placed: Array<any> = [];


        let lane = 0;

        for (const c of candidates) {
          placed.push({ ...c, lane  });
          lane++;
        }

        const lanes = laneEnds.length;
        return { placed, lanes };
      }, [items, newScale, width, currentDate, start, end]);

      const laneHeight = 16;
      const topMargin = 0;
      const svgHeight = 200;

      return (
          
          <svg className="w-full zoomable" width={width} height={svgHeight}>
            <g>
              {layout.placed.map((p) => {
                const textY = topMargin + p.lane * laneHeight + 12;
                const centerX = width / 2;
                const delta = Math.abs(p.anchorX - centerX);
                const anchor: 'start' | 'middle' | 'end' = delta < width * 0.05
                  ? 'middle'
                  : (p.anchorX < centerX ? 'end' : 'start');
                const dx = anchor === 'start' ? 2 : anchor === 'end' ? -2 : 0;
                return (
                  <g
                    key={`topics-${p.id}`}
                    style={{ transition: "transform 300ms ease-in-out", transform: `translate(0px, ${textY}px)` }}
                  >
                    <text
                      x={p.anchorX}
                      y={0}
                      textAnchor={anchor}
                      dx={dx}
                      className={p.isActive ? "text-[10px] fill-yellow-300 opacity-100" : "text-[10px] fill-white opacity-90"}
                    >
                      {p.topic}
                    </text>
                  </g>
                );
              })}
            </g>
            
          </svg>
      );
    },
  } as Layer;
};




/**
 * Layer that renders an exponentially spaced time grid.
 * Labels indicate durations using formatDuration: past on the left, future on the right, center at 0s.
 */
export const CurvedTimeLayer: (options?: { height?: number }) => Layer = (
  options = {},
) => {
  const { height = 80 } = options;

  const Component: React.FC<LayerComponentProps> = ({ width, scale, transform }) => {
    const newScale = transform.rescaleX(scale);
    const middle = width / 2;
    const [start, end] = newScale.domain();
    const middleTS: number = (start.getTime() + end.getTime()) / 2;
    const K = 14;
    const linear = Array.from({ length: K+1 }, (_, i) => -K/2 + i);
  
    return (
      <svg width={width} height={height} className="overflow-visible">
        <g>
          {
            linear.map((i) => {
              const duration = 1000 * (10**Math.abs(i));
              const linearX = newScale(new Date(middleTS + duration * Math.sign(i)));
              const logX = middle + width * i / K;
              const origin = [logX, 10 + i*i];
              const target = [linearX, 0];
              const dx = target[0] - origin[0];
              const dy = target[1] - origin[1];
              let length = Math.abs(dx) + Math.abs(dy);
              if (length < 1000) {
                length = Math.sqrt(dx * dx + dy * dy);
              }
              const lineLen = 10;
              const unitVector = [dx / length, dy / length];
              
              return (
                <g key={i.toString()}> 
                  <line x1={origin[0]} x2={origin[0] + unitVector[0] * lineLen} y1={origin[1]} y2={origin[1] + unitVector[1] * lineLen} stroke="#E5E7EB" strokeWidth={1} fill="none" />
                  <text x={logX} y={20 + i*i} textAnchor="middle" dominantBaseline="hanging" fontSize="12px" fill="#E5E7EB">
                    {formatDuration(duration * Math.sign(i))}
                  </text>
                </g>
              )
            })
          }
        </g>
      </svg>
    );
  };

  return { component: Component } as Layer;
};

