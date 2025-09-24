import { Layer, LayerComponentProps, Tool } from "@/core.ts";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";

import { AudioPlayer, useDateStore } from "./player.tsx";
import { TimelineItems } from "./TimelineItems.tsx";
import { CursorLine } from "./cursorLine.tsx";
import { useAudioItems } from "./useAudioItems.ts";
import { useTimelineRange } from "@/stores/timelineRange.ts";
import { PlayPauseButton } from "./PlayPauseButton.tsx";
import GainSlider from "./GainSlider.tsx";
import { useTranscripts } from "./useTranscripts.ts";
import { Settings2 as Sliders } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

import { formatDuration as formatDurationSI } from "@/modules/time/formatters/si.ts";
import { formatLabel as formatLabelGregorian } from "@/modules/time/formatters/gregorian.ts";


const day = 1000 * 60 * 60 * 24;

const roundToSignificantSeconds = (ms: number, significantDigits = 1): number => {
  if (ms === 0) return 0;
  const sign = Math.sign(ms);
  const secondsAbs = Math.abs(ms) / 1000;
  const power = Math.floor(Math.log10(secondsAbs)) - (significantDigits - 1);
  const factor = Math.pow(10, power);
  const roundedSeconds = Math.round(secondsAbs / factor) * factor;
  return sign * roundedSeconds * 1000;
};

const lambertW = (z: number, branch: 0 | -1 = 0): number => {
  const negInvE = -1 / Math.E;
  if (branch === 0 && z < negInvE) return NaN;
  if (branch === -1 && (z < negInvE || z >= 0)) return NaN;
  if (z === 0) return 0;
  let w: number;
  if (branch === 0) {
    if (z < 1) {
      w = z;
    } else {
      w = Math.log(z) - Math.log(Math.log(z));
    }
  } else {
    if (z > -0.1) {
      w = Math.log(-z);
    } else {
      w = Math.log(-z) - Math.log(-Math.log(-z));
    }
  }
  const maxIter = 64;
  const tol = 1e-12;
  for (let i = 0; i < maxIter; i++) {
    const ew = Math.exp(w);
    const wew = w * ew;
    const f = wew - z;
    const denomBase = ew * (w + 1);
    const denom = denomBase - (w + 2) * f / (2 * (w + 1));
    const dw = f / denom;
    w -= dw;
    if (Math.abs(dw) <= tol * (1 + Math.abs(w))) break;
  }
  return w;
};

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
                        <span onClick={() => {
                          resetDate(new Date(segment.start));
                        }} key={idx}>{segment.text}</span>
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
      const centerMs = currentDate ? currentDate.getTime() : (start.getTime() + end.getTime()) / 2;
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
              const seg = { id: `${i.id}-${idx}`,ts: segStartMs, topic, siblingCount: topics.length, idx };
              return { ...seg, x: sToShift(seg)};
            });
          })
      }, [items, currentDate, centerMs ]);

      const baselineY = 14;

      return (

        <div className="relative h-[28px]">
            {layout.map((p) => {
              const referenceX = width / 2;
              const delta = Math.abs(p.x - referenceX);
              const anchor: 'start' | 'middle' | 'end' = delta < width * 0.05
                ? 'middle'
                : (p.x < referenceX ? 'end' : 'start');
              return (
                <span
                  key={`topics-${p.id}`}
                  style={{
                    transform: `translate(${p.x}px, ${baselineY}px)`,
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: '100%',
                    height: '30px',
                }}
                  className="text-[10px] fill-white opacity-90"
                >
                  {p.idx === 0 && (
                    <span className="text-yellow-600">{
                      new Date(p.ts).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" })
                    }</span>
                  )} {p.topic}
                </span>
              );
            })}
        </div>
      );
    },
  } as Layer;
};







const MidText = ({ date }: { date: Date }) => {
  const [first, ...rest] = formatLabelGregorian(date);
  return (
    <foreignObject
      width={150}
      height="40px"
      className="overflow-visible"
      x={-75}
    >
      <div className="flex flex-col-reverse h-full">
        <p className="text-center text-xs">{first}</p>
        {rest.length > 0 && (
          <div className="mx-auto text-center text-xs flex flex-row-reverse gap-1">
            {rest.map((segment, i) => <span key={i}>{segment}</span>)}
          </div>
        )}
      </div>
    </foreignObject>
);
}



/**
 * Layer that renders an exponentially spaced time grid.
 * Labels indicate durations using formatDuration: past on the left, future on the right, center at 0s.
 */
