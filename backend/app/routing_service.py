from __future__ import annotations

from typing import Any

import networkx as nx
import numpy as np
from shapely.geometry import Point

from .artifacts import _clamp, _first_numeric, latlon_to_point_m, load_artifacts, m_to_latlon
from .routing_config import (
    GREEN_ATTR_CANDIDATES,
    MODE_COLORS,
    MODE_LABELS,
    MODE_WEIGHT_CANDIDATES,
    NOISE_ATTR_CANDIDATES,
    SNAP_CANDIDATE_COUNT,
    SNAP_DISTANCE_PENALTY,
    WALK_SPEED_KMH,
)
from .schemas import LatLon, MetaResponse, Mode, RouteInfo, RouteRequest, RouteResponse

def nearest_node(point_m: Point, nodes_arr: np.ndarray) -> tuple[float, float]:
    x, y = point_m.x, point_m.y
    d2 = (nodes_arr[:, 0] - x) ** 2 + (nodes_arr[:, 1] - y) ** 2
    idx = int(d2.argmin())
    return float(nodes_arr[idx, 0]), float(nodes_arr[idx, 1])


def nearest_k_nodes(
    point_m: Point,
    nodes_arr: np.ndarray,
    k: int = SNAP_CANDIDATE_COUNT,
) -> list[tuple[tuple[float, float], float]]:
    x, y = point_m.x, point_m.y
    d2 = (nodes_arr[:, 0] - x) ** 2 + (nodes_arr[:, 1] - y) ** 2
    count = min(k, len(nodes_arr))
    if count <= 0:
        return []

    idxs = np.argpartition(d2, count - 1)[:count]
    idxs = idxs[np.argsort(d2[idxs])]

    result: list[tuple[tuple[float, float], float]] = []
    for idx in idxs:
        node = (float(nodes_arr[idx, 0]), float(nodes_arr[idx, 1]))
        result.append((node, float(d2[idx]) ** 0.5))
    return result


def choose_snap_nodes(
    graph: nx.Graph,
    nodes_arr: np.ndarray,
    start: LatLon,
    end: LatLon,
    mode: Mode,
) -> tuple[tuple[float, float], tuple[float, float]]:
    start_point = latlon_to_point_m(start.lat, start.lon)
    end_point = latlon_to_point_m(end.lat, end.lon)

    start_candidates = nearest_k_nodes(start_point, nodes_arr)
    end_candidates = nearest_k_nodes(end_point, nodes_arr)

    primary_weight = _pick_weight_key(graph, mode)
    fallback_weight = _pick_weight_key(graph, "shortest")
    weight_key = primary_weight or fallback_weight

    best_pair: tuple[tuple[float, float], tuple[float, float]] | None = None
    best_score: float | None = None

    for start_node, start_snap_dist in start_candidates:
        for end_node, end_snap_dist in end_candidates:
            try:
                route_cost = float(nx.shortest_path_length(graph, start_node, end_node, weight=weight_key))
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                continue

            score = route_cost + SNAP_DISTANCE_PENALTY * (start_snap_dist + end_snap_dist)
            if best_score is None or score < best_score:
                best_score = score
                best_pair = (start_node, end_node)

    if best_pair is not None:
        return best_pair

    return nearest_node(start_point, nodes_arr), nearest_node(end_point, nodes_arr)


def path_length_m(graph: nx.Graph, node_list: list[tuple[float, float]]) -> float:
    return float(sum(graph[a][b].get("length_m", 0.0) for a, b in zip(node_list[:-1], node_list[1:])))


def eta_minutes(length_m: float) -> float:
    speed_mps = WALK_SPEED_KMH * 1000 / 3600
    return (length_m / speed_mps) / 60


def _distance2(a: tuple[float, float], b: tuple[float, float]) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def _edge_latlon_segment(a: tuple[float, float], b: tuple[float, float], attrs: dict[str, Any]) -> list[tuple[float, float]]:
    geom = attrs.get("geometry")
    direct = [m_to_latlon(*a), m_to_latlon(*b)]

    if geom is None or not hasattr(geom, "coords"):
        return direct

    try:
        metric_coords = [(float(x), float(y)) for x, y in geom.coords]
    except Exception:
        return direct

    if len(metric_coords) < 2:
        return direct

    start = metric_coords[0]
    end = metric_coords[-1]

    # Концы геометрии должны совпадать с узлами, иначе линия маршрута образует петли.
    start_to_a = _distance2(start, a)
    start_to_b = _distance2(start, b)
    end_to_a = _distance2(end, a)
    end_to_b = _distance2(end, b)

    threshold2 = 25.0 ** 2
    forward_ok = start_to_a <= threshold2 and end_to_b <= threshold2
    reverse_ok = start_to_b <= threshold2 and end_to_a <= threshold2

    if reverse_ok and not forward_ok:
        metric_coords = list(reversed(metric_coords))
    elif not forward_ok and not reverse_ok:
        return direct

    return [m_to_latlon(x, y) for x, y in metric_coords]


def build_polyline_latlon_from_path(graph: nx.Graph, node_list: list[tuple[float, float]]) -> list[list[float]]:
    coords: list[tuple[float, float]] = []
    first = True

    for a, b in zip(node_list[:-1], node_list[1:]):
        edge = graph[a][b]
        seg = _edge_latlon_segment(a, b, edge)

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

    # Округление убирает незначительные расхождения координат при сравнении маршрутов.
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

    start_node, end_node = choose_snap_nodes(
        graph=graph,
        nodes_arr=nodes_arr,
        start=request.start,
        end=request.end,
        mode=request.mode,
    )

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



