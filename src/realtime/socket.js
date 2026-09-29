import { backoffDelay } from "../lib/backoff.js";

/**
 * Cliente WebSocket de tiempo real (backend: src/realtime/wsServer.ts).
 *
 *  - Se autentica con el PRIMER mensaje (nunca con el token en la URL).
 *  - Si la conexión cae, reintenta con backoff exponencial + jitter.
 *  - Al reconectar, llama a onResync(): mientras estuvo caído pudieron llegar
 *    mensajes que el socket no entregó; la vista los recupera por REST y el
 *    almacén de mensajes descarta duplicados. Sin esto, se perderían mensajes.
 *  - Cierre 4409 (token vencido) o 4401: llama a onAuthExpired() (el panel
 *    renueva el access token) ANTES de reconectar.
 *
 * Estados: "connecting" | "open" | "reconnecting" | "closed".
 */

export const CLOSE_TOKEN_EXPIRED = 4409;
export const CLOSE_UNAUTHORIZED = 4401;

export function webSocketUrl(location = window.location) {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
}

/**
 * @param {object} options
 * @param {() => Promise<object|null>} options.authMessage  mensaje de auth ({ type: "auth", … }) o null si no hay sesión
 * @param {(event: object) => void} options.onEvent
 * @param {(status: string) => void} [options.onStatus]
 * @param {() => void} [options.onResync]        tras una RE-conexión (no en la primera)
 * @param {() => Promise<unknown>} [options.onAuthExpired]
 */
export function createRealtimeClient({
  url = webSocketUrl(),
  authMessage,
  onEvent,
  onStatus = () => {},
  onResync = () => {},
  onAuthExpired = async () => {},
  WebSocketImpl = globalThis.WebSocket,
  backoff = backoffDelay,
}) {
  let socket = null;
  let stopped = true;
  let attempt = 0;
  let reconnectTimer = null;
  let everReady = false;
  let status = "closed";

  const setStatus = (next) => {
    if (next === status) return;
    status = next;
    onStatus(status);
  };

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    setStatus("reconnecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoff(attempt++));
  }

  async function connect() {
    if (stopped) return;
    const auth = await authMessage().catch(() => null);
    if (stopped) return;
    if (!auth) {
      // Sin credenciales todavía (p. ej. renovando): se reintenta más tarde.
      scheduleReconnect();
      return;
    }
    setStatus(everReady ? "reconnecting" : "connecting");
    const ws = new WebSocketImpl(url);
    socket = ws;

    ws.addEventListener("open", () => ws.send(JSON.stringify(auth)));
    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "ready") {
        const wasReconnect = everReady;
        everReady = true;
        attempt = 0;
        setStatus("open");
        if (wasReconnect) onResync();
        return;
      }
      if (message.type === "pong") return;
      onEvent(message);
    });
    ws.addEventListener("close", async (event) => {
      if (socket === ws) socket = null;
      if (stopped) return;
      if (event.code === CLOSE_TOKEN_EXPIRED || event.code === CLOSE_UNAUTHORIZED) {
        await onAuthExpired().catch(() => {});
      }
      scheduleReconnect();
    });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      attempt = 0;
      connect();
    },
    stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      socket?.close(1000, "fin");
      socket = null;
      setStatus("closed");
    },
    get status() {
      return status;
    },
  };
}
