## Events Timeline — Product Requirements

### Overview
The Events feature provides a zoomable personal timeline for life, education, work, relationships, and geography. It visualizes both point-in-time events and time spans, with lane assignment to avoid overlaps and category-aware styling. It is backed by a hypothetical `events` collection and integrated into Mycelia’s Remix/React/Tailwind app.

### Goals
- Visualize life events on a time axis with smooth zoom and pan
- Support both point events and ranged periods
- Group by categories (geo, education, romantic, work, etc.) with distinct visuals, categories are user-defined
- Enable filtering by time window, category, tags, and search
- Allow create/read/update/delete of events

### Non‑Goals
- Complex analytics beyond filtering and counts
- Collaborative editing and multi-user permissions
- Geospatial rendering beyond categorical “geo” styling

### Primary Use Cases
- View an at-a-glance life timeline across categories
- Drill into a period to see nested or related sub-periods
- Add/edit events while previewing the placement on the timeline
- Filter to focus on a subset (e.g., work between 2019–2025)


## Data Model
Use a single `events` collection. Prefer explicit types; use Zod for runtime validation.

### Core Fields
- id: ObjectId
- kind: 'point' | 'range'
- title: string
- shortTitle?: string
- description?: string
- color: string
- category: string
- start: Date
- end?: Date optional, open-ended if omitted and kind is 'range'
- parentId?: ObjectId for hierarchical grouping
- style?: {
  - rightBorder?: 'straight' | 'zigzag' | 'wave' | 'fade'
  - thin?: boolean
}
- createdAt: Date
- updatedAt: Date

## API Requirements
Use existing API for resources, no new API endpoints are needed.

## UI/UX Requirements

- Add a layer to the timeline to render the events in `@/modules/events/index.tsx`.
## State Management
- `@/modules/events/useEvents.ts`: filters, viewport time window, selection, hover state
- Debounced updates for zoom/pan to avoid excessive recomputes

## Validation
Use Zod for validation.

## Tests

Add tests to `@/modules/events/tests/layer.test.ts` and `@/modules/events/tests/useEvents.test.ts`.