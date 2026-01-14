import { jwtVerify } from "jose";
import { permissionDenied } from "./utils.ts";
import { ObjectId } from "mongodb";
import type { Request, Response } from "express";

import {
  defaultResourceManager,
  Policy,
  Resource,
  ResourcePath,
} from "./resources.ts";
import { EJSON } from "bson";
import { redis } from "@/lib/redis.ts";
import { env } from "#/env.ts";

export interface APIKey {
  hashedKey: string;
  salt: string;
  owner: string;
  name: string;
  openPrefix: string;
  createdAt: Date;
  isActive: boolean;
  policies: Policy[];
  _id?: ObjectId;
}

class AccessLogger {
  async log(
    auth: Auth,
    resource: Resource<any, any>,
    actions: {
      path: ResourcePath;
      actions: string[];
    }[],
  ) {
    try {
      const timestamp = new Date().toISOString();
      const fields: string[] = [
        "principal",
        auth.principal,
        "resource",
        resource.code,
        "actions",
        JSON.stringify(actions),
        "timestamp",
        timestamp,
      ];

      await redis.xadd("access_logs", "*", ...fields);
    } catch (error) {
      console.error("[AccessLogger] Failed to write access log to Redis stream:", error);
      throw error;
    }
  }
}

export const accessLogger = new AccessLogger();

export class Auth {
  policies: Policy[];
  principal: string;
  constructor(options: {
    policies?: Policy[];
    principal: string;
  }) {
    this.policies = options.policies || [];
    this.principal = options.principal;
  }

  getResource<Input, Output>(
    code: string,
  ): (input: Input) => Promise<Output | Response> {
    const token = Deno.env.get("MYCELIA_JWT");
    const myceliaUrl = env.MYCELIA_URL;

    // Prefer local resource if it's registered
    if (defaultResourceManager.listResources().some(r => r.code === code)) {
      return defaultResourceManager.getResource(code, this);
    }

    if (token && myceliaUrl) {
      console.log(`[Auth] Using remote resource call for ${code} via ${myceliaUrl}`);
      return async (input: Input): Promise<Output | Response> => {
        const url = `${myceliaUrl.replace(/\/$/, "")}/api/resource/${code}`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: EJSON.stringify(EJSON.serialize(input)),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Resource call failed: ${response.status} ${errorText}`);
        }

        const text = await response.text();
        return EJSON.deserialize(JSON.parse(text)) as Output;
      };
    }

    return defaultResourceManager.getResource(code, this);
  }
}

export const verifyToken = async (token: string): Promise<null | Auth> => {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(env.SECRET_KEY),
    );
    if (typeof payload === "string") {
      permissionDenied();
    }
    return new Auth(EJSON.deserialize(payload));
  } catch (error) {
    // JWT failed
  }

  return null;
};

export const authenticate = async (req: Request): Promise<Auth | null> => {
  const authHeader = req.headers.authorization;
  
  let token: string | undefined;
  
  if (authHeader) {
    token = authHeader.split(" ")[1];
  }
  
  if (!token) {
    if ("query" in req && req.query) {
      token = (req.query as any).token as string | undefined;
    }
  }
  
  if (!token && req.url) {
    try {
      const url = new URL(req.url);
      token = url.searchParams.get("token") || undefined;
    } catch {
      try {
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        token = url.searchParams.get("token") || undefined;
      } catch {
        token = undefined;
      }
    }
  }

  if (!token) {
    return null;
  }

  return verifyToken(token);
};

export const authenticateOr401 = async (
  req: Request,
  res: Response,
): Promise<Auth> => {
  const auth = await authenticate(req);

  if (!auth) {
    permissionDenied("Token is missing or invalid");
  }

  return auth;
};

export const getServerAuth = async (): Promise<Auth> => {
  const token = Deno.env.get("MYCELIA_JWT");
  if (token) {
    const auth = await verifyToken(token);
    if (auth) return auth;
    console.warn("MYCELIA_JWT found but invalid, falling back to system permissions");
  }

  return new Auth({
    principal: "server",
    policies: [{ resource: "**", action: "*", effect: "allow" }],
  });
};
