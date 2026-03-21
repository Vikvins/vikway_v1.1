from __future__ import annotations

import os
import pickle
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import networkx as nx
import numpy as np
from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from .schemas import LatLon, MetaResponse, Mode, RouteInfo, RouteRequest, RouteResponse

CRS_WGS = 4326
CRS_METRIC = 3857
WALK_SPEED_KMH = 4.8

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

_wgs84_to_m = Transformer.from_crs(CRS_WGS, CRS_METRIC, always_xy=True)
_m_to_wgs84 = Transformer.from_crs(CRS_METRIC, CRS_WGS, always_xy=True)


@dataclass(frozen=True)
class GraphArtifacts:
    graph: nx.Graph
    nodes_arr: np.ndarray
    export_dir: Path


@dataclass(frozen=True)
class SpatialIndex:
    tree: STRtree
    geometries: tuple[Any, ...]


def _candidate_export_dirs() -> list[Path]:
    backend_dir = Path(__file__).resolve().parents[1]
    workspace_dir = backend_dir.parent
    return [
        backend_dir / "data" / "export",
        workspace_dir / "vikway" / "export",
    ]


def resolve_export_dir() -> Path:
    env_path = os.getenv("VIKWAY_EXPORT_DIR")
    if env_path:
        path = Path(env_path).expanduser().resolve()
        if (path / "G.pkl").exists() and (path / "nodes.npy").exists():
            return path

    for path in _candidate_export_dirs():
        if (path / "G.pkl").exists() and (path / "nodes.npy").exists():
            return path
    attempted = "\n".join(str(p) for p in _candidate_export_dirs())
    raise FileNotFoundError(f"Could not find export directory. Tried:\n{attempted}")


def _first_numeric(attrs: dict[str, Any], candidates: list[str]) -> float | None:
    for key in candidates:
        value = attrs.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    return None


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _parse_float(value: Any, default: float = 0.0) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        m = re.search(r"[0-9]+(?:\.[0-9]+)?", value)
        if m:
            return float(m.group(0))
    return default


def _normalize_highway(value: Any) -> str:
    if isinstance(value, list) and value:
        return str(value[0]).lower()
    if isinstance(value, str):
        return value.lower()
    return "unknown"


def _as_linestring(a: tuple[float, float], b: tuple[float, float], attrs: dict[str, Any]) -> LineString:
    geom = attrs.get("geometry")
    if geom is not None:
        try:
            if isinstance(geom, LineString):
                return geom
            if hasattr(geom, "coords"):
                return LineString(list(geom.coords))
        except Exception:
            pass
    return LineString([a, b])


def _collect_geometries(obj: Any) -> list[Any]:
    geoms: list[Any] = []
    if obj is None:
        return geoms

    if hasattr(obj, "geometry"):
        try:
            for g in obj.geometry:
                if g is not None and not getattr(g, "is_empty", False):
                    geoms.append(g)
            return geoms
        except Exception:
            pass

    if isinstance(obj, dict):
        for v in obj.values():
            geoms.extend(_collect_geometries(v))
        return geoms

    if isinstance(obj, (list, tuple, set)):
        for v in obj:
            geoms.extend(_collect_geometries(v))
        return geoms

    if hasattr(obj, "geoms"):
        try:
            for g in obj.geoms:
                geoms.extend(_collect_geometries(g))
            return geoms
        except Exception:
            pass

    if hasattr(obj, "geom_type"):
        if not getattr(obj, "is_empty", False):
            geoms.append(obj)
        return geoms

    return geoms


def _load_spatial_index(export_dir: Path, file_name: str) -> SpatialIndex | None:
    path = export_dir / file_name
    if not path.exists():
        return None

    try:
        with path.open("rb") as f:
            raw = pickle.load(f)
    except Exception:
        return None

    # If source is a GeoDataFrame/GeoSeries in geographic CRS, project it to metric CRS.
    if hasattr(raw, "to_crs") and hasattr(raw, "crs"):
        try:
            crs = raw.crs
            crs_str = str(crs).upper() if crs is not None else ""
            if "4326" in crs_str or "WGS 84" in crs_str:
                raw = raw.to_crs(epsg=CRS_METRIC)
        except Exception:
            pass

    geoms = _collect_geometries(raw)
    if not geoms:
        return None

    try:
        return SpatialIndex(tree=STRtree(geoms), geometries=tuple(geoms))
    except Exception:
        return None


def _query_geometries(index: SpatialIndex, geometry: Any) -> list[Any]:
    try:
        matches = index.tree.query(geometry)
    except Exception:
        return []

    if matches is None or len(matches) == 0:
        return []

    first = matches[0]
    if isinstance(first, (int, np.integer)):
        return [index.geometries[int(i)] for i in matches]
    return [geom for geom in matches if geom is not None]


