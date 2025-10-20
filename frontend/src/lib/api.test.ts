import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiClient } from './api';
import { useSettingsStore } from '@/stores/settingsStore';
import * as auth from './auth';

global.fetch = vi.fn();

vi.mock('./auth', () => ({
  getCurrentJWT: vi.fn(),
}));

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new ApiClient();
    useSettingsStore.setState({
      apiEndpoint: 'http://localhost:8000',
      clientId: 'test-client',
      clientSecret: 'test-secret',
    });
  });

  describe('fetch', () => {
    it('makes successful GET request', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ data: 'test' }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);
      (auth.getCurrentJWT as any).mockResolvedValue('jwt-token');

      const response = await client.fetch('/test');

      expect(response.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer jwt-token',
          }),
        })
      );
    });

    it('throws error on failed request', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
      };
      (global.fetch as any).mockResolvedValue(mockResponse);
      (auth.getCurrentJWT as any).mockResolvedValue('jwt-token');

      await expect(client.fetch('/test')).rejects.toThrow('API request failed: 404 Not Found');
    });

    it('makes request without JWT when not available', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ data: 'test' }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);
      (auth.getCurrentJWT as any).mockResolvedValue(null);

      await client.fetch('/test');

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].headers).not.toHaveProperty('Authorization');
    });

    it('merges custom headers with default headers', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ data: 'test' }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);
      (auth.getCurrentJWT as any).mockResolvedValue('jwt-token');

      await client.fetch('/test', {
        headers: { 'X-Custom-Header': 'value' },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer jwt-token',
            'X-Custom-Header': 'value',
          }),
        })
      );
    });
  });

  describe('JWT caching', () => {
    it('caches JWT for subsequent requests', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ data: 'test' }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);
      (auth.getCurrentJWT as any).mockResolvedValue('jwt-token');

      await client.fetch('/test1');
      await client.fetch('/test2');

      expect(auth.getCurrentJWT).toHaveBeenCalledTimes(1);
    });

    it('refreshes JWT after cache expiry', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ data: 'test' }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);
      (auth.getCurrentJWT as any)
        .mockResolvedValueOnce('jwt-token-1')
        .mockResolvedValueOnce('jwt-token-2');

      await client.fetch('/test1');

      vi.useFakeTimers();
      vi.advanceTimersByTime(7 * 60 * 60 * 1000);

      await client.fetch('/test2');

      expect(auth.getCurrentJWT).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });

  describe('get', () => {
    it('performs GET request and returns JSON', async () => {
      const mockData = { id: 1, name: 'test' };
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue(mockData),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);
      (auth.getCurrentJWT as any).mockResolvedValue('jwt-token');

      const result = await client.get('/items/1');

      expect(result).toEqual(mockData);
    });
  });

  describe('post', () => {
    it('performs POST request with data', async () => {
      const postData = { name: 'new item' };
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ id: 1, ...postData }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);
      (auth.getCurrentJWT as any).mockResolvedValue('jwt-token');

      const result = await client.post('/items', postData);

      expect(result).toEqual({ id: 1, ...postData });
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/items',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(postData),
        })
      );
    });
  });

  describe('put', () => {
    it('performs PUT request with data', async () => {
      const updateData = { name: 'updated item' };
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ id: 1, ...updateData }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);
      (auth.getCurrentJWT as any).mockResolvedValue('jwt-token');

      const result = await client.put('/items/1', updateData);

      expect(result).toEqual({ id: 1, ...updateData });
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/items/1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(updateData),
        })
      );
    });
  });

  describe('delete', () => {
    it('performs DELETE request', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);
      (auth.getCurrentJWT as any).mockResolvedValue('jwt-token');

      const result = await client.delete('/items/1');

      expect(result).toEqual({ success: true });
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/items/1',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  describe('testConnection', () => {
    it('returns true on successful connection', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);
      (auth.getCurrentJWT as any).mockResolvedValue('jwt-token');

      const result = await client.testConnection();

      expect(result).toBe(true);
    });

    it('returns false on failed connection', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      };
      (global.fetch as any).mockResolvedValue(mockResponse);
      (auth.getCurrentJWT as any).mockResolvedValue('jwt-token');

      const result = await client.testConnection();

      expect(result).toBe(false);
    });

    it('returns false on network error', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));
      (auth.getCurrentJWT as any).mockResolvedValue('jwt-token');

      const result = await client.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('callResource', () => {
    it('calls resource with EJSON serialization', async () => {
      const requestBody = { action: 'find', collection: 'items' };
      const responseData = [{ id: 1, name: 'item1' }];
      const mockResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(responseData)),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);
      (auth.getCurrentJWT as any).mockResolvedValue('jwt-token');

      const result = await client.callResource('tech.mycelia.mongo', requestBody);

      expect(result).toEqual(responseData);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/resource/tech.mycelia.mongo',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('handles EJSON dates correctly', async () => {
      const testDate = new Date('2024-01-15T00:00:00.000Z');
      const requestBody = { date: testDate };
      const mockResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue('{"date":{"$date":"2024-01-15T00:00:00.000Z"}}'),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);
      (auth.getCurrentJWT as any).mockResolvedValue('jwt-token');

      const result = await client.callResource('tech.mycelia.test', requestBody);

      expect(result.date).toBeInstanceOf(Date);
      expect(result.date.toISOString()).toBe('2024-01-15T00:00:00.000Z');
    });
  });
});
