# Updating Existing Objects

#objects #update #versioning

Objects use optimistic locking to prevent concurrent update conflicts.

## Update Process

1. **Get current object** with version number
2. **Send update** with that version
3. If version mismatch → conflict error

## Update Single Field

```json
{
  "action": "update",
  "id": "OBJECT_ID",
  "version": 3,
  "field": "details",
  "value": "Updated description here"
}
```

## Update Nested Field

Use dot notation:

```json
{
  "action": "update",
  "id": "OBJECT_ID", 
  "version": 3,
  "field": "icon.text",
  "value": "🎉"
}
```

## Remove a Field

Set value to null:

```json
{
  "action": "update",
  "id": "OBJECT_ID",
  "version": 3,
  "field": "aliases",
  "value": null
}
```

## Handling Conflicts

If you get a version mismatch error:

1. Fetch the latest object
2. Review the changes
3. Re-apply your update with new version

## View History

Use `objects_getHistory` to see all changes:

```json
{
  "action": "getHistory",
  "id": "OBJECT_ID",
  "limit": 20
}
```
