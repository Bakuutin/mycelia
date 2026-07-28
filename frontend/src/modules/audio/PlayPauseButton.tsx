import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { useAudioPlayer } from "./player.tsx";

export const PlayPauseButton = () => {
  const { isPlaying, toggleIsPlaying } = useAudioPlayer();

  return (
    <Button onClick={() => toggleIsPlaying()}>
      {isPlaying ? <Pause /> : <Play />}
    </Button>
  );
};
