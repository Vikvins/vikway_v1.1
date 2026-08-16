import L from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMapEvents,
} from "react-leaflet";


function MapClickHandler({ enabled, onClick }) {
  useMapEvents({
    click: (event) => {
      if (enabled) {
        onClick(event.latlng);
      }
    },
  });
  return null;
}

function stopRouteEvent(event) {
  if (event?.originalEvent) {
    L.DomEvent.stop(event.originalEvent);
  }
}

export function RouteMap({
  center,
  zoom,
  start,
  end,
  snapped,
  routes,
  isMobile,
  manualMode,
  onMapClick,
}) {
  return (
    <MapContainer center={center} zoom={zoom} zoomSnap={0.5} className="map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapClickHandler onClick={onMapClick} enabled={manualMode} />

      {start ? (
        <CircleMarker center={[start.lat, start.lon]} radius={7} pathOptions={{ color: "#1565c0" }}>
          <Tooltip direction="top" offset={[0, -6]} opacity={1}>
            Старт
          </Tooltip>
        </CircleMarker>
      ) : null}

      {end ? (
        <CircleMarker center={[end.lat, end.lon]} radius={7} pathOptions={{ color: "#d32f2f" }}>
          <Tooltip direction="top" offset={[0, -6]} opacity={1}>
            Финиш
          </Tooltip>
        </CircleMarker>
      ) : null}

      {snapped.start ? (
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
          {start ? (
            <Polyline
              positions={[
                [start.lat, start.lon],
                [snapped.start.lat, snapped.start.lon],
              ]}
              pathOptions={{ color: "#1565c0", weight: 3, opacity: 0.7, dashArray: "6 8" }}
            >
              <Tooltip>Привязка старта к дорожному графу</Tooltip>
            </Polyline>
          ) : null}
        </>
      ) : null}

      {snapped.end ? (
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
          {end ? (
            <Polyline
              positions={[
                [end.lat, end.lon],
                [snapped.end.lat, snapped.end.lon],
              ]}
              pathOptions={{ color: "#d32f2f", weight: 3, opacity: 0.7, dashArray: "6 8" }}
            >
              <Tooltip>Привязка финиша к дорожному графу</Tooltip>
            </Polyline>
          ) : null}
        </>
      ) : null}

      {routes.map((route) => (
        <Polyline
          key={route.id}
          positions={route.coordinates}
          pathOptions={{
            color: route.color,
            weight: route.selected ? 6 : 4,
            opacity: route.selected ? 1 : 0.9,
          }}
          eventHandlers={{
            click: stopRouteEvent,
            mousedown: stopRouteEvent,
            touchstart: stopRouteEvent,
          }}
        >
          <Tooltip
            permanent
            direction="center"
            className={isMobile ? "route-tooltip-mobile" : ""}
          >
            {route.label}
          </Tooltip>
        </Polyline>
      ))}
    </MapContainer>
  );
}
