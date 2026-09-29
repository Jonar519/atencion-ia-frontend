/**
 * Decide qué hace el Service Worker con cada petición (función pura, probada
 * en tests/serviceWorker.test.js; el SW la usa tal cual).
 *
 *  - "network": NO se intercepta. Toda la API (/api/…), el WebSocket (/ws),
 *    otros orígenes y cualquier método que no sea GET. Las conversaciones de
 *    los clientes son datos personales: jamás se guardan en Cache Storage.
 *  - "shell": navegaciones (la app es una SPA con router por hash) → index.html
 *    en caché con revalidación en segundo plano; sin red y sin caché, offline.html.
 *  - "cache-first": /assets/* (nombre con hash de contenido: inmutable).
 *  - "network-first": el resto de archivos propios (favicon, offline.html).
 */
export function strategyFor({ url, method = "GET", mode = "cors" }, origin) {
  const target = new URL(url);
  if (method !== "GET") return "network";
  if (target.origin !== origin) return "network";
  if (target.pathname.startsWith("/api/") || target.pathname === "/api" || target.pathname.startsWith("/ws"))
    return "network";
  if (mode === "navigate") return "shell";
  if (target.pathname.startsWith("/assets/")) return "cache-first";
  return "network-first";
}
