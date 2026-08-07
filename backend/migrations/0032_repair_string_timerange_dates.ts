import { Db } from "mongodb";

/**
 * objects_update used to store timeRanges date values exactly as sent —
 * ISO strings from JSON callers (e.g. the chat assistant) — while every
 * consumer expects Date. Convert any string start/end back to Date.
 */
export const up = async (db: Db) => {
  console.log("Repairing string timeRanges dates in objects...");

  const objects = db.collection("objects");
  const cursor = objects.find({
    timeRanges: {
      $elemMatch: {
        $or: [
          { start: { $type: "string" } },
          { end: { $type: "string" } },
        ],
      },
    },
  });

  let repaired = 0;
  for await (const doc of cursor) {
    const timeRanges = (doc.timeRanges as any[]).map((range) => {
      const out = { ...range };
      for (const key of ["start", "end"]) {
        if (typeof out[key] === "string" && !Number.isNaN(Date.parse(out[key]))) {
          out[key] = new Date(out[key]);
        }
      }
      return out;
    });
    await objects.updateOne({ _id: doc._id }, { $set: { timeRanges } });
    repaired++;
  }

  console.log(`Repaired ${repaired} object(s) with string timeRanges dates`);
};

export const down = async (_db: Db) => {
  console.log("Nothing to revert: dates stay dates");
};
