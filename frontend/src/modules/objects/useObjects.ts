import { create } from "zustand";
import _ from "lodash";
import { useEffect } from "react";
import { Object } from "@/types/objects.ts";
import { callResource } from "@/lib/api";

type ObjectsState = {
  objects: Object[];
  loading: boolean;
  refresh: () => Promise<void>;
};

export const useObjectsStore = create<ObjectsState>((set) => ({
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
  const { objects, refresh, loading } = useObjectsStore();

  useEffect(() => {
    const run = _.debounce(async () => {
      if (loading || objects.length > 0) return;
      await refresh();
    }, 100);
    run();
    return () => run.cancel();
  }, [refresh, objects.length]);

  return { objects, refresh, loading };
}
