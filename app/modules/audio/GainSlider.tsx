import React, { useState } from "react";
import { useDateStore } from "./player.tsx";

const GainSlider: React.FC = () => {
  const { volume, setVolume } = useDateStore();

  const handleGainChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(event.target.value));
  };

  return (
    <div className="flex items-center gap-2">
      <input
        id="gain-slider"
        type="range"
        min="0"
        max="3"
        step="0.01"
        value={volume}
        onChange={handleGainChange}
        className="w-24"
      />
    </div>
  );
};

export default GainSlider;
