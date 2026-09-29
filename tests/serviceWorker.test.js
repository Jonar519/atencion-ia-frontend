import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { strategyFor } from "../src/sw/strategy.js";
import { buildServiceWorkerSource } from "../scripts/sw-build.js";

const ORIGIN = "http://localhost:5174";

describe("Service Worker: qué intercepta", () => {
  it.each([
    ["/api/widget/conversations/abc/messages", "GET", "cors"],
    ["/api/auth/refresh", "POST", "cors"],
    ["/api/conversations?scope=queue", "GET", "cors"],
    ["/ws", "GET", "websocket"],
  ])("la API y el WebSocket NUNCA pasan por la caché: %s", (path, method, mode) => {
    expect(strategyFor({ url: `${ORIGIN}${path}`, method, mode }, ORIGIN)).toBe("network");
  });

  it("otro origen no se toca", () => {
    expect(strategyFor({ url: "https://cdn.example/x.js" }, ORIGIN)).toBe("network");
  });

  it("navegación → shell; assets con hash → cache-first; resto → network-first", () => {
    expect(strategyFor({ url: `${ORIGIN}/`, mode: "navigate" }, ORIGIN)).toBe("shell");
    expect(strategyFor({ url: `${ORIGIN}/assets/index-abc123.js` }, ORIGIN)).toBe("cache-first");
    expect(strategyFor({ url: `${ORIGIN}/favicon.svg` }, ORIGIN)).toBe("network-first");
  });
});

describe("Service Worker generado por el build", () => {
  const swSource = fs.readFileSync("src/sw/service-worker.js", "utf8");
  const strategySource = fs.readFileSync("src/sw/strategy.js", "utf8");
  const precacheUrls = ["/", "/index.html", "/assets/app-1.js"];

  /** Carga el SW generado en un "self" simulado y devuelve lo que registró. */
  function load(source) {
    const handlers = {};
    const self = {
      addEventListener: (type, handler) => (handlers[type] = handler),
      location: { origin: ORIGIN },
      skipWaiting: async () => {},
    };
    let precached = null;
    const caches = { open: async () => ({ addAll: async (urls) => (precached = urls) }) };
    new Function("self", "caches", source)(self, caches);
    return { handlers, precached: () => precached };
  }

  it("se CARGA sin errores y precachea la lista real (regresión: la lista quedaba en un comentario)", async () => {
    const source = buildServiceWorkerSource({ swSource, strategySource, buildId: "abc123", precacheUrls });
    const sw = load(source);
    expect(Object.keys(sw.handlers).sort()).toEqual(["activate", "fetch", "install"]);
    let installing;
    sw.handlers.install({ waitUntil: (promise) => (installing = promise) });
    await installing;
    expect(sw.precached()).toEqual(precacheUrls);
    expect(source).toContain('const BUILD_ID = "abc123";');
    expect(source).not.toContain("import ");
  });

  it("si falta una declaración, el build FALLA en vez de publicar un SW roto", () => {
    expect(() =>
      buildServiceWorkerSource({
        swSource: swSource.replace("const PRECACHE_URLS = __PRECACHE_URLS__;", ""),
        strategySource,
        buildId: "x",
        precacheUrls,
      })
    ).toThrow(/PRECACHE_URLS/);
  });

  it("el fetch del SW generado deja pasar la API sin responder desde caché", () => {
    const sw = load(buildServiceWorkerSource({ swSource, strategySource, buildId: "b", precacheUrls }));
    let responded = false;
    sw.handlers.fetch({
      request: { url: `${ORIGIN}/api/widget/session`, method: "GET", mode: "cors" },
      respondWith: () => (responded = true),
    });
    expect(responded).toBe(false);
  });
});
