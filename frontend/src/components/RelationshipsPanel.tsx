import { Link } from 'react-router-dom';
import type { Object } from '@/types/objects';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Link as LinkIcon } from 'lucide-react';

interface RelationshipsPanelProps {
  object: Object;
  allObjects: Object[];
  relatedObjects: Object[];
}

const renderIcon = (icon: any) => {
  if (!icon) return '';
  if (typeof icon === 'string') return icon;
  if (icon.text) return icon.text;
  if (icon.base64) return '📷'; // Placeholder for base64 images
  return '';
};

export function RelationshipsPanel({ object, allObjects, relatedObjects }: RelationshipsPanelProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Relationships</h3>
      
      {object.isRelationship && object.relationship && (
        <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
          <Label className="text-sm font-medium">This Relationship</Label>
          
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Subject</Label>
              <div className="mt-1 p-2 bg-background border rounded">
                {(() => {
                  const subject = allObjects.find(obj => obj._id.toString() === object.relationship?.subject.toString());
                  return subject ? (
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{renderIcon(subject.icon)}</span>
                      <span className="font-medium">{subject.name}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Select subject...</span>
                  );
                })()}
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Object</Label>
              <div className="mt-1 p-2 bg-background border rounded">
                {(() => {
                  const obj = allObjects.find(o => o._id.toString() === object.relationship?.object.toString());
                  return obj ? (
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{renderIcon(obj.icon)}</span>
                      <span className="font-medium">{obj.name}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Select object...</span>
                  );
                })()}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {object.relationship.symmetrical ? 'Symmetrical' : 'Asymmetrical'} relationship
              </span>
            </div>
          </div>
        </div>
      )}

      {!object.isRelationship && relatedObjects.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Related Objects</Label>
          <div className="grid gap-2">
            {relatedObjects.map(relatedObj => (
              <div key={relatedObj._id.toString()} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{renderIcon(relatedObj.icon)}</span>
                  <div>
                    <div className="font-medium">{relatedObj.name}</div>
                    {relatedObj.details && (
                      <div className="text-sm text-muted-foreground">{relatedObj.details}</div>
                    )}
                  </div>
                </div>
                <Link to={`/objects/${relatedObj._id.toString()}`}>
                  <Button variant="ghost" size="sm">
                    <LinkIcon className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {!object.isRelationship && relatedObjects.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p>No related objects found.</p>
          <p className="text-sm mt-1">Create relationship objects to link this object to others.</p>
        </div>
      )}
    </div>
  );
}
