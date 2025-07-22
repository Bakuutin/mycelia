import React, { useEffect } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { useDateStore } from "./player.tsx";

export const PlayPauseButton = () => {
  const { isPlaying, toggleIsPlaying } = useDateStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        toggleIsPlaying();
      }
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleIsPlaying]);

  return (
    <Button onClick={() => toggleIsPlaying()}>
      {isPlaying ? <Pause /> : <Play />}
    </Button>
  );
};