def _estimate_noise_db(
    attrs: dict[str, Any],
    edge_line: LineString,
    rail_index: SpatialIndex | None,
) -> tuple[float, float]:
    existing = _first_numeric(attrs, NOISE_ATTR_CANDIDATES)
    if existing is not None and existing > 1.5:
        noise_db = _clamp(existing, 35.0, 85.0)
        return noise_db, _clamp((noise_db - 35.0) / 50.0, 0.0, 1.0)

    highway = _normalize_highway(attrs.get("highway"))
    lanes = _parse_float(attrs.get("lanes"), default=1.0)
    maxspeed = _parse_float(attrs.get("maxspeed"), default=30.0)

    road_component = ROAD_NOISE_FACTOR.get(highway, 7.0)
    lanes_component = _clamp(lanes, 1.0, 6.0) * 1.4
    speed_component = _clamp(maxspeed, 20.0, 110.0) * 0.15

    rail_component = 0.0
    if rail_index is not None:
        try:
            near = _query_geometries(rail_index, edge_line.buffer(60.0))
            if len(near) > 0:
                rail_component = 6.0
        except Exception:
            rail_component = 0.0

    noise_db = _clamp(35.0 + road_component + lanes_component + speed_component + rail_component, 35.0, 85.0)
    noise_norm = _clamp((noise_db - 35.0) / 50.0, 0.0, 1.0)
    return noise_db, noise_norm


def _estimate_green_score(
    attrs: dict[str, Any],
    edge_line: LineString,
    green_index: SpatialIndex | None,
) -> float:
    existing = _first_numeric(attrs, GREEN_ATTR_CANDIDATES)
    if existing is not None:
        if existing > 1.0:
            return _clamp(existing / 100.0, 0.0, 1.0)
        return _clamp(existing, 0.0, 1.0)

    highway = _normalize_highway(attrs.get("highway"))
    score = 0.20 + GREEN_HIGHWAY_BONUS.get(highway, 0.0)

    if green_index is not None:
        try:
            close_10 = len(_query_geometries(green_index, edge_line.buffer(10.0)))
            close_25 = len(_query_geometries(green_index, edge_line.buffer(25.0)))
            close_50 = len(_query_geometries(green_index, edge_line.buffer(50.0)))

            if close_10 > 0:
                score += 0.28
            if close_25 > 0:
                score += 0.20
            if close_50 > 0:
                score += 0.12

            # Extra small boost for dense green surroundings.
            score += min(close_25, 3) * 0.03
        except Exception:
            pass

    if attrs.get("lit") in ("no", False):
        score += 0.05

    return _clamp(score, 0.0, 1.0)


def _enrich_graph_with_environment(graph: nx.Graph, export_dir: Path) -> None:
    green_index = _load_spatial_index(export_dir, "green.pkl")
    rail_index = _load_spatial_index(export_dir, "rail.pkl")

    for a, b, attrs in graph.edges(data=True):
        length_m = float(attrs.get("length_m", 0.0))
        if length_m <= 0.0:
            length_m = float(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5)
            attrs["length_m"] = length_m

        edge_line = _as_linestring(a, b, attrs)

        noise_db, noise_norm = _estimate_noise_db(attrs, edge_line, rail_index)
        green_score = _estimate_green_score(attrs, edge_line, green_index)

        attrs["noise_proxy_db"] = noise_db
        attrs["noise_norm"] = noise_norm
        attrs["green_score"] = green_score

        if "w_short" not in attrs:
            attrs["w_short"] = length_m
        if "w_quiet" not in attrs:
            attrs["w_quiet"] = length_m * (1.0 + 1.2 * noise_norm)
        if "w_green" not in attrs:
            attrs["w_green"] = length_m * (1.0 + 1.2 * (1.0 - green_score))
        if "w_balanced" not in attrs:
            attrs["w_balanced"] = length_m * (1.0 + 0.8 * noise_norm + 0.8 * (1.0 - green_score))

        # v1.1: same routing architecture as baseline, slightly stronger eco sensitivity.
        attrs["w_quiet_v11"] = length_m * (1.0 + 1.32 * noise_norm)
        attrs["w_green_v11"] = length_m * (1.0 + 1.34 * (1.0 - green_score))
        attrs["w_balanced_v11"] = length_m * (1.0 + 0.90 * noise_norm + 0.92 * (1.0 - green_score))


