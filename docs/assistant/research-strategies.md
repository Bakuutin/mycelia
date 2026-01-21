# Research Strategies for Complex Questions

#search #research #strategies

## General Approach

1. **Search objects first** - Use `search_searchObjects` to find relevant entities, especially conversations
2. **Start with specific searches** - Use the appropriate search tool for your data type
3. **Analyze results** to understand what data exists
4. **Cross-reference** objects and relationships
5. **Combine multiple searches** if needed

## Strategy: "What conversations exist about X?"

1. **Start with objects**: `search_searchObjects` filtering for type="conversation"
2. Search conversation titles, descriptions, and metadata
3. Use `objects_getRelationships` to find related entities
4. Get full conversation details with `objects_getObjects`
5. This is often the fastest way to find relevant discussions

## Strategy: "What did I discuss about X?"

1. Search objects first: `search_searchObjects` for conversations about X
2. Search transcriptions with `search_searchTranscriptions`
3. Search messages with `search_searchMessages`
4. Combine results from all sources
5. Summarize findings chronologically

## Strategy: "Tell me about person X"

1. Search objects: `search_searchObjects` with person name
2. Get their relationships: `objects_getRelationships`
3. Search transcriptions mentioning them
4. Build a profile from all sources

## Strategy: "What happened last week?"

1. Use `objects_exploreTimeRange` for the week
2. Search conversations with time filters
3. Group by day/topic
4. Highlight key events and discussions

## Strategy: "Find connections between X and Y"

1. Search for both entities: `search_searchObjects` for X and Y
2. Check if direct relationship exists: `objects_getRelationships`
3. Search for conversations involving both: `search_searchObjects` type="conversation"
4. Search transcriptions for both names together
5. Look for shared relationships (mutual connections)

## When Results Are Empty

- Try broader search terms
- Remove date filters
- Check for aliases/alternate spellings
- Search in different collections
