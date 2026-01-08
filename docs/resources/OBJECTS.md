# Objects Resource (`objects`)

The `objects` resource manages the graph-based entity system in Mycelia. It tracks people, places, events, relationships, and promises.

## Actions
- `create`: Create a new entity or relationship.
- `get`: Retrieve an object by ID.
- `list`: Search and filter objects with pagination.
- `update`: Modify specific fields on an object (supports optimistic locking).
- `delete`: Permanently remove an object.
- `getRelationships`: Find all connections for a specific object.
- `getHistory`: Retrieve the version history of changes to an object.
- `exploreTimeRange`: Find objects active during a specific period.

## Policy Paths
- `objects`: Standard path for all object operations.

## Features
- **Temporal Graph**: Objects can have `timeRanges`, allowing the system to reconstruct "who was where when".
- **Optimistic Locking**: Every update requires a `version` number to prevent accidental overwrites in concurrent environments.
- **History Tracking**: All changes are automatically recorded in the `object_history` collection.
- **Deep Relationships**: The `list` action can automatically join related objects for a comprehensive view.

