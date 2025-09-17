import React, { useCallback, useEffect } from "react";
import { useDateStore } from "@/modules/audio/player.tsx";
import { useTimeline } from "@/hooks/useTimeline.ts";
import { config } from "#/config.ts";
import { useTimelineRange } from "../stores/timelineRange.ts";
import _ from "lodash";
import { Link } from "@remix-run/react";
import { Cog } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

const TimelinePage = () => {
  const { start, end } = useTimelineRange();

  const setQueryParams = useCallback(
    _.debounce((start: Date, end: Date) => {
      const form = new FormData();
      form.append("start", start.getTime().toString());
      form.append("end", end.getTime().toString());

      const searchParams = new URLSearchParams({
        start: start.getTime().toString(),
        end: end.getTime().toString(),
      });
      globalThis.history.replaceState(null, "", `?${searchParams.toString()}`);
    }, 500),
    [],
  );

  useEffect(() => {
    setQueryParams(start, end);
  }, [start, end]);

  const {
    containerRef,
    transform,
    timeScale,
    width,
  } = useTimeline();

  return (
    <>
      <div className="p-4 gap-4 flex flex-col">
        <div className="flex flex-row items-center gap-4">
          {config.tools.map((tool, i) => (
            <tool.component
              key={i}
            />
          ))}
          <Link to="/settings" className="ml-auto">
            <Button><Cog /></Button>
          </Link>
        </div>
        <div
          ref={containerRef}
        >
          {containerRef.current && (
            <>
              {config.layers.map((layer, i) => (
                <layer.component
                  key={i}
                  scale={timeScale}
                  transform={transform}
                  width={width}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default TimelinePage;
