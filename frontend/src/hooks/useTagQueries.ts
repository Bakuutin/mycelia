import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { callResource } from "@/lib/api";
import type { Object as ObjectModel } from "@/types/objects";
import { ObjectId } from "bson";
import { objectKeys } from "@/hooks/useObjectQueries";

/**
 * Tag data access.
 *
 * Tags are plain objects with `isTag: true`. An object is tagged via a
 * relationship edge `{ isRelationship: true, name: "tagged",
 * relationship: { subject: <taggedObjectId>, object: <tagId> } }` —
 * the same shape the backend tagger and merged extractor create
 * (see backend/workers/tagger.ts).
 */

export const tagKeys = {
  all: ["tags"] as const,
  list: () => [...tagKeys.all, "list"] as const,
};

/** All tag objects, sorted by name. The tag set is small and changes rarely. */
export function useAllTags() {
  return useQuery<ObjectModel[]>({
    queryKey: tagKeys.list(),
    queryFn: async () => {
      return await callResource("objects", {
        action: "list",
        filters: { isTag: true },
        options: { sort: { name: 1 } },
      });
    },
    staleTime: 5 * 60 * 1000,
  });
}

function invalidateForObject(
  queryClient: ReturnType<typeof useQueryClient>,
  objectId: string,
) {
  queryClient.invalidateQueries({ queryKey: objectKeys.related(objectId) });
  queryClient.invalidateQueries({
    queryKey: objectKeys.referenceCounts(objectId),
  });
}

/** Create a "tagged" edge from an object to a tag. */
export function useAddTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      { objectId, tagId }: { objectId: string; tagId: string },
    ) => {
      return await callResource("objects", {
        action: "create",
        object: {
          isRelationship: true,
          name: "tagged",
          relationship: {
            subject: new ObjectId(objectId),
            object: new ObjectId(tagId),
            symmetrical: false,
          },
        },
      });
    },
    onSuccess: (_data, { objectId }) => {
      invalidateForObject(queryClient, objectId);
    },
  });
}

/** Remove a tag from an object by deleting the "tagged" edge. */
export function useRemoveTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      { edgeId }: { edgeId: string; objectId: string },
    ) => {
      return await callResource("objects", {
        action: "delete",
        id: edgeId,
      });
    },
    onSuccess: (_data, { objectId }) => {
      invalidateForObject(queryClient, objectId);
    },
  });
}

/** Create a new tag object (isTag: true). Returns the created tag's id. */
export function useCreateTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      const result = await callResource("objects", {
        action: "create",
        object: { isTag: true, name: name.trim() },
      }) as { insertedId?: string | { toString(): string } };
      const insertedId = result?.insertedId;
      if (!insertedId) {
        throw new Error("Tag creation returned no id");
      }
      return insertedId.toString();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
}
