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

## How conversations get tagged

**Primary path — extraction time.** The `conversation_extractor` selects tags
inside the same metadata LLM call that extracts entities and emoji: the
transcript is already being sent, so the tag list is the only extra prompt
cost. Matching tags become `tagged` relationships and a tagging run is
recorded in `metadata.aiProvenance.taggingRuns` (including valid zero-tag
outcomes) so the tagger does not re-process the conversation.

**Backfill path — the `tagger` worker.** The tagger remains for conversations
that were extracted before a tag existed: after adding a new tag, run the
tagger (optionally over a timeline range) with `force: true` to re-evaluate,
or without it to process only conversations that have no tagging run yet.
Unlike extraction-time tagging, it works from the conversation title and
summary rather than the full transcript.