@lru_cache(maxsize=1)
def load_artifacts() -> GraphArtifacts:
    export_dir = resolve_export_dir()
    with (export_dir / "G.pkl").open("rb") as f:
        graph = pickle.load(f)
    nodes_arr = np.load(export_dir / "nodes.npy")

    _enrich_graph_with_environment(graph, export_dir)

    return GraphArtifacts(graph=graph, nodes_arr=nodes_arr, export_dir=export_dir)


def latlon_to_point_m(lat: float, lon: float) -> Point:
    x, y = _wgs84_to_m.transform(lon, lat)
    return Point(x, y)


def m_to_latlon(x: float, y: float) -> tuple[float, float]:
    lon, lat = _m_to_wgs84.transform(x, y)
    return float(lat), float(lon)


def nearest_node(point_m: Point, nodes_arr: np.ndarray) -> tuple[float, float]:
    x, y = point_m.x, point_m.y
    d2 = (nodes_arr[:, 0] - x) ** 2 + (nodes_arr[:, 1] - y) ** 2
    idx = int(d2.argmin())
    return float(nodes_arr[idx, 0]), float(nodes_arr[idx, 1])


def path_length_m(graph: nx.Graph, node_list: list[tuple[float, float]]) -> float:
    return float(sum(graph[a][b].get("length_m", 0.0) for a, b in zip(node_list[:-1], node_list[1:])))


def eta_minutes(length_m: float) -> float:
    speed_mps = WALK_SPEED_KMH * 1000 / 3600
    return (length_m / speed_mps) / 60


def _distance2(a: tuple[float, float], b: tuple[float, float]) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def build_polyline_latlon_from_path(graph: nx.Graph, node_list: list[tuple[float, float]]) -> list[list[float]]:
    coords: list[tuple[float, float]] = []
    first = True

    for a, b in zip(node_list[:-1], node_list[1:]):
        edge = graph[a][b]
        geom = edge.get("geometry")

        if geom is not None:
            xs, ys = zip(*list(geom.coords))
            seg = [m_to_latlon(float(x), float(y)) for x, y in zip(xs, ys)]
        else:
            seg = [m_to_latlon(*a), m_to_latlon(*b)]

        if not seg:
            continue

        if first:
            coords.extend(seg)
            first = False
            continue

        last = coords[-1]
        if _distance2(last, seg[-1]) < _distance2(last, seg[0]):
            seg = list(reversed(seg))

        if _distance2(last, seg[0]) > 1e-6:
            coords.append(seg[0])

        coords.extend(seg[1:])

    if not coords:
        return []

    cleaned = [coords[0]]
    for p in coords[1:]:
        if _distance2(p, cleaned[-1]) > 1e-12:
            cleaned.append(p)

    return [[lat, lon] for lat, lon in cleaned]


def _available_weight_keys(graph: nx.Graph) -> set[str]:
    keys: set[str] = set()
    for _, _, attrs in graph.edges(data=True):
        keys.update(k for k, v in attrs.items() if isinstance(v, (int, float)))
        if len(keys) > 64:
            break
    return keys


def _pick_weight_key(graph: nx.Graph, mode: Mode) -> str | None:
    available = _available_weight_keys(graph)
    for key in MODE_WEIGHT_CANDIDATES[mode]:
        if key in available:
            return key
    return None


def _route_metrics(graph: nx.Graph, node_list: list[tuple[float, float]]) -> tuple[float | None, float | None]:
    noise_weighted_sum = 0.0
    green_weighted_sum = 0.0
    noise_total_len = 0.0
    green_total_len = 0.0

    for a, b in zip(node_list[:-1], node_list[1:]):
        attrs = graph[a][b]
        seg_len = float(attrs.get("length_m", 0.0))
        if seg_len <= 0:
            seg_len = float(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5)
        if seg_len <= 0:
            continue

        noise = _first_numeric(attrs, NOISE_ATTR_CANDIDATES)
        green = _first_numeric(attrs, GREEN_ATTR_CANDIDATES)

        if noise is not None:
            if noise <= 1.5:
                noise = 35.0 + noise * 50.0
            noise_weighted_sum += float(noise) * seg_len
            noise_total_len += seg_len

        if green is not None:
            if green > 1.0:
                green = green / 100.0
            green_weighted_sum += float(_clamp(green, 0.0, 1.0)) * seg_len
            green_total_len += seg_len

    avg_noise = (noise_weighted_sum / noise_total_len) if noise_total_len > 0 else None
    avg_green = (green_weighted_sum / green_total_len) if green_total_len > 0 else None
    return float(avg_noise) if avg_noise is not None else None, float(avg_green) if avg_green is not None else None


