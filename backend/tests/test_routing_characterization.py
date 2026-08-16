from __future__ import annotations

import hashlib
import json
import unittest

from app.routing_service import build_routes, get_meta
from app.schemas import LatLon, RouteRequest


CASES = {
    "contrast": {
        "start": (59.39882, 56.78425),
        "end": (59.40616, 56.80305),
        "mode": "green",
        "digest": "ba6a4dcd4e08388f6b67c0cd34ba7d807b92b280f39e1cbcc1721803b80fb928",
        "route_count": 3,
    },
    "green": {
        "start": (59.40062, 56.81388),
        "end": (59.41345, 56.79043),
        "mode": "green",
        "digest": "06b200b4bc7dd6cc43193e884fb8c1f881217728cee77ad4dee00043c51b0e1d",
        "route_count": 2,
    },
    "quiet": {
        "start": (59.3986, 56.77996),
        "end": (59.40603, 56.81172),
        "mode": "quiet",
        "digest": "8466b3093a9afbac0f1a4751c4bc4b76ca3f927e7a6210cc334853a8ee679bcc",
        "route_count": 2,
    },
}


def response_digest(payload: dict) -> str:
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode()).hexdigest()


class RoutingCharacterizationTests(unittest.TestCase):
    def test_metadata_contract(self) -> None:
        metadata = get_meta()

        self.assertEqual(metadata.modes, ["shortest", "quiet", "green", "balanced"])
        self.assertEqual(len(metadata.bbox), 2)
        self.assertIn("w_short", metadata.available_weight_keys)
        self.assertIn("w_green_v11", metadata.available_weight_keys)

    def test_demo_routes_match_baseline(self) -> None:
        for name, case in CASES.items():
            with self.subTest(case=name):
                request = RouteRequest(
                    start=LatLon(lat=case["start"][0], lon=case["start"][1]),
                    end=LatLon(lat=case["end"][0], lon=case["end"][1]),
                    mode=case["mode"],
                    include_alternatives=True,
                )
                response = build_routes(request)
                payload = response.model_dump(mode="json")

                self.assertEqual(len(payload["routes"]), case["route_count"])
                self.assertEqual(response_digest(payload), case["digest"])


if __name__ == "__main__":
    unittest.main()
