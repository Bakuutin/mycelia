import { expect, fn } from "@std/expect";
import { z } from "zod";
import {
  defaultResourceManager,
  Policy,
  Resource,
  ResourceManager,
} from "../resources.ts";
import { Auth } from "../core.server.ts";

const accessLogger = {
  log: () => {},
};

function setupManagerAndAuth(policies?: Policy[]) {
  const auth = new Auth({
    principal: "test-user",
    policies: policies ?? [],
  });
  accessLogger.log = fn(() => {}) as any;
  return { auth };
}

Deno.test("should register a resource and evaluate access with custom auth policy", async () => {
  const inputSchema = z.object({
    id: z.number(),
  });
  const outputSchema = z.object({
    id: z.number(),
    name: z.string(),
    email: z.string(),
  });
  type UserInput = z.infer<typeof inputSchema>;
  type UserOutput = z.infer<typeof outputSchema>;
  const userResource: Resource<UserInput, UserOutput> = {
    code: "users",
    schemas: {
      request: inputSchema,
      response: outputSchema,
    },
    use: async (input: UserInput) => {
      return {
        id: input.id,
        name: "John Doe",
        email: "john@example.com",
      };
    },
    extractActions: () => [{
      path: "users",
      actions: ["read"],
    }],
  };
  defaultResourceManager.registerResource(userResource);
  const customAuth = new Auth({
    principal: "reader",
    policies: [
      {
        resource: "users",
        action: "read",
        effect: "allow",
      },
    ],
  });
  const result = await userResource.use({ id: 123 }, customAuth);
  expect(result).toEqual({
    id: 123,
    name: "John Doe",
    email: "john@example.com",
  });
});

Deno.test("ResourceManager edge cases: denies access if policy effect is deny", async () => {
  const { auth } = setupManagerAndAuth([
    { resource: "test", action: "read", effect: "deny" },
  ]);
  const inputSchema = z.object({ id: z.number() });
  const outputSchema = z.object({ id: z.string() });
  const baseResource: Resource<any, any> = {
    code: "test",
    schemas: { request: inputSchema, response: outputSchema },
    use: async (input) => ({ id: input.id }),
    extractActions: (
      input: { id: number },
    ) => [{ path: "test", actions: ["read"] }],
  };
  defaultResourceManager.registerResource(baseResource);
  const fn = await auth.getResource("test");
  await expect(fn({ id: 1 })).rejects.toHaveProperty("status", 403);
});

Deno.test("ResourceManager edge cases: denies access if no matching policy", async () => {
  const { auth } = setupManagerAndAuth([
    { resource: "other", action: "read", effect: "allow" },
  ]);
  const inputSchema = z.object({ id: z.number() });
  const outputSchema = z.object({ id: z.string() });
  const baseResource: Resource<any, any> = {
    code: "test",
    schemas: { request: inputSchema, response: outputSchema },
    use: async (input) => ({ id: input.id }),
    extractActions: (
      input: { id: number },
    ) => [{ path: "test", actions: ["read"] }],
  };
  defaultResourceManager.registerResource(baseResource);
  const fn = await auth.getResource("test");
  await expect(fn({ id: 1 })).rejects.toHaveProperty("status", 403);
});

Deno.test("ResourceManager edge cases: denies access if resource is not registered", async () => {
  const resourceManager = new ResourceManager();
  const { auth } = setupManagerAndAuth([
    { resource: "test", action: "read", effect: "allow" },
  ]);
  await expect(resourceManager.getResource("test", auth)).rejects
    .toHaveProperty(
      "status",
      403,
    );
});

Deno.test("ResourceManager edge cases: calls modifier if modify policy present and schema passes", async () => {
  const resourceManager = new ResourceManager();
  const { auth } = setupManagerAndAuth([
    {
      resource: "test",
      action: "read",
      effect: "modify",
      middleware: { code: "mod", arg: { foo: "bar" } },
    },
  ]);

  class TestResource implements Resource<{ id: number }, any> {
    code = "test";
    schemas = { request: z.object({ id: z.number() }), response: z.any() };
    modifiers = {
      mod: {
        use: async (
          { input, auth }: { input: { id: number }; auth: Auth },
          next: (input: { id: number }, auth: any) => Promise<any>,
        ) => {
          const res = await next(input, auth);
          return { ...res, foo: "bar" };
        },
      },
    };
    use = async (input: { id: number }) => ({ id: input.id });
    extractActions = () => [{ path: "test", actions: ["read"] }];
  }
  resourceManager.registerResource(new TestResource());
  const fn = await resourceManager.getResource("test", auth);
  const result = await fn({ id: 2 });
  expect(result).toEqual({ id: 2, foo: "bar" });
});

