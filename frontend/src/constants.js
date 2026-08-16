export const DEMO_SCENARIOS = [
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

export const MAP_VIEW = {
  desktop: {
    center: [59.4097, 56.8042],
    zoom: 13,
  },
  mobile: {
    center: [59.4065, 56.799],
    zoom: 12.5,
  },
};
