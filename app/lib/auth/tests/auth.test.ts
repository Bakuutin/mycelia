import { expect, fn } from "@std/expect";
import { z } from "zod";
import { Auth } from "../core.server.ts";
import { accessLogger } from "../core.server.ts";
import { Policy, Resource, ResourceManager, defaultResourceManager } from "../resources.ts";

function setupAuth(policies?: any[]) {
  const auth = new Auth({
    principal: "test-user",
    policies: policies ?? [],
  });
  accessLogger.log = fn(() => {}) as any;
  return { auth };
}

Deno.test("constructor: should create auth with default policies", () => {
  const auth = new Auth({ principal: "test-user" });
  expect(auth.principal).toBe("test-user");
  expect(auth.policies).toEqual([]);
});

Deno.test("constructor: should create auth with custom policies", () => {
  const policies: Policy[] = [
    { resource: "test", action: "read", effect: "allow" },
  ];
  const auth = new Auth({ principal: "test-user", policies });
  expect(auth.principal).toBe("test-user");
  expect(auth.policies).toEqual(policies);
});

Deno.test("getResource: should get a resource function when resource is registered", async () => {
  const { auth } = setupAuth();
  const testResource: Resource<any, any> = {
    code: "test",
    schemas: {
      request: z.object({ id: z.number() }),
      response: z.object({ id: z.string() }),
    },
    modifiers: {},
    use: async (input: { id: number }) => ({ id: input.id }),
    extractActions: (
      input: { id: number },
    ) => [{ path: "test", actions: ["read"] }],
  };
  defaultResourceManager.registerResource(testResource);
  const resourceFn = await auth.getResource("test");
  expect(typeof resourceFn).toBe("function");
});

Deno.test("getResource: should throw when resource is not registered", async () => {
  const { auth } = setupAuth();
  await expect(auth.getResource("nonexistent")).rejects.toHaveProperty(
    "status",
    403,
  );
});

Deno.test("getResource: should allow access when policy matches", async () => {
  const { auth } = setupAuth();
  const testResource: Resource<any, any> = {
    code: "users",
    schemas: {
      request: z.object({ id: z.number() }),
      response: z.object({ id: z.string() }),
    },
    modifiers: {},
    use: async (input: { id: number }) => ({ id: input.id }),
    extractActions: (
      input: { id: number },
    ) => [{ path: "users", actions: ["read"] }],
  };
  defaultResourceManager.registerResource(testResource);
  const authWithPolicy = new Auth({
    principal: "test-user",
    policies: [{ resource: "users", action: "read", effect: "allow" }],
  });
  const resourceFn = await authWithPolicy.getResource("users");
  const result = await resourceFn({ id: 123 });
  expect(result).toEqual({ id: 123 });
});

Deno.test("getResource: should deny access when policy effect is deny", async () => {
  const testResource: Resource<any, any> = {
    code: "users",
    schemas: {
      request: z.object({ id: z.number() }),
      response: z.object({ id: z.string() }),
    },
    modifiers: {},
    use: async (input: { id: number }) => ({ id: input.id }),
    extractActions: (
      input: { id: number },
    ) => [{ path: "users", actions: ["read"] }],
  };
  defaultResourceManager.registerResource(testResource);
  const auth = new Auth({
    principal: "test-user",
    policies: [{ resource: "users", action: "read", effect: "deny" }],
  });
  const resourceFn = await auth.getResource("users");
  await expect(resourceFn({ id: 123 })).rejects.toHaveProperty("status", 403);
});

Deno.test("getResource: should deny access when no matching policy", async () => {
  const testResource: Resource<any, any> = {
    code: "users",
    schemas: {
      request: z.object({ id: z.number() }),
      response: z.object({ id: z.string() }),
    },
    modifiers: {},
    use: async (input: { id: number }) => ({ id: input.id }),
    extractActions: (
      input: { id: number },
    ) => [{ path: "users", actions: ["read"] }],
  };
  defaultResourceManager.registerResource(testResource);
  const auth = new Auth({
    principal: "test-user",
    policies: [{ resource: "other", action: "read", effect: "allow" }],
  });
  const resourceFn = await auth.getResource("users");
  await expect(resourceFn({ id: 123 })).rejects.toHaveProperty("status", 403);
});