Deno.test("ResourceManager edge cases: denies access if modify policy present but modifier missing", async () => {
  const { auth } = setupManagerAndAuth([
    {
      resource: "test",
      action: "read",
      effect: "modify",
      middleware: { code: "missing", arg: {} },
    },
  ]);
  const inputSchema = z.object({ id: z.number() });
  const outputSchema = z.object({ id: z.string() });
  const baseResource: Resource<any, any> = {
    code: "test",
    schemas: { request: inputSchema, response: outputSchema },
    use: async (input) => ({ id: input.id }),
    extractActions: (
      input: { id: number },
    ) => [{ path: "test", actions: ["read"] }],
  };
  defaultResourceManager.registerResource(baseResource);
  const fn = await auth.getResource("test");
  await expect(fn({ id: 1 })).rejects.toHaveProperty("status", 403);
});

Deno.test("ResourceManager edge cases: denies access if modify policy present but schema fails", async () => {
  const { auth } = setupManagerAndAuth([
    {
      resource: "test",
      action: "read",
      effect: "modify",
      middleware: { code: "mod", arg: { foo: 123 } },
    },
  ]);
  const inputSchema = z.object({ id: z.number() });
  const outputSchema = z.object({ id: z.string() });
  const modifier = {
    schema: z.object({ foo: z.string() }),
    use: async (
      { arg, input, auth }: {
        arg: { foo: string };
        input: { id: number };
        auth: any;
      },
      next: (input: { id: number }, auth: any) => Promise<any>,
    ) => {
      return next(input, auth);
    },
  };
  const baseResource: Resource<any, any> = {
    code: "test",
    schemas: { request: inputSchema, response: outputSchema },
    modifiers: { mod: modifier },
    use: async (input) => ({ id: input.id }),
    extractActions: (
      input: { id: number },
    ) => [{ path: "test", actions: ["read"] }],
  };
  defaultResourceManager.registerResource(baseResource);
  const fn = await auth.getResource("test");
  await expect(fn({ id: 1 })).rejects.toHaveProperty("status", 403);
});

Deno.test("ResourceManager edge cases: matchPolicy returns true for matching resource and action", () => {
  const policy = {
    resource: "foo*",
    action: "rea*",
    effect: "allow",
  } as Policy;
  expect(defaultResourceManager.matchPolicy(policy, "foobar", "read")).toBe(
    true,
  );
});

Deno.test("ResourceManager edge cases: matchPolicy returns false for non-matching resource or action", () => {
  const policy = {
    resource: "foo*",
    action: "rea*",
    effect: "allow",
  } as Policy;
  expect(defaultResourceManager.matchPolicy(policy, "bar", "read")).toBe(false);
  expect(defaultResourceManager.matchPolicy(policy, "foobar", "write")).toBe(
    false,
  );
});

Deno.test("ResourceManager edge cases: calls all modifiers", async () => {
  const resourceManager = new ResourceManager();
  let sharedCallCount = 0;
  let privateCallCount = 0;
  const resource: Resource<any, any> = {
    code: "users",
    schemas: {
      request: z.object({ id: z.number() }),
      response: z.object({ id: z.number(), foo: z.string() }),
    },
    modifiers: {
      shared: {
        use: async (
          { input, auth }: { input: { id: number }; auth: any },
          next: (input: { id: number }, auth: any) => Promise<any>,
        ) => {
          sharedCallCount++;
          return next(input, auth);
        },
      },
      private: {
        use: async (
          { input, auth }: { input: { id: number }; auth: any },
          next: (input: { id: number }, auth: any) => Promise<any>,
        ) => {
          privateCallCount++;
          return next(input, auth);
        },
      },
    },
    use: async (input) => ({ id: input.id, foo: "default" }),
    extractActions: (
      input: { id: number },
    ) => [{ path: ["users", input.id.toString()], actions: ["read"] }],
  };
  resourceManager.registerResource(resource);
  const auth = {
    principal: "user",
    policies: [{
      resource: "users/*",
      action: "read",
      effect: "modify",
      middleware: { code: "shared" },
    }, {
      resource: "users/2",
      action: "read",
      effect: "modify",
      middleware: { code: "private" },
    }],
  } as any;
  const fnResource = await resourceManager.getResource("users", auth);
  const result = await fnResource({ id: 2 });
  expect(result).toEqual({ id: 2, foo: "default" });
  expect(sharedCallCount).toBe(1);
  expect(privateCallCount).toBe(1);
});
