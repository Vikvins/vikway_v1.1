import { formatGreen, formatMeters, formatMinutes, formatNoise } from "../formatters";


function ResultsCards({ routes }) {
  if (routes.length === 0) {
    return (
      <p className="section-empty">
        Постройте маршрут, чтобы сравнить варианты по длине, шуму и озеленению
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

export function DesktopResults({ routes }) {
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

export function MobileResults({ routes, expanded, onToggle }) {
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
