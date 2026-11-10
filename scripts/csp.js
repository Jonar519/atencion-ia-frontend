import { normalizeApiUrl, webSocketOrigin } from "../src/api/apiOrigin.js";

/**
 * Content-Security-Policy del build (función pura: la usan vite.config.js y
 * tests/apiOrigin.test.js). La API y sus WebSockets están en OTRO origen
 * (VITE_API_URL): connect-src permite 'self' y SOLO ese origen, en https y en
 * wss (http y ws en local). Ningún script, estilo o conexión a terceros. Sin
 * 'unsafe-inline': todo el JS y el CSS vienen de archivos.
 * (frame-ancestors no vale en <meta>: lo pone vercel.json como cabecera.)
 */
export function buildCsp(apiOrigin) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    // blob: el avatar (se pide con el token y se muestra con un URL local) y el recorte antes de subirlo.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin} ${webSocketOrigin(apiOrigin)}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Origen de la API para el build. En Vercel (VERCEL=1) es OBLIGATORIO y https:
 * un build de producción sin VITE_API_URL apuntaría en silencio a localhost.
 */
export function resolveApiOrigin(rawApiUrl, { onVercel = false } = {}) {
  if (onVercel && !rawApiUrl) throw new Error("Falta VITE_API_URL en las variables de entorno de Vercel");
  const origin = normalizeApiUrl(rawApiUrl);
  if (onVercel && !origin.startsWith("https://")) throw new Error(`VITE_API_URL debe ser https en Vercel: ${origin}`);
  return origin;
}
