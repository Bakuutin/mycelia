import { ObjectId } from "bson";
import { Db } from "mongodb";

export async function recordHistory(
  db: Db,
  objectId: ObjectId,
  action: "create" | "update" | "delete",
  userId: string,
  version: number,
  field: string | null,
  oldValue: any,
  newValue: any,
): Promise<void> {
  try {
    await db.collection("object_history").insertOne({
      objectId,
      action,
      timestamp: new Date(),
      userId,
      version,
      field,
      oldValue,
      newValue,
    });
  } catch (error) {
    console.error("Failed to record object history:", error);
  }
}
