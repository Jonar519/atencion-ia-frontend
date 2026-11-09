import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { DEFAULT_API_URL, normalizeApiUrl, webSocketOrigin } from "../src/api/apiOrigin.js";
import { API_URL, apiUrl, wsUrl } from "../src/api/base.js";
import { webSocketUrl } from "../src/realtime/socket.js";
import { voiceSocketUrl } from "../src/voice/voiceSession.js";
import { strategyFor } from "../src/sw/strategy.js";
import { buildCsp, resolveApiOrigin } from "../scripts/csp.js";

const PROD_API = "https://api-atencion.example.com";
const APP_ORIGIN = "https://atencion.example.com";

describe("origen de la API (VITE_API_URL)", () => {
  it("vacío = la API de desarrollo", () => {
    expect(normalizeApiUrl(undefined)).toBe(DEFAULT_API_URL);
    expect(normalizeApiUrl("  ")).toBe(DEFAULT_API_URL);
    // Sin VITE_API_URL en los tests: el módulo usa la de desarrollo.
    expect(API_URL).toBe(DEFAULT_API_URL);
  });

  it("se queda solo con el origen (sin la barra final)", () => {
    expect(normalizeApiUrl("https://api-atencion.example.com/")).toBe(PROD_API);
    expect(normalizeApiUrl("http://localhost:4101")).toBe("http://localhost:4101");
  });

  it.each([
    ["no es URL", "api-atencion.example.com"],
    ["esquema raro", "ftp://api.example.com"],
    ["con ruta", "https://api.example.com/api"],
    ["con query", "https://api.example.com/?x=1"],
    ["con credenciales", "https://u:p@api.example.com"],
  ])("rechaza %s", (_label, value) => {
    expect(() => normalizeApiUrl(value)).toThrow(/VITE_API_URL/);
  });

  it("en Vercel es obligatoria y https", () => {
    expect(() => resolveApiOrigin(undefined, { onVercel: true })).toThrow(/Falta VITE_API_URL/);
    expect(() => resolveApiOrigin("http://api.example.com", { onVercel: true })).toThrow(/https/);
    expect(resolveApiOrigin(`${PROD_API}/`, { onVercel: true })).toBe(PROD_API);
    expect(resolveApiOrigin(undefined)).toBe(DEFAULT_API_URL);
  });
});

describe("URLs absolutas: nunca location.host", () => {
  it("REST: /api/… en el origen de la API", () => {
    expect(apiUrl("/api/auth/refresh", PROD_API)).toBe(`${PROD_API}/api/auth/refresh`);
  });

  it("WebSocket de chat y de voz: wss en producción, ws en local", () => {
    expect(webSocketOrigin(PROD_API)).toBe("wss://api-atencion.example.com");
    expect(webSocketUrl(PROD_API)).toBe("wss://api-atencion.example.com/ws");
    expect(voiceSocketUrl(PROD_API)).toBe("wss://api-atencion.example.com/ws/voice");
    expect(wsUrl("/ws", "http://localhost:4101")).toBe("ws://localhost:4101/ws");
  });

  it("por defecto, los sockets salen de VITE_API_URL aunque la página esté en otro host", () => {
    // jsdom corre en http://localhost:3000 (u otro): el socket NO toma ese host.
    expect(webSocketUrl()).toBe(`${webSocketOrigin(API_URL)}/ws`);
    expect(voiceSocketUrl()).toBe(`${webSocketOrigin(API_URL)}/ws/voice`);
    expect(webSocketUrl()).not.toContain(window.location.host);
  });

  it("ningún archivo de src arma URLs con location.host", () => {
    const files = fs.readdirSync("src", { recursive: true }).filter((f) => String(f).endsWith(".js"));
    // Solo código: los comentarios que explican la regla la mencionan.
    const code = (file) =>
      fs
        .readFileSync(`src/${file}`, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line))
        .join("\n");
    const offenders = files.filter((file) => /location\.host\b/.test(code(file)));
    expect(offenders).toEqual([]);
  });
});

describe("CSP del build", () => {
  const csp = buildCsp(PROD_API);
  const directive = (name) =>
    csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${name} `));

  it("connect-src permite SOLO la página y el origen de la API (https y wss)", () => {
    expect(directive("connect-src")).toBe(`connect-src 'self' ${PROD_API} wss://api-atencion.example.com`);
  });

  it("lo demás sigue cerrado ('self', sin inline ni terceros)", () => {
    expect(directive("script-src")).toBe("script-src 'self'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(csp).not.toContain("unsafe-inline");
  });
});

describe("Service Worker con la API en otro origen", () => {
  it.each([
    [`${PROD_API}/api/widget/conversations/abc/messages`, "GET", "cors"],
    [`${PROD_API}/api/staff/abc/avatar`, "GET", "cors"],
    [`${PROD_API}/api/auth/refresh`, "POST", "cors"],
    [`${PROD_API}/ws`, "GET", "websocket"],
  ])("no intercepta %s", (url, method, mode) => {
    expect(strategyFor({ url, method, mode }, APP_ORIGIN)).toBe("network");
  });
});