export const CurvedTimeLayer: (options?: { height?: number }) => Layer = (
  options = {},
) => {
  const { height = 80 } = options;

  const Component: React.FC<LayerComponentProps> = ({ width, scale, transform }) => {

    const newScale = useMemo(() => transform.rescaleX(scale), [transform, scale]);
    const calibration = useMemo(() => {
      const [s, e] = newScale.domain();
      const tStart = s.getTime();
      const tEnd = e.getTime();
      const xStart = newScale(s);
      const xEnd = newScale(e);
      const xCenter = (xStart + xEnd) / 2;
      const a = (xEnd - xStart) / Math.max(1, tEnd - tStart);
      return { xCenter, a };
    }, [width, scale, transform]);


    const delta = 23003609127040;
    const  { start: flatStart, end: flatEnd } = useTimelineRange();
    const centerMs = (flatStart.getTime() + flatEnd.getTime()) / 2;
    const { start, end } = {
      start: new Date(centerMs - delta),
      end: new Date(centerMs + delta),
    }
    const items5 = useAudioItems(start, end, "5min").items;
    const items1h = useAudioItems(start, end, "1hour").items;
    const items1d = useAudioItems(start, end, "1day").items;
    const items1w = useAudioItems(start, end, "1week").items;

    const K = 24;
    const [maxExp, setMaxExp] = React.useState<number>(10.5);
    const [isSettingsOpen, setIsSettingsOpen] = React.useState<boolean>(false);
    const [showLogToLinearDirection, setShowLogToLinearDirection] = React.useState<boolean>(false);
    const [downPower, setDownPower] = React.useState<[number, number, number]>([0.4, 2.1, 10]);

    const moveDown = useMemo(() => {
      const [a, b, c] = downPower;
      // ax^b + c
      return (i: number) => {
        return 10 + a * Math.abs(i) ** b + c;
      };
    }, [downPower]);



    const specialDurations = useMemo(() => {
      const minute = 60 * 1000;
      const dayMs = 24 * 60 * 60 * 1000;
      return [
        { id: "1min", label: "1m", ms: minute },
        { id: "10min", label: "10m", ms: 10 * minute },
        { id: "1hour", label: "1h", ms: 60 * minute },
        { id: "6hours", label: "6h", ms: 6 * 60 * minute },
        { id: "1day", label: "1d", ms: dayMs },
        { id: "1week", label: "1w", ms: 7 * dayMs },
        { id: "1month", label: "1m", ms: 30 * dayMs },
        { id: "6months", label: "6m", ms: 180 * dayMs },
        { id: "2year", label: "2y", ms: 2 * 365 * dayMs },
        { id: "10years", label: "10y", ms: 10 * 365 * dayMs },
        { id: "100years", label: "100y", ms: 100 * 365 * dayMs },
        { id: "1000years", label: "1000y", ms: 1000 * 365 * dayMs },
      ];
    }, []);

    const specialMarks = useMemo(() => {
      const out: Array<{ id: string; x: number; label: string }> = [];
      for (const s of specialDurations) {
        const xPosPlus = calibration.xCenter + calibration.a * s.ms;
        const xPosMinus = calibration.xCenter - calibration.a * s.ms;
        if (xPosMinus >= 0 && xPosMinus <= width) out.push({ id: `${s.id}-neg`, x: xPosMinus, label: `-${s.label}` });
        if (xPosPlus >= 0 && xPosPlus <= width) out.push({ id: `${s.id}-pos`, x: xPosPlus, label: s.label });
      }
      return out.filter((o) => Math.abs(o.x - width / 2) > 70);
    }, [width, specialDurations, calibration]);

    const specialBlueDots = useMemo(() => {
      const middle = width / 2;
      const c = (2 * maxExp) / K;
      const out: Array<{ id: string; x: number; y: number; label: string; ms: number; sign: 1 | -1 }> = [];
      for (const s of specialDurations) {
        const v = Math.log10(Math.max(1, s.ms / 1000)) / Math.max(1e-9, c);
        const maxIndex = K / 2;
        if (v >= 0 && v <= maxIndex) {
          const iPos = v;
          const iNeg = -v;
          const xPos = middle + (width * iPos) / K;
          const yPos = moveDown(iPos);
          const xNeg = middle + (width * iNeg) / K;
          const yNeg = moveDown(iNeg);
          out.push({ id: `${s.id}-pos`, x: xPos, y: yPos, label: s.label, ms: s.ms, sign: 1 });
          out.push({ id: `${s.id}-neg`, x: xNeg, y: yNeg, label: `-${s.label}`, ms: s.ms, sign: -1 });
        }
      }
      out.push({ id: `zero`, x: middle, y: moveDown(0), label: `0`, ms: 0, sign: 1 });
      return out;
    }, [width, maxExp, K, specialDurations, moveDown]);

    const verticalDots = useMemo(() => {
      const middle = width / 2;
      const p = width / K;
      const D = middle - calibration.xCenter;
      const r = calibration.a * 1000;
      const a = (2 * maxExp / K) * Math.log(10);
      const results: Array<{ x: number; y: number; label: React.ReactNode[] }> = [];
      ([-1, 1] as const).forEach((side) => {
        const q = side * D;
        const z = -(a * r / p) * Math.exp((-a * q) / p);
        [0, -1].forEach((branch) => {
          const W = lambertW(z, branch as 0 | -1);
          if (!Number.isFinite(W)) return;
          const v = -(1 / a) * W - q / p;
          if (!Number.isFinite(v)) return;
          if (v < 1) return;
          const i = side * v;
          const x = middle + (width * i) / K;
          const y = moveDown(i);
          const durationMs = 1000 * Math.exp(a * v) * side;
          const label = formatDurationSI(roundToSignificantSeconds(durationMs, 1));
          results.push({ x, y, label });
        });
      });
      return results;
    }, [width, moveDown, calibration]);

    const colorScale = useMemo(() => d3.scaleSequential<string>()
      .domain([-15, -2])
      .interpolator(d3.interpolateRdYlBu), []);

    const getFill = useCallback((item: any) => {
      const seconds = Math.max(1e-6, item.totals.seconds);
      const density = (item.totals.audio_chunks?.has_speech || 0.1) / seconds;
      return colorScale(Math.log(density));
    }, [colorScale]);

    const getPattern = useCallback((item: any) => {
      if (item.stale) return "url(#stale-stripes)";
      return getFill(item);
    }, [getFill]);

    const spanMs = useMemo(() => Math.max(1, end.getTime() - start.getTime()), [start, end]);
    const chooseResolutionForMs = useCallback((ms: number) => {
      const minute = 60 * 1000;
      const hour = 60 * minute;
      const day = 24 * hour;
      const dist = Math.abs(ms - centerMs);
      const t1 = hour * 1;
      const t2 = day * 1;
      const t3 = day * 10;
      if (dist <= t1) return "5min" as const;
      if (dist <= t2) return "1hour" as const;
      if (dist <= t3) return "1day" as const;
      return "1week" as const;
    }, [centerMs, spanMs]);
    const selectedItems = useMemo(() => {
      const pick = (list: any[], tag: "5min" | "1hour" | "1day" | "1week") =>
        list.filter((it) => chooseResolutionForMs((it.start.getTime() + it.end.getTime()) / 2) === tag);
      return [
        ...pick(items5, "5min"),
        ...pick(items1h, "1hour"),
        ...pick(items1d, "1day"),
        ...pick(items1w, "1week"),
      ];
    }, [items5, items1h, items1d, items1w, chooseResolutionForMs]);
    const middle = width / 2;
    const c = useMemo(() => (2 * maxExp) / K, [maxExp]);
    const indexFromMs = useCallback((ms: number) => {
      const delta = ms - centerMs;
      const absSec = Math.max(1, Math.abs(delta) / 1000);
      const v = Math.log10(absSec) / Math.max(1e-9, c);
      const sign = delta >= 0 ? 1 : -1;
      return sign * v;
    }, [centerMs, c]);

    return (
      <svg width={width} height={height} className="overflow-visible">
        <defs>
          <marker id="arrowWhite" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#FFFFFF" />
          </marker>
          <pattern id="stale-stripes" patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="pink" opacity="1" />
            <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" stroke="rgb(255,20,147)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <g>

          {
            specialMarks.map((m) => (
              <g key={m.id}>
                  <text x={m.x} y={-10} textAnchor="middle" dominantBaseline="hanging" fontSize="10px" fill="white" fontStyle="italic">{m.label}</text>
              </g>
            ))
          }
          {
            (() => {
              const lineGen = d3.line<[number, number]>()
                .x((p) => p[0])
                .y((p) => p[1])
                .curve(d3.curveMonotoneX);
              const buildPath = (iStart: number, iEnd: number, yOffset: number) => {
                const steps = Math.max(2, Math.ceil(Math.abs(iEnd - iStart) * 6));
                const pts: [number, number][] = [];
                for (let s = 0; s < steps; s++) {
                  const t = steps === 1 ? 0 : s / (steps - 1);
                  const i = iStart + (iEnd - iStart) * t;
                  const x = middle + (width * i) / K;
                  const y = moveDown(i) + yOffset;
                  pts.push([x, y]);
                }
                return lineGen(pts) || "";
              };
              return selectedItems.map((item: any) => {
                const i0 = indexFromMs(item.start.getTime());
                const i1 = indexFromMs(item.end.getTime());
                const pathMain = buildPath(i0, i1, 12);
                return (
                  <g key={`log-item-${item.id}`}>
                    <path d={pathMain} fill="none" stroke={getPattern(item)} strokeWidth={10} strokeLinecap="butt" className="timeline-item" />
                  </g>
                );
              });
            })()
          }
          {
            specialBlueDots.map((b) => (
              <g key={`b-${b.id}`}>
                {(() => {
                  const xLinear = width / 2;
                  const dx = xLinear - b.x;
                  const dy = 0 - b.y;
                  const len = Math.hypot(dx, dy) || 1;
                  const ux = dx / len;
                  const uy = dy / len;
                  const tickLen = 10;
                  return (
                    <g>
                      {
                        showLogToLinearDirection && (
                          <line x1={b.x} x2={b.x + ux * tickLen} y1={b.y} y2={b.y + uy * tickLen} stroke="#999" strokeWidth={1} markerEnd="url(#arrowWhite)" />
                        )
                      }
                      {
                        len > 10 && len < 1000 && Math.abs(b.x + ux * len - width / 2) > 30 &&(
                          <line x1={b.x} x2={b.x + ux * len} y1={b.y} y2={0} stroke="#999" opacity={0.5} strokeWidth={1} strokeDasharray="1 9" />
                        )
                      }
                    </g>
                  );
                })()}

                  {b.ms == 0 ? (
                    <g transform={`translate(${b.x}, ${-18})`}>
                    <MidText date={new Date(centerMs)} />
                    </g>
                  ) : (
                    <g transform={`translate(${b.x}, ${b.y - 6})`}>
                      <circle cy={6} r={2} fill="#999" />
                      <text textAnchor="middle" dominantBaseline="baseline" fontSize="10px" fill="white">
                        {b.label}
                      </text>
                    </g>
                  )}
              </g>
            ))
          }
          {
            verticalDots.map((d, idx) => (
              <g key={`vd-${idx}`}>
                <circle cx={d.x} cy={d.y} r={2} fill="white" />
                <circle cx={d.x} cy={-10} r={2} fill="white" />
                {/* <text x={d.x} y={d.y + 12} textAnchor="middle" dominantBaseline="hanging" fontSize="10px" fill="#999">{d.label}</text> */}
              </g>
            ))
          }
        </g>
        {!isSettingsOpen && (
          <foreignObject x={width - 50} y={0} width={50} height={50}>
            <Button
              onClick={() => setIsSettingsOpen(true)}
              className="text-xs text-gray-500"
            >
              <Sliders />
            </Button>
          </foreignObject>
        )}

        {isSettingsOpen && (
          <foreignObject x={Math.max(0, width - 240)} y={0} width={240} height={200}>
            <div className="flex flex-col gap-2 text-[10px] text-gray-300 bg-black/30 px-2 py-4 rounded">
              <div className="absolute top-0 right-0">
                <button
                  type="button"
                  aria-label="Close settings"
                  title="Close settings"
                  className="p-3 text-xs rounded text-gray-200"
                  onClick={() => setIsSettingsOpen(false)}
                >
                  ✕
                </button>
              </div>
              <span>maxExp {maxExp.toFixed(1)}</span>
              <input
                type="range"
                min={2}
                max={20}
                step={0.1}
                value={maxExp}
                onChange={(e) => setMaxExp(parseFloat(e.target.value))}
              />
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={showLogToLinearDirection}
                  onChange={(e) => setShowLogToLinearDirection(e.target.checked)}
                />
                <span>show log to linear direction</span>
              </label>
              <span>down power: a={downPower[0].toFixed(2)} b={downPower[1].toFixed(2)} c={downPower[2].toFixed(2)}</span>
              <label className="flex items-center gap-1">
                <span className="w-3 text-right">a</span>
                <input
                  type="range"
                  min={0}
                  max={20}
                  step={0.1}
                  value={downPower[0]}
                  onChange={(e) => {
                    const nextA = parseFloat(e.target.value);
                    setDownPower((prev) => [nextA, prev[1], prev[2]]);
                  }}
                />
              </label>
              <label className="flex items-center gap-1">
                <span className="w-3 text-right">b</span>
                <input
                  type="range"
                  min={0.1}
                  max={5}
                  step={0.1}
                  value={downPower[1]}
                  onChange={(e) => {
                    const nextB = parseFloat(e.target.value);
                    setDownPower((prev) => [prev[0], nextB, prev[2]]);
                  }}
                />
              </label>
              <label className="flex items-center gap-1">
                <span className="w-3 text-right">c</span>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  step={0.5}
                  value={downPower[2]}
                  onChange={(e) => {
                    const nextC = parseFloat(e.target.value);
                    setDownPower((prev) => [prev[0], prev[1], nextC]);
                  }}
                />
              </label>
            </div>
          </foreignObject>
        )}
      </svg>
    );
  };

  return { component: Component } as Layer;
};

export const CurvedTopicsLayer: () => Layer = () => {
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