def _path_geometry_key(graph: nx.Graph, node_list: list[tuple[float, float]]) -> tuple[tuple[float, float], ...]:
    coords = build_polyline_latlon_from_path(graph, node_list)
    if not coords:
        return ()

    # Reduce minor coordinate jitter and keep key size stable.
    step = max(1, len(coords) // 80)
    sampled = coords[::step]
    if sampled[-1] != coords[-1]:
        sampled.append(coords[-1])

    return tuple((round(float(lat), 5), round(float(lon), 5)) for lat, lon in sampled)


def _dedupe_paths(
    graph: nx.Graph,
    paths_by_mode: dict[Mode, list[tuple[float, float]]],
) -> list[tuple[list[Mode], list[tuple[float, float]]]]:
    grouped: dict[tuple[tuple[float, float], ...], dict[str, Any]] = {}

    for mode, path in paths_by_mode.items():
        geom_key = _path_geometry_key(graph, path)
        if geom_key not in grouped:
            grouped[geom_key] = {"modes": [], "path": path}
        grouped[geom_key]["modes"].append(mode)

    return [(item["modes"], item["path"]) for item in grouped.values()]


def _compute_paths(
    graph: nx.Graph,
    start_node: tuple[float, float],
    end_node: tuple[float, float],
    requested_mode: Mode,
    include_alternatives: bool,
) -> dict[Mode, list[tuple[float, float]]]:
    modes: list[Mode]
    if include_alternatives:
        modes = [requested_mode] + [m for m in MODE_LABELS.keys() if m != requested_mode]
    else:
        modes = [requested_mode]

    paths: dict[Mode, list[tuple[float, float]]] = {}
    for mode in modes:
        weight_key = _pick_weight_key(graph, mode)
        kwargs: dict[str, Any] = {"source": start_node, "target": end_node}
        if weight_key is not None:
            kwargs["weight"] = weight_key

        paths[mode] = nx.shortest_path(graph, **kwargs)
    return paths


def get_meta() -> MetaResponse:
    artifacts = load_artifacts()
    graph = artifacts.graph
    nodes_arr = artifacts.nodes_arr

    center_x = float(nodes_arr[:, 0].mean())
    center_y = float(nodes_arr[:, 1].mean())
    center_lat, center_lon = m_to_latlon(center_x, center_y)

    min_x = float(nodes_arr[:, 0].min())
    max_x = float(nodes_arr[:, 0].max())
    min_y = float(nodes_arr[:, 1].min())
    max_y = float(nodes_arr[:, 1].max())

    south, west = m_to_latlon(min_x, min_y)
    north, east = m_to_latlon(max_x, max_y)

    return MetaResponse(
        center=LatLon(lat=center_lat, lon=center_lon),
        bbox=[[south, west], [north, east]],
        modes=["shortest", "quiet", "green", "balanced"],
        available_weight_keys=sorted(_available_weight_keys(graph)),
    )


def build_routes(request: RouteRequest) -> RouteResponse:
    artifacts = load_artifacts()
    graph = artifacts.graph
    nodes_arr = artifacts.nodes_arr

    start_node = nearest_node(latlon_to_point_m(request.start.lat, request.start.lon), nodes_arr)
    end_node = nearest_node(latlon_to_point_m(request.end.lat, request.end.lon), nodes_arr)

    paths_by_mode = _compute_paths(
        graph=graph,
        start_node=start_node,
        end_node=end_node,
        requested_mode=request.mode,
        include_alternatives=request.include_alternatives,
    )

    deduped = _dedupe_paths(graph, paths_by_mode)
    route_infos: list[RouteInfo] = []

    for idx, (modes, node_list) in enumerate(deduped, start=1):
        selected = request.mode in modes
        primary_mode = modes[0]
        length_m = path_length_m(graph, node_list)
        avg_noise, avg_green = _route_metrics(graph, node_list)
        route_infos.append(
            RouteInfo(
                id=f"route-{idx}",
                label=" / ".join(MODE_LABELS[m] for m in modes),
                modes=modes,
                color=MODE_COLORS[primary_mode],
                selected=selected,
                length_m=length_m,
                eta_min=eta_minutes(length_m),
                avg_noise=avg_noise,
                avg_green=avg_green,
                coordinates=build_polyline_latlon_from_path(graph, node_list),
            )
        )

    route_infos.sort(key=lambda r: (not r.selected, r.eta_min))

    snapped_start_lat, snapped_start_lon = m_to_latlon(*start_node)
    snapped_end_lat, snapped_end_lon = m_to_latlon(*end_node)

    return RouteResponse(
        start=request.start,
        end=request.end,
        snapped_start=LatLon(lat=snapped_start_lat, lon=snapped_start_lon),
        snapped_end=LatLon(lat=snapped_end_lat, lon=snapped_end_lon),
        routes=route_infos,
    )




