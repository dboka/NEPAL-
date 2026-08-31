import unittest
from datetime import datetime, timezone

from scripts.discover_scenes import (
    NPT,
    acquired_nepal,
    bbox_intersects,
    dedupe_scenes,
    parse_utc,
    quality_flags,
)


class SceneUtilsTest(unittest.TestCase):
    def test_timezone_conversion(self):
        self.assertEqual(acquired_nepal("2026-08-27T05:05:00Z"), "2026-08-27T10:50:00+05:45")

    def test_aoi_intersection_bbox(self):
        self.assertTrue(bbox_intersects([84, 27, 86, 29], [85, 28, 85.5, 28.5]))
        self.assertFalse(bbox_intersects([84, 27, 85, 28], [86, 29, 87, 30]))

    def test_scene_deduplication_prefers_official_source(self):
        scenes = [
            {"mission": "Landsat", "productId": "A", "acquiredAtUtc": "2026-08-26T00:00:00Z", "source": "NASA CMR"},
            {"mission": "Landsat", "productId": "A", "acquiredAtUtc": "2026-08-26T00:00:00Z", "source": "Element84 Earth Search"},
        ]
        self.assertEqual(dedupe_scenes(scenes)[0]["source"], "Element84 Earth Search")

    def test_chronological_sorting(self):
        scenes = [
            {"mission": "S", "productId": "2", "acquiredAtUtc": "2026-08-27T00:00:00Z", "source": "NASA CMR"},
            {"mission": "S", "productId": "1", "acquiredAtUtc": "2026-08-25T00:00:00Z", "source": "NASA CMR"},
        ]
        self.assertEqual([s["productId"] for s in dedupe_scenes(scenes)], ["1", "2"])

    def test_invalid_acquisition_timestamp(self):
        with self.assertRaises(ValueError):
            parse_utc("")

    def test_missing_cloud_cover(self):
        self.assertEqual(quality_flags("optical", 30, None, "full"), [])

    def test_metadata_only_not_raster(self):
        flags = quality_flags("optical", None, None, "metadata-only")
        self.assertIn("METADATA_ONLY", flags)

    def test_parse_utc_normalizes_timezone(self):
        self.assertEqual(parse_utc("2026-08-27T10:50:00+05:45"), datetime(2026, 8, 27, 5, 5, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
