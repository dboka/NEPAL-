# Nepal River Valley Satellite Time Viewer

OpenStreetMap-based satellite timeline for the Copernicus EMSR927 flood activation in Nepal.

## Project overview

The project discovers public satellite observations covering the EMSR927 river valley from 2026-08-25 00:00 NPT through 2026-08-28 00:00 NPT. It stores verified metadata locally and visualizes the scenes on a MapLibre GL map.

## Screenshot placeholder

Run the web app and capture the map after discovery has completed.

## Data sources

See `docs/data-sources.md` and `data/source-audit.json`.

## Satellite missions

The discovery script checks Sentinel-1, Sentinel-2, Sentinel-3, Landsat 8/9, MODIS Terra/Aqua, and VIIRS Suomi NPP/NOAA-20/NOAA-21 where public APIs are available.

## Installation

```bash
cd apps/web
npm install
```

## Environment variables

No frontend API token is required for the current catalog. See `.env.example` for optional tile settings.

## Scene discovery

```bash
python scripts/discover_scenes.py
```

Outputs are written to `data/` and copied to `apps/web/public/data/`.

## Raster processing

The first version streams public COG assets when an HTTP GeoTIFF URL exists. Restricted commercial EMS source imagery is metadata-only.

## Development server

```bash
cd apps/web
npm run dev
```

## Production build

```bash
cd apps/web
npm run build
```

## Licensing

See `docs/licensing.md`.

## Known limitations

- Sentinel-3 is audited through CDSE STAC, but the current collection check may need a provider-specific collection ID update.
- MODIS/VIIRS records are low resolution and often metadata-only for the map.
- AOI-specific cloud cover is not computed yet; scene-level cloud cover is displayed when provided by the source.
- A dedicated TiTiler deployment would be better than the public demo endpoint for production.
