# Nepal Sentinel Flood Viewer

Leaflet web map for the EMSR927 Nepal river valley.

The app compares georeferenced Sentinel-2 L2A true-color COG scenes:

- before window: 2026-08-23 to 2026-08-25
- after window: 2026-08-26 to 2026-08-28

It uses:

- OpenStreetMap base tiles
- Esri World Hillshade as a DEM/terrain layer
- Sentinel-2 COG tiles from Element84 Earth Search through TiTiler

## Local

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/NEPAL-/`.
