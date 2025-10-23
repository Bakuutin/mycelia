import { EJSON } from 'bson';
import { useSettingsStore } from '@/stores/settingsStore';
import { getCurrentJWT } from './auth';

export class ApiClient {
  private jwtCache: { token: string | null; expiry: number } | null = null;

  private getConfig() {
    const { apiEndpoint, clientId, clientSecret } = useSettingsStore.getState();
    return { apiEndpoint, clientId, clientSecret };
  }

  private async getJWT(): Promise<string | null> {
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

  private async getHeaders(): Promise<HeadersInit> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    const jwt = await this.getJWT();
    if (jwt) {
      headers['Authorization'] = `Bearer ${jwt}`;
    }

    return headers;
  }

  get baseURL(): string {
    const { apiEndpoint } = this.getConfig();
    return apiEndpoint.replace(/\/$/, '');
  }

  async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const { apiEndpoint } = this.getConfig();
    const url = `${apiEndpoint}${path}`;

    const headers = await this.getHeaders();

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  async get<T>(path: string): Promise<T> {
    const response = await this.fetch(path);
    return response.json();
  }

  async post<T>(path: string, data: unknown): Promise<T> {
    const response = await this.fetch(path, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.json();
  }

  async put<T>(path: string, data: unknown): Promise<T> {
    const response = await this.fetch(path, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return response.json();
  }

  async delete<T>(path: string): Promise<T> {
    const response = await this.fetch(path, {
      method: 'DELETE',
    });
    return response.json();
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.fetch('resource', {});
      return true;
    } catch {
      return false;
    }
  }

  async callResource(resource: string, body: any): Promise<any> {
    const response = await this.fetch(`/api/resource/${resource}`, {
      method: 'POST',
      body: EJSON.stringify(body),
    });
    return EJSON.parse(await response.text());
  }
}

export const apiClient = new ApiClient();

export const callResource = (resource: string, body: any) => {
  return apiClient.callResource(resource, body);
};
