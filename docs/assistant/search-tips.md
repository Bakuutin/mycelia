# Advanced Search Tips

#search #tips #advanced

## Search Operators (in MongoDB queries)

When using `objects_list` filters:

### Regex Search

```json
{ "name": { "$regex": "john", "$options": "i" } }
```

### Multiple Conditions

```json
{
  "$and": [
    { "isPerson": true },
    { "name": { "$regex": "smith" } }
  ]
}
```

### Exists Check

```json
{ "location": { "$exists": true } }
```

## Efficient Searching

1. **Use searchTerm option** for name/alias search:

```json
{ "options": { "searchTerm": "therapy" } }
```

2. **Limit results** to avoid overwhelming responses:

```json
{ "options": { "limit": 20 } }
```

3. **Sort by relevance**:

```json
{ "options": { "sort": { "updatedAt": -1 } } }
```

## Combining Sources

For comprehensive research:

1. Search transcriptions for spoken mentions
2. Search messages for written mentions  
3. Search objects for structured data
4. Cross-reference and deduplicate
