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
  return useQuery({
    queryKey: objectKeys.detail(id?.toString()!),
    queryFn: async () => {
      if (!id) throw new Error('Object ID is required');
      return await callResource("tech.mycelia.objects", {
        action: "get",
        id: id.toString(),
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
      return await callResource("tech.mycelia.objects", {
        action: "list",
        filters: { isRelationship: { $ne: true } },
        options: {
          sort: { name: 1 },
          limit: 1000,
        },
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
      return await callResource("tech.mycelia.objects", {
        action: "list",
        filters: { isRelationship: { $ne: true } },
        options: {
          searchTerm: searchTerm.trim() || undefined,
          sort: { name: 1 },
          limit,
        },
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
  const idString = objectId ? (objectId instanceof ObjectId ? objectId.toString() : objectId) : undefined;

  return useQuery({
    queryKey: objectKeys.related(idString!),
    queryFn: async () => {
      if (!idString) throw new Error('Object ID is required');

      const relationships = await callResource("tech.mycelia.objects", {
        action: "getRelationships",
        id: idString,
      });

      // populate useQuery cache with the "other" objects
      relationships.forEach((relationship: any) => {
        queryClient.setQueryData(objectKeys.detail(relationship.other._id.toString()), relationship.other);
      });

      return relationships;
    },
    enabled: !!idString,
    staleTime: 30 * 1000 // 30 sec
  });
}

// Mutation for updating an object
export function useUpdateObject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      version,
      field,
      value
    }: {
      id: string;
      version: number;
      field: string;
      value: any
    }) => {
      return await callResource("tech.mycelia.objects", {
        action: "update",
        id,
        version,
        field,
        value,
      });
    },
    onSuccess: (result, { id }) => {
      // Update cached object with new version
      queryClient.setQueryData(objectKeys.detail(id), result);
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: objectKeys.related(id) });
      queryClient.invalidateQueries({ queryKey: objectKeys.lists() });
    },
    onError: (error: any, { id }) => {
      if (error.code === 409) {
        // Conflict - refresh object data
        queryClient.invalidateQueries({ queryKey: objectKeys.detail(id) });
      }
    },
  });
}

// Mutation for creating an object
export function useCreateObject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (object: Partial<Object>) => {
      return await callResource("tech.mycelia.objects", {
        action: "create",
        object,
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
      return await callResource("tech.mycelia.objects", {
        action: "delete",
        id,
      });
    },
    onSuccess: () => {
      // Invalidate all object queries
      queryClient.invalidateQueries({ queryKey: objectKeys.all });
    },
  });
}
