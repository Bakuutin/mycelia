import { Buffer } from "node:buffer";
import { createHash, createSecretKey, randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { APIKey, Auth, getServerAuth } from "./core.server.ts";
import { Policy } from "./resources.ts";
import { z } from "zod";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { ObjectId } from "mongodb";

const OPEN_PREFIX_LENGTH = 16;

const apiKeySchema = z.object({
  _id: z.instanceof(ObjectId).optional(),
  hashedKey: z.string(),
  salt: z.string(),
  owner: z.string(),
  name: z.string(),
  policies: z.array(z.any()),
  openPrefix: z.string(),
  createdAt: z.date(),
  isActive: z.boolean(),
});

type APIKeyDocument = z.infer<typeof apiKeySchema>;

function hashApiKey(apiKey: string, salt: Buffer): string {
  return createHash("sha256").update(salt).update(apiKey).digest("base64");
}

export async function generateApiKey(
  owner: string,
  name: string,
  policies: Policy[],
): Promise<string> {
  const apiKey = `mycelia_${randomBytes(32).toString("base64url")}`;
  const salt = randomBytes(32);
  const hashedKey = hashApiKey(apiKey, salt);

  const auth = await getServerAuth();
  const mongo = await getMongoResource(auth);

  const newApiKey: Omit<APIKeyDocument, "_id"> = {
    hashedKey,
    salt: salt.toString("base64"),
    owner,
    name,
    policies,
    openPrefix: apiKey.slice(0, OPEN_PREFIX_LENGTH),
    createdAt: new Date(),
    isActive: true,
  };

  const result = await mongo({
    action: "insertOne",
    collection: "api_keys",
    doc: newApiKey,
  });
  const clientId = result.insertedId.toString();
  console.log("MYCELIA_CLIENT_ID: ", clientId);

  return apiKey;
}

export async function verifyApiKey(apiKey: string): Promise<APIKey | null> {
  const auth = await getServerAuth();
  const mongo = await getMongoResource(auth);

  const keyDoc = await mongo({
    action: "findOne",
    collection: "api_keys",
    query: {
      openPrefix: apiKey.slice(0, OPEN_PREFIX_LENGTH),
      isActive: true,
    },
  });

  if (!keyDoc) {
    return null;
  }

  const salt = Buffer.from(keyDoc.salt, "base64");
  const hashedInput = hashApiKey(apiKey, salt);

  if (hashedInput !== keyDoc.hashedKey) {
    return null;
  }

  return keyDoc as APIKey;
}

export async function signJWT(
  owner: string,
  principal: string,
  policies: Policy[],
  duration: string,
) {
  return new SignJWT({
    owner: principal,
    principal,
    policies: JSON.parse(JSON.stringify(policies)),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(duration)
    .sign(createSecretKey(
      Buffer.from(Deno.env.get("SECRET_KEY") as string, "utf-8"),
    ));
}

export async function decodeAccessToken(
  apiKey: string,
  duration: string = "1 day",
): Promise<string | null> {
  const keyDoc = await verifyApiKey(apiKey);

  if (!keyDoc) {
    return null;
  }

  return signJWT(
    keyDoc.owner,
    keyDoc._id!.toString(),
    keyDoc.policies,
    duration,
  );
}

export async function exchangeApiKeyForAccessToken(
  token: string,
  duration: string = "1 day",
): Promise<{ jwt: string | null; error: string | null }> {
  if (typeof token !== "string" || token.length === 0) {
    return { jwt: null, error: "Token is required" };
  }

  const jwt = await decodeAccessToken(token, duration);
  if (!jwt) {
    return { jwt: null, error: "Invalid token" };
  }

  return { jwt, error: null };
}

export async function listApiKeys(auth: Auth): Promise<APIKeyDocument[]> {
  const mongo = await getMongoResource(auth);

  const docs = await mongo({
    action: "find",
    collection: "api_keys",
    query: {},
    options: { sort: { createdAt: -1 } },
  });
  return docs as APIKeyDocument[];
}

export async function revokeApiKey(
  owner: string,
  id: string,
): Promise<boolean> {
  const auth = await getServerAuth();
  const mongo = await getMongoResource(auth);

  const result = await mongo({
    action: "updateOne",
    collection: "api_keys",
    query: { _id: new ObjectId(id), owner },
    update: { $set: { isActive: false } },
  });

  return Boolean(result && (result.modifiedCount || result.matchedCount));
}
