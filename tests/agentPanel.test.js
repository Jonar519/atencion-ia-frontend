import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentPanelView } from "../src/views/agent/panel.view.js";
import { createRealtimeClient } from "../src/realtime/socket.js";
import { HttpError } from "../src/api/http.js";
import { FakeWebSocket, flush } from "./support/fakeWebSocket.js";

/** Panel de agentes con API, sesión y WebSocket simulados. */

const LAURA = { id: "a2", name: "Laura Méndez", role: "agent", availability: "available" };
const CASE = {
  id: "c1",
  status: "waiting_agent",
  priority: 90,
  subject: null,
  lastMessageAt: new Date().toISOString(),
  customer: { id: "b1", displayName: "Mariana" },
  assignedAgent: null,
  openEscalation: { reason: "possible_fraud", priority: 90 },
  lastMessage: { preview: "Hay una compra que no hice" },
};

function fakeSession(staff = LAURA) {
  return {
    getStaff: () => staff,
    restore: vi.fn(async () => staff),
    getAccessToken: () => "token-en-memoria",
    refresh: vi.fn(async () => "token-nuevo"),
    logout: vi.fn(async () => {}),
    onSessionChange: () => () => {},
  };
}

function fakeStaffApi() {
  const state = {
    queue: [CASE],
    mine: [],
    detail: { ...CASE, escalations: [{ status: "open", reason: "possible_fraud", priority: 90 }] },
  };
  return {
    state,
    queue: vi.fn(async () => ({ items: state.queue })),
    mine: vi.fn(async () => ({ items: state.mine })),
    conversation: vi.fn(async () => state.detail),
    messages: vi.fn(async () => ({
      items: [
        {
          id: "m1",
          senderType: "customer",
          content: "Hay una compra que no hice",
          createdAt: "2026-09-29T10:00:00Z",
          intent: "possible_fraud",
          sentiment: "angry",
        },
        {
          id: "m2",
          senderType: "system",
          content: "Te estoy comunicando con un asesor.",
          createdAt: "2026-09-29T10:00:01Z",
        },
      ],
    })),
    take: vi.fn(async () => {
      state.detail = { ...state.detail, status: "agent_active", assignedAgent: { id: LAURA.id, name: LAURA.name } };
      state.mine = [{ ...CASE, status: "agent_active" }];
      state.queue = [];
      return state.detail;
    }),
    close: vi.fn(),
    reply: vi.fn(async (_id, content, clientMsgId) => ({
      id: "r1",
      senderType: "agent",
      content,
      clientMsgId,
      createdAt: "2026-09-29T10:01:00Z",
      senderAgent: { id: LAURA.id, name: LAURA.name },
    })),
    setAvailability: vi.fn(async (availability) => ({ availability })),
  };
}

let root;
let cleanup;

async function mount(api = fakeStaffApi(), session = fakeSession()) {
  root = document.createElement("div");
  document.body.append(root);
  cleanup = agentPanelView(
    root,
    {},
    {
      staffApi: api,
      session,
      createRealtimeClient: (options) =>
        createRealtimeClient({ ...options, url: "ws://t/ws", WebSocketImpl: FakeWebSocket, backoff: () => 1000 }),
    }
  );
  await flush(40);
  const ws = FakeWebSocket.last();
  ws.serverOpen();
  ws.serverSend({ type: "ready", kind: "staff" });
  return { api, ws };
}

const openCase = async () => {
  root.querySelector(".case").click();
  await flush(40);
};

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup?.();
  root?.remove();
  vi.useRealTimers();
});

