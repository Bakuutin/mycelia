import { Card } from "@/components/ui/card";
import { TypeBadges } from "./TypeBadges";
import { getObjectName, getProperty } from "@/types/activitypub";
import type { APObject } from "@/types/activitypub";
import { format } from "date-fns";

interface ObjectViewProps {
  object: APObject;
  showMetadata?: boolean;
  className?: string;
}

export function ObjectView({ object, showMetadata = true, className }: ObjectViewProps) {
  const name = getObjectName(object);
  const icon = getProperty<string>(object, "mycelia:icon");
  const summary = typeof object.summary === 'string' ? object.summary : undefined;
  const content = typeof object.content === 'string' ? object.content : undefined;
  
  return (
    <Card className={`p-4 ${className || ''}`}>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          {icon && (
            <span className="text-3xl" role="img" aria-label="icon">
              {icon}
            </span>
          )}
          <div className="flex-1 space-y-2">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-semibold">{name}</h2>
              <TypeBadges object={object} />
            </div>
            
            {summary && (
              <p className="text-sm text-muted-foreground">{summary}</p>
            )}
          </div>
        </div>
        
        {content && (
          <div 
            className="prose prose-sm max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: content }}
          />
        )}
        
        {showMetadata && (
          <div className="border-t pt-4 space-y-2 text-sm text-muted-foreground">
            {object.published && (
              <div>
                <span className="font-medium">Published:</span>{' '}
                {format(new Date(object.published), 'PPpp')}
              </div>
            )}
            
            {object.startTime && (
              <div>
                <span className="font-medium">Start:</span>{' '}
                {format(new Date(object.startTime), 'PPpp')}
              </div>
            )}
            
            {object.endTime && (
              <div>
                <span className="font-medium">End:</span>{' '}
                {format(new Date(object.endTime), 'PPpp')}
              </div>
            )}
            
            
            <div className="text-xs">
              <span className="font-medium">ID:</span>{' '}
              <code className="bg-muted px-1 py-0.5 rounded">{object.id}</code>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

