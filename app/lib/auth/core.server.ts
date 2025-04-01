import { jwtVerify } from "jose";
import { createCookie, redirect } from "@remix-run/node";
import { expandTypedObjects } from "./typed.ts";
import { permissionDenied } from "./utils.ts";
import process from "node:process";
import { Types } from "mongoose";
import { minimatch } from "minimatch";
import { ScopedDB } from "../mongo/scoped.server.ts";
import { getRootDB } from "../mongo/core.server.ts";

export const authCookie = createCookie("token", {
  path: "/",
  httpOnly: true,
});

type Rule = string & { __brand: "Rule" };

type BasePolicy = {
  resource: Rule;
  action: Rule;
};

type SimplePolicy = BasePolicy & {
  effect: "allow" | "deny";
};

type FilterPolicy = BasePolicy & {
  filter: any;
  effect: "filter";
};

export type Policy = SimplePolicy | FilterPolicy;

export interface APIKey {
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

const match = (policy: Policy, resource: string, action: string): boolean => {
  // TODO: Cache the compiled regex for performance
  // console.log(action, resource, JSON.stringify(policy), minimatch(resource, policy.resource))
  return minimatch(action, policy.action); // && minimatch(resource, policy.resource)
};

export class Auth {
  options: any;
  policies: Policy[];
  db: ScopedDB;

  constructor(options: any) {
    this.options = options;
    this.policies = options.policies || [];
    this.db = new ScopedDB(this, options.db);
  }

  hasAccess(resource: string, action: string): boolean {
    let isAllowed = false;

    for (const policy of this.policies) {
      if (!match(policy, resource, action)) continue;

      if (policy.effect === "deny" || policy.effect === "filter") {
        return false;
      }

      if (policy.effect === "allow") {
        isAllowed = true; // can be overridden by a deny policy later
      }
    }

    return isAllowed;
  }

  getFilters(resource: string, action: string): any[] {
    const filters: any[] = [];
    let hasAnyPolicy = false;

    for (const policy of this.policies) {
      if (!match(policy, resource, action)) continue;

      hasAnyPolicy = true;

      if (policy.effect === "deny") {
        permissionDenied();
      }

      if (policy.effect === "filter") {
        filters.push(policy.filter);
      }
    }

    if (!hasAnyPolicy) {
      permissionDenied();
    }

    return filters;
  }
}

export const verifyToken = async (token: string): Promise<null | Auth> => {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(process.env.SECRET_KEY),
    );
    if (typeof payload === "string") {
      permissionDenied();
    }
    return new Auth({ ...expandTypedObjects(payload), db: await getRootDB() });
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

  return await verifyToken(token) as Auth;
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
