# Authentication & Authorization Model

This document describes security system used in Mycelia. In this architecture, **Resources are the central chokepoint** for all authentication and authorization control.

## Authentication Layers

Mycelia distinguishes between **who you are** (Authentication) and **what you can do** (Authorization). Security is applied at two distinct layers:

### 1. Connection Layer (HTTP Authentication)
This is the entry point for all external interactions. When a client (Web UI, Mobile App, or Extension) connects to the Mycelia server, it must prove its identity:
- **Users**: Authenticated via JWT (JSON Web Tokens) after logging in.
- **Services & Extensions**: Authenticated via API Keys.
- **System**: Internal tasks run with a special "server" principal that has full system access.

### 2. Operation Layer (Resource PBAC)
Once a connection is established, every single operation is governed by **Policy-Based Access Control (PBAC)**. This is the internal system that manages how different identities interact with data and services.

Instead of broad "admin" or "user" roles, every action is a call to a **Resource**. Your identity (the **Principal**) is wrapped in an **Auth Object** containing a set of **Policies**.

#### Delegation and Scoped Permissions
The Resource model allows for sophisticated delegation and security limitations:
- **Full Access**: The Web UI typically runs with your full user permissions.
- **Limited Agents**: You can run an AI agent or a specialized extension and provide it with a "scoped" Auth object. For example, an agent might be allowed to *read* your transcriptions but be explicitly *denied* from *writing* to your database or *accessing* your file system.
- **Sharing**: You can share specific resources with friends by granting their principal specific policies on your resource paths. 

This separation ensures that even if an extension is active, its impact is limited to the specific permissions granted to it.

## The Chokepoint Philosophy



In Mycelia, security is centralized in the **Resource Layer**. 

1.  **Unified Enforcement**: Every major system operation (Database, File System, AI Inference, Job Queue) is encapsulated in a `Resource`. 
2.  **Mandatory Proxy**: System internals are not accessed directly. Instead, consumers must go through `auth.getResource(code)`. This returns a proxied function that **automatically** enforces policies before the underlying logic ever runs.
3.  **Isolation by Design**: By making the resource the chokepoint, we ensure that security rules are applied consistently, regardless of whether a request comes from a Web UI, a CLI tool, or an external Extension.

---

## Core Concepts

### 1. The Principal
The identity performing an action.
- **User**: Authenticated via JWT.
- **Service/Extension**: Authenticated via API keys.
- **System**: Internal operations (running with "server" auth).

### 2. The Auth Object
The container for security context.
- `principal`: The unique ID of the actor.
- `policies`: The specific rules attached to this identity.

### 3. Policies
Rules that define the limits of the chokepoint:
- **Resource**: A glob pattern matching a resource path (e.g., `mongo/audio_chunks`).
- **Action**: A glob pattern matching an operation (e.g., `read`, `write`, `delete`, `*`).
- **Effect**: 
  - `allow`: Access granted.
  - `deny`: Access blocked (takes precedence).
  - `modify`: Injects security middleware (the "Enforcement Logic").

---

## The Authorization Lifecycle (The Chokepoint in Action)

When an operation is requested, it passes through the following mandatory stages:

### 1. Action Extraction (Translation)
The Resource translates the high-level business request into a set of security requirements.
*Example: A request to `mongo.find({ collection: "audio_chunks" })` is translated into:*
- **Path**: `mongo/audio_chunks`
- **Action**: `read`

### 2. Policy Matching
The `ResourceManager` compares the principal's policies against these extracted requirements using glob matching. 

### 3. Middleware Wrapping (Enforcement)
If a `modify` policy matches, the Resource wraps the execution in a **Modifier**. This is where context-aware security happens:
- **Filtering**: Injecting `{ owner: principal }` into database queries.
- **Validation**: Ensuring a file upload doesn't exceed a specific size.
- **Auditing**: Logging the exact data being accessed.

### 4. Final Execution
The underlying resource logic (the `use` function) is only called **after** all policies have been satisfied and all modifiers have been applied.

---

## Resource Sharing & Multi-Tenancy

Because the resource is the chokepoint, we can safely share physical infrastructure between multiple principals.

### Context-Aware Isolation
Instead of creating 100 MongoDB collections for 100 users, we use a single collection and a **Modify Policy** that enforces isolation at the query level.

**User Policy Example:**
```json
{
  "resource": "mongo/audio_chunks",
  "action": "read",
  "effect": "modify",
  "middleware": {
    "code": "filter",
    "arg": { "owner": "user_123" }
  }
}
```

The user's code simply asks for "all audio chunks". The chokepoint (Resource Layer) sees the policy and silently transforms the request to only return "audio chunks owned by user_123".

---

## Security Considerations

### Default Deny
If a request reaches the chokepoint and no policy explicitly handles it, access is denied. There are no "implicit" permissions.

### Chokepoint Bypass Protection
Developers are encouraged to keep system logic inside Resources. Any logic living outside a Resource bypasses the PBAC system and must be handled with extreme caution (usually reserved for "server" principal operations).

### Cross-Resource Consistency
Since resources are independent chokepoints, a complex operation (like "transcribing an uploaded file") requires a principal to have permissions for multiple resources (`fs`, `mongo`, and `transcription`).

---

## Technical Reference

- **Policy Engine**: `backend/app/lib/auth/resources.ts`
- **Enforcement Point**: `ResourceManager.getResource()`
- **Resource Definitions**: [See Resource Documentation](resources/README.md)
