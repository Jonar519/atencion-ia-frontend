import { CSRF_HEADERS, getAccessToken, refresh } from "../auth/session.js";

/**
 * Cliente HTTP de la app. La API está en el MISMO origen (proxy de Vite en
 * desarrollo), así que las cookies de sesión viajan con credentials: "same-origin".
 *
 *  - Siempre envía el encabezado anti-CSRF: el backend lo exige a toda
 *    escritura autenticada con cookie (widget del cliente, /refresh).
 *  - auth: "staff" agrega el access token (en memoria) y, ante un 401, renueva
 *    UNA vez con la cookie de refresh (single-flight en session.js) y repite.
 *  - auth: "widget" se autentica solo con la cookie httpOnly del cliente.
 *  - Errores con un mensaje para mostrar: el backend responde { error, details? }.
 */

export const DEFAULT_TIMEOUT_MS = 15_000;
/** Un turno del cliente pasa por la IA: puede tardar más. */
export const AI_TIMEOUT_MS = 45_000;

export const NETWORK_ERROR = "No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.";
export const TIMEOUT_ERROR = "El servidor tardó demasiado en responder. Intenta de nuevo.";
export const SESSION_EXPIRED = "Tu sesión expiró. Inicia sesión de nuevo.";

export class HttpError extends Error {
  constructor(message, { status = 0, kind = "http" } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.kind = kind;
  }
}

function messageFrom(data, status) {
  if (!data?.error)
    return status >= 500 ? `El servidor tuvo un problema (${status}). Intenta más tarde.` : `Error (${status})`;
  if (Array.isArray(data.details) && data.details.length) {
    return `${data.error}: ${data.details.map((d) => (typeof d === "string" ? d : d.message)).join("; ")}`;
  }
  return data.error;
}

async function fetchOnce(path, init, timeoutMs, responseType = "json") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { ...init, signal: controller.signal });
    const isJson = (response.headers.get("content-type") || "").includes("application/json");
    // "blob": imágenes (avatar). Un error de la API sigue llegando como JSON.
    if (responseType === "blob" && response.ok) return { response, data: await response.blob() };
    return { response, data: isJson ? await response.json() : null };
  } catch {
    // Nunca se muestra el error crudo del navegador ("Failed to fetch"…).
    throw controller.signal.aborted
      ? new HttpError(TIMEOUT_ERROR, { kind: "timeout" })
      : new HttpError(NETWORK_ERROR, { kind: "network" });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * raw: { data: Blob, contentType } envía el cuerpo tal cual (p. ej. el avatar ya recortado).
 * responseType: "blob" devuelve el cuerpo binario (p. ej. una imagen).
 * headers: encabezados adicionales (los adjuntos mandan nombre y comentario así).
 */
export async function request(
  path,
  {
    method = "GET",
    body,
    raw,
    auth = "none",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    responseType = "json",
    headers: extra,
  } = {}
) {
  // extra: encabezados propios de la petición (p. ej. X-File-Name de un adjunto). Nunca pisan el anti-CSRF.
  const headers = { ...extra, ...CSRF_HEADERS };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (raw) headers["Content-Type"] = raw.contentType;
  const init = {
    method,
    headers,
    credentials: "same-origin",
    body: raw ? raw.data : body !== undefined ? JSON.stringify(body) : undefined,
  };

  const withToken = () => {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return Boolean(token);
  };
  if (auth === "staff") withToken();

  let { response, data } = await fetchOnce(path, init, timeoutMs, responseType);

  if (response.status === 401 && auth === "staff") {
    // Access token vencido: se renueva una vez y se repite.
    const renewed = await refresh().catch(() => null);
    if (!renewed || !withToken()) throw new HttpError(SESSION_EXPIRED, { status: 401 });
    ({ response, data } = await fetchOnce(path, init, timeoutMs, responseType));
    if (response.status === 401) throw new HttpError(SESSION_EXPIRED, { status: 401 });
  }

  if (!response.ok) throw new HttpError(messageFrom(data, response.status), { status: response.status });
  return data;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: "GET" }),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  put: (path, raw, options) => request(path, { ...options, method: "PUT", raw }),
  delete: (path, options) => request(path, { ...options, method: "DELETE" }),
};
