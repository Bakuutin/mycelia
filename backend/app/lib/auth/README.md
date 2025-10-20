# Authentication & Authorization System

The Mycelia authentication system provides a flexible, policy-based
authorization.

## Overview

The auth system consists of several key components:

- **Auth Class**: Manages user identity and policies
- **ResourceManager**: Registers and manages resource access
- **Resources**: Define business logic with access control
- **Policies**: Define authorization rules
- **Modifiers**: Middleware for transforming resource behavior

## Core Concepts

### Auth Class

The `Auth` class represents a principal with associated policies:

```typescript
const auth = new Auth({
  principal: "user-123",
  policies: [
    { resource: "users", action: "read", effect: "allow" },
    {
      resource: "users",
      action: "write",
      effect: "modify",
      middleware: { code: "audit" },
    },
  ],
});
```

### Resources

Resources encapsulate business logic with built-in access control. Each resource
defines:

- **Code**: Unique identifier for the resource
- **Schemas**: For request/response to the resource
- **Modifiers**: Optional functions for transforming behavior
- **Use Function**: Core business logic
- **Extract Actions**: Determines required permissions for a given input

```typescript
const userResource: Resource<UserInput, UserOutput> = {
  code: "users",
  schemas: {
    request: z.object({ id: z.number() }),
    response: z.object({ id: z.string(), name: z.string() }),
  },
  modifiers: {
    audit: {
      code: "audit",
      schema: z.object({ logLevel: z.string() }),
      use: async ({ arg, input, auth }, next) => {
        console.log(
          `Audit: ${arg.logLevel} access to user ${input.id} by ${auth.principal}`,
        );
        return next(input, auth);
      },
    },
  },
  use: async (input, auth) => ({ id: input.id, name: "John Doe" }),
  extractActions: (input) => [{ path: "users", actions: ["read"] }],
};
```

### Policies

Policies define authorization rules with three effect types:

#### Allow Policy

Grants access to a resource/action combination:

```typescript
{ resource: "users", action: "read", effect: "allow" }
```

#### Deny Policy

Explicitly denies access:

```typescript
{ resource: "users", action: "delete", effect: "deny" }
```

#### Modify Policy

Anything more complex than allow or deny: modify the request, run a complex
check of permissions, etc.

```typescript
{
  resource: "users", 
  action: "read", 
  effect: "modify",
  middleware: { 
    code: "audit", 
    arg: { logLevel: "info" } 
  }
}
```

### Resource Paths and Actions

Resources can extract multiple action requirements from a single input:

```typescript
extractActions: ((input) => [
  { path: "users", actions: ["read"] },
  { path: "users/profile", actions: ["read"] },
]);
```

This allows fine-grained access control where a single operation might require
multiple permissions.

## Usage Patterns

### Basic Resource Access

```typescript
// Register a resource
resourceManager.registerResource(userResource);

// Get resource function with access control
const userFn = await auth.getResource("users");

// Use the resource (access control applied automatically, 'auth' is injected)
const result = await userFn({ id: 123 });
```

### Glob Syntax

JS library [minimatch](https://github.com/isaacs/minimatch) is used for glob
matching.

```
* - Matches any number of characters (except '/')

** - Matches any number of characters including '/'

? - Matches a single character

[abc] - Character class; matches one of a, b, or c

!(pattern) - Negation

@(pattern) - Exactly one match

+(pattern) - One or more

*(pattern) - Zero or more

?(pattern) - Zero or one
```

### Schema Validation

Modifier arguments are validated against their schemas:

```typescript
const modifier = {
  code: "audit",
  schema: z.object({ logLevel: z.string() }),
  use: async ({ arg, input, auth }, next) => {
    // arg.logLevel is guaranteed to be a string
    // auth is available for context
    return next(input, auth);
  },
};
```
