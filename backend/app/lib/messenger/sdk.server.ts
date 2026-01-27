import { ObjectId } from "bson";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import type { Auth } from "@/lib/auth/core.server.ts";

export interface GetOrCreatePersonOptions {
  platform: string;
  externalId: string | number;
  name?: string;
  auth: Auth;
}

export interface GetOrCreatePersonResult {
  _id: ObjectId;
  created: boolean;
}

export async function getOrCreatePersonByMessengerId(
  options: GetOrCreatePersonOptions,
): Promise<GetOrCreatePersonResult> {
  const { platform, externalId, name, auth } = options;
  const mongo = await getMongoResource(auth);

  const messengerIdKey = `messenger.${platform}.id`;
  const messengerIdValue = String(externalId);

  const existing = await mongo({
    action: "findOne",
    collection: "objects",
    query: {
      [messengerIdKey]: messengerIdValue,
    },
  });

  if (existing) {
    return { _id: existing._id, created: false };
  }

  const personName = name || `Unknown ${platform} user`;
  const icon = { text: "👤" };

  const newPerson = await mongo({
    action: "insertOne",
    collection: "objects",
    doc: {
      name: personName,
      isPerson: true,
      icon,
      messenger: {
        [platform]: {
          id: messengerIdValue,
        },
      },
      createdAt: new Date(),
      version: 1,
    },
  });

  return { _id: newPerson.insertedId, created: true };
}

