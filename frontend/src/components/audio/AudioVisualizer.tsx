import { useEffect, useRef, useState } from "react";
import type { AudioRecordingReturn } from "@/hooks/useAudioRecording";
import { useSettingsStore } from "@/stores/settingsStore";

interface AudioVisualizerProps {
  recording: AudioRecordingReturn;
}

const getThemeColors = (isDark: boolean) => {
  const getComputedColor = (cssVar: string, fallback: string): string => {
    try {
      const tempEl = document.createElement("div");
      tempEl.style.setProperty("color", `var(${cssVar})`);
      tempEl.style.position = "absolute";
      tempEl.style.visibility = "hidden";
      tempEl.style.pointerEvents = "none";
      tempEl.style.top = "-9999px";
      document.body.appendChild(tempEl);

      const computedColor = getComputedStyle(tempEl).color;
      document.body.removeChild(tempEl);

      if (
        computedColor &&
        computedColor !== "rgba(0, 0, 0, 0)" &&
        computedColor !== "transparent" &&
        (computedColor.startsWith("rgb") || computedColor.startsWith("#") ||
          computedColor.startsWith("hsl"))
      ) {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = computedColor;
          ctx.fillRect(0, 0, 1, 1);
          const imageData = ctx.getImageData(0, 0, 1, 1);
          const [r, g, b] = imageData.data;
          return `rgb(${r}, ${g}, ${b})`;
        }
      }
    } catch (error) {
      console.warn(`Failed to get color for ${cssVar}:`, error);
    }

    return fallback;
  };

  if (isDark) {
    return {
      background: getComputedColor("--card", "rgb(52, 52, 52)"),
      primary: getComputedColor("--chart-1", "rgb(99, 102, 241)"),
      accent: getComputedColor("--chart-2", "rgb(34, 197, 94)"),
      border: getComputedColor("--border", "rgba(255, 255, 255, 0.1)"),
    };
  } else {
    return {
      background: getComputedColor("--card", "rgb(255, 255, 255)"),
      primary: getComputedColor("--chart-1", "rgb(99, 102, 241)"),
      accent: getComputedColor("--chart-2", "rgb(34, 197, 94)"),
      border: getComputedColor("--border", "rgb(229, 229, 229)"),
    };
  }
};

export const AudioVisualizer = ({ recording }: AudioVisualizerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const { analyser, isRecording } = recording;
  const { theme } = useSettingsStore();
  const isDark = theme === "dark" ||
    (theme === "system" && document.documentElement.classList.contains("dark"));
  const [themeColors, setThemeColors] = useState(getThemeColors(isDark));

  useEffect(() => {
    const updateTheme = () => {
      const currentIsDark = theme === "dark" ||
        (theme === "system" &&
          document.documentElement.classList.contains("dark"));
      setThemeColors(getThemeColors(currentIsDark));
    };

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      observer.disconnect();
    };
  }, [theme]);

  useEffect(() => {
    if (!analyser || !isRecording || !canvasRef.current) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resizeCanvas();
    addEventListener("resize", resizeCanvas);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const barCount = 64;
    const dataStep = Math.floor(bufferLength / barCount);

    const draw = () => {
      if (!isRecording || !analyser) return;

      animationFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;

      ctx.clearRect(0, 0, width, height);

      const barWidth = width / barCount;
      const gap = 2;
      const maxBarHeight = height;

      for (let i = 0; i < barCount; i++) {
        const dataIndex = i * dataStep;
        const value = dataArray[dataIndex];
        const normalizedValue = value / 255;
        const barHeight = normalizedValue * maxBarHeight;

        const x = i * barWidth;
        const y = height - barHeight;

        ctx.fillStyle = themeColors.primary;
        ctx.fillRect(x + gap, y, barWidth - gap * 2, barHeight);
      }
    };

    draw();

    return () => {
      removeEventListener("resize", resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [analyser, isRecording, themeColors]);

  if (!isRecording) {
    return null;
  }

  return (
    <div className="w-full relative">
      <canvas
        ref={canvasRef}
        className="w-full h-30"
        style={{ height: "192px", backgroundColor: "transparent" }}
      />
    </div>
  );
};
