# Timeline Resource (`timeline`)

The `timeline` resource manages the visualization metadata for the main user interface, specifically the histograms that show activity over time.

## Actions
- `recalculate`: Recompute activity histograms for a specific time range.
- `invalidate`: Clear cached histogram data.
- `ensureIndex`: Verify and create necessary database indexes for timeline performance.

## Policy Paths
- `timeline`: Standard path for timeline maintenance.

## Implementation
Histograms are pre-computed at different resolutions (5min, 1hour, 1day, 1week) to ensure the UI remains responsive even with millions of data points.

