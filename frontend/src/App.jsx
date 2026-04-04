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
  { value: "shortest", label: "РљСЂР°С‚С‡Р°Р№С€РёР№" },
  { value: "quiet", label: "РўРёС…РёР№" },
  { value: "green", label: "Р—РµР»РµРЅС‹Р№" },
  { value: "balanced", label: "РЎР±Р°Р»Р°РЅСЃРёСЂРѕРІР°РЅРЅС‹Р№" },
];

const DEMO_SCENARIOS = [
  {
    value: "contrast-routes",
    label: "Контраст маршрутов",
    description: "Сравнение кратчайшего, тихого и зелёного маршрутов",
    mode: "green",
    start: { lat: 59.39882, lon: 56.78425 },
    end: { lat: 59.40616, lon: 56.80305 },
  },
  {
    value: "green-showcase",
    label: "Больше зелени",
    description: "Маршрут проходит через более зелёные и спокойные зоны города",
    mode: "green",
    start: { lat: 59.40062, lon: 56.81388 },
    end: { lat: 59.41345, lon: 56.79043 },
  },
  {
    value: "quiet-showcase",
    label: "Меньше шума",
    description: "Маршрут проходит по более тихим улицам с меньшим уровнем шума",
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
    return `${(lengthM / 1000).toFixed(2)} РєРј`;
  }
  return `${Math.round(lengthM)} Рј`;
}

