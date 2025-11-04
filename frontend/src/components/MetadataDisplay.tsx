import { Card } from '@/components/ui/card';
import type { Object } from '@/types/objects';
import { formatTime } from '@/lib/formatTime';

interface MetadataDisplayProps {
  object: Object;
}

export function MetadataDisplay({ object }: MetadataDisplayProps) {
  const metadata = object?.metadata?.extractedWith;

  if (!metadata) {
    return null;
  }

  return (
    <Card className="p-4 bg-muted/50">
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">Extraction Metadata</h3>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Model:</dt>
          <dd className="font-mono text-foreground">{metadata.model}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Extracted:</dt>
          <dd className="font-mono text-foreground">{formatTime(new Date(metadata.timestamp))}</dd>
        </div>
      </dl>
    </Card>
  );
}
