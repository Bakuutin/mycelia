# Timeline Histograms

Visual representation of data density across time

## What Are Histograms?

Histograms display aggregated audio data as vertical bars on the timeline, showing:

- **Audio chunk count**: How much audio data exists in each time period
- **Speech activity**: Proportion of audio containing detected speech
- **Data freshness**: Whether histogram bins need recalculation (pink color)

The histogram automatically switches between different time resolutions as you zoom in and out, ensuring optimal visualization at any scale.

## Visual Encoding

### Bar Height
The height of each bar represents the **total number of audio chunks** in that time period. Taller bars indicate more audio data.

### Bar Color & Opacity
- **Blue bars**: Up-to-date histogram data
- **Pink bars**: Stale data that needs recalculation
- **Opacity**: Varies based on speech ratio (0.3 to 1.0)
  - Higher opacity = more speech detected
  - Lower opacity = mostly silence or background noise

## How Histogram Data is Generated

### Initial Calculation
Histograms are calculated from source audio data using a multi-resolution aggregation system:

1. **5-minute resolution** (base layer): Directly aggregated from `audio_chunks` collection
2. **Higher resolutions**: Computed from lower resolutions for efficiency

### Recalculation
When audio data changes, affected histogram bins are marked as "stale" (shown with pink stripes). To recalculate:

1. Select a time range on the timeline
2. Click the **Recalculate** button (refresh icon)
3. A background job will update the histogram data

The recalculation happens asynchronously via the job queue system.

## Data Caching

The histogram layer uses aggressive client-side caching to minimize database queries:

### Range-Based Caching
- **Loaded ranges**: Tracks which time periods have been fetched for each resolution
- **In-flight requests**: Prevents duplicate requests for the same data
- **Crossfilter indexing**: Fast filtering of cached data by time range

### Cache Invalidation
The cache automatically invalidates when:
- WebSocket events indicate histogram data has changed (`mongo:histogram`)
- Manual invalidation is triggered

### Concurrent Loading
The system fetches missing data in parallel (up to 5 concurrent requests) with automatic deduplication and range merging.

## MongoDB Collections

Histogram data is stored in MongoDB collections:

- `histogram_5min` - 5-minute bins
- `histogram_1hour` - 1-hour bins
- `histogram_1day` - 1-day bins
- `histogram_1week` - 1-week bins

Each document contains:
```js
{
  _id: ObjectId,
  start: Date,              // Bin start time
  stale: Boolean,           // Needs recalculation?
  updated_at: Date,
  totals: {
    audio_chunks: {
      count: Number,                    // Total chunks
      has_speech: Number,              // Chunks with speech
      speech_probability_max: Number,  // Max VAD probability
      speech_probability_avg: Number   // Average VAD probability
    },
    transcriptions: {
      count: Number          // Number of transcriptions
    },
    diarizations: {
      count: Number          // Number of speaker segments
    },
    // Add other aggregations!
  }
}
```

## Related Files

### Frontend
- `frontend/src/modules/histogram/index.tsx` - Histogram layer component
- `frontend/src/modules/histogram/HistogramLayer.tsx` - Rendering logic
- `frontend/src/modules/histogram/useHistogramItems.ts` - Data fetching hook
- `frontend/src/modules/histogram/useHistogramCache.ts` - Zustand cache store
- `frontend/src/lib/resolution.ts` - Resolution calculation logic

### Backend
- `backend/app/services/timeline.server.ts` - Histogram aggregation and recalculation
- `backend/app/lib/jobs/workers/histRecalculation.ts` - Background job worker
- `backend/app/lib/timeline/resource.server.ts` - Timeline resource API
- `backend/app/types/resolution.ts` - Resolution type definitions

## Technical Implementation

### Direct MongoDB Queries
The histogram layer queries MongoDB directly from the frontend using the `mongo` resource:

```typescript
const histogramData = await callResource("mongo", {
  action: "find",
  collection: `histogram_${resolution}`,
  query: {
    start: { $gte: queryStart, $lt: queryEnd },
  },
  options: { sort: { start: 1 } },
});
```

### Range Merging
Multiple overlapping or adjacent time ranges are automatically merged to minimize the number of database queries.
