import { normalizeApiUrl, webSocketOrigin } from "./apiOrigin.js";

/**
 * URLs absolutas hacia la API, a partir de VITE_API_URL (fijada en el build).
 * Ninguna se arma con location.host: la página y la API están en orígenes distintos.
 */
export const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL);

/** "/api/…" → "https://api…/api/…". */
export function apiUrl(path, origin = API_URL) {
  return `${origin}${path}`;
}

/** "/ws" → "wss://api…/ws". */
export function wsUrl(path, origin = API_URL) {
  return `${webSocketOrigin(origin)}${path}`;
}
