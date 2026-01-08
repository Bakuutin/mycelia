# API Keys Resource (`apikeys`)

The `apikeys` resource manages the lifecycle of credentials used by external services and extensions.

## Actions
- `create`: Generate a new API key with a specific set of policies.
- `list`: Retrieve all active API keys for the current principal.
- `update`: Modify the policies (scopes) of an existing key.
- `revoke`: Deactivate an API key.

## Policy Paths
Paths are structured as `apikeys/<action>`.
- `apikeys/create`
- `apikeys/list`
- `apikeys/update`
- `apikeys/revoke`

## Security
API keys are stored as hashed values with unique salts. When creating or updating a key, the policies are provided in YAML format for human readability, which the resource then parses and validates.

