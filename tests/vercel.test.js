// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Configuración de Vercel (vercel.json): frame-ancestors como CABECERA (en <meta> no
 * funciona), HSTS, nosniff y la caché de los assets con hash frente a los archivos que
 * los apuntan (index.html, service-worker.js, offline.html).
 */
const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

/** Cabeceras que Vercel aplicaría a `path` (todas las reglas cuyo source coincide, en orden). */
function headersFor(path) {
  const out = {};
  for (const rule of config.headers) {
    if (new RegExp(`^${rule.source}$`).test(path)) {
      for (const { key, value } of rule.headers) out[key.toLowerCase()] = value;
    }
  }
  return out;
}

describe("vercel.json", () => {
  it("construye con npm ci + npm run build y publica dist", () => {
    expect(config).toMatchObject({
      framework: "vite",
      installCommand: "npm ci",
      buildCommand: "npm run build",
      outputDirectory: "dist",
    });
  });

  it("no lleva variables ni dominios: VITE_API_URL va en el proyecto de Vercel", () => {
    expect(config.env).toBeUndefined();
    expect(config.build).toBeUndefined();
    expect(JSON.stringify(config)).not.toMatch(/VITE_API_URL|https?:\/\/(?!openapi\.vercel\.sh)/);
  });

  it("router por hash: sin rewrites (ninguna ruta del servidor se reescribe a index.html)", () => {
    expect(config.rewrites).toBeUndefined();
    expect(config.redirects).toBeUndefined();
  });

  it("toda respuesta: frame-ancestors 'none', X-Frame-Options DENY, nosniff y HSTS", () => {
    for (const path of ["/", "/index.html", "/assets/index-abc123.js", "/offline.html", "/service-worker.js"]) {
      const h = headersFor(path);
      expect(h["content-security-policy"], path).toBe("frame-ancestors 'none'");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["strict-transport-security"], path).toMatch(/^max-age=\d{8,}; includeSubDomains$/);
      expect(h["cross-origin-opener-policy"], path).toBe("same-origin");
    }
  });

  it("la CSP de cabecera no reemplaza a la del <meta>: solo agrega frame-ancestors", () => {
    // Si llevara default-src o connect-src se SUMARÍA a la del <meta> y podría bloquear la API.
    expect(headersFor("/")["content-security-policy"]).not.toMatch(/default-src|script-src|connect-src/);
  });

  it("micrófono solo para la propia app (llamadas de voz); cámara y ubicación, nunca", () => {
    const policy = headersFor("/")["permissions-policy"];
    expect(policy).toContain("microphone=(self)");
    expect(policy).toContain("camera=()");
    expect(policy).toContain("geolocation=()");
  });

  it("assets con hash: inmutables por un año", () => {
    expect(headersFor("/assets/index-XEn-p5Ng.js")["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(headersFor("/assets/capture.worklet-BPy-EAQ3.js")["cache-control"]).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  it("lo que apunta a los assets nuevos se revalida siempre (no-cache)", () => {
    for (const path of ["/", "/index.html", "/service-worker.js", "/offline.html", "/offline.css"]) {
      expect(headersFor(path)["cache-control"], path).toBe("no-cache");
    }
  });

  it("nada fuera de /assets/ queda inmutable", () => {
    expect(headersFor("/favicon.svg")["cache-control"]).toBeUndefined();
    expect(headersFor("/service-worker.js")["cache-control"]).not.toMatch(/immutable/);
  });
});
