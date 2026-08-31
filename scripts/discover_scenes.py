#!/usr/bin/env python3
"""Discover open satellite scenes for the EMSR927 Nepal river valley.

The script uses public catalog/API responses only. It writes normalized scene
metadata for the web app and records every searched source in source-audit.json.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
WEB_PUBLIC_DATA = ROOT / "apps" / "web" / "public" / "data"

CEMS_ACTIVATION_URL = "https://mapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/?code=EMSR927"
CEMS_AOI_URL = "https://mapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/download-aois/?code=EMSR927"
EARTH_SEARCH = "https://earth-search.aws.element84.com/v1/search"
CDSE_STAC = "https://stac.dataspace.copernicus.eu/v1/search"
CMR_GRANULES = "https://cmr.earthdata.nasa.gov/search/granules.json"

NPT = timezone(timedelta(hours=5, minutes=45))
START_UTC = datetime(2026, 8, 24, 18, 15, tzinfo=timezone.utc)
END_UTC = datetime(2026, 8, 27, 18, 15, tzinfo=timezone.utc)


def http_json(url: str, method: str = "GET", payload: dict[str, Any] | None = None, timeout: int = 45) -> Any:
    data = None
    headers = {"Accept": "application/json", "User-Agent": "nepal-river-satellite-viewer/0.1"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def acquired_nepal(utc_iso: str | None) -> str | None:
    if not utc_iso:
        return None
    dt = parse_utc(utc_iso)
    return dt.astimezone(NPT).isoformat()


def parse_utc(value: str) -> datetime:
    if not value:
        raise ValueError("Missing acquisition timestamp")
    value = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def bbox_from_geojson(fc: dict[str, Any]) -> list[float]:
    xs: list[float] = []
    ys: list[float] = []

    def walk(coords: Any) -> None:
        if isinstance(coords, list) and coords and isinstance(coords[0], (int, float)):
            xs.append(float(coords[0]))
            ys.append(float(coords[1]))
            return
        if isinstance(coords, list):
            for item in coords:
                walk(item)

    for feature in fc.get("features", []):
        walk(feature.get("geometry", {}).get("coordinates", []))
    if not xs or not ys:
        raise ValueError("AOI GeoJSON has no coordinates")
    return [min(xs), min(ys), max(xs), max(ys)]


def bbox_intersects(a: list[float], b: list[float]) -> bool:
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def feature_collection(features: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": features}


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def copy_for_web(path: Path) -> None:
    WEB_PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    (WEB_PUBLIC_DATA / path.name).write_text(path.read_text(encoding="utf-8"), encoding="utf-8")


def normalize_platform(value: str | None) -> str:
    if not value:
        return "Unknown"
    return value.replace("-", " ").title().replace(" ", "-")


def mission_from_platform(platform: str, collection: str = "") -> str:
    text = f"{platform} {collection}".lower()
    if "sentinel-1" in text:
        return "Sentinel-1"
    if "sentinel-2" in text:
        return "Sentinel-2"
    if "sentinel-3" in text:
        return "Sentinel-3"
    if "landsat" in text:
        return "Landsat"
    if "viirs" in text or platform.lower() in {"suomi-npp", "noaa-20", "noaa-21"}:
        return "VIIRS"
    if "modis" in text or platform.lower() in {"terra", "aqua"}:
        return "MODIS"
    return "Other open data"


def data_type_for(mission: str, props: dict[str, Any]) -> str:
    if mission == "Sentinel-1" or props.get("sar:instrument_mode"):
        return "sar"
    return "optical"


def quality_flags(data_type: str, resolution: float | None, cloud: float | None, display_mode: str) -> list[str]:
    flags: list[str] = []
    if display_mode == "metadata-only":
        flags.append("METADATA_ONLY")
    if data_type == "sar":
        flags.append("SAR")
    if resolution and resolution >= 250:
        flags.append("LOW_RESOLUTION")
    if cloud is None:
        return flags
    if cloud < 20:
        flags.append("CLEAR")
    elif cloud < 50:
        flags.append("PARTLY_CLOUDY")
    elif cloud < 80:
        flags.append("CLOUDY")
    else:
        flags.append("VERY_CLOUDY")
    return flags


def asset_href(assets: dict[str, Any], *names: str) -> str | None:
    for name in names:
        asset = assets.get(name)
        if isinstance(asset, dict) and asset.get("href"):
            return asset["href"]
    return None


def normalize_stac_item(item: dict[str, Any], source: str, source_url: str) -> dict[str, Any]:
    props = item.get("properties", {})
    assets = item.get("assets", {})
    links = item.get("links", [])
    collection = item.get("collection", "")
    platform = normalize_platform(props.get("platform") or props.get("constellation"))
    mission = mission_from_platform(platform, collection)
    data_type = data_type_for(mission, props)
    acquired = props.get("datetime") or props.get("start_datetime")
    cloud = props.get("eo:cloud_cover")
    resolution = props.get("gsd")
    if resolution is None:
        visual_asset = assets.get("visual") or assets.get("visual-jp2") or assets.get("thumbnail")
        if isinstance(visual_asset, dict):
            resolution = visual_asset.get("gsd")
    stac_item_url = next((l.get("href") for l in links if l.get("rel") == "self"), None)
    license_url = next((l.get("href") for l in links if l.get("rel") in {"license", "cite-as"}), None)
    display_mode = "full"
    normalized_assets = {
        "thumbnail": asset_href(assets, "thumbnail", "overview"),
        "visual": asset_href(assets, "visual", "visual-jp2", "reduced_resolution_browse"),
        "red": asset_href(assets, "red", "red-jp2", "B04", "SR_B4"),
        "green": asset_href(assets, "green", "green-jp2", "B03", "SR_B3"),
        "blue": asset_href(assets, "blue", "blue-jp2", "B02", "SR_B2"),
        "nir": asset_href(assets, "nir", "nir08", "nir08-jp2", "B08", "SR_B5"),
        "swir": asset_href(assets, "swir16", "swir16-jp2", "swir22", "SR_B6"),
        "vv": asset_href(assets, "vv", "VV"),
        "vh": asset_href(assets, "vh", "VH"),
    }
    normalized_assets = {k: v for k, v in normalized_assets.items() if v}
    return {
        "id": f"{source.lower().replace(' ', '-')}-{item.get('id')}",
        "productId": item.get("id"),
        "platform": platform,
        "mission": mission,
        "sensor": ", ".join(props.get("instruments") or []) or "Unknown",
        "dataType": data_type,
        "processingLevel": props.get("processing:level") or props.get("s2:product_type") or props.get("landsat:correction") or "Unknown",
        "acquiredAtUtc": parse_utc(acquired).isoformat().replace("+00:00", "Z") if acquired else None,
        "acquiredAtNepal": acquired_nepal(acquired),
        "resolutionMeters": resolution,
        "sceneCloudCoverPercent": cloud,
        "aoiCloudCoverPercent": None,
        "cloudCoverPercent": cloud,
        "footprint": item.get("geometry"),
        "bbox": item.get("bbox"),
        "source": source,
        "sourceUrl": source_url,
        "stacItemUrl": stac_item_url,
        "license": "open",
        "licenseUrl": license_url,
        "displayMode": display_mode,
        "assets": normalized_assets,
        "polarizations": props.get("sar:polarizations"),
        "orbitDirection": props.get("sat:orbit_state"),
        "relativeOrbit": props.get("sat:relative_orbit"),
        "qualityFlags": quality_flags(data_type, resolution, cloud, display_mode),
        "notes": "",
        "rawProperties": props,
    }


def stac_search(source: str, url: str, collections: list[str], bbox: list[float]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    payload = {
        "collections": collections,
        "datetime": f"{START_UTC.isoformat().replace('+00:00', 'Z')}/{END_UTC.isoformat().replace('+00:00', 'Z')}",
        "bbox": bbox,
        "limit": 100,
    }
    t0 = time.time()
    data = http_json(url, method="POST", payload=payload)
    scenes = [normalize_stac_item(item, source, url) for item in data.get("features", [])]
    audit = {
        "provider": source,
        "mission": ", ".join(collections),
        "searched": True,
        "sceneCount": len(scenes),
        "status": "success",
        "query": payload,
        "elapsedSeconds": round(time.time() - t0, 2),
    }
    return scenes, audit


def cmr_search(short_name: str, platform: str, mission: str, bbox: list[float]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    params = {
        "short_name": short_name,
        "bounding_box": ",".join(str(v) for v in bbox),
        "temporal": f"{START_UTC.isoformat().replace('+00:00', 'Z')},{END_UTC.isoformat().replace('+00:00', 'Z')}",
        "page_size": "100",
    }
    url = f"{CMR_GRANULES}?{urllib.parse.urlencode(params)}"
    t0 = time.time()
    data = http_json(url)
    entries = data.get("feed", {}).get("entry", [])
    scenes: list[dict[str, Any]] = []
    for entry in entries:
        acquired = entry.get("time_start")
        polygons = entry.get("polygons") or []
        footprint = None
        if polygons:
            coords = []
            raw_numbers = polygons[0][0].replace(",", " ").split()
            for i in range(0, len(raw_numbers) - 1, 2):
                lat = raw_numbers[i]
                lon = raw_numbers[i + 1]
                coords.append([float(lon), float(lat)])
            if coords and coords[0] != coords[-1]:
                coords.append(coords[0])
            footprint = {"type": "Polygon", "coordinates": [coords]}
        links = entry.get("links") or []
        browses = [l.get("href") for l in links if "browse" in (l.get("rel") or "").lower() or "image" in (l.get("type") or "")]
        cloud = entry.get("cloud_cover")
        resolution = 250 if "VIIRS" in mission else 1000
        scenes.append({
            "id": f"nasa-cmr-{entry.get('id')}",
            "productId": entry.get("producer_granule_id") or entry.get("id"),
            "platform": platform,
            "mission": mission,
            "sensor": short_name,
            "dataType": "optical",
            "processingLevel": "Unknown",
            "acquiredAtUtc": parse_utc(acquired).isoformat().replace("+00:00", "Z") if acquired else None,
            "acquiredAtNepal": acquired_nepal(acquired),
            "resolutionMeters": resolution,
            "sceneCloudCoverPercent": cloud,
            "aoiCloudCoverPercent": None,
            "cloudCoverPercent": cloud,
            "footprint": footprint,
            "bbox": bbox,
            "source": "NASA CMR",
            "sourceUrl": url,
            "stacItemUrl": entry.get("links", [{}])[0].get("href") if entry.get("links") else None,
            "license": "open",
            "displayMode": "metadata-only" if not browses else "full",
            "assets": {"thumbnail": browses[0]} if browses else {},
            "qualityFlags": quality_flags("optical", resolution, cloud, "full" if browses else "metadata-only"),
            "notes": "Low-resolution NASA browse/metadata product; not a high-resolution georeferenced COG layer.",
            "rawProperties": entry,
        })
    audit = {
        "provider": "NASA CMR",
        "mission": f"{mission} {short_name}",
        "searched": True,
        "sceneCount": len(scenes),
        "status": "success",
        "query": params,
        "elapsedSeconds": round(time.time() - t0, 2),
    }
    return scenes, audit


def in_requested_window(utc_iso: str | None) -> bool:
    if not utc_iso:
        return False
    dt = parse_utc(utc_iso)
    return START_UTC <= dt < END_UTC


def cems_metadata_scenes(activation: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    restricted = {"WorldView", "GeoEye", "Pleiades", "BlackSky", "Legion", "Satellogic", "PeruSAT", "Resurs"}
    scenes: list[dict[str, Any]] = []
    for aoi in activation.get("aois", []):
        for product in aoi.get("products", []):
            for image in product.get("images", []):
                sensor = image.get("sensorName") or "Unknown"
                acquired = image.get("acquisitionTime")
                if not in_requested_window(acquired):
                    continue
                display = "metadata-only" if any(name.lower() in sensor.lower() for name in restricted) else "metadata-only"
                scenes.append({
                    "id": f"cems-{image.get('uuid')}",
                    "productId": image.get("fileName") or image.get("uuid"),
                    "platform": sensor,
                    "mission": "Restricted/commercial EMS source",
                    "sensor": sensor,
                    "dataType": image.get("sensorType") or "optical",
                    "processingLevel": product.get("type") or "Unknown",
                    "acquiredAtUtc": parse_utc(acquired).isoformat().replace("+00:00", "Z") if acquired else None,
                    "acquiredAtNepal": acquired_nepal(acquired),
                    "resolutionMeters": None,
                    "sceneCloudCoverPercent": None,
                    "aoiCloudCoverPercent": None,
                    "cloudCoverPercent": None,
                    "footprint": wkt_polygon_to_geojson(product.get("extent") or aoi.get("extent")),
                    "bbox": None,
                    "source": "Copernicus EMSR927 product metadata",
                    "sourceUrl": CEMS_ACTIVATION_URL,
                    "stacItemUrl": product.get("downloadPath"),
                    "license": "restricted",
                    "displayMode": display,
                    "assets": {},
                    "qualityFlags": quality_flags("optical", None, None, display),
                    "notes": "CEMS rapid mapping source image is recorded as metadata only; raster is not rehosted.",
                    "rawProperties": {"aoi": aoi.get("name"), "product": product.get("id"), "image": image},
                })
    return scenes, {
        "provider": "Copernicus EMSR927",
        "mission": "CEMS source imagery metadata",
        "searched": True,
        "sceneCount": len(scenes),
        "status": "success",
        "query": CEMS_ACTIVATION_URL,
    }


def wkt_polygon_to_geojson(wkt: str | None) -> dict[str, Any] | None:
    if not wkt or not wkt.startswith("POLYGON"):
        return None
    inner = wkt.split("((", 1)[1].rsplit("))", 1)[0]
    coords = []
    for pair in inner.split(","):
        lon, lat = pair.strip().split()[:2]
        coords.append([float(lon), float(lat)])
    return {"type": "Polygon", "coordinates": [coords]}


def dedupe_scenes(scenes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    priority = {
        "Copernicus Data Space": 0,
        "Element84 Earth Search": 1,
        "NASA CMR": 2,
        "Copernicus EMSR927 product metadata": 3,
    }
    chosen: dict[tuple[str, str, str], dict[str, Any]] = {}
    for scene in scenes:
        key = (
            scene.get("mission") or "",
            scene.get("productId") or scene.get("id") or "",
            scene.get("acquiredAtUtc") or "",
        )
        prev = chosen.get(key)
        if prev is None or priority.get(scene.get("source"), 99) < priority.get(prev.get("source"), 99):
            chosen[key] = scene
    return sorted(chosen.values(), key=lambda s: s.get("acquiredAtUtc") or "")


def scenes_geojson(scenes: list[dict[str, Any]]) -> dict[str, Any]:
    features = []
    for scene in scenes:
        if scene.get("footprint"):
            features.append({
                "type": "Feature",
                "properties": {k: scene.get(k) for k in [
                    "id", "productId", "platform", "mission", "sensor", "dataType",
                    "acquiredAtUtc", "acquiredAtNepal", "resolutionMeters",
                    "cloudCoverPercent", "source", "license", "displayMode",
                ]},
                "geometry": scene["footprint"],
            })
    return feature_collection(features)


def discovery_table(scenes: list[dict[str, Any]]) -> str:
    header = "| Date | Time UTC | Time Nepal | Satellite | Sensor | Resolution | Cloud | AOI Coverage | Source | Open Data |\n"
    sep = "| ---- | -------- | ---------- | --------- | ------ | ---------- | ----- | ------------ | ------ | --------- |\n"
    rows = []
    for scene in scenes:
        utc = scene.get("acquiredAtUtc")
        npt = scene.get("acquiredAtNepal")
        dt_utc = parse_utc(utc) if utc else None
        dt_npt = parse_utc(utc).astimezone(NPT) if utc else None
        rows.append(
            f"| {dt_utc.date() if dt_utc else 'Unknown'} | {dt_utc.strftime('%H:%M') if dt_utc else 'Unknown'} | "
            f"{dt_npt.strftime('%Y-%m-%d %H:%M') if dt_npt else 'Unknown'} | {scene.get('platform') or 'Unknown'} | "
            f"{scene.get('sensor') or 'Unknown'} | {scene.get('resolutionMeters') or 'Unknown'} | "
            f"{scene.get('cloudCoverPercent') if scene.get('cloudCoverPercent') is not None else 'Unknown'} | "
            f"{'intersects search bbox/footprint' if scene.get('footprint') else 'bbox only'} | "
            f"{scene.get('source')} | {scene.get('license') == 'open'} |"
        )
    return header + sep + "\n".join(rows) + "\n"


def save_aoi() -> tuple[dict[str, Any], dict[str, Any]]:
    fc = http_json(CEMS_AOI_URL)
    activation = http_json(CEMS_ACTIVATION_URL)["results"][0]
    write_json(DATA / "aoi.geojson", fc)
    write_json(DATA / "cems-activation.json", activation)
    return fc, activation


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    WEB_PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    audits: list[dict[str, Any]] = []
    scenes: list[dict[str, Any]] = []

    aoi, activation = save_aoi()
    bbox = bbox_from_geojson(aoi)

    searches = [
        ("Element84 Earth Search", EARTH_SEARCH, ["sentinel-2-l2a"]),
        ("Element84 Earth Search", EARTH_SEARCH, ["sentinel-2-l1c"]),
        ("Element84 Earth Search", EARTH_SEARCH, ["sentinel-1-grd"]),
        ("Element84 Earth Search", EARTH_SEARCH, ["landsat-c2-l2"]),
        ("Copernicus Data Space", CDSE_STAC, ["sentinel-1-grd"]),
        ("Copernicus Data Space", CDSE_STAC, ["sentinel-2-l1c"]),
        ("Copernicus Data Space", CDSE_STAC, ["sentinel-2-l2a"]),
        ("Copernicus Data Space", CDSE_STAC, ["sentinel-3-olci-l1-efr"]),
    ]

    for source, url, collections in searches:
        try:
            found, audit = stac_search(source, url, collections, bbox)
            scenes.extend(found)
            audits.append(audit)
            print(f"{source} {collections}: {len(found)} scenes")
        except Exception as exc:
            audits.append({
                "provider": source,
                "mission": ", ".join(collections),
                "searched": True,
                "sceneCount": 0,
                "status": "failed",
                "reason": str(exc),
            })
            print(f"{source} {collections}: failed: {exc}", file=sys.stderr)

    for short_name, platform, mission in [
        ("MOD021KM", "Terra", "MODIS"),
        ("MYD021KM", "Aqua", "MODIS"),
        ("VNP02IMG", "Suomi-NPP", "VIIRS"),
        ("VJ102IMG", "NOAA-20", "VIIRS"),
        ("VJ202IMG", "NOAA-21", "VIIRS"),
    ]:
        try:
            found, audit = cmr_search(short_name, platform, mission, bbox)
            scenes.extend(found)
            audits.append(audit)
            print(f"NASA CMR {short_name}: {len(found)} scenes")
        except Exception as exc:
            audits.append({
                "provider": "NASA CMR",
                "mission": f"{mission} {short_name}",
                "searched": True,
                "sceneCount": 0,
                "status": "failed",
                "reason": str(exc),
            })
            print(f"NASA CMR {short_name}: failed: {exc}", file=sys.stderr)

    cems_scenes, cems_audit = cems_metadata_scenes(activation)
    scenes.extend(cems_scenes)
    audits.append(cems_audit)

    scenes = dedupe_scenes([s for s in scenes if s.get("acquiredAtUtc")])
    write_json(DATA / "scenes.json", scenes)
    write_json(DATA / "scenes.geojson", scenes_geojson(scenes))
    write_json(DATA / "source-audit.json", audits)
    (DATA / "scene-discovery-table.md").write_text(discovery_table(scenes), encoding="utf-8")

    for name in ["aoi.geojson", "scenes.json", "scenes.geojson", "source-audit.json", "cems-activation.json"]:
        copy_for_web(DATA / name)

    print(f"Wrote {len(scenes)} normalized scenes and {len(audits)} audit records.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
