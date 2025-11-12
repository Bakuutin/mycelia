import { jwtVerify } from "jose";
import { createCookie, redirect } from "@remix-run/node";
import { permissionDenied } from "./utils.ts";
import { ObjectId } from "mongodb";

import {
  defaultResourceManager,
  Policy,
  Resource,
  ResourcePath,
} from "./resources.ts";
import { EJSON } from "bson";

export const authCookie = createCookie("token", {
  path: "/",
  httpOnly: true,
});

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
    console.log({
      principal: auth.principal,
      resource: resource.code,
      actions,
    });
    // TODO: access log
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
  ): Promise<(input: Input) => Promise<Output | Response>> {
    return defaultResourceManager.getResource(code, this);
  }
}

export const verifyToken = async (token: string): Promise<null | Auth> => {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(Deno.env.get("SECRET_KEY")),
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

export const authenticate = async (request: Request): Promise<Auth | null> => {
  const token = request.headers.get("Authorization")?.split(" ")[1] as string;

  if (!token) {
    return null;
  }

  return verifyToken(token);
};

export const authenticateOrRedirect = async (
  request: Request,
): Promise<Auth> => {
  const auth = await authenticate(request);

  if (!auth) {
    throw redirect("/login");
  }

  return auth;
};

export const authenticateOr401 = async (request: Request): Promise<Auth> => {
  const auth = await authenticate(request);

  if (!auth) {
    throw new Response("Token is missing or invalid", { status: 401 });
  }

  return auth;
};

export const getServerAuth = async (): Promise<Auth> => {
  return new Auth({
    principal: "server",
    policies: [{ resource: "**", action: "*", effect: "allow" }],
  });
};
