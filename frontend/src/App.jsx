import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
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

const DEMO_SCENARIOS = [
  {
    value: "contrast-routes",
    label: "Контраст маршрутов",
    description: "Показывает контраст между кратчайшим, тихим и зеленым маршрутами",
    mode: "green",
    start: { lat: 59.39882, lon: 56.78425 },
    end: { lat: 59.40616, lon: 56.80305 },
  },
  {
    value: "green-showcase",
    label: "Максимум озеленения",
    description: "Зеленый маршрут заметно выигрывает по озеленению по сравнению с кратчайшим",
    mode: "green",
    start: { lat: 59.40062, lon: 56.81388 },
    end: { lat: 59.41345, lon: 56.79043 },
  },
  {
    value: "quiet-showcase",
    label: "Тихий сценарий",
    description: "Тихий маршрут показывает более низкий шум, чем остальные варианты",
    mode: "quiet",
    start: { lat: 59.3986, lon: 56.77996 },
    end: { lat: 59.40603, lon: 56.81172 },
  },
];

function MapClickHandler({ onClick, enabled }) {
  useMapEvents({
    click: (event) => {
      if (!enabled) {
        return;
      }
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

function ResultsCards({ routes }) {
  if (routes.length === 0) {
    return (
      <p className="section-empty">
        Постройте маршрут, чтобы сравнить варианты по длине, шуму и озеленению.
      </p>
    );
  }

  return (
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
  );
}

function DesktopResultsSection({ routes }) {
  return (
    <>
      <div className="section-header">
        <h2>Найденные маршруты</h2>
        {routes.length > 0 ? <span className="section-badge">{routes.length}</span> : null}
      </div>
      <ResultsCards routes={routes} />
    </>
  );
}

function MobileResultsSection({ routes, expanded, onToggle }) {
  return (
    <section className="panel-section mobile-results-panel">
      <button type="button" className="mobile-results-toggle" onClick={onToggle}>
        <span className="mobile-results-title">Найденные маршруты</span>
        <span className="mobile-results-actions">
          <span className="section-badge">{routes.length}</span>
          <span className={expanded ? "mobile-chevron expanded" : "mobile-chevron"} aria-hidden="true">
            ▾
          </span>
        </span>
      </button>

      {expanded ? (
        <div className="mobile-results-body">
          <ResultsCards routes={routes} />
        </div>
      ) : null}
    </section>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(max-width: 720px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const media = window.matchMedia("(max-width: 720px)");
    const onChange = (event) => setIsMobile(event.matches);

    setIsMobile(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

function stopRouteEvent(event) {
  if (event?.originalEvent) {
    L.DomEvent.stop(event.originalEvent);
  }
}

export default function App() {
  const [meta, setMeta] = useState(null);
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [mode, setMode] = useState("shortest");
  const [viewMode, setViewMode] = useState(null);
  const [demoScenario, setDemoScenario] = useState(null);
  const [pickTarget, setPickTarget] = useState("start");
  const [includeAlternatives, setIncludeAlternatives] = useState(true);
  const [routes, setRoutes] = useState([]);
  const [snapped, setSnapped] = useState({ start: null, end: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mobileResultsExpanded, setMobileResultsExpanded] = useState(true);
  const isMobile = useIsMobile();
  const pendingScrollTopRef = useRef(null);

  useEffect(() => {
    fetchMeta()
      .then((data) => {
        setMeta(data);
      })
      .catch((err) => {
        setError(err.message);
      });
  }, []);

  useEffect(() => {
    if (loading || pendingScrollTopRef.current === null || typeof window === "undefined") {
      return;
    }

    const scrollTop = pendingScrollTopRef.current;
    pendingScrollTopRef.current = null;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollTop, behavior: "auto" });
      });
    });
  }, [loading, routes, snapped]);

  const center = useMemo(() => {
    if (!meta) return [59.4, 56.8];
    return [meta.center.lat, meta.center.lon];
  }, [meta]);

  const selectedDemo = useMemo(
    () => DEMO_SCENARIOS.find((scenario) => scenario.value === demoScenario) ?? null,
    [demoScenario],
  );

  const handleMapClick = ({ lat, lng }) => {
    if (viewMode !== "manual") {
      return;
    }

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

  const runRouteBuild = async ({ nextStart, nextEnd, nextMode, nextIncludeAlternatives }) => {
    if (typeof window !== "undefined") {
      pendingScrollTopRef.current = window.scrollY;
    }

    setLoading(true);
    setError("");
    try {
      const response = await buildRoutes({
        start: nextStart,
        end: nextEnd,
        mode: nextMode,
        include_alternatives: nextIncludeAlternatives,
      });
      setRoutes(response.routes ?? []);
      setSnapped({ start: response.snapped_start, end: response.snapped_end });
      if (isMobile) {
        setMobileResultsExpanded(false);
      }
    } catch (err) {
      setError(String(err.message || err));
      setRoutes([]);
      setSnapped({ start: null, end: null });
    } finally {
      setLoading(false);
    }
  };

  const handleBuildRoutes = async () => {
    if (!start || !end) {
      setError("Выберите точки старта и финиша на карте.");
      return;
    }

    await runRouteBuild({
      nextStart: start,
      nextEnd: end,
      nextMode: mode,
      nextIncludeAlternatives: includeAlternatives,
    });
  };

  const handleRunDemo = async (scenario) => {
    setViewMode("demo");
    setDemoScenario(scenario.value);
    setStart(scenario.start);
    setEnd(scenario.end);
    setMode(scenario.mode);
    setPickTarget("start");
    setIncludeAlternatives(true);

    await runRouteBuild({
      nextStart: scenario.start,
      nextEnd: scenario.end,
      nextMode: scenario.mode,
      nextIncludeAlternatives: true,
    });
  };

  const clearSelection = () => {
    setStart(null);
    setEnd(null);
    setRoutes([]);
    setSnapped({ start: null, end: null });
    setError("");
    setPickTarget("start");
    setMobileResultsExpanded(true);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>VikWay</h1>
        <p className="subtitle">Цифровой сервис комфортных пешеходных маршрутов</p>

        <div className="entry-switch">
          <button
            type="button"
            className={viewMode === "manual" ? "entry-card active" : "entry-card"}
            onClick={() => setViewMode("manual")}
          >
            <strong>Ручной режим</strong>
            <span>Выбирайте точки на карте и стройте маршрут самостоятельно</span>
          </button>

          <button
            type="button"
            className={viewMode === "demo" ? "entry-card active" : "entry-card"}
            onClick={() => setViewMode("demo")}
          >
            <strong>Демо-сценарии</strong>
            <span>Запускайте заранее подготовленные кейсы для показа сервиса</span>
          </button>
        </div>

        {viewMode === "demo" ? (
          <>
            <div className="section-divider" aria-hidden="true" />
            <div className="subsection-header">
              <h2>Выберите демо-сценарий</h2>
              <p>Нажмите на один из готовых маршрутов, чтобы автоматически показать работу сервиса</p>
            </div>
            <div className="demo-scenarios">
              {DEMO_SCENARIOS.map((scenario) => (
                <button
                  key={scenario.value}
                  type="button"
                  className={
                    selectedDemo?.value === scenario.value
                      ? `scenario-card active ${scenario.value}`
                      : `scenario-card ${scenario.value}`
                  }
                  onClick={() => handleRunDemo(scenario)}
                  disabled={loading}
                >
                  <strong>{scenario.label}</strong>
                  <span>{scenario.description}</span>
                </button>
              ))}
            </div>

            <div className="points-info">
              <p>
                <strong>Старт:</strong>{" "}
                {start ? `${start.lat.toFixed(5)}, ${start.lon.toFixed(5)}` : "не задан"}
              </p>
              <p>
                <strong>Финиш:</strong>{" "}
                {end ? `${end.lat.toFixed(5)}, ${end.lon.toFixed(5)}` : "не задан"}
              </p>
            </div>

            <div className="control-block inline">
              <button type="button" className="ghost" onClick={clearSelection}>
                Очистить
              </button>
            </div>
          </>
        ) : null}

        {viewMode === "manual" ? (
          <>
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
                <strong>Старт:</strong>{" "}
                {start ? `${start.lat.toFixed(5)}, ${start.lon.toFixed(5)}` : "не задан"}
              </p>
              <p>
                <strong>Финиш:</strong>{" "}
                {end ? `${end.lat.toFixed(5)}, ${end.lon.toFixed(5)}` : "не задан"}
              </p>
            </div>
          </>
        ) : null}

        {error && <p className="error">{error}</p>}

        <section className="sidebar-results desktop-results">
          <DesktopResultsSection routes={routes} />
        </section>
      </aside>

      <main className="map-area">
        {isMobile ? (
          <MobileResultsSection
            routes={routes}
            expanded={mobileResultsExpanded}
            onToggle={() => setMobileResultsExpanded((value) => !value)}
          />
        ) : null}

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

              <MapClickHandler onClick={handleMapClick} enabled={viewMode === "manual"} />

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
                  eventHandlers={{
                    click: stopRouteEvent,
                    mousedown: stopRouteEvent,
                    touchstart: stopRouteEvent,
                  }}
                >
                  <Tooltip
                    permanent={isMobile}
                    sticky={!isMobile}
                    direction="center"
                    className={isMobile ? "route-tooltip-mobile" : ""}
                  >
                    {route.label}
                  </Tooltip>
                </Polyline>
              ))}
            </MapContainer>
          </div>
        </section>

        <section className="panel-section mobile-results">
          <div className="mobile-results-inner">
            <DesktopResultsSection routes={routes} />
          </div>
        </section>
      </main>
    </div>
  );
}
