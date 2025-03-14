import jsonwebtoken from "jsonwebtoken";
import { createCookie, redirect } from "@remix-run/node";

export const authCookie = createCookie("token", {
    path: "/",
    httpOnly: true,
});

export type ScopeAction = "read" | "write" | "modify" | "delete";

export type Scope = {
    filter: Record<string, any>;
    actions: ScopeAction[];
};

export type TypeConverter<T> = (value: any) => T;

export interface TypedObject {
    type: string;
    [key: string]: any;
}

export interface ConverterRegistry {
    [type: string]: TypeConverter<any>;
}

const converters: ConverterRegistry = {
    "isodate": (value: any) => new Date(value),
}

function processWithConverters(data: any): any {
    if (data === null || data === undefined || typeof data !== 'object') {
        return data;
    }

    if (Array.isArray(data)) {
        return data.map(item => processWithConverters(item));
    }

    if (isTypedObject(data) && converters[data.type]) {
        return converters[data.type](data[data.type]);
    }

    const result: Record<string, any> = {};

    for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            result[key] = processWithConverters(data[key]);
        }
    }

    return result;
}

function isTypedObject(obj: any): obj is TypedObject {
    return (
        obj !== null &&
        typeof obj === 'object' &&
        typeof obj.type === 'string' &&
        obj.type in obj &&
        obj[obj.type] !== undefined
    );
}



export interface Auth {
    id: string;
    name: string;
    scopes: {
        [collectionName: string]: Scope;
    };
}

/**
 * Throws a 403 Forbidden response with a message indicating permission denied.
 * This function is used to indicate that the user does not have permission to access a resource.
 * 
 * @throws {Response} 403 Forbidden
 */
export function permissionDenied(): never {
    throw new Response("Permission denied", { status: 403 });
}

export const verifyToken = (token: string) => {
    try {
        const payload = jsonwebtoken.verify(token, process.env.SECRET_KEY as string);
        if (typeof payload === "string") {
            permissionDenied();
        }
        return processWithConverters(payload.subject);
    } catch (error) {
        return null;
    }
}

export const authenticate = async (request: Request): Promise<Auth | null> => {
    const cookie = await authCookie.parse(request.headers.get("Cookie"));


    const token = (cookie || request.headers.get("Authorization")?.split(" ")[1]) as string;

    if (!token) {
        return null;
    }

    return verifyToken(token) as Auth;
}

export const authenticateOrRedirect = async (request: Request): Promise<Auth> => {
    const auth = await authenticate(request);

    if (!auth) {
        throw redirect("/login");
    }

    return auth;
}


export const authenticateOr401 = async (request: Request): Promise<Auth> => {
    const auth = await authenticate(request);

    if (!auth) {
        throw new Response("Token is missing or invalid", { status: 401 });
    }

    return auth;
}
