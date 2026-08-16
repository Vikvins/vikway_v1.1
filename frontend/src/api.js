const envApiBase = import.meta.env.VITE_API_BASE_URL;
const API_BASE = envApiBase && envApiBase.trim().length > 0 ? envApiBase : "";

export async function buildRoutes(payload) {
  const response = await fetch(`${API_BASE}/api/routes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Не удалось построить маршрут: ${response.status}`);
  }

  return response.json();
}
