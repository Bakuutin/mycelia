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

// Fetch objects with search functionality for dropdowns
export function useObjectSearch(searchTerm: string = '', limit: number = 50) {
  return useQuery({
    queryKey: [...objectKeys.selection(), 'search', searchTerm, limit],
    queryFn: async () => {
      const query: any = { isRelationship: { $ne: true } };
      
      if (searchTerm.trim()) {
        query.$or = [
          { name: { $regex: searchTerm, $options: 'i' } },
          { aliases: { $regex: searchTerm, $options: 'i' } }
        ];
      }

      return await callResource("tech.mycelia.mongo", {
        action: "find",
        collection: "objects",
        query,
        sort: { name: 1 },
        limit,
      });
    },
    staleTime: 10 * 1000 // 10 sec for search results
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
          },
          {
            $set: {
              earliestStart: {
                $min: {
                  $map: {
                    input: "$relationship.timeRanges",
                    as: "r",
                    in: "$$r.start"
                  }
                }
              },
              latestEnd: {
                $max: {
                  $map: {
                    input: "$relationship.timeRanges",
                    as: "r",
                    in: "$$r.end"
                  }
                }
              }
            },
          },
          {
            $set: {
              endOrNow: {$ifNull: ["$latestEnd", new Date()]},
            },
          },
          {
            $set: {
              duration: { $subtract: ["$endOrNow", "$earliestStart"] }
            },
          },
          { $sort: { endOrNow: -1, earliestStart: -1  } }
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
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Object> | any }) => {
      let update: any;

      if (updates.$unset || updates.$set || updates.$push || updates.$pull) {
        update = {
          ...updates,
          $set: {
            ...updates.$set,
            updatedAt: new Date(),
          },
        };
      } else {
        update = {
          $set: {
            ...updates,
            updatedAt: new Date(),
          },
        };
      }

      return await callResource("tech.mycelia.mongo", {
        action: "updateOne",
        collection: "objects",
        query: { _id: { $oid: id } },
        update,
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

// Mutation for creating an object
export function useCreateObject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (doc: Partial<Object>) => {
      return await callResource("tech.mycelia.mongo", {
        action: "insertOne",
        collection: "objects",
        doc: {
          ...doc,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: objectKeys.all });
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
