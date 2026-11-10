/**
 * Origen de la API (función pura: la usan el navegador, vite.config.js para la
 * CSP y los tests). En producción la app y la API viven en orígenes distintos
 * del mismo sitio (atencion.<dominio> y api-atencion.<dominio>): la cookie de
 * sesión es SameSite=Strict y viaja porque ambos comparten el dominio padre.
 *
 * VITE_API_URL debe ser SOLO un origen (esquema + host + puerto opcional), sin
 * ruta, query ni fragmento: las rutas (/api/…, /ws, /ws/voice) las agrega el
 * código. Vacío = la API de desarrollo.
 */
export const DEFAULT_API_URL = "http://localhost:4100";

export function normalizeApiUrl(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return DEFAULT_API_URL;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`VITE_API_URL no es una URL válida: "${value}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`VITE_API_URL debe empezar por https:// (o http:// en local): "${value}"`);
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error(
      `VITE_API_URL debe ser solo el origen, sin ruta ni query (p. ej. https://api.example.com): "${value}"`
    );
  }
  return url.origin;
}

/** Origen del WebSocket para ese origen de API: https → wss, http → ws. */
export function webSocketOrigin(apiOrigin) {
  const url = new URL(apiOrigin);
  return `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
}
