import { Buffer } from "node:buffer";
import mongoose, { Schema, Types } from "mongoose";
import { createHash, createSecretKey, randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { APIKey } from "./core.server.ts";
import { Policy } from "./resources.ts";

const OPEN_PREFIX_LENGTH = 16;

const apiKeySchema = new Schema<APIKey>({
  hashedKey: { type: String, required: true },
  salt: { type: String, required: true },
  owner: { type: String, required: true },
  name: { type: String, required: true },
  policies: { type: [Object], required: true },

  openPrefix: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
});

const APIKeyModel = mongoose.models.APIKey ||
  mongoose.model<APIKey>("APIKey", apiKeySchema, "api_keys");

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

  const newApiKey = new APIKeyModel({
    hashedKey,
    salt: salt.toString("base64"),
    owner,
    name,
    policies,
    openPrefix: apiKey.slice(0, OPEN_PREFIX_LENGTH),
    createdAt: new Date(),
    isActive: true,
  });

  await newApiKey.save();

  console.log(newApiKey._id);

  return apiKey;
}

export async function verifyApiKey(apiKey: string): Promise<APIKey | null> {
  const keyDoc = await APIKeyModel.findOne({
    openPrefix: apiKey.slice(0, OPEN_PREFIX_LENGTH),
    isActive: true,
  });

  if (!keyDoc) {
    return null;
  }

  const salt = Buffer.from(keyDoc.salt, "base64");
  const hashedInput = hashApiKey(apiKey, salt);

  if (hashedInput !== keyDoc.hashedKey) {
    return null;
  }

  return keyDoc;
}

export async function signJWT(owner: string, principal: string, policies: Policy[], duration: string) {
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

  return signJWT(keyDoc.owner, keyDoc._id!.toString(), keyDoc.policies, duration);
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
