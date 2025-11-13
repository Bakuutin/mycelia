import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Object } from "@/types/objects";
import { formatTime } from "@/lib/formatTime";

interface MetadataDisplayProps {
  object: Object;
}

export function MetadataDisplay({ object }: MetadataDisplayProps) {
  const extractedWith = object?.metadata?.extractedWith;

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-muted/50">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">
          Metadata
        </h3>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <dt className="text-muted-foreground">Created:</dt>
            <dd className="text-foreground">
              {formatTime(new Date(object.createdAt))}
            </dd>
          </div>
          <div className="flex justify-between items-center">
            <dt className="text-muted-foreground">Updated:</dt>
            <dd className="text-foreground">
              {formatTime(new Date(object.updatedAt))}
            </dd>
          </div>
          <div className="flex justify-between items-center">
            <dt className="text-muted-foreground">Version:</dt>
            <dd className="text-foreground">
              {(object?.version || 0 ) as number}
            </dd>
          </div>
        </dl>
      </Card>

      {extractedWith && (
        <Card className="p-4 bg-muted/50">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">
            Extraction Metadata
          </h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground">Model:</dt>
              <dd className="font-mono text-foreground">
                {extractedWith.model}
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground">Extracted:</dt>
              <dd className="text-foreground">
                {formatTime(new Date(extractedWith.timestamp))}
              </dd>
            </div>
          </dl>
        </Card>
      )}
    </div>
  );
}
