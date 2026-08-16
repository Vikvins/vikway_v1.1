from __future__ import annotations

from typing import Literal, Sequence

from pydantic import BaseModel, Field

Mode = Literal["shortest", "quiet", "green", "balanced"]


class LatLon(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    start: LatLon
    end: LatLon
    mode: Mode = "shortest"
    include_alternatives: bool = True


class RouteInfo(BaseModel):
    id: str
    label: str
    modes: Sequence[Mode]
    color: str
    selected: bool
    length_m: float
    eta_min: float
    avg_noise: float | None = Field(default=None, description="Расчётная оценка шума на рёбрах графа")
    avg_green: float | None = Field(default=None, description="Расчётная оценка озеленения на рёбрах графа")
    coordinates: list[list[float]]


class RouteResponse(BaseModel):
    start: LatLon
    end: LatLon
    snapped_start: LatLon
    snapped_end: LatLon
    routes: list[RouteInfo]


class MetaResponse(BaseModel):
    center: LatLon
    bbox: list[list[float]]
    modes: list[Mode]
    available_weight_keys: list[str]
