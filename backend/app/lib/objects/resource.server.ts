import { z } from "zod";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth, getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource, getRootDB } from "@/lib/mongo/core.server.ts";
import { 
  objectsRequestSchema, 
  ObjectsRequest, 
  ObjectsResponse 
} from "./schemas.ts";
import {
  handleCreate,
  handleGet,
  handleUpdate,
  handleDelete,
  handleList,
  handleGetRelationships,
  handleGetHistory,
  handleExploreTimeRange,
  handleGetTimeRange,
  handleGetCounts,
} from "./actions.server.ts";

export type { ObjectsRequest, ObjectsResponse } from "./schemas.ts";

export class ObjectsResource
  implements Resource<ObjectsRequest, ObjectsResponse> {
  code = "objects";
  description =
    "Manage timeline objects (people, events, places, relationships, promises). Objects form a graph where relationships connect entities with temporal data. Supports optimistic locking for concurrent updates. Use 'list' to find objects, 'get' for details, 'getRelationships' to explore connections, 'exploreTimeRange' to find objects active during a time period, 'create' for new entities, 'update' for field changes, and 'getHistory' for version tracking.";
  schemas = {
    request: objectsRequestSchema as z.ZodType<ObjectsRequest>,
    response: z.any(),
  };

  async use(input: ObjectsRequest): Promise<ObjectsResponse> {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    const db = await getRootDB();

    switch (input.action) {
      case "create":
        return handleCreate(input, mongo, db, auth.principal);

      case "get":
        return handleGet(input, mongo);

      case "update":
        return handleUpdate(input, mongo, db, auth.principal);

      case "delete":
        return handleDelete(input, mongo, db, auth.principal);

      case "list":
        return handleList(input, mongo);

      case "getRelationships":
        return handleGetRelationships(input, mongo);

      case "getHistory":
        return handleGetHistory(input, mongo);

      case "exploreTimeRange":
        return handleExploreTimeRange(input, mongo);

      case "getTimeRange":
        return handleGetTimeRange(mongo);

      case "getCounts":
        return handleGetCounts(input, db);

      default:
        throw new Error("Unknown action");
    }
  }

  extractActions(input: ObjectsRequest) {
    const actionMap: Record<string, string[]> = {
      create: ["create"],
      get: ["read"],
      list: ["read"],
      update: ["update"],
      delete: ["delete"],
      getRelationships: ["read"],
      getHistory: ["read"],
      exploreTimeRange: ["read"],
      getTimeRange: ["read"],
      getCounts: ["read"],
    };

    return [
      {
        path: ["objects"],
        actions: actionMap[input.action] || ["read"],
      },
    ];
  }
}

export function getObjectsResource(
  auth: Auth,
): (input: ObjectsRequest) => Promise<ObjectsResponse> {
  return auth.getResource<ObjectsRequest, ObjectsResponse>(
    "objects",
  );
}
