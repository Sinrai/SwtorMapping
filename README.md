# SWTOR Mapping

Web-based interactive map project for *Star Wars: The Old Republic* using Leaflet.

The map uses a zone-based basemap system:
- world map view when zoomed out
- regional map view when zoomed in
- level switching for stacked/interior regions

Content markers are loaded from per-zone layer data and rendered above the basemap, with optional labels, popups, media, and links.

## URL Attributes

- `zone`
  - Selects the zone slug to load.
  - Default: `crash_site_outpost`
- `zoom`
  - Sets initial zoom level.
- `level`
  - Sets initial selected level (if available in the zone).
- `debug`
  - `1` enables zoom debug display and coordinates on mapnotes.
