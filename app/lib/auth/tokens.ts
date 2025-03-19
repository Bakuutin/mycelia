import jsonwebtoken from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { createHash, randomBytes } from "crypto";
import { Buffer } from "node:buffer";
import process from "node:process";

const OPEN_PREFIX_LENGTH = 16;

interface APIKey {
  hashedKey: string;
  salt: string;
  owner: string;
  name: string;
  scopes: string[];
  openPrefix: string;
  createdAt: Date;
  isActive: boolean;
}

const apiKeys: APIKey[] = []; // This should be replaced with your database logic

function hashApiKey(apiKey: string, salt: Buffer): string {
  return createHash("sha256").update(salt).update(apiKey).digest("base64");
}

export function generateApiKey(
  owner: string,
  name: string,
  scopes: string[],
): string {
  const apiKey = `mycelia_${randomBytes(32).toString("base64url")}`;
  const salt = randomBytes(32);
  const hashedKey = hashApiKey(apiKey, salt);

  apiKeys.push({
    hashedKey,
    salt: salt.toString("base64"),
    owner,
    name,
    scopes,
    openPrefix: apiKey.slice(0, OPEN_PREFIX_LENGTH),
    createdAt: new Date(),
    isActive: true,
  });

  return apiKey;
}

export function verifyApiKey(apiKey: string): APIKey | null {
  const keyDoc = apiKeys.find(
    (key) =>
      key.openPrefix === apiKey.slice(0, OPEN_PREFIX_LENGTH) && key.isActive,
  );

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

export function exchangeApiKeyForAccessToken(
  apiKey: string,
  duration: string = "1d",
): string | null {
  const keyDoc = verifyApiKey(apiKey);

  if (!keyDoc) {
    return null;
  }

  const token = jsonwebtoken.sign(
    {
      owner: keyDoc.owner,
      keyId: uuidv4(),
      scopes: keyDoc.scopes,
    },
    process.env.SECRET_KEY as string,
    { expiresIn: duration },
  );

  return token;
}
