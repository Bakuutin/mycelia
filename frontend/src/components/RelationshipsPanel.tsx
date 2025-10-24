import { Link } from 'react-router-dom';
import { Link as LinkIcon, ArrowRight, ArrowLeft, ArrowLeftRight } from 'lucide-react';
import type { Object } from '@/types/objects';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { getRelationships } from "@/hooks/useObjectQueries.ts";

interface RelationshipsPanelProps {
  object: Object;
}



const renderIcon = (icon: any) => {
  if (!icon) return '';
  if (typeof icon === 'string') return icon;
  if (icon.text) return icon.text;
  if (icon.base64) return '📷'; // Placeholder for base64 images
  return '';
};


export function RelationshipsPanel({ object }: RelationshipsPanelProps) {
  const { data: relationships = [] } = getRelationships(object._id);

  console.log(relationships);
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Relationships</h3>
      {!object.isRelationship && relationships.length > 0 && (
        <div className="space-y-2">
          <div className="grid gap-2">
            {relationships.map(({ other, relationship }) => {
              // Determine if current object is subject or object in the relationship
              const isCurrentObjectSubject = relationship.relationship?.subject.toString() === object._id.toString();
              const isSymmetrical = relationship.relationship?.symmetrical;

              // Use double-sided arrow for symmetrical relationships, directional arrows for asymmetrical
              const ArrowComponent = isSymmetrical ? ArrowLeftRight : (isCurrentObjectSubject ? ArrowRight : ArrowLeft);

              return (
                <div key={relationship._id.toString()} className="p-1 space-y-2">
                  {/* Horizontal relationship flow */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Link to={`/objects/${relationship._id.toString()}`} className="flex items-center gap-2 min-w-0">
                         
                          <span className="text-lg">{renderIcon(relationship.icon)}</span>
                          <span className="font-medium truncate">{relationship.name}</span>

                        <ArrowComponent className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      </Link>
                      <Link to={`/objects/${other._id.toString()}`} className="flex items-center gap-2 min-w-0">
                        <span className="text-lg">{renderIcon(other.icon)}</span>
                        <span className="font-medium truncate">{other.name}</span>
                      </Link>
                    </div>
                  </div>

                  {/* Relationship description below */}
                  {relationship.details && (
                    <div className="text-sm text-muted-foreground pl-2">
                      {relationship.details}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!object.isRelationship && relationships.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p>No related objects found.</p>
          <p className="text-sm mt-1">Create relationship objects to link this object to others.</p>
        </div>
      )}
    </div>
  );
}
