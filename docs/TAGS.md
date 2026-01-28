# Tags System

Tags are used to categorize objects. They exist as normal objects with `isTag: true` attribute and are linked to objects via relationships.

You can make any object a tag by setting `isTag: true`.

## Data Model


```typescript
{
  isTag: true,
  name: string,        // Required: tag name (e.g., "work", "personal")
  details?: string,    // if provided, it will be used as a context for the LLM when tagging objects
  // ... standard object fields
}
```

## Default Tags

Default tags are seeded via migration `0016_seed_default_tags.ts`:

## Tagger Worker

The `tagger` worker automatically applies tags to conversations.

Select a range on the timeline and run the tagger worker to apply tags to conversations in that range (that don't have any tags yet).
