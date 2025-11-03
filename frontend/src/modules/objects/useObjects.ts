import { useEffect } from "react";
import { create } from "zustand";
import { Object } from "@/types/objects.ts";
import { callResource } from "@/lib/api";

type ObjectsState = {
  objects: Object[];
  loading: boolean;
  refresh: () => Promise<void>;
  fetchInitial: () => Promise<void>;
};

export const useObjectsStore = create<ObjectsState>((set, get) => ({
  objects: [],
  loading: false,
  refresh: async () => {
    try {
      set({ loading: true });
      const objects = await fetchObjects();
      set({ objects });
    } finally {
      set({loading: false});
    }
  },
  fetchInitial: async () => {
    const state = get();
    if (state.loading || state.objects.length > 0) return;
    set({ loading: true });
    try {
      const objects = await fetchObjects();
      set({ objects });
    } finally {
      set({loading: false});
    }
  }
}));

async function fetchObjects(): Promise<Object[]> {
  return callResource("tech.mycelia.mongo", {
        action: "aggregate",
        collection: "objects",
        pipeline: [
          {
            $addFields: {
              hasTimeRanges: { $cond: { if: { $isArray: "$timeRanges" }, then: true, else: false } }
            }
          },
          { $match: { hasTimeRanges: true } },
          // Lookup subject object for relationships
          {
            $lookup: {
              from: "objects",
              localField: "relationship.subject",
              foreignField: "_id",
              as: "subjectObject"
            }
          },
          // Lookup object object for relationships
          {
            $lookup: {
              from: "objects",
              localField: "relationship.object",
              foreignField: "_id",
              as: "objectObject"
            }
          },
          // Unwind the arrays to get single objects
          { $unwind: { path: "$subjectObject", preserveNullAndEmptyArrays: true } },
          { $unwind: { path: "$objectObject", preserveNullAndEmptyArrays: true } },
          {
            $addFields: {
              earliestStart: {
                $min: {
                  $map: {
                    input: "$timeRanges",
                    as: "r",
                    in: "$$r.start"
                  }
                }
              },
              latestEnd: {
                $max: {
                  $map: {
                    input: "$timeRanges",
                    as: "r",
                    in: { $ifNull: ["$$r.end", "$$r.start"] }
                  }
                }
              }
            }
          },
          {
            $addFields: {
              duration: { $subtract: ["$latestEnd", "$earliestStart"] }
            }
          },
          { $sort: { earliestStart: -1, duration: -1 } }
        ],
      });
};

export function useObjects() {
  const { objects, loading } = useObjectsStore();
  const refresh = useObjectsStore((state) => state.refresh);
  const fetchInitial = useObjectsStore((state) => state.fetchInitial);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  return { objects, refresh, loading };
}
