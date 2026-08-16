import { useEffect, useMemo, useRef, useState } from "react";
import { buildRoutes } from "./api";
import { RouteMap } from "./components/RouteMap";
import { DesktopResults, MobileResults } from "./components/RouteResults";
import { DEMO_SCENARIOS, MAP_VIEW } from "./constants";
import { useIsMobile } from "./hooks/useIsMobile";

export default function App() {
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [viewMode, setViewMode] = useState(null);
  const [demoScenario, setDemoScenario] = useState(null);
  const [pickTarget, setPickTarget] = useState("start");
  const [routes, setRoutes] = useState([]);
  const [snapped, setSnapped] = useState({ start: null, end: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mobileResultsExpanded, setMobileResultsExpanded] = useState(true);
  const isMobile = useIsMobile();
  const pendingScrollTopRef = useRef(null);

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

  const defaultCenter = useMemo(
    () => (isMobile ? MAP_VIEW.mobile.center : MAP_VIEW.desktop.center),
    [isMobile],
  );
  const defaultZoom = isMobile ? MAP_VIEW.mobile.zoom : MAP_VIEW.desktop.zoom;

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

  const runRouteBuild = async ({ nextStart, nextEnd, nextMode }) => {
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
        include_alternatives: true,
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
      setError("Выберите точки старта и финиша на карте");
      return;
    }

    await runRouteBuild({
      nextStart: start,
      nextEnd: end,
      nextMode: "shortest",
    });
  };

  const handleRunDemo = async (scenario) => {
    setViewMode("demo");
    setDemoScenario(scenario.value);
    setStart(scenario.start);
    setEnd(scenario.end);
    setPickTarget("start");

    await runRouteBuild({
      nextStart: scenario.start,
      nextEnd: scenario.end,
      nextMode: scenario.mode,
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
        <p className="subtitle">Цифровой сервис комфортных пешеходных маршрутов</p>

        <div className="entry-switch">
          <button
            type="button"
            className={viewMode === "manual" ? "entry-card active" : "entry-card"}
            onClick={handleActivateManualMode}
          >
            <strong>Ручной режим</strong>
            <span>Постройте маршрут сами — выберите нужные точки на карте</span>
          </button>

          <button
            type="button"
            className={viewMode === "demo" ? "entry-card active" : "entry-card"}
            onClick={handleActivateDemoMode}
          >
            <strong>Демо-сценарии</strong>
            <span>Готовые маршруты для быстрого знакомства с сервисом</span>
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

            <div className="control-block inline">
              <button type="button" className="ghost" onClick={clearSelection}>
                Очистить
              </button>
            </div>
          </>
        ) : null}

        {viewMode === "manual" ? (
          <>
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

            <div className="control-block inline">
              <button type="button" onClick={handleBuildRoutes} disabled={loading}>
                {loading ? "Строю..." : "Построить маршрут"}
              </button>
              <button type="button" className="ghost" onClick={clearSelection}>
                Очистить
              </button>
            </div>

          </>
        ) : null}

        {error && <p className="error">{error}</p>}

        {routes.length > 0 ? (
          <section className="sidebar-results desktop-results">
            <DesktopResults routes={routes} />
          </section>
        ) : null}
      </aside>

      <main className="map-area">
        <section className="panel-section map-section">
          <div className="section-header">
            <h2>Карта маршрутов</h2>
          </div>
          <div className="map-frame">
            <RouteMap
              center={defaultCenter}
              zoom={defaultZoom}
              start={start}
              end={end}
              snapped={snapped}
              routes={routes}
              isMobile={isMobile}
              manualMode={viewMode === "manual"}
              onMapClick={handleMapClick}
            />
          </div>
        </section>

        {isMobile && routes.length > 0 ? (
          <MobileResults
            routes={routes}
            expanded={mobileResultsExpanded}
            onToggle={() => setMobileResultsExpanded((value) => !value)}
          />
        ) : null}
      </main>
    </div>
  );
}
