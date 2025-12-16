import type { Request, Response as ExpressResponse } from "express";

export function createMockExpressRequest(
  url: string,
  options?: {
    method?: string;
    headers?: HeadersInit;
    body?: any;
    params?: Record<string, string>;
    query?: Record<string, string>;
  },
): Request {
  const urlObj = new URL(url);
  const method = options?.method || "GET";
  const headers = new Headers(options?.headers);
  
  if (!headers.has("host")) {
    headers.set("host", urlObj.host);
  }
  
  let body = options?.body;
  
  if (typeof body === "string") {
    const contentType = headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(body);
      body = Object.fromEntries(params.entries());
    } else if (contentType.includes("application/json")) {
      try {
        body = JSON.parse(body);
      } catch {
        // Ignore parse errors
      }
    }
  }
  
  const req = {
    method,
    url: urlObj.pathname + urlObj.search,
    path: urlObj.pathname,
    protocol: urlObj.protocol.replace(":", ""),
    get: (name: string) => headers.get(name.toLowerCase()) || undefined,
    headers: Object.fromEntries(headers.entries()),
    body: body,
    params: options?.params || {},
    query: options?.query || Object.fromEntries(urlObj.searchParams.entries()),
  } as unknown as Request;

  return req;
}

export function createMockExpressResponse(): {
  res: ExpressResponse;
  getStatus: () => number;
  getBody: () => any;
  getHeaders: () => Record<string, string>;
} {
  let statusCode = 200;
  let responseBody: any = undefined;
  const responseHeaders: Record<string, string> = {};

  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (body: any) => {
      responseBody = body;
      responseHeaders["content-type"] = "application/json";
      return res;
    },
    send: (body?: any) => {
      if (body !== undefined) {
        responseBody = body;
        if (typeof body === "string") {
          responseHeaders["content-type"] = "text/plain; charset=UTF-8";
        }
      }
      return res;
    },
    setHeader: (name: string, value: string) => {
      responseHeaders[name.toLowerCase()] = value;
      return res;
    },
    getHeader: (name: string) => responseHeaders[name.toLowerCase()],
    headersSent: false,
  } as unknown as ExpressResponse;

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => responseBody,
    getHeaders: () => responseHeaders,
  };
}

export async function callExpressHandler(
  handler: (req: Request, res: ExpressResponse) => Promise<void> | void,
  url: string,
  options?: {
    method?: string;
    headers?: HeadersInit;
    body?: any;
    params?: Record<string, string>;
    query?: Record<string, string>;
  },
): Promise<globalThis.Response> {
  const req = createMockExpressRequest(url, options);
  const { res, getStatus, getBody, getHeaders } = createMockExpressResponse();

  try {
    await handler(req, res);
  } catch (error) {
    if (error instanceof globalThis.Response) {
      const status = error.status;
      if (status === 403) {
        return new Response(await error.text(), {
          status: 401,
          headers: error.headers,
        });
      }
      return error;
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const status = getStatus();
    if (status === 200 || status === 0) {
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const status = getStatus();
  const body = getBody();
  const headers = getHeaders();

  if (body === undefined) {
    return new Response(undefined, { status, headers: new Headers(headers) });
  }

  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(bodyStr, {
    status,
    headers: new Headers(headers),
  });
}

