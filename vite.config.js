import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { buildServiceWorkerSource } from "./scripts/sw-build.js";

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

/**
 * Content-Security-Policy del build. La API y el WebSocket se sirven en el
 * MISMO origen que la página (proxy de Vite en desarrollo; proxy inverso en
 * producción), así que todo es 'self': ningún script, estilo o conexión
 * a terceros. Sin 'unsafe-inline': todo el JS y el CSS vienen de archivos.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  // blob: el avatar (se pide con el token y se muestra con un URL local) y el recorte antes de subirlo.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function contentSecurityPolicy() {
  return {
    name: "atencion-ia:csp",
    apply: "build",
    transformIndexHtml() {
      return [
        { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  // Backend al que se reenvían /api y /ws. Por defecto el de desarrollo (4100);
  // las pruebas en vivo usan otro (VITE_BACKEND_URL=http://localhost:4101).
  const backend = env.VITE_BACKEND_URL || "http://localhost:4100";
  const proxy = {
    "/api": { target: backend, changeOrigin: false },
    "/ws": { target: backend.replace(/^http/, "ws"), ws: true, changeOrigin: false },
  };
  return {
    plugins: [serviceWorker(), contentSecurityPolicy()],
    // 5174: el 5173 lo usa el Proyecto 1.
    server: { port: 5174, strictPort: true, proxy },
    preview: { port: 4174, strictPort: true, proxy },
    test: {
      environment: "jsdom",
      include: ["tests/**/*.test.js"],
      restoreMocks: true,
    },
  };
});
