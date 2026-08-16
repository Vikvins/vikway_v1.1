export function formatMeters(lengthM) {
  if (lengthM >= 1000) {
    return `${(lengthM / 1000).toFixed(2)} км`;
  }
  return `${Math.round(lengthM)} м`;
}

export function formatMinutes(value) {
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

export function formatNoise(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "н/д";
  }
  return `${value.toFixed(1)} дБА`;
}

export function formatGreen(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "н/д";
  }
  const percent = Math.max(0, Math.min(1, value)) * 100;
  return `${percent.toFixed(2)}%`;
}