Deno.test("getResource: should apply middleware when modify policy is present", async () => {
  const resourceManager = new ResourceManager();
  const testResource: Resource<any, any> = {
    code: "users",
    schemas: {
      request: z.object({ id: z.number() }),
      response: z.object({ id: z.string(), modified: z.boolean() }),
    },
    modifiers: {
      addFlag: {
        schema: z.object({ flag: z.string() }),
        use: async ({ arg, input, auth }, next) => {
          const result = await next(input, auth);
          return { ...result, modified: true, flag: arg.flag };
        },
      },
    },
    use: async (input: { id: number }) => ({
      id: input.id,
      modified: false,
    }),
    extractActions: (
      input: { id: number },
    ) => [{ path: "users", actions: ["read"] }],
  };
  resourceManager.registerResource(testResource);
  const auth = new Auth({
    principal: "test-user",
    policies: [{
      resource: "users",
      action: "read",
      effect: "modify",
      middleware: { code: "addFlag", arg: { flag: "test-flag" } },
    }],
  });
  const resourceFn = await resourceManager.getResource("users", auth);
  const result = await resourceFn({ id: 123 });
  expect(result).toEqual({ id: 123, modified: true, flag: "test-flag" });
});

Deno.test("getResource: should deny access when modify policy present but modifier missing", async () => {
  const testResource: Resource<any, any> = {
    code: "users",
    schemas: {
      request: z.object({ id: z.number() }),
      response: z.object({ id: z.string() }),
    },
    modifiers: {},
    use: async (input: { id: number }) => ({ id: input.id }),
    extractActions: (
      input: { id: number },
    ) => [{ path: "users", actions: ["read"] }],
  };
  defaultResourceManager.registerResource(testResource);
  const auth = new Auth({
    principal: "test-user",
    policies: [{
      resource: "users",
      action: "read",
      effect: "modify",
      middleware: { code: "missing", arg: {} },
    }],
  });
  const resourceFn = await auth.getResource("users");
  await expect(resourceFn({ id: 123 })).rejects.toHaveProperty("status", 403);
});

Deno.test("getResource: should deny access when modify policy present but schema fails", async () => {
  const testResource: Resource<any, any> = {
    code: "users",
    schemas: {
      request: z.object({ id: z.number() }),
      response: z.object({ id: z.string() }),
    },
    modifiers: {
      addFlag: {
        schema: z.object({ flag: z.string() }),
        use: async ({ arg, input, auth }, next) => {
          const result = await next(input, auth);
          return { ...result, flag: arg.flag };
        },
      },
    },
    use: async (input: { id: number }) => ({ id: input.id }),
    extractActions: (
      input: { id: number },
    ) => [{ path: "users", actions: ["read"] }],
  };
  defaultResourceManager.registerResource(testResource);
  const auth = new Auth({
    principal: "test-user",
    policies: [{
      resource: "users",
      action: "read",
      effect: "modify",
      middleware: { code: "addFlag", arg: { invalid: "data" } },
    }],
  });
  const resourceFn = await auth.getResource("users");
  await expect(resourceFn({ id: 123 })).rejects.toHaveProperty("status", 403);
});

Deno.test("getResource: should handle multiple actions from extractActions", async () => {
  const testResource: Resource<any, any> = {
    code: "users",
    schemas: {
      request: z.object({ id: z.number() }),
      response: z.object({ id: z.string() }),
    },
    modifiers: {},
    use: async (input: { id: number }) => ({ id: input.id }),
    extractActions: (
      input: { id: number },
    ) => [
      { path: "users", actions: ["read", "write"] },
    ],
  };
  defaultResourceManager.registerResource(testResource);
  const auth = new Auth({
    principal: "test-user",
    policies: [
      { resource: "users", action: "read", effect: "allow" },
      { resource: "users", action: "write", effect: "allow" },
    ],
  });
  const resourceFn = await auth.getResource("users");
  const result = await resourceFn({ id: 123 });
  expect(result).toEqual({ id: 123 });
});

Deno.test("getResource: should handle multiple action groups from extractActions", async () => {
  const testResource: Resource<any, any> = {
    code: "users",
    schemas: {
      request: z.object({ id: z.number() }),
      response: z.object({ id: z.string() }),
    },
    modifiers: {},
    use: async (input: { id: number }) => ({ id: input.id }),
    extractActions: (
      input: { id: number },
    ) => [
      { path: "users", actions: ["read"] },
      { path: "users/profile", actions: ["read"] },
    ],
  };
  defaultResourceManager.registerResource(testResource);
  const auth = new Auth({
    principal: "test-user",
    policies: [
      { resource: "users", action: "read", effect: "allow" },
      { resource: "users/profile", action: "read", effect: "allow" },
    ],
  });
  const resourceFn = await auth.getResource("users");
  const result = await resourceFn({ id: 123 });
  expect(result).toEqual({ id: 123 });
});

