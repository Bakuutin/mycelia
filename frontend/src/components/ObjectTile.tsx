import { Link, useNavigate } from "react-router-dom";
import { ArrowLeftRight, ArrowRight, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime, formatTimeRangeDuration } from "@/lib/formatTime";
import { useDeleteObject } from "@/hooks/useObjectQueries";
import { useObjectSelectionStore } from "@/stores/objectSelectionStore";
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
  isSelected?: boolean;
};

export function ObjectTile({ object, isSelected }: ObjectTileProps) {
  const navigate = useNavigate();
  const deleteObject = useDeleteObject();
  const { removeFromSelection } = useObjectSelectionStore();

  const timeRange = object.timeRanges?.[0];
  const hasRelationshipData = object.isRelationship &&
    object.relationship &&
    object.subjectObject &&
    object.objectObject;
  const title = (object as { summary?: string }).summary || object.name;
  const description = object.details;
  const objectId = object._id.toString();

  const handleDelete = () => {
    if (!globalThis.confirm(`Delete "${object.name}"?`)) return;
    deleteObject.mutate(objectId, {
      onSuccess: () => removeFromSelection(object._id),
    });
  };

  return (
    <div className={`rounded-lg border p-4 flex flex-col gap-3 transition-colors ${isSelected ? "border-primary ring-2 ring-primary/30 bg-primary/5" : ""}`}>
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
            to={`/objects/${objectId}`}
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

        {/* Edit / Delete actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-primary"
            onClick={() => navigate(`/objects/${objectId}`)}
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
            disabled={deleteObject.isPending}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
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
}
