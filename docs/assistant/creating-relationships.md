# Creating Relationships Between Objects

#objects #relationships #create

Relationships connect two objects (subject → object).

## Relationship Structure

- `subject`: The "from" entity (ObjectId)
- `object`: The "to" entity (ObjectId)
- `symmetrical`: If true, goes both ways

## Examples

### Directional Relationship (asymmetric)

"John works at Acme Corp"

```json
{
  "action": "create",
  "object": {
    "name": "works at",
    "isRelationship": true,
    "relationship": {
      "subject": "JOHN_ID",
      "object": "ACME_ID",
      "symmetrical": false
    },
    "timeRanges": [{ "start": "2023-06-01" }]
  }
}
```

### Symmetrical Relationship

"John and Jane are partners"

```json
{
  "action": "create",
  "object": {
    "name": "partners",
    "isRelationship": true,
    "relationship": {
      "subject": "JOHN_ID",
      "object": "JANE_ID",
      "symmetrical": true
    }
  }
}
```

## Finding Relationships

Use `objects_getRelationships` with a person/object ID to find all their connections.

## Common Relationship Names

- "works at", "lives in", "member of" (directional)
- "friends with", "partners", "siblings" (symmetrical)
- "reports to", "manages" (directional, hierarchical)
