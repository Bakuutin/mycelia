import { Link } from "react-router-dom";
import { ArrowLeftRight, ArrowRight } from "lucide-react";
import { formatTime, formatTimeRangeDuration } from "@/lib/formatTime";
import type { Object } from "@/types/objects";

type IconData = { text?: string; base64?: string };

const renderIcon = (icon: string | IconData | null | undefined) => {
  if (!icon) return "";
  if (typeof icon === "string") return icon;
  if ("text" in icon && icon.text) return icon.text;
  if ("base64" in icon && icon.base64) return "📷";
  return "";
};

type ObjectTileProps = {
  object: Object & { subjectObject?: Object; objectObject?: Object };
};

const renderDefaultDetails = (
  object: Object & { subjectObject?: Object; objectObject?: Object },
) => {
  const timeRange = object.timeRanges?.[0];
  const hasRelationshipData = object.isRelationship &&
    object.relationship &&
    object.subjectObject &&
    object.objectObject;
  const title = (object as { summary?: string }).summary || object.name;
  const description = object.details;

  return (
    <div className="rounded-lg border p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <span className="text-2xl leading-none flex-shrink-0">{renderIcon(object.icon)}</span>
        <div className="min-w-0 flex-1 space-y-2">
          {hasRelationshipData && (
            <div className="flex items-center gap-2 text-xs font-medium">
              <Link
                to={`/objects/${object.subjectObject?._id.toString()}`}
                className="inline-flex items-center gap-1 hover:text-primary transition-colors"
              >
                <span>{renderIcon(object.subjectObject?.icon)}</span>
                <span className="truncate">{object.subjectObject?.name}</span>
              </Link>
              {object.relationship?.symmetrical
                ? <ArrowLeftRight className="w-3 h-3 flex-shrink-0" />
                : <ArrowRight className="w-3 h-3 flex-shrink-0" />}
              <Link
                to={`/objects/${object.objectObject?._id.toString()}`}
                className="inline-flex items-center gap-1 hover:text-primary transition-colors"
              >
                <span>{renderIcon(object.objectObject?.icon)}</span>
                <span className="truncate">{object.objectObject?.name}</span>
              </Link>
            </div>
          )}
          <Link
            to={`/objects/${object._id.toString()}`}
            className="font-medium hover:text-primary transition-colors block"
          >
            {title}
          </Link>
          {description && (
            <div className="text-sm text-muted-foreground line-clamp-3">
              {description}
            </div>
          )}
        </div>
      </div>
      {timeRange && (
        <div className="text-xs text-muted-foreground">
          <span>{formatTime(timeRange.start)}</span>
          <span>
            {timeRange.end ? ` – ${formatTime(timeRange.end)}` : " – ongoing"}
          </span>
          {timeRange.end && (
            <span className="ml-2">
              {formatTimeRangeDuration(timeRange.start, timeRange.end)}
            </span>
          )}
          {object.timeRanges && object.timeRanges.length > 1 && (
            <span className="ml-2">
              {`${object.timeRanges.length} ranges`}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export function ObjectTile({ object }: ObjectTileProps) {
  return renderDefaultDetails(object);
}
