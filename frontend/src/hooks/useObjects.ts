import { useQuery } from "@tanstack/react-query";
import { callResource } from "@/lib/api";
import type { APObject } from "@/types/activitypub";

export function useObjects() {
  return useQuery({
    queryKey: ['objects'],
    queryFn: async () => {
      const result = await callResource("tech.mycelia.mongo", {
        action: "find",
        collection: "objects",
        query: {},
        options: { 
          sort: { "_internal.created": -1 },
          limit: 1000, // Increased limit for relationship dropdowns
        },
      });
      
      return (result || []) as APObject[];
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
    retry: 2,
  });
}
