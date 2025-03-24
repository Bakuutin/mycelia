import React from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { useDateStore } from "@/components/player.tsx";

export const PlayPauseButton = () => {
  const { isPlaying, toggleIsPlaying } = useDateStore();
  return (
    <Button onClick={() => toggleIsPlaying()}>
      {isPlaying ? <Pause /> : <Play />}
    </Button>
  );
};
