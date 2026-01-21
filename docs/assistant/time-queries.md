# Working with Time and Date Queries

#time #search #queries

## Relative Time Expressions

Use these shortcuts for recent periods:

- `"30s"` - 30 seconds ago
- `"5m"` - 5 minutes ago (m = minutes!)
- `"1h"` - 1 hour ago
- `"7d"` - 7 days ago  
- `"2w"` - 2 weeks ago
- `"30d"` - ~1 month ago (use days, not 'm')
- `"90d"` - ~3 months ago
- `"1y"` - 1 year ago

**Important:** `m` means MINUTES, not months. Use `30d` for approximately one month.

## ISO Date Formats

- Date only: `"2024-03-15"`
- With time: `"2024-03-15T14:30:00Z"`
- With timezone: `"2024-03-15T14:30:00+02:00"`

## Search Examples

### Find transcriptions from last week

```json
{
  "action": "searchTranscriptions",
  "query": "meeting",
  "startDate": "7d"
}
```

### Find objects active in a date range

```json
{
  "action": "exploreTimeRange",
  "start": "2024-01-01",
  "end": "2024-03-31",
  "filters": { "isEvent": true }
}
```

## User Time References

When users say:

- "last week" → startDate: "7d"
- "last month" → startDate: "30d"
- "yesterday" → startDate: "1d"
- "last hour" → startDate: "1h"
- "this year" → startDate: "365d" or "1y"
- "in January" → Calculate specific date range