Deno.test("getResource: should deny access when some actions are not covered by policies", async () => {
  const resourceManager = new ResourceManager();
  const testResource: Resource<any, any> = {
    code: "users",
    schemas: {
      request: z.object({ id: z.number() }),
      response: z.object({ id: z.string() }),
    },
    modifiers: {},
    use: async (input: { id: number }) => ({ id: input.id }),
    extractActions: (input: { id: number }) => [
      { path: "users", actions: ["read", "write"] },
    ],
  };
  resourceManager.registerResource(testResource);
  const auth = new Auth({
    principal: "test-user",
    policies: [
      { resource: "users", action: "read", effect: "allow" },
      // Missing write policy
    ],
  });
  const resourceFn = await resourceManager.getResource("users", auth);
  await expect(resourceFn({ id: 123 })).rejects.toHaveProperty("status", 403);
});

Deno.test("getResource: should apply multiple modifiers in correct order", async () => {
  const callOrder: string[] = [];
  const testResource: Resource<any, any> = {
    code: "users",
    schemas: {
      request: z.object({ id: z.number() }),
      response: z.object({ id: z.string(), calls: z.array(z.string()) }),
    },
    modifiers: {
      first: {
        use: async ({ input, auth }, next) => {
          callOrder.push("first");
          const result = await next(input, auth);
          return { ...result, calls: [...result.calls, "first"] };
        },
      },
      second: {
        use: async ({ input, auth }, next) => {
          callOrder.push("second");
          const result = await next(input, auth);
          return { ...result, calls: [...result.calls, "second"] };
        },
      },
    },
    use: async (input: { id: number }) => ({
      id: input.id,
      calls: ["base"],
    }),
    extractActions: (
      input: { id: number },
    ) => [{ path: "users", actions: ["read"] }],
  };
  const resourceManager = new ResourceManager();
  resourceManager.registerResource(testResource);
  const auth = new Auth({
    principal: "test-user",
    policies: [
      {
        resource: "users",
        action: "read",
        effect: "modify",
        middleware: { code: "first" },
      },
      {
        resource: "users",
        action: "read",
        effect: "modify",
        middleware: { code: "second" },
      },
    ],
  });
  const resourceFn = await resourceManager.getResource("users", auth);
  const result = await resourceFn({ id: 123 });
  expect(result).toEqual({
    id: 123,
    calls: ["base", "second", "first"],
  });
  expect(callOrder).toEqual(["first", "second"]);
});

Deno.test("getResource: should handle wildcard resource patterns", async () => {
  const testResource: Resource<any, any> = {
    code: "users",
    schemas: {
      request: z.object({ id: z.number() }),
      response: z.object({ id: z.string() }),
    },
    modifiers: {},
    use: async (input: { id: number }) => ({ id: input.id }),
    extractActions: (
      input: { id: number },
    ) => [{ path: "users/123", actions: ["read"] }],
  };
  const resourceManager = new ResourceManager();
  resourceManager.registerResource(testResource);
  const auth = new Auth({
    principal: "test-user",
    policies: [{ resource: "users/*", action: "read", effect: "allow" }],
  });
  const resourceFn = await resourceManager.getResource("users", auth);
  const result = await resourceFn({ id: 123 });
  expect(result).toEqual({ id: 123 });
});

Deno.test("getResource: should handle wildcard action patterns", async () => {
  const testResource: Resource<any, any> = {
    code: "users",
    schemas: {
      request: z.object({ id: z.number() }),
      response: z.object({ id: z.string() }),
    },
    modifiers: {},
    use: async (input: { id: number }) => ({ id: input.id }),
    extractActions: (
      input: { id: number },
    ) => [{ path: "users", actions: ["read"] }],
  };
  const resourceManager = new ResourceManager();
  resourceManager.registerResource(testResource);
  const auth = new Auth({
    principal: "test-user",
    policies: [{ resource: "users", action: "rea*", effect: "allow" }],
  });
  const resourceFn = await resourceManager.getResource("users", auth);
  const result = await resourceFn({ id: 123 });
  expect(result).toEqual({ id: 123 });
});
