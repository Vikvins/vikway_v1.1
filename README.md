# VikWay v1.1 (FastAPI + React)

Conservative copy of the baseline MVP with the same routing architecture and slightly stronger eco sensitivity.

## Structure

- `backend/` FastAPI API that loads `G.pkl` + `nodes.npy` and builds routes.
- `frontend/` React + Vite app with Leaflet map.
- `backend/data/export/` bundled data needed for deployed routing.

## Reused logic

- Nearest-node snapping from point to graph.
- Weighted shortest paths with `networkx.shortest_path`.
- Modes backed by existing graph weight keys (`w_short`, `w_quiet`, `w_green`, `w_accessible`).
- Polyline reconstruction from edge geometry.
- Route length and ETA calculation.

## Backend setup

1. Create and activate virtual environment.
2. Install dependencies:

```powershell
cd backend
pip install -r requirements.txt
```

3. Optional: set export directory explicitly (if autodetect fails):

```powershell
$env:VIKWAY_EXPORT_DIR = "C:\Users\chekalina\Documents\New project\vikway\export"
```

4. Run API:

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

## Frontend setup

1. Install dependencies:

```powershell
cd frontend
npm install
```

2. Copy env file and run dev server:

```powershell
copy .env.example .env
npm run dev -- --host 127.0.0.1 --port 5175 --strictPort
```

By default frontend expects API on `http://127.0.0.1:8001` in local development.

## Production build

The production frontend is built into `frontend/dist` and served by FastAPI from the same origin.

To rebuild it locally:

```powershell
cd frontend
npm run build
```

## Render deployment

This repo includes `render.yaml` at the repository root.

Expected flow:
1. Push the repository to GitHub.
2. In Render, create a Blueprint or Web Service from that GitHub repo.
3. Render will use:
   - `rootDir: vikway_web_mvp_ludicrous_goose_v2/backend`
   - `buildCommand: pip install -r requirements.txt`
   - `startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Health check path: `/api/health`

Because the frontend is already bundled and the routing data is stored inside `backend/data/export`, no extra storage or Node build step is required on Render.

## API endpoints

- `GET /api/health`
- `GET /api/meta`
- `POST /api/routes`

Example request:

```json
{
  "start": { "lat": 59.41, "lon": 56.79 },
  "end": { "lat": 59.40, "lon": 56.83 },
  "mode": "green",
  "include_alternatives": true
}
```

## Notes

- `balanced` mode maps to available balanced-like weight key in this order: `w_balanced_v11`, `w_balanced`, `w_accessible`, `weight`, `w_short`.
- Proxy metrics (`avg_noise`, `avg_green`) are best-effort and depend on available edge attributes in your graph.
- No auth, DB, Docker, or enterprise layers are added by design.