describe("panel de agentes", () => {
  it("muestra la cola con el motivo del escalamiento y se autentica en el socket con el token en memoria", async () => {
    const { ws } = await mount();
    expect(ws.sent[0]).toEqual({ type: "auth", accessToken: "token-en-memoria" });
    expect(root.querySelector(".tab").textContent).toBe("Cola (1)");
    expect(root.querySelector(".case").classList.contains("case--high")).toBe(true);
    expect(root.querySelector(".case__reason").textContent).toBe("Posible fraude");
  });

  it("deja leer el historial completo (con el análisis de la IA) ANTES de tomar el caso; sin caja de respuesta", async () => {
    await mount();
    await openCase();
    const history = root.querySelector(".pane .chat__messages").textContent;
    expect(history).toContain("Hay una compra que no hice");
    expect(history).toContain("Posible fraude · Molesto");
    expect(root.querySelector(".pane textarea")).toBeNull();
    expect([...root.querySelectorAll(".pane__actions button")].map((b) => b.textContent)).toEqual(["Tomar caso"]);
  });

  it("tomar el caso habilita responder; la respuesta se ve una sola vez", async () => {
    const { api, ws } = await mount();
    await openCase();
    root.querySelector(".pane__actions button").click();
    await flush(40);
    expect(api.take).toHaveBeenCalledWith("c1");
    const textarea = root.querySelector(".pane textarea");
    expect(textarea).not.toBeNull();
    textarea.value = "Hola Mariana, ya bloqueé tu tarjeta";
    root.querySelector(".pane form").requestSubmit();
    await flush(40);
    ws.serverSend({
      type: "message.created",
      conversation: { id: "c1", status: "agent_active" },
      message: {
        id: "r1",
        senderType: "agent",
        content: "Hola Mariana, ya bloqueé tu tarjeta",
        createdAt: "2026-09-29T10:01:00Z",
        clientMsgId: api.reply.mock.calls[0][2],
      },
    });
    const replies = [...root.querySelectorAll(".pane .msg--agent .msg__text")].map((el) => el.textContent);
    expect(replies).toEqual(["Hola Mariana, ya bloqueé tu tarjeta"]);
  });

  it("si OTRO asesor toma el caso que estás mirando, el panel te lo avisa y deja de mostrarlo", async () => {
    const { ws } = await mount();
    await openCase();
    ws.serverSend({ type: "conversation.updated", conversation: { id: "c1", status: "agent_active" }, visible: false });
    expect(root.querySelector(".pane").textContent).toContain("Otro asesor tomó este caso.");
    expect(root.querySelector(".pane .chat__messages")).toBeNull();
  });

  it("un aviso de escalamiento sugerido para ti se anuncia y recarga la cola", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { api, ws } = await mount();
    const before = api.queue.mock.calls.length;
    ws.serverSend({ type: "escalation.created", reason: "angry_customer", priority: 70, suggestedAgentId: LAURA.id });
    expect(document.querySelector(".toasts").textContent).toContain("Cliente molesto (sugerido para ti)");
    await vi.advanceTimersByTimeAsync(300);
    expect(api.queue.mock.calls.length).toBe(before + 1);
  });

  it("si otro asesor ya lo tomó al pulsar 'Tomar', muestra el error del servidor", async () => {
    const api = fakeStaffApi();
    api.take.mockRejectedValueOnce(new HttpError("Otro agente ya tomó esta conversación", { status: 409 }));
    await mount(api);
    await openCase();
    root.querySelector(".pane__actions button").click();
    await flush(40);
    expect(document.querySelector(".toasts").textContent).toContain("Otro agente ya tomó esta conversación");
  });

  it("sin sesión, manda al login", async () => {
    const session = { ...fakeSession(), getStaff: () => null, restore: vi.fn(async () => null) };
    root = document.createElement("div");
    cleanup = agentPanelView(
      root,
      {},
      { staffApi: fakeStaffApi(), session, createRealtimeClient: () => ({ start() {}, stop() {} }) }
    );
    await flush(20);
    expect(window.location.hash).toBe("#/agente/login");
  });
});

describe("panel de agentes: cambio de cuenta en otra pestaña", () => {
  it("si la sesión pasa a OTRA cuenta (otra pestaña inició sesión), el panel se recarga como el nuevo usuario", async () => {
    let emit;
    const session = { ...fakeSession(), onSessionChange: (listener) => ((emit = listener), () => {}) };
    const reload = vi.fn();
    root = document.createElement("div");
    document.body.append(root);
    cleanup = agentPanelView(
      root,
      {},
      {
        staffApi: fakeStaffApi(),
        session,
        reload,
        createRealtimeClient: () => ({ start() {}, stop() {} }),
      }
    );
    await flush(40);
    emit({ staff: LAURA, reason: "refreshed" }); // misma cuenta: nada
    expect(reload).not.toHaveBeenCalled();
    emit({ staff: { id: "a3", name: "Diego Rojas" }, reason: "refreshed" });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("panel de agentes: llamadas de voz (Fase 5)", () => {
  const CALL = { id: "call1", status: "waiting_agent", endReason: null };
  const conversationRef = (id = "c1") => ({
    id,
    customerId: "b1",
    status: "waiting_agent",
    assignedAgentId: null,
    priority: 90,
  });

  it("muestra el estado de la llamada activa del caso y lo actualiza en vivo", async () => {
    const api = fakeStaffApi();
    api.state.detail = { ...api.state.detail, calls: [{ id: "call1", status: "in_progress" }] };
    const { ws } = await mount(api);
    await openCase();
    expect(root.querySelector(".pill--call").textContent).toBe("Llamada en curso");
    ws.serverSend({ type: "call.updated", conversation: conversationRef(), call: CALL });
    await flush(5);
    expect(root.querySelector(".pill--call").textContent).toBe("Llamada en espera de asesor");
    ws.serverSend({ type: "call.updated", conversation: conversationRef(), call: { ...CALL, status: "ended" } });
    await flush(5);
    expect(root.querySelector(".pill--call")).toBeNull();
  });

  it("la transcripción en vivo aparece solo para el caso abierto, como TEXTO, y pasa al historial al cerrar la frase", async () => {
    const { ws } = await mount();
    await openCase();
    const live = root.querySelector(".live-transcript");
    expect(live.hidden).toBe(true);

    // De OTRO caso: no se muestra aquí.
    ws.serverSend({
      type: "call.transcript.partial",
      conversation: conversationRef("otro"),
      callId: "x",
      speaker: "customer",
      text: "ajeno",
    });
    await flush(5);
    expect(live.hidden).toBe(true);

    ws.serverSend({
      type: "call.transcript.partial",
      conversation: conversationRef(),
      callId: "call1",
      speaker: "customer",
      text: '<img src=x onerror="alert(1)"> no reconozco',
    });
    await flush(5);
    expect(live.hidden).toBe(false);
    expect(live.textContent).toContain('Cliente (en vivo) <img src=x onerror="alert(1)"> no reconozco');
    expect(live.querySelector("img")).toBeNull();

    ws.serverSend({
      type: "message.created",
      conversation: conversationRef(),
      message: {
        id: "v1",
        senderType: "customer",
        channel: "voice",
        content: "No reconozco un cargo",
        createdAt: "2026-09-29T10:02:00Z",
      },
    });
    await flush(5);
    expect(live.hidden).toBe(true);
    const turn = root.querySelector('[data-id="v1"]');
    expect(turn.querySelector(".tag--voice").textContent).toBe("Voz");
  });
});
