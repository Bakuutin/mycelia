import { useQuery, useMutation, useQueryClient, UseQueryResult } from '@tanstack/react-query';
import { callResource } from '@/lib/api';
import type { Object } from '@/types/objects';
import { ObjectId } from "bson";

// Query keys
export const objectKeys = {
  all: ['objects'] as const,
  lists: () => [...objectKeys.all, 'list'] as const,
  list: (filters: Record<string, any>) => [...objectKeys.lists(), { filters }] as const,
  details: () => [...objectKeys.all, 'detail'] as const,
  detail: (id: string) => [...objectKeys.details(), id] as const,
  related: (id: string) => [...objectKeys.all, 'related', id] as const,
  selection: () => [...objectKeys.all, 'selection'] as const,
};

// Fetch a single object by ID
export function useObject(id: string | ObjectId | undefined) {
  const objectId = id ? (id instanceof ObjectId ? id : new ObjectId(id)) : undefined;
  return useQuery({
    queryKey: objectKeys.detail(id?.toString()!),
    queryFn: async () => {
      if (!id) throw new Error('Object ID is required');
      return await callResource("tech.mycelia.mongo", {
        action: "findOne",
        collection: "objects",
        query: { _id: objectId },
      });
    },
    enabled: !!id,
  });
}

// Fetch objects for selection dropdowns (with limit)
export function useObjectSelection() {
  return useQuery({
    queryKey: objectKeys.selection(),
    queryFn: async () => {
      return await callResource("tech.mycelia.mongo", {
        action: "find",
        collection: "objects",
        query: { isRelationship: { $ne: true } },
        sort: { name: 1 },
        limit: 1000,
      });
    },
    staleTime: 30 * 1000 // 30 sec
  });
}


export function getRelationships(objectId: string | ObjectId | undefined): UseQueryResult<{
  relationship: Object;
  other: Object;
}[], Error> {
  const queryClient = useQueryClient();
  objectId = objectId ? (objectId instanceof ObjectId ? objectId : new ObjectId(objectId)) : undefined;
  return useQuery({
    queryKey: objectKeys.related(objectId!.toString()),
    queryFn: async () => {
      if (!objectId) throw new Error('Object ID is required');

      const relationships = await callResource("tech.mycelia.mongo", {
        action: "aggregate",
        collection: "objects",
        pipeline: [
          { $match: { isRelationship: true } },
          {
            $match: {
              $or: [
                { "relationship.subject": { $oid: objectId } },
                { "relationship.object": { $oid: objectId } }
              ]
            }
          },
          {
            $lookup: {
              from: "objects",
              localField: "relationship.subject",
              foreignField: "_id",
              as: "subjectObj"
            }
          },
          {
            $lookup: {
              from: "objects",
              localField: "relationship.object",
              foreignField: "_id",
              as: "objectObj"
            }
          },
          { $unwind: { path: "$subjectObj", preserveNullAndEmptyArrays: true } },
          { $unwind: { path: "$objectObj", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              relationship: "$$ROOT",
              other: {
                $cond: [
                  { $eq: ["$relationship.subject", { $oid: objectId }] },
                  "$objectObj",
                  "$subjectObj"
                ]
              }
            }
          }
        ]
      });

      // populate useQuery cache with the "other" objects 
      relationships.forEach((relationship: any) => {
        queryClient.setQueryData(objectKeys.detail(relationship.other._id.toString()), relationship.other);
      });

      return relationships
    },
    enabled: !!objectId,
    staleTime: 30 * 1000 // 30 sec
  });
}

// Mutation for updating an object
export function useUpdateObject() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Object> }) => {
      return await callResource("tech.mycelia.mongo", {
        action: "updateOne",
        collection: "objects",
        query: { _id: { $oid: id } },
        update: {
          $set: {
            ...updates,
            updatedAt: new Date(),
          },
        },
      });
    },
    onSuccess: (_, { id }) => {
      // Invalidate and refetch object details
      queryClient.invalidateQueries({ queryKey: objectKeys.detail(id) });
      // Invalidate related objects queries
      queryClient.invalidateQueries({ queryKey: objectKeys.related(id) });
    },
  });
}

// Mutation for deleting an object
export function useDeleteObject() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      return await callResource("tech.mycelia.mongo", {
        action: "deleteOne",
        collection: "objects",
        query: { _id: { $oid: id } },
      });
    },
    onSuccess: () => {
      // Invalidate all object queries
      queryClient.invalidateQueries({ queryKey: objectKeys.all });
    },
  });
}
