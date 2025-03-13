import React from 'react';
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDateStore } from '~/components/player';

export const PlayPauseButton = () => {
    const isPlaying = useDateStore((state) => state.isPlaying);
    const setIsPlaying = useDateStore((state) => state.setIsPlaying);

    return (
        <Button
            variant="outline"
            size="icon"
            onClick={() => setIsPlaying(!isPlaying)}
        >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
    );
}; 