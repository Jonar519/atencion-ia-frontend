/**
 * Genera el código final del Service Worker a partir de src/sw/service-worker.js
 * (función pura: la usa vite.config.js y la prueba tests/serviceWorker.test.js).
 *
 * Se reemplazan las DECLARACIONES exactas, no "la primera aparición" de un
 * marcador: en un primer intento la lista de archivos terminó dentro de un
 * comentario que mencionaba el marcador, y el SW fallaba al cargar
 * ("__PRECACHE_URLS__ is not defined"). Si una declaración no está, se lanza
 * un error y el build falla, en vez de publicar un SW roto.
 *
 * @param {{ swSource: string, strategySource: string, buildId: string, precacheUrls: string[] }} input
 */
export function buildServiceWorkerSource({ swSource, strategySource, buildId, precacheUrls }) {
  const replacements = [
    ['import { strategyFor } from "./strategy.js";', strategySource.replace(/^export /m, "")],
    ['const BUILD_ID = "__BUILD_ID__";', `const BUILD_ID = ${JSON.stringify(buildId)};`],
    ["const PRECACHE_URLS = __PRECACHE_URLS__;", `const PRECACHE_URLS = ${JSON.stringify(precacheUrls)};`],
  ];
  let source = swSource;
  for (const [declaration, replacement] of replacements) {
    const occurrences = source.split(declaration).length - 1;
    if (occurrences !== 1) {
      throw new Error(`service-worker.js debe contener exactamente una vez: ${declaration} (hay ${occurrences})`);
    }
    source = source.replace(declaration, () => replacement);
  }
  return source;
}
