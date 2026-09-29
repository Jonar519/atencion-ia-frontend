/**
 * Service Worker (se emite como /service-worker.js en el build: scripts/sw-build.js
 * completa el id del build y la lista real de archivos a precachear).
 *
 * Qué hace de verdad:
 *  - La app abre SIN red: shell y assets precacheados al instalar; si no hay
 *    conexión se ve la app (con el aviso de "Reconectando…") o offline.html.
 *  - Una versión nueva se activa sola en la siguiente carga, y las cachés de
 *    builds anteriores se borran al activarse.
 *  - NUNCA toca la API ni el WebSocket (strategy.js): los mensajes de los
 *    clientes no se guardan en el navegador.
 */
import { strategyFor } from "./strategy.js";

const BUILD_ID = "__BUILD_ID__";
const PRECACHE_URLS = __PRECACHE_URLS__;
const CACHE_PREFIX = "atencion-ia-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function shell(event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match("/index.html");
  const fresh = fetch("/index.html", { cache: "no-cache" })
    .then((response) => {
      if (response.ok) cache.put("/index.html", response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(fresh);
    return cached;
  }
  return (await fresh) || (await cache.match("/offline.html")) || Response.error();
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(request, { ignoreVary: true })) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const strategy = strategyFor({ url: request.url, method: request.method, mode: request.mode }, self.location.origin);
  if (strategy === "network") return; // sin respondWith: el navegador va directo a la red
  if (strategy === "shell") event.respondWith(shell(event));
  else if (strategy === "cache-first") event.respondWith(cacheFirst(request));
  else event.respondWith(networkFirst(request));
});
