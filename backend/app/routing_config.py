from __future__ import annotations

from .schemas import Mode

CRS_WGS = 4326
CRS_METRIC = 3857
WALK_SPEED_KMH = 4.8
SNAP_CANDIDATE_COUNT = 8
SNAP_DISTANCE_PENALTY = 4.0

QUIET_NOISE_PENALTY = 1.32
GREEN_ABSENCE_PENALTY = 1.34
BALANCED_NOISE_PENALTY = 0.90
BALANCED_GREEN_PENALTY = 0.92

MODE_LABELS: dict[Mode, str] = {
    "shortest": "Кратчайший",
    "quiet": "Тихий",
    "green": "Зеленый",
    "balanced": "Сбалансированный",
}

MODE_COLORS: dict[Mode, str] = {
    "shortest": "#e53935",
    "quiet": "#1e88e5",
    "green": "#43a047",
    "balanced": "#8e24aa",
}

MODE_WEIGHT_CANDIDATES: dict[Mode, list[str]] = {
    "shortest": ["w_short", "weight", "length_m"],
    "quiet": ["w_quiet_v11", "w_quiet", "w_noise", "weight"],
    "green": ["w_green_v11", "w_green", "weight"],
    "balanced": ["w_balanced_v11", "w_balanced", "w_accessible", "weight", "w_short"],
}

NOISE_ATTR_CANDIDATES = [
    "noise_proxy_db",
    "noise",
    "noise_db",
    "noise_level",
    "noise_score",
    "noise_norm",
    "w_noise",
]

GREEN_ATTR_CANDIDATES = [
    "green_score",
    "green",
    "greenness",
    "green_norm",
    "ndvi",
]

ROAD_NOISE_FACTOR = {
    "motorway": 26,
    "trunk": 22,
    "primary": 18,
    "secondary": 14,
    "tertiary": 10,
    "residential": 6,
    "service": 4,
    "living_street": 2,
    "footway": 1,
    "pedestrian": 1,
    "path": 1,
    "cycleway": 1,
}

GREEN_HIGHWAY_BONUS = {
    "footway": 0.18,
    "path": 0.18,
    "pedestrian": 0.15,
    "cycleway": 0.14,
    "living_street": 0.08,
    "residential": 0.06,
    "service": 0.03,
}
