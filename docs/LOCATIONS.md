# Location Tracks

Import GPS tracks from navigation apps (Organic Maps and anything else that
exports GPX/KML), see where you were on the timeline and on a dedicated map,
and let Mycelia derive timezone periods from your movements so timeline times
are always displayed correctly.

## First-time setup

1. **Download the places database** (one time, ~13 MB). Open **Settings →
   Maps → Download database** (live progress bar), or click **"Download
   places database"** on the Map page. This loads the offline GeoNames cities
   dataset (~235k cities) into MongoDB — reverse geocoding then works fully
   offline, no coordinates ever leave your server.
2. **Export a track from your navigation app.**
   - *Organic Maps*: open the track (Bookmarks & Tracks) → share/export →
     choose **GPX** (preferred) or **KML/KMZ**.
   - Any other app that produces GPX 1.1 track files (`<trkpt>` with `<time>`)
     or KML `gx:Track` works too.
3. **Import** on the **Map** page: click **Import tracks** and drop the files
   in (or use the file picker). Multiple files at once are fine.
4. **Enable the Locations track** on the timeline: Timeline → layers button
   (Track visibility) → toggle **Locations**. The track is off by default and
   performs zero requests until enabled. After your first successful import it
   is enabled automatically.

## What appears where

### Timeline: the Locations track

A dedicated row on the timeline shows where you were:

- **Colored bands** — stays (same city ⇒ same color, city label when the band
  is wide enough). Purple bands are manual assignments.
- **Thin blue ribbons** — movement between stays.
- **Grey hatched bands** — gaps: no data, the route between the surrounding
  points is *assumed*.

Click any band to open a mini-map below the timeline showing where that was,
with the place name and timezone. Selecting an object marker (a conversation,
event, …) shows the same mini-map for the moment it happened.

### Map page (`/map`)

All movements for a selectable period:

- Time presets (Day / Week / Month / Year / All); the range is shared with the
  timeline via the `?start`/`?end` URL params, so links round-trip between the
  two pages.
- **Stay circles** — radius encodes dwell time (`4·√hours`, clamped 4–24 px).
- **Blue polylines** — movements. Long ranges are automatically simplified
  server-side (point budget per request) so even "All" stays fast.
- **Grey dashed lines** — assumed routes across data gaps. Click one to assign
  a location to that period manually.
- **Conversation clusters** (toggle in the toolbar) — 💬 badges show how many
  conversations happened at each place; at low zoom nearby places merge, click
  to zoom in. Clicking a single place opens the list of its conversations
  (switchable between the selected period and all time); each entry links to
  the conversation and re-centers the map on its spot.
- **Import tracks** button — upload dialog with drag & drop, per-file results
  (imported / deduplicated / skipped counts) and the list of previous imports
  with delete.

### Conversation details

If location data overlaps a conversation's time range, its detail page shows a
**Location** section: a mini-map plus "This happened in *City, Country*". The
**Use detected location** button copies the coordinates into the object's
latitude/longitude fields.

## Timezones

Every stay is resolved to an IANA timezone offline (`tz-lookup`). The
processing worker maintains `timeline_timezone_periods` records with
`source: "import"`; the timeline's contextual timezone mode picks them up
automatically, so times are rendered in the zone you were actually in.
Manually created timezone periods always win — imported periods are clipped
around them, never overwrite them.

## Managing geotags

Every segment (geotag) knows where it came from: import file(s) or a manual
assignment — shown as source chips everywhere.

- **Timeline**: click a Locations band → the panel below shows the place,
  timezone and source, with **details** (ⓘ), **edit** (✎) and, inside the
  details card, **Delete / Override / Open in map**.
- **Map page → Geotags** button: the full list for the current period with
  type filter, source chips, overlap warnings, and per-row actions (show on
  map, details, edit, delete).
- **Deleting** a manual geotag removes the assignment (derived data
  reappears). Deleting a *derived* geotag permanently deletes the GPS points
  behind it — re-importing the same file will not restore them (they stay
  deduplicated away). Deleting a whole import (Settings → Maps or the import
  dialog) removes all its points.
- **Duplicates / overlapping tracks**: points from overlapping imports are
  deduplicated by timestamp+coordinates and merged during segmentation — a
  segment then simply lists several source files. A manual assignment always
  wins: all derived segments (stays, moves and gaps) are clipped around it.

## Settings → Maps

One place for everything geo: GeoNames status (count, last update) with a
live-progress download/update button, the list of track imports with delete,
the tile-server URL (point it at your own server for fully offline maps), a
toggle for the timeline Locations track, and a full-reprocess button.

## Manual locations

When there is no GPS data (or it is wrong), assign a location by hand:

- **Timeline**: select a range on the time axis → **Location** (📍) action in
  the toolbar.
- **Map**: click a grey assumed-route line.

In the dialog, search a city by name (offline GeoNames autocomplete) or click
the exact spot on the embedded map, adjust the range if needed, and save. This
creates a manual location segment **and** a matching manual timezone period,
and re-clips the assumed gaps around it. Manual segments can be deleted from
the API (`location.delete-segment`); deleting restores the derived gap.

## How processing works

- Raw points land in `location_points` (deduplicated by
  `timestamp+lat+lng`, so overlapping exports are safe; identical files are
  skipped by content hash).
- The `location_processing` worker (triggered automatically after each import)
  segments points into **stays** (≥10 min within ~200 m), **moves**
  (Douglas-Peucker-simplified paths) and **gaps** (>30 min silences), reverse
  geocodes stays against GeoNames, and derives timezone periods.
- Everything derived is rebuilt idempotently per time window — re-importing or
  deleting an import re-generates segments for the affected period only.

## Limits and notes

- KML `LineString` geometry has no per-point timestamps and cannot be placed
  on a timeline — such coordinates are counted as "skipped" in the import
  results. Use GPX or KML with `gx:Track` for recorded tracks.
- Map tiles are fetched from openstreetmap.org. For heavy use or full
  offline operation, point the tile URL in
  `frontend/src/components/location/LocationMap.tsx` at your own tile server.
- Place labels appear only after the GeoNames database is downloaded; stays
  imported earlier are labeled automatically once it is.
