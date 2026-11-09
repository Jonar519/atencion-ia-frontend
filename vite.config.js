import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { buildServiceWorkerSource } from "./scripts/sw-build.js";
import { buildCsp, resolveApiOrigin } from "./scripts/csp.js";

/**
 * Service Worker: se emite /service-worker.js en cada build a partir de
 * src/sw/service-worker.js, con el id del build y la lista REAL de archivos a
 * precachear (el shell y los assets con hash). El id es un hash de esa lista:
 * cambia solo si cambió algo, y así el navegador detecta la versión nueva.
 * En desarrollo no hay Service Worker (src/sw/registerSW.js).
 */
function serviceWorker() {
  return {
    name: "atencion-ia:service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((file) => !file.endsWith(".map"));
      const precache = [
        "/",
        "/index.html",
        "/offline.html",
        "/offline.css",
        "/favicon.svg",
        ...files.map((file) => `/${file}`),
      ];
      const unique = [...new Set(precache)].sort();
      const buildId = createHash("sha256").update(unique.join("\n")).digest("hex").slice(0, 12);
      const source = buildServiceWorkerSource({
        swSource: fs.readFileSync(path.resolve("src/sw/service-worker.js"), "utf8"),
        strategySource: fs.readFileSync(path.resolve("src/sw/strategy.js"), "utf8"),
        buildId,
        precacheUrls: unique,
      });
      this.emitFile({ type: "asset", fileName: "service-worker.js", source });
    },
  };
}

/** CSP del build en un <meta> (scripts/csp.js: connect-src = 'self' + el origen de la API). */
function contentSecurityPolicy(csp) {
  return {
    name: "atencion-ia:csp",
    apply: "build",
    transformIndexHtml() {
      return [
        { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: csp }, injectTo: "head-prepend" },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  // Sin proxy: la app habla con la API en su propio origen, igual que en producción.
  // Por defecto la de desarrollo (http://localhost:4100); el E2E usa VITE_API_URL=http://localhost:4101.
  const apiOrigin = resolveApiOrigin(env.VITE_API_URL, { onVercel: process.env.VERCEL === "1" });
  return {
    plugins: [serviceWorker(), contentSecurityPolicy(buildCsp(apiOrigin))],
    // 5174: el 5173 lo usa el Proyecto 1.
    server: { port: 5174, strictPort: true },
    preview: { port: 4174, strictPort: true },
    test: {
      environment: "jsdom",
      include: ["tests/**/*.test.js"],
      restoreMocks: true,
    },
  };
});
