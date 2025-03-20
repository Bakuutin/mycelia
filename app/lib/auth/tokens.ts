import { Buffer } from "node:buffer";
import process from "node:process";
import mongoose, { Schema, Types } from "mongoose";
import { getRootDB } from "@/lib/mongo/core.ts";
import { createSecretKey, createHash, randomUUID, randomBytes } from "node:crypto";
import { SignJWT } from "jose";

const OPEN_PREFIX_LENGTH = 16;

export interface Policy {
  resource: string;
  effect: "allow" | "deny";
  actions: string[];
}

interface APIKey {
  hashedKey: string;
  salt: string;
  owner: string;
  name: string;
  openPrefix: string;
  createdAt: Date;
  isActive: boolean;
  policies: Policy[];
  _id?: Types.ObjectId;
}

const policySchema = new Schema<Policy>({
  resource: { type: String, required: true },
  effect: { type: String, required: true, enum: ["allow", "deny"] },
  actions: { type: [String], required: true },
});

const apiKeySchema = new Schema<APIKey>({
  hashedKey: { type: String, required: true },
  salt: { type: String, required: true },
  owner: { type: String, required: true },
  name: { type: String, required: true },
  policies: { type: [policySchema], required: true },
  
  openPrefix: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
});

const APIKeyModel = mongoose.models.APIKey || mongoose.model<APIKey>("APIKey", apiKeySchema, "api_keys");
  
const key = createSecretKey(
  Buffer.from(process.env.SECRET_KEY as string, "utf-8"),
);

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
  const db = await getRootDB();
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

export async function exchangeApiKeyForAccessToken(
  apiKey: string,
  duration: string = "1 day",
): Promise<string | null> {
  const keyDoc = await verifyApiKey(apiKey);

  if (!keyDoc) {
    return null;
  }

  const jwt = await new SignJWT({
    owner: keyDoc.owner,
    keyId: keyDoc._id!.toString(),
    policies: JSON.stringify(keyDoc.policies),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(duration)
    .sign(key);

  return jwt;
}
