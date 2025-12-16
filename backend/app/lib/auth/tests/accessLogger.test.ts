import { expect } from "@std/expect";
import { accessLogger } from "../core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";

Deno.test("AccessLogger.log: should write to Redis stream", withFixtures([
  "TestAuth",
  "TestResource",
  "MockRedisXadd",
], async (auth, testResources, mockRedis) => {
  await accessLogger.log(auth, testResources.mongo, [
    { path: ["db", "objects"], actions: ["read", "write"] },
  ]);

  expect(mockRedis.mock).toHaveBeenCalled();
  const callArgs = mockRedis.mock.calls[0].args;
  expect(callArgs[0]).toBe("access_logs");
  expect(callArgs[1]).toBe("*");

  const fields = callArgs.slice(2);
  const fieldMap: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    fieldMap[fields[i]] = fields[i + 1];
  }

  expect(fieldMap.principal).toBe("test-user");
  expect(fieldMap.resource).toBe("mongo");
  expect(fieldMap.actions).toBeDefined();
  expect(fieldMap.timestamp).toBeDefined();

  const actions = JSON.parse(fieldMap.actions);
  expect(actions).toEqual([{ path: ["db", "objects"], actions: ["read", "write"] }]);
}));

Deno.test("AccessLogger.log: should throw error when Redis write fails", withFixtures([
  "TestAuth",
  "TestResource",
  "MockRedisXaddError",
], async (auth, testResources) => {
  await expect(
    accessLogger.log(auth, testResources.mongo, [{ path: ["db"], actions: ["read"] }]),
  ).rejects.toThrow();
}));

Deno.test("AccessLogger.log: should include timestamp in ISO format", withFixtures([
  "TestAuth",
  "TestResource",
  "MockRedisXadd",
], async (auth, testResources, mockRedis) => {
  const beforeTime = new Date().toISOString();
  await accessLogger.log(auth, testResources.redis, [{ path: ["key"], actions: ["get"] }]);
  const afterTime = new Date().toISOString();

  const callArgs = mockRedis.mock.calls[0].args;
  const fields = callArgs.slice(2);
  const fieldMap: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    fieldMap[fields[i]] = fields[i + 1];
  }

  const timestamp = fieldMap.timestamp;
  expect(timestamp).toBeDefined();
  expect(new Date(timestamp).getTime()).toBeGreaterThanOrEqual(
    new Date(beforeTime).getTime(),
  );
  expect(new Date(timestamp).getTime()).toBeLessThanOrEqual(
    new Date(afterTime).getTime(),
  );
}));

Deno.test("AccessLogger.log: should handle multiple action paths", withFixtures([
  "TestAuth",
  "TestResource",
  "MockRedisXadd",
], async (auth, testResources, mockRedis) => {
  await accessLogger.log(auth, testResources.mongoMultiple, [
    { path: ["db", "users"], actions: ["read"] },
    { path: ["db", "posts"], actions: ["write"] },
  ]);

  expect(mockRedis.mock).toHaveBeenCalled();
  expect(mockRedis.mock.calls).toBeDefined();
  expect(mockRedis.mock.calls.length).toBeGreaterThan(0);
  const callArgs = mockRedis.mock.calls[0].args;
  const fields = callArgs.slice(2);
  const fieldMap: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    fieldMap[fields[i]] = fields[i + 1];
  }

  const actions = JSON.parse(fieldMap.actions);
  expect(actions).toEqual([
    { path: ["db", "users"], actions: ["read"] },
    { path: ["db", "posts"], actions: ["write"] },
  ]);
}));

