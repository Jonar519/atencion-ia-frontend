/**
 * Sesión del STAFF en el navegador (backend: docs/adr/0002-esquema-de-sesion.md).
 *
 *  - El access token (15 min) vive SOLO en esta variable de módulo: nunca en
 *    localStorage, sessionStorage, IndexedDB ni cookies accesibles por JS. Un
 *    XSS no lo encuentra guardado, y al cerrar la pestaña desaparece.
 *  - El refresh token viaja en una cookie httpOnly que este código no puede
 *    leer; restore()/refresh() la usan llamando a /api/auth/refresh.
 *  - refresh() es "single-flight": si varias peticiones reciben 401 a la vez,
 *    se hace UN solo /refresh y todas esperan ese resultado. (Cada /refresh
 *    rota la cookie: dos en paralelo harían que el segundo pareciera una
 *    reutilización y el backend cerraría la sesión por seguridad.)
 *  - Renovación proactiva un minuto antes de que venza.
 *  - Cerrar sesión en una pestaña la cierra en las demás (BroadcastChannel).
 *
 * Usa fetch directo (no api/http.js) para no crear un ciclo: http.js llama a
 * refresh() cuando recibe un 401.
 */

export const CSRF_HEADERS = { "X-Requested-With": "atencion-ia" };
const REFRESH_MARGIN_MS = 60_000;
// 409 = otra pestaña rotó la cookie en ese instante; la nueva ya está en el navegador.
const RACE_RETRY_DELAY_MS = 300;

let accessToken = null;
let staff = null;
let inFlight = null;
let proactiveTimer = null;
const listeners = new Set();

const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("atencion-ia-session") : null;
channel?.addEventListener("message", (event) => {
  if (event.data === "logout" && staff) endLocal("logout-other-tab");
});

function notify(reason) {
  for (const listener of listeners) listener({ staff, reason });
}

/** Suscribirse a cambios de sesión (login, renovación, fin). Devuelve la función para desuscribirse. */
export function onSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAccessToken() {
  return accessToken;
}

export function getStaff() {
  return staff;
}

/** Vencimiento del JWT en ms (sin verificarlo: eso lo hace la API). */
export function tokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function schedule(token) {
  clearTimeout(proactiveTimer);
  const expiresAt = tokenExpiry(token);
  if (!expiresAt) return;
  const delay = Math.max(expiresAt - Date.now() - REFRESH_MARGIN_MS, 5_000);
  proactiveTimer = setTimeout(() => refresh().catch(() => {}), delay);
}

function setSession(token, profile, reason) {
  accessToken = token;
  staff = profile;
  schedule(token);
  notify(reason);
}

function endLocal(reason) {
  clearTimeout(proactiveTimer);
  accessToken = null;
  staff = null;
  notify(reason);
}

async function post(path, body) {
  return fetch(`/api/auth/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { ...CSRF_HEADERS, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export class LoginError extends Error {}

export async function login(email, password) {
  let response;
  try {
    response = await post("login", { email, password });
  } catch {
    throw new LoginError("No se pudo conectar con el servidor. Revisa tu conexión.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new LoginError(data.error || `No se pudo iniciar sesión (${response.status})`);
  setSession(data.accessToken, data.staff, "login");
  return data.staff;
}

/**
 * Pide un access token nuevo con la cookie de refresh. Resuelve con el token,
 * o con null si la sesión ya no es válida (y cierra la sesión local). Lanza
 * solo ante errores de red, para que quien llama distinga "sin conexión".
 */
export function refresh() {
  inFlight ??= (async () => {
    try {
      let response = await post("refresh");
      if (response.status === 409) {
        await new Promise((resolve) => setTimeout(resolve, RACE_RETRY_DELAY_MS));
        response = await post("refresh");
      }
      if (!response.ok) {
        if (staff) endLocal("expired");
        return null;
      }
      const data = await response.json();
      setSession(data.accessToken, data.staff, "refreshed");
      return data.accessToken;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Al abrir el panel: si la cookie de refresh sigue vigente, recupera la sesión sin pedir la contraseña. */
export async function restore() {
  if (accessToken) return staff;
  try {
    return (await refresh()) ? staff : null;
  } catch {
    return null;
  }
}

export async function logout() {
  try {
    await post("logout");
  } catch {
    // Sin conexión: la sesión local se cierra igual; la cookie vence sola.
  }
  channel?.postMessage("logout");
  endLocal("logout");
}

// Timers congelados en segundo plano: al volver a la pestaña se renueva si vence pronto.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !accessToken) return;
    const expiresAt = tokenExpiry(accessToken);
    if (expiresAt && expiresAt - Date.now() < REFRESH_MARGIN_MS) refresh().catch(() => {});
  });
}

/** Solo tests. */
export function _resetForTests() {
  clearTimeout(proactiveTimer);
  accessToken = null;
  staff = null;
  inFlight = null;
  listeners.clear();
}
