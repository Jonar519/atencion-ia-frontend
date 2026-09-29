import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../src/auth/session.js";
import { api, SESSION_EXPIRED } from "../src/api/http.js";

/** JWT falso con exp: el navegador no verifica la firma (eso lo hace la API). */
function fakeJwt(expSecondsFromNow = 900, sub = "a1") {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64({ sub, role: "agent", exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })}.firma`;
}

const STAFF = {
  id: "a1",
  name: "Laura Méndez",
  email: "laura@cordillera.example",
  role: "agent",
  availability: "available",
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  session._resetForTests();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("sesión del staff: el token vive SOLO en memoria", () => {
  it("después de iniciar sesión, el token no está en localStorage, sessionStorage ni cookies legibles", async () => {
    const setLocal = vi.spyOn(Storage.prototype, "setItem");
    const token = fakeJwt();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { accessToken: token, staff: STAFF }));

    await session.login("laura@cordillera.example", "Password123!");

    expect(session.getAccessToken()).toBe(token);
    expect(setLocal).not.toHaveBeenCalled();
    for (const storage of [localStorage, sessionStorage]) {
      for (let i = 0; i < storage.length; i++) expect(storage.getItem(storage.key(i))).not.toContain(token);
    }
    expect(document.cookie).not.toContain(token);
  });

  it("login envía el encabezado anti-CSRF y la cookie (same-origin)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(json(200, { accessToken: fakeJwt(), staff: STAFF }));
    await session.login("laura@cordillera.example", "x");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/auth/login");
    expect(init.headers["X-Requested-With"]).toBe("atencion-ia");
    expect(init.credentials).toBe("same-origin");
  });

  it("credenciales incorrectas muestran el mensaje del servidor", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(401, { error: "Credenciales inválidas" }));
    await expect(session.login("x@y.example", "mala")).rejects.toThrow("Credenciales inválidas");
    expect(session.getAccessToken()).toBeNull();
  });
});

describe("renovación single-flight", () => {
  it("tres peticiones con 401 a la vez hacen UN solo /refresh y todas se reintentan con el token nuevo", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(200, { accessToken: fakeJwt(900), staff: STAFF }));
    await session.login("l@x.example", "x");
    const newToken = fakeJwt(1800);
    let refreshes = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (url === "/api/auth/refresh") {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return json(200, { accessToken: newToken, staff: STAFF });
      }
      return init.headers.Authorization === `Bearer ${newToken}`
        ? json(200, { ok: url })
        : json(401, { error: "Token inválido o expirado" });
    });

    const results = await Promise.all(["/api/a", "/api/b", "/api/c"].map((path) => api.get(path, { auth: "staff" })));
    expect(refreshes).toBe(1);
    expect(results.map((r) => r.ok)).toEqual(["/api/a", "/api/b", "/api/c"]);
    expect(session.getAccessToken()).toBe(newToken);
  });

  it("409 (otra pestaña rotó la cookie en ese instante) se reintenta una vez", async () => {
    const calls = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      calls.push(url);
      return calls.length === 1
        ? json(409, { error: "reintenta" })
        : json(200, { accessToken: fakeJwt(), staff: STAFF });
    });
    expect(await session.refresh()).toEqual(expect.any(String));
    expect(calls).toEqual(["/api/auth/refresh", "/api/auth/refresh"]);
  });

  it("si la renovación falla, la sesión local se cierra y la petición informa 'sesión expirada'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(200, { accessToken: fakeJwt(), staff: STAFF }));
    await session.login("l@x.example", "x");
    const changes = [];
    session.onSessionChange((change) => changes.push(change.reason));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      url === "/api/auth/refresh" ? json(401, { error: "La sesión expiró" }) : json(401, { error: "Token inválido" })
    );
    await expect(api.get("/api/conversations", { auth: "staff" })).rejects.toThrow(SESSION_EXPIRED);
    expect(session.getAccessToken()).toBeNull();
    expect(changes).toContain("expired");
  });

  it("renueva sola un minuto antes de que venza el token", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { accessToken: fakeJwt(120), staff: STAFF }));
    await session.login("l@x.example", "x");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(json(200, { accessToken: fakeJwt(900), staff: STAFF }));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(fetchSpy).toHaveBeenCalledWith("/api/auth/refresh", expect.anything());
  });

  it("logout avisa a las demás pestañas", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { accessToken: fakeJwt(), staff: STAFF }));
    await session.login("l@x.example", "x");
    const other = new BroadcastChannel("atencion-ia-session");
    const received = new Promise((resolve) => other.addEventListener("message", (e) => resolve(e.data)));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await session.logout();
    expect(await received).toBe("logout");
    expect(session.getAccessToken()).toBeNull();
    other.close();
  });
});
