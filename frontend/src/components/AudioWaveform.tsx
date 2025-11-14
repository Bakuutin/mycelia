import React from "react";

interface AudioWaveformProps {
  className?: string;
  size?: number;
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({
  className = "",
  size = 24,
}) => {
  const bars = [
    { x: 2, startY: 10, height: 3 },
    { x: 6, startY: 6, height: 11 },
    { x: 10, startY: 3, height: 18 },
    { x: 14, startY: 8, height: 7 },
    { x: 18, startY: 5, height: 13 },
    { x: 22, startY: 10, height: 3 },
  ];

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <defs>
        <style>
          {`
            @keyframes wave-pulse {
              0%, 100% {
                opacity: 0.5;
                transform: scaleY(0.4);
              }
              50% {
                opacity: 1;
                transform: scaleY(1);
              }
            }
            
            .wave-bar {
              transform-origin: center;
              animation: wave-pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            }
          `}
        </style>
      </defs>
      {bars.map((bar, index) => {
        const delay = ((bars.length - 1 - index) * 0.2) % 1.2;
        return (
          <path
            key={index}
            className="wave-bar"
            d={`M${bar.x} ${bar.startY}v${bar.height}`}
            style={{
              animationDelay: `${delay}s`,
            }}
          />
        );
      })}
    </svg>
  );
};

