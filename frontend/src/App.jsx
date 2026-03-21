import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMapEvents,
} from "react-leaflet";
import { buildRoutes, fetchMeta } from "./api";

const MODE_OPTIONS = [
  { value: "shortest", label: "Кратчайший" },
  { value: "quiet", label: "Тихий" },
  { value: "green", label: "Зеленый" },
  { value: "balanced", label: "Сбалансированный" },
];

function MapClickHandler({ onClick }) {
  useMapEvents({
    click: (event) => {
      onClick(event.latlng);
    },
  });
  return null;
}

function formatMeters(lengthM) {
  if (lengthM >= 1000) {
    return `${(lengthM / 1000).toFixed(2)} км`;
  }
  return `${Math.round(lengthM)} м`;
}

function formatMinutes(value) {
  const totalMinutes = Math.max(0, Math.round(value));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} мин`;
  }
  if (minutes === 0) {
    return `${hours} ч`;
  }
  return `${hours} ч ${minutes} мин`;
}

function formatNoise(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "н/д";
  }
  return `${value.toFixed(1)} дБА`;
}

function formatGreen(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "н/д";
  }
  const percent = Math.max(0, Math.min(1, value)) * 100;
  return `${percent.toFixed(2)}%`;
}

export default function App() {
  const [meta, setMeta] = useState(null);
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [mode, setMode] = useState("shortest");
  const [pickTarget, setPickTarget] = useState("start");
  const [includeAlternatives, setIncludeAlternatives] = useState(true);
  const [routes, setRoutes] = useState([]);
  const [snapped, setSnapped] = useState({ start: null, end: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchMeta()
      .then((data) => {
        setMeta(data);
      })
      .catch((err) => {
        setError(err.message);
      });
  }, []);

  const center = useMemo(() => {
    if (!meta) return [59.4, 56.8];
    return [meta.center.lat, meta.center.lon];
  }, [meta]);

  const handleMapClick = ({ lat, lng }) => {
    setError("");
    const nextPoint = { lat, lon: lng };

    if (start && end) {
      setRoutes([]);
      setSnapped({ start: null, end: null });
      setStart(nextPoint);
      setEnd(null);
      setPickTarget("end");
      return;
    }

    setRoutes([]);
    setSnapped({ start: null, end: null });
    if (pickTarget === "start") {
      setStart(nextPoint);
      setPickTarget("end");
      return;
    }
    setEnd(nextPoint);
    setPickTarget("start");
  };

  const handleBuildRoutes = async () => {
    if (!start || !end) {
      setError("Выберите точки старта и финиша на карте.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await buildRoutes({
        start,
        end,
        mode,
        include_alternatives: includeAlternatives,
      });
      setRoutes(response.routes ?? []);
      setSnapped({ start: response.snapped_start, end: response.snapped_end });
    } catch (err) {
      setError(String(err.message || err));
      setRoutes([]);
      setSnapped({ start: null, end: null });
    } finally {
      setLoading(false);
    }
  };

  const clearSelection = () => {
    setStart(null);
    setEnd(null);
    setRoutes([]);
    setSnapped({ start: null, end: null });
    setError("");
    setPickTarget("start");
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>VikWay</h1>
        <p className="subtitle">Цифровой сервис комфортных пешеходных маршрутов</p>

        <div className="control-block">
          <label>Режим маршрута</label>
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="control-block inline">
          <button
            type="button"
            className={pickTarget === "start" ? "ghost active" : "ghost"}
            onClick={() => setPickTarget("start")}
          >
            Выбрать старт
          </button>
          <button
            type="button"
            className={pickTarget === "end" ? "ghost active" : "ghost"}
            onClick={() => setPickTarget("end")}
          >
            Выбрать финиш
          </button>
        </div>

        <div className="control-block checkbox">
          <input
            id="alts"
            type="checkbox"
            checked={includeAlternatives}
            onChange={(event) => setIncludeAlternatives(event.target.checked)}
          />
          <label htmlFor="alts">Показать альтернативы</label>
        </div>

        <div className="control-block inline">
          <button type="button" onClick={handleBuildRoutes} disabled={loading}>
            {loading ? "Строю..." : "Построить маршрут"}
          </button>
          <button type="button" className="ghost" onClick={clearSelection}>
            Очистить
          </button>
        </div>

        <div className="points-info">
          <p>
            <strong>Старт:</strong> {start ? `${start.lat.toFixed(5)}, ${start.lon.toFixed(5)}` : "не задан"}
          </p>
          <p>
            <strong>Финиш:</strong> {end ? `${end.lat.toFixed(5)}, ${end.lon.toFixed(5)}` : "не задан"}
          </p>
        </div>

        {error && <p className="error">{error}</p>}

        <section className="sidebar-results">
          <div className="section-header">
            <h2>Найденные маршруты</h2>
            {routes.length > 0 ? <span className="section-badge">{routes.length}</span> : null}
          </div>
          {routes.length > 0 ? (
            <div className="routes-list routes-list-sidebar">
              {routes.map((route) => (
                <article key={route.id} className={route.selected ? "route-card selected" : "route-card"}>
                  <h3>{route.label}</h3>
                  <p>Длина: {formatMeters(route.length_m)}</p>
                  <p>Время: {formatMinutes(route.eta_min)}</p>
                  <p>Шум: {formatNoise(route.avg_noise)}</p>
                  <p>Озеленение: {formatGreen(route.avg_green)}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="section-empty">Постройте маршрут, чтобы сравнить варианты по длине, шуму и озеленению.</p>
          )}
        </section>
      </aside>

      <main className="map-area">
        <section className="panel-section map-section">
          <div className="section-header">
            <h2>Карта маршрутов</h2>
          </div>
          <div className="map-frame">
            <MapContainer center={center} zoom={12} className="map">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <MapClickHandler onClick={handleMapClick} />

              {start && (
                <CircleMarker center={[start.lat, start.lon]} radius={7} pathOptions={{ color: "#1565c0" }}>
                  <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                    Старт
                  </Tooltip>
                </CircleMarker>
              )}

              {end && (
                <CircleMarker center={[end.lat, end.lon]} radius={7} pathOptions={{ color: "#d32f2f" }}>
                  <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                    Финиш
                  </Tooltip>
                </CircleMarker>
              )}

              {snapped.start && (
                <>
                  <CircleMarker
                    center={[snapped.start.lat, snapped.start.lon]}
                    radius={5}
                    pathOptions={{ color: "#1565c0", fillOpacity: 0.5 }}
                  >
                    <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                      Привязка к графу
                    </Tooltip>
                  </CircleMarker>
                  {start && (
                    <Polyline
                      positions={[
                        [start.lat, start.lon],
                        [snapped.start.lat, snapped.start.lon],
                      ]}
                      pathOptions={{
                        color: "#1565c0",
                        weight: 3,
                        opacity: 0.7,
                        dashArray: "6 8",
                      }}
                    >
                      <Tooltip>Привязка старта к дорожному графу</Tooltip>
                    </Polyline>
                  )}
                </>
              )}

              {snapped.end && (
                <>
                  <CircleMarker
                    center={[snapped.end.lat, snapped.end.lon]}
                    radius={5}
                    pathOptions={{ color: "#d32f2f", fillOpacity: 0.5 }}
                  >
                    <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                      Привязка к графу
                    </Tooltip>
                  </CircleMarker>
                  {end && (
                    <Polyline
                      positions={[
                        [end.lat, end.lon],
                        [snapped.end.lat, snapped.end.lon],
                      ]}
                      pathOptions={{
                        color: "#d32f2f",
                        weight: 3,
                        opacity: 0.7,
                        dashArray: "6 8",
                      }}
                    >
                      <Tooltip>Привязка финиша к дорожному графу</Tooltip>
                    </Polyline>
                  )}
                </>
              )}

              {routes.map((route) => (
                <Polyline
                  key={route.id}
                  positions={route.coordinates}
                  pathOptions={{
                    color: route.color,
                    weight: route.selected ? 6 : 4,
                    opacity: route.selected ? 1.0 : 0.9,
                  }}
                >
                  <Tooltip>{route.label}</Tooltip>
                </Polyline>
              ))}
            </MapContainer>
          </div>
        </section>
      </main>
    </div>
  );
}
