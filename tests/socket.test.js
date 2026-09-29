import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealtimeClient, CLOSE_TOKEN_EXPIRED } from "../src/realtime/socket.js";
import { FakeWebSocket, flush } from "./support/fakeWebSocket.js";

function client(overrides = {}) {
  const events = [];
  const statuses = [];
  const onResync = vi.fn();
  const onAuthExpired = vi.fn(async () => {});
  const realtime = createRealtimeClient({
    url: "ws://localhost/ws",
    authMessage: async () => ({ type: "auth", accessToken: "tok" }),
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    onResync,
    onAuthExpired,
    WebSocketImpl: FakeWebSocket,
    backoff: (attempt) => 1000 * 2 ** attempt, // sin jitter: tiempos predecibles
    ...overrides,
  });
  return { realtime, events, statuses, onResync, onAuthExpired };
}

async function connectAndReady() {
  await flush();
  const ws = FakeWebSocket.last();
  ws.serverOpen();
  ws.serverSend({ type: "ready", kind: "staff" });
  return ws;
}

beforeEach(() => {
  FakeWebSocket.reset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("cliente WebSocket", () => {
  it("se autentica con el PRIMER mensaje (el token nunca va en la URL)", async () => {
    const { realtime } = client();
    realtime.start();
    const ws = await connectAndReady();
    expect(ws.url).toBe("ws://localhost/ws");
    expect(ws.url).not.toContain("tok");
    expect(ws.sent[0]).toEqual({ type: "auth", accessToken: "tok" });
    expect(realtime.status).toBe("open");
  });

  it("entrega los eventos a la vista (y no los mensajes de control)", async () => {
    const { realtime, events } = client();
    realtime.start();
    const ws = await connectAndReady();
    ws.serverSend({ type: "pong" });
    ws.serverSend({ type: "message.created", conversation: { id: "c1" }, message: { id: "m1" } });
    expect(events).toEqual([{ type: "message.created", conversation: { id: "c1" }, message: { id: "m1" } }]);
  });

  it("si la conexión cae, reintenta con backoff exponencial (1 s, 2 s, 4 s…)", async () => {
    const { realtime } = client();
    realtime.start();
    await flush();
    FakeWebSocket.last().serverClose(1006);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
    realtime.stop();
  });

  it("al RE-conectar pide una re-sincronización (no en la primera conexión): no se pierden mensajes", async () => {
    const { realtime, onResync } = client();
    realtime.start();
    const first = await connectAndReady();
    expect(onResync).not.toHaveBeenCalled();
    first.serverClose(1006);
    await vi.advanceTimersByTimeAsync(1000);
    await connectAndReady();
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("tras reconectar con éxito, el backoff vuelve a empezar desde 1 s", async () => {
    const { realtime } = client();
    realtime.start();
    await flush();
    FakeWebSocket.last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(1000);
    FakeWebSocket.last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(2000);
    const ws = await connectAndReady();
    ws.serverClose(1006);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(4);
    realtime.stop();
  });

  it("si el servidor cierra por token vencido (4409), renueva el token ANTES de reconectar", async () => {
    const order = [];
    let token = "viejo";
    const onAuthExpired = vi.fn(async () => {
      order.push("renovar");
      token = "nuevo";
    });
    const { realtime } = client({ authMessage: async () => ({ type: "auth", accessToken: token }), onAuthExpired });
    realtime.start();
    const ws = await connectAndReady();
    ws.serverClose(CLOSE_TOKEN_EXPIRED);
    await flush();
    expect(onAuthExpired).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(FakeWebSocket.last().sent).toEqual([]); // aún no abrió
    FakeWebSocket.last().serverOpen();
    expect(FakeWebSocket.last().sent[0]).toEqual({ type: "auth", accessToken: "nuevo" });
    realtime.stop();
  });

  it("stop() cierra y deja de reintentar", async () => {
    const { realtime } = client();
    realtime.start();
    await connectAndReady();
    realtime.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(realtime.status).toBe("closed");
  });
});
