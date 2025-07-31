import { jwtVerify } from "jose";
import { createCookie, redirect } from "@remix-run/node";
import { expandTypedObjects } from "./typed.ts";
import { permissionDenied } from "./utils.ts";
import { ObjectId } from "mongodb";

import {
  defaultResourceManager,
  Policy,
  ResourcePath,
} from "./resources.ts";

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
    resource: ResourcePath,
    action: string,
    policies: Policy[],
    result: "allowed" | "denied" | "filtered",
  ) {
    console.log("access", auth.principal, resource, action, policies, result);
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
  ): Promise<(input: Input) => Promise<Output>> {
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
    return new Auth(expandTypedObjects(payload));
  } catch (error) {
    return null;
  }
};

export const authenticate = async (request: Request): Promise<Auth | null> => {
  const cookie = await authCookie.parse(request.headers.get("Cookie"));

  const token =
    (cookie || request.headers.get("Authorization")?.split(" ")[1]) as string;

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
