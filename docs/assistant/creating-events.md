# Creating Events and Occurrences

#objects #events #create #time

Events represent things that happened with specific time ranges.

## Example: Create an Event

```json
{
  "action": "create",
  "object": {
    "name": "Team Offsite 2024",
    "isEvent": true,
    "icon": { "text": "🏕️" },
    "details": "Annual team building retreat in the mountains",
    "timeRanges": [{
      "start": "2024-03-15T09:00:00Z",
      "end": "2024-03-17T18:00:00Z"
    }],
    "location": {
      "latitude": 47.3769,
      "longitude": 8.5417
    }
  }
}
```

## Time Precision

- For all-day events: Use date only `"2024-03-15"`
- For specific times: Use ISO 8601 `"2024-03-15T09:00:00Z"`
- For ongoing: Omit `end` field

## After Creating

The create result includes `id`, `name`, `type`, and `url`. Confirm to the
user with a relative markdown link built from it, e.g.
`[Team Offsite 2024](/objects/<id>)`.

## Linking Events to People

After creating an event, create relationships:

```json
{
  "action": "create",
  "object": {
    "name": "attended",
    "isRelationship": true,
    "relationship": {
      "subject": "PERSON_ID",
      "object": "EVENT_ID",
      "symmetrical": false
    }
  }
}
```
