import { useState, useCallback } from 'react';
import { callResource } from '@/lib/api';
import type { Object } from '@/types/objects';

export function useObjects() {
  const [allObjects, setAllObjects] = useState<Object[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAllObjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const objects = await callResource("tech.mycelia.mongo", {
        action: "find",
        collection: "objects",
        query: { isRelationship: { $ne: true } }, // Exclude relationship objects
        sort: { name: 1 }
      });
      setAllObjects(objects || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch objects';
      setError(errorMessage);
      console.error('Failed to fetch all objects:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    allObjects,
    loading,
    error,
    fetchAllObjects,
  };
}

export function useRelatedObjects(objectId: string | undefined) {
  const [relatedObjects, setRelatedObjects] = useState<Object[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRelatedObjects = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);

    try {
      // Find all relationships where this object is either subject or object
      const relationships = await callResource("tech.mycelia.mongo", {
        action: "find",
        collection: "objects",
        query: {
          isRelationship: true,
          $or: [
            { "relationship.subject": { $oid: id } },
            { "relationship.object": { $oid: id } }
          ]
        },
      });

      // Get the related objects
      const relatedIds = relationships.flatMap((rel: any) => [
        rel.relationship.subject.toString(),
        rel.relationship.object.toString()
      ]).filter((id: string) => id !== objectId);

      if (relatedIds.length > 0) {
        const relatedObjects = await callResource("tech.mycelia.mongo", {
          action: "find",
          collection: "objects",
          query: { _id: { $in: relatedIds.map((id: string) => ({ $oid: id })) } }
        });
        setRelatedObjects(relatedObjects || []);
      } else {
        setRelatedObjects([]);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch related objects';
      setError(errorMessage);
      console.error('Failed to fetch related objects:', err);
    } finally {
      setLoading(false);
    }
  }, [objectId]);

  return {
    relatedObjects,
    loading,
    error,
    fetchRelatedObjects,
  };
}
