import jsonwebtoken from "jsonwebtoken";
import { createCookie, redirect } from "@remix-run/node";
import { expandTypedObjects, Scope } from "./scopes.ts";
import { permissionDenied } from "./utils.ts";
import process from "node:process";

export const authCookie = createCookie("token", {
  path: "/",
  httpOnly: true,
});

export interface Auth {
  id: string;
  name: string;
  scopes: {
    [collectionName: string]: Scope;
  };
}

export const verifyToken = (token: string) => {
  try {
    const payload = jsonwebtoken.verify(
      token,
      process.env.SECRET_KEY as string,
    );
    if (typeof payload === "string") {
      permissionDenied();
    }
    return expandTypedObjects(payload.subject);
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

  return verifyToken(token) as Auth;
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
