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

from .routing_config import (
    BALANCED_GREEN_PENALTY,
    BALANCED_NOISE_PENALTY,
    CRS_METRIC,
    CRS_WGS,
    GREEN_ABSENCE_PENALTY,
    GREEN_ATTR_CANDIDATES,
    GREEN_HIGHWAY_BONUS,
    NOISE_ATTR_CANDIDATES,
    QUIET_NOISE_PENALTY,
    ROAD_NOISE_FACTOR,
)

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
        if "=" in env_path and env_path.split("=", 1)[0].strip() == "VIKWAY_EXPORT_DIR":
            env_path = env_path.split("=", 1)[1].strip()
        path = Path(env_path).expanduser().resolve()
        if (path / "G.pkl").exists() and (path / "nodes.npy").exists():
            return path

    for path in _candidate_export_dirs():
        if (path / "G.pkl").exists() and (path / "nodes.npy").exists():
            return path
    attempted = "\n".join(str(p) for p in _candidate_export_dirs())
    raise FileNotFoundError(f"Не найдена папка с данными маршрутизации. Проверены пути:\n{attempted}")


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

    # Пространственные расстояния рассчитываются только в метрической системе координат.
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

        attrs["w_quiet_v11"] = length_m * (1.0 + QUIET_NOISE_PENALTY * noise_norm)
        attrs["w_green_v11"] = length_m * (1.0 + GREEN_ABSENCE_PENALTY * (1.0 - green_score))
        attrs["w_balanced_v11"] = length_m * (
            1.0
            + BALANCED_NOISE_PENALTY * noise_norm
            + BALANCED_GREEN_PENALTY * (1.0 - green_score)
        )


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

