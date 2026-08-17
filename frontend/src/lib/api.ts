import { EJSON } from "bson";
import { useSettingsStore } from "@/stores/settingsStore";
import { getCurrentJWT } from "./auth";

export interface CallResourceOptions {
  signal?: AbortSignal;
}

/**
 * EJSON serializes object properties whose value is `undefined` as `null`,
 * unlike JSON.stringify, which omits them. Resource schemas use optional
 * fields to distinguish an omitted value from an explicit null, so preserve
 * normal JSON request semantics while leaving BSON values (Date/ObjectId,
 * etc.) intact for EJSON.
 */
function omitUndefinedObjectProperties(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(omitUndefinedObjectProperties);
  }
  if (value === null || typeof value !== "object") return value;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nested]) =>
      nested === undefined ? [] : [[key, omitUndefinedObjectProperties(nested)]]
    ),
  );
}

export class ApiClient {
  private jwtCache: { token: string | null; expiry: number } | null = null;

  private getConfig() {
    const { apiEndpoint, clientId, clientSecret } = useSettingsStore.getState();
    return { apiEndpoint, clientId, clientSecret };
  }

  async getJWT(): Promise<string | null> {
    if (this.jwtCache && this.jwtCache.expiry > Date.now()) {
      return this.jwtCache.token;
    }

    const jwt = await getCurrentJWT();

    if (jwt) {
      this.jwtCache = {
        token: jwt,
        expiry: Date.now() + 6 * 60 * 60 * 1000,
      };
    }

    return jwt;
  }

  async getAuthHeaders(): Promise<HeadersInit> {
    const jwt = await this.getJWT();
    if (!jwt) {
      return {};
    }
    return {
      "Authorization": `Bearer ${jwt}`,
    };
  }

  get baseURL(): string {
    const { apiEndpoint } = this.getConfig();
    return apiEndpoint.replace(/\/$/, "");
  }

  /**
   * Authenticated fetch that returns the raw Response without throwing on
   * HTTP errors — callers that need the server's error payload use this.
   */
  async fetchRaw(path: string, options: RequestInit = {}): Promise<Response> {
    const { apiEndpoint } = this.getConfig();
    const url = `${apiEndpoint}${path}`;

    const headers = new Headers();

    for (const [key, value] of Object.entries(await this.getAuthHeaders())) {
      headers.set(key, value);
    }
    for (const [key, value] of Object.entries(options.headers || {})) {
      headers.set(key, value);
    }

    if (
      !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }

    return await fetch(url, {
      ...options,
      headers,
    });
  }

  async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const response = await this.fetchRaw(path, options);

    if (!response.ok) {
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}`,
      );
    }

    return response;
  }

  async get<T>(path: string): Promise<T> {
    const response = await this.fetch(path);
    return response.json();
  }

  async post<T>(path: string, data: unknown): Promise<T> {
    const response = await this.fetch(path, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return response.json();
  }

  async getBlob(path: string): Promise<Blob> {
    const response = await this.fetch(path, {
      method: "GET",
    });
    return response.blob();
  }

  async put<T>(path: string, data: unknown): Promise<T> {
    const response = await this.fetch(path, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return response.json();
  }

  async delete<T>(path: string): Promise<T> {
    const response = await this.fetch(path, {
      method: "DELETE",
    });
    return response.json();
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.fetch("resource", {});
      return true;
    } catch {
      return false;
    }
  }

  async callResource(
    resource: string,
    body: any,
    options: CallResourceOptions = {},
  ): Promise<any> {
    const response = await this.fetch(`/api/resource/${resource}`, {
      method: "POST",
      body: EJSON.stringify(omitUndefinedObjectProperties(body)),
      signal: options.signal,
    });
    return EJSON.parse(await response.text());
  }
}

export const apiClient = new ApiClient();

// Backwards compatibility alias
export const api = apiClient;

export const callResource = (
  resource: string,
  body: any,
  options?: CallResourceOptions,
) => {
  return apiClient.callResource(resource, body, options);
};
