from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .routing_service import build_routes, get_meta, load_artifacts
from .schemas import MetaResponse, RouteRequest, RouteResponse

app = FastAPI(title="VikWay MVP API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    load_artifacts()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/meta", response_model=MetaResponse)
def meta() -> MetaResponse:
    try:
        return get_meta()
    except Exception as exc:  # pragma: no cover - defensive API wrapper
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/routes", response_model=RouteResponse)
def routes(payload: RouteRequest) -> RouteResponse:
    try:
        return build_routes(payload)
    except Exception as exc:  # pragma: no cover - defensive API wrapper
        raise HTTPException(status_code=400, detail=str(exc)) from exc


frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
