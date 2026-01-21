# Creating Promises and Tasks

#objects #promises #tasks #create

Promises represent commitments, tasks, or things to remember.

## Create a Promise

```json
{
  "action": "create",
  "object": {
    "name": "Call dentist for appointment",
    "isPromise": true,
    "icon": { "text": "📋" },
    "details": "Need to schedule annual checkup",
    "timeRanges": [{
      "start": "2024-03-20",
      "name": "Due date"
    }]
  }
}
```

## Link Promise to Person

If someone asked you to do something:

```json
{
  "action": "create",
  "object": {
    "name": "promised to",
    "isRelationship": true,
    "relationship": {
      "subject": "ME_ID",
      "object": "PERSON_ID",
      "symmetrical": false
    },
    "timeRanges": [{ "start": "2024-03-15" }]
  }
}
```

## Find Open Promises

```json
{
  "action": "list",
  "filters": { 
    "isPromise": true,
    "timeRanges.end": null
  }
}
```

## Mark Complete

Update with end date:

```json
{
  "action": "update",
  "id": "PROMISE_ID",
  "version": 1,
  "field": "timeRanges.0.end",
  "value": "2024-03-18"
}
```
