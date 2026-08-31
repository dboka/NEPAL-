# Data Sources

This project discovers scenes for the EMSR927 Nepal river valley from public catalog APIs.

| Provider | API/catalog | Dataset | Role |
| --- | --- | --- | --- |
| Copernicus EMS | CEMS public activation API | EMSR927 AOIs and product source metadata | AOI definition and restricted source-image metadata |
| Copernicus Data Space Ecosystem | STAC API | Sentinel-1 GRD, Sentinel-2 L1C/L2A, Sentinel-3 check | Official Copernicus catalog audit |
| Element84 Earth Search | STAC API | Sentinel-2 L1C/L2A, Sentinel-1 GRD, Landsat Collection 2 Level 2 | Public open-data scenes and COG assets |
| NASA CMR | Granules API | MODIS Terra/Aqua, VIIRS Suomi NPP/NOAA-20/NOAA-21 | Low-resolution open-data overpasses |

The generated files are:

- `data/aoi.geojson`
- `data/scenes.json`
- `data/scenes.geojson`
- `data/source-audit.json`
- `data/scene-discovery-table.md`

Run `python scripts/discover_scenes.py` to refresh the catalog.
