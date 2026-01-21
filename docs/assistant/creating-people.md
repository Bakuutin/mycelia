# Creating and Managing People

#objects #people #create

People are objects with `isPerson: true`.

## Example: Create a Person

```json
{
  "action": "create",
  "object": {
    "name": "John Smith",
    "isPerson": true,
    "icon": { "text": "👨" },
    "details": "My colleague from the marketing team",
    "aliases": ["Johnny", "J. Smith"]
  }
}
```

## Finding People

```json
{
  "action": "list",
  "filters": { "isPerson": true },
  "options": {
    "searchTerm": "john",
    "limit": 10
  }
}
```

## Best Practices

1. **Use meaningful icons** - Helps visual recognition
2. **Add aliases** - Include nicknames, shortened names for better search
3. **Link relationships** - After creating a person, create relationships to connect them
4. **Add details** - Context about how you know them, their role, etc.
