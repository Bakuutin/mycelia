# Objects & Knowledge Graph Overview

#objects #knowledge-graph #basics

The knowledge graph stores entities and their relationships. Everything is an "object".

## Object Types

| Type | Field | Description |
|------|-------|-------------|
| Person | `isPerson: true` | People - friends, family, colleagues, therapists |
| Event | `isEvent: true` | Things that happened with time ranges |
| Relationship | `isRelationship: true` | Connections between two entities |
| Promise | `isPromise: true` | Commitments, tasks, things to do |
| Place | Has `location` field | Geographic locations |

## Common Fields

- `name`: Display name (required)
- `details`: Markdown description
- `icon`: Either `{ text: "🐯" }` (emoji) or `{ base64: "..." }` (image)
- `aliases`: Array of alternative names for search
- `timeRanges`: When this object was/is active
- `color`: Hex color code for visualization

## Time Ranges

Objects can have multiple time ranges for non-continuous periods:

```json
{
  "timeRanges": [
    { "start": "2024-01-01", "end": "2024-03-15", "name": "First period" },
    { "start": "2024-06-01", "end": null, "name": "Ongoing" }
  ]
}
```

Omit `end` for ongoing/current periods.
