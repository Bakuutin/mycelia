import { cn } from "@/lib/utils";
import { UserRound } from "lucide-react";

interface SpeakerBadgeProps {
  name: string;
  color?: string;
  similarity?: number;
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
  className?: string;
}

/**
 * SpeakerBadge - displays a colored badge with speaker name
 * Used in transcripts and diarization views to show identified speakers.
 */
export function SpeakerBadge({
  name,
  color = "#6b7280",
  similarity,
  size = "sm",
  showIcon = false,
  className,
}: SpeakerBadgeProps) {
  const sizeClasses = {
    sm: "text-xs px-1.5 py-0.5 gap-1",
    md: "text-sm px-2 py-1 gap-1.5",
    lg: "text-base px-2.5 py-1.5 gap-2",
  };

  const iconSizes = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium",
        sizeClasses[size],
        className
      )}
      style={{
        backgroundColor: `${color}20`,
        color: color,
        borderColor: color,
        borderWidth: "1px",
      }}
      title={similarity ? `Confidence: ${Math.round(similarity * 100)}%` : undefined}
    >
      {showIcon && <UserRound className={iconSizes[size]} />}
      <span>{name}</span>
      {similarity !== undefined && (
        <span className="opacity-60 text-[0.8em]">
          {Math.round(similarity * 100)}%
        </span>
      )}
    </span>
  );
}

/**
 * SpeakerDot - a small colored dot representing a speaker
 * Used in timeline and compact views.
 */
export function SpeakerDot({
  color = "#6b7280",
  name,
  className,
}: {
  color?: string;
  name?: string;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-block w-2 h-2 rounded-full", className)}
      style={{ backgroundColor: color }}
      title={name}
    />
  );
}

export default SpeakerBadge;