function formatMinutes(value) {
  const totalMinutes = Math.max(0, Math.round(value));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} РјРёРЅ`;
  }
  if (minutes === 0) {
    return `${hours} С‡`;
  }
  return `${hours} С‡ ${minutes} РјРёРЅ`;
}

function formatNoise(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "РЅ/Рґ";
  }
  return `${value.toFixed(1)} РґР‘Рђ`;
}

function formatGreen(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "РЅ/Рґ";
  }
  const percent = Math.max(0, Math.min(1, value)) * 100;
  return `${percent.toFixed(2)}%`;
}

function ResultsCards({ routes }) {
  if (routes.length === 0) {
    return (
      <p className="section-empty">
        РџРѕСЃС‚СЂРѕР№С‚Рµ РјР°СЂС€СЂСѓС‚, С‡С‚РѕР±С‹ СЃСЂР°РІРЅРёС‚СЊ РІР°СЂРёР°РЅС‚С‹ РїРѕ РґР»РёРЅРµ, С€СѓРјСѓ Рё РѕР·РµР»РµРЅРµРЅРёСЋ.
      </p>
    );
  }

  return (
    <div className="routes-list routes-list-sidebar">
      {routes.map((route) => (
        <article key={route.id} className={route.selected ? "route-card selected" : "route-card"}>
          <h3>{route.label}</h3>
          <p>Р”Р»РёРЅР°: {formatMeters(route.length_m)}</p>
          <p>Р’СЂРµРјСЏ: {formatMinutes(route.eta_min)}</p>
          <p>РЁСѓРј: {formatNoise(route.avg_noise)}</p>
          <p>РћР·РµР»РµРЅРµРЅРёРµ: {formatGreen(route.avg_green)}</p>
        </article>
      ))}
    </div>
  );
}

function DesktopResultsSection({ routes }) {
  return (
    <>
      <div className="section-header">
        <h2>РќР°Р№РґРµРЅРЅС‹Рµ РјР°СЂС€СЂСѓС‚С‹</h2>
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
        <span className="mobile-results-title">РќР°Р№РґРµРЅРЅС‹Рµ РјР°СЂС€СЂСѓС‚С‹</span>
        <span className="mobile-results-actions">
          <span className="section-badge">{routes.length}</span>
          <span className={expanded ? "mobile-chevron expanded" : "mobile-chevron"} aria-hidden="true">
            в–ѕ
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
      setError("Р’С‹Р±РµСЂРёС‚Рµ С‚РѕС‡РєРё СЃС‚Р°СЂС‚Р° Рё С„РёРЅРёС€Р° РЅР° РєР°СЂС‚Рµ.");
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

  const handleActivateManualMode = () => {
    clearSelection();
    setViewMode("manual");
    setDemoScenario(null);
  };

  const handleActivateDemoMode = () => {
    clearSelection();
    setViewMode("demo");
    setDemoScenario(null);
  };

  const clearSelection = () => {
    setStart(null);
    setEnd(null);
    setRoutes([]);
    setSnapped({ start: null, end: null });
    setError("");
    setPickTarget("start");
    setMobileResultsExpanded(true);
    setDemoScenario(null);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>VikWay</h1>
        <p className="subtitle">Р¦РёС„СЂРѕРІРѕР№ СЃРµСЂРІРёСЃ РєРѕРјС„РѕСЂС‚РЅС‹С… РїРµС€РµС…РѕРґРЅС‹С… РјР°СЂС€СЂСѓС‚РѕРІ</p>

        <div className="entry-switch">
          <button
            type="button"
            className={viewMode === "manual" ? "entry-card active" : "entry-card"}
            onClick={handleActivateManualMode}
          >
            <strong>Р СѓС‡РЅРѕР№ СЂРµР¶РёРј</strong>
            <span>Постройте маршрут сами — выберите нужные точки на карте</span>
          </button>

          <button
            type="button"
            className={viewMode === "demo" ? "entry-card active" : "entry-card"}
            onClick={handleActivateDemoMode}
          >
            <strong>Р”РµРјРѕ-СЃС†РµРЅР°СЂРёРё</strong>
            <span>Готовые маршруты для быстрого знакомства с сервисом</span>
          </button>
        </div>

        {viewMode === "demo" ? (
          <>
            <div className="section-divider" aria-hidden="true" />
            <div className="subsection-header">
              <h2>Р’С‹Р±РµСЂРёС‚Рµ РґРµРјРѕ-СЃС†РµРЅР°СЂРёР№</h2>
              <p>РќР°Р¶РјРёС‚Рµ РЅР° РѕРґРёРЅ РёР· РіРѕС‚РѕРІС‹С… РјР°СЂС€СЂСѓС‚РѕРІ, С‡С‚РѕР±С‹ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїРѕРєР°Р·Р°С‚СЊ СЂР°Р±РѕС‚Сѓ СЃРµСЂРІРёСЃР°</p>
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
                <strong>РЎС‚Р°СЂС‚:</strong>{" "}
                {start ? `${start.lat.toFixed(5)}, ${start.lon.toFixed(5)}` : "РЅРµ Р·Р°РґР°РЅ"}
              </p>
              <p>
                <strong>Р¤РёРЅРёС€:</strong>{" "}
                {end ? `${end.lat.toFixed(5)}, ${end.lon.toFixed(5)}` : "РЅРµ Р·Р°РґР°РЅ"}
              </p>
            </div>

            <div className="control-block inline">
              <button type="button" className="ghost" onClick={clearSelection}>
                РћС‡РёСЃС‚РёС‚СЊ
              </button>
            </div>
          </>
        ) : null}

        {viewMode === "manual" ? (
          <>
            <div className="control-block">
              <label>Р РµР¶РёРј РјР°СЂС€СЂСѓС‚Р°</label>
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
                Р’С‹Р±СЂР°С‚СЊ СЃС‚Р°СЂС‚
              </button>
              <button
                type="button"
                className={pickTarget === "end" ? "ghost active" : "ghost"}
                onClick={() => setPickTarget("end")}
              >
                Р’С‹Р±СЂР°С‚СЊ С„РёРЅРёС€
              </button>
            </div>

            <div className="control-block checkbox">
              <input
                id="alts"
                type="checkbox"
                checked={includeAlternatives}
                onChange={(event) => setIncludeAlternatives(event.target.checked)}
              />
              <label htmlFor="alts">РџРѕРєР°Р·Р°С‚СЊ Р°Р»СЊС‚РµСЂРЅР°С‚РёРІС‹</label>
            </div>

            <div className="control-block inline">
              <button type="button" onClick={handleBuildRoutes} disabled={loading}>
                {loading ? "РЎС‚СЂРѕСЋ..." : "РџРѕСЃС‚СЂРѕРёС‚СЊ РјР°СЂС€СЂСѓС‚"}
              </button>
              <button type="button" className="ghost" onClick={clearSelection}>
                РћС‡РёСЃС‚РёС‚СЊ
              </button>
            </div>

            <div className="points-info">
              <p>
                <strong>РЎС‚Р°СЂС‚:</strong>{" "}
                {start ? `${start.lat.toFixed(5)}, ${start.lon.toFixed(5)}` : "РЅРµ Р·Р°РґР°РЅ"}
              </p>
              <p>
                <strong>Р¤РёРЅРёС€:</strong>{" "}
                {end ? `${end.lat.toFixed(5)}, ${end.lon.toFixed(5)}` : "РЅРµ Р·Р°РґР°РЅ"}
              </p>
            </div>
          </>
        ) : null}

        {error && <p className="error">{error}</p>}

        {routes.length > 0 ? (
          <section className="sidebar-results desktop-results">
            <DesktopResultsSection routes={routes} />
          </section>
        ) : null}
      </aside>

      <main className="map-area">
        <section className="panel-section map-section">
          <div className="section-header">
            <h2>РљР°СЂС‚Р° РјР°СЂС€СЂСѓС‚РѕРІ</h2>
          </div>
          <div className="map-frame">
            <MapContainer center={center} zoom={14} className="map">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <MapClickHandler onClick={handleMapClick} enabled={viewMode === "manual"} />

              {start && (
                <CircleMarker center={[start.lat, start.lon]} radius={7} pathOptions={{ color: "#1565c0" }}>
                  <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                    РЎС‚Р°СЂС‚
                  </Tooltip>
                </CircleMarker>
              )}

              {end && (
                <CircleMarker center={[end.lat, end.lon]} radius={7} pathOptions={{ color: "#d32f2f" }}>
                  <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                    Р¤РёРЅРёС€
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
                      РџСЂРёРІСЏР·РєР° Рє РіСЂР°С„Сѓ
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
                      <Tooltip>РџСЂРёРІСЏР·РєР° СЃС‚Р°СЂС‚Р° Рє РґРѕСЂРѕР¶РЅРѕРјСѓ РіСЂР°С„Сѓ</Tooltip>
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
                      РџСЂРёРІСЏР·РєР° Рє РіСЂР°С„Сѓ
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
                      <Tooltip>РџСЂРёРІСЏР·РєР° С„РёРЅРёС€Р° Рє РґРѕСЂРѕР¶РЅРѕРјСѓ РіСЂР°С„Сѓ</Tooltip>
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

        {isMobile && routes.length > 0 ? (
          <MobileResultsSection
            routes={routes}
            expanded={mobileResultsExpanded}
            onToggle={() => setMobileResultsExpanded((value) => !value)}
          />
        ) : null}
      </main>
    </div>
  );
}


