import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { customerChatView } from "../src/views/customer/chat.view.js";
import { createRealtimeClient } from "../src/realtime/socket.js";
import { HttpError } from "../src/api/http.js";
import { FakeWebSocket, flush } from "./support/fakeWebSocket.js";

/**
 * Widget del cliente de punta a punta con red y WebSocket simulados:
 * envío, recepción en tiempo real, reconexión con re-sincronización y reintento.
 */

const CONV = "c0000000-0000-4000-8000-0000000000aa";
const at = (s) => `2026-09-29T10:00:${String(s).padStart(2, "0")}.000Z`;

function fakeApi() {
  const server = { messages: [], status: "ai_active" };
  const api = {
    server,
    currentSession: vi.fn(async () => ({ customerId: "b1", displayName: "Mariana" })),
    startSession: vi.fn(async () => ({})),
    endSession: vi.fn(async () => undefined),
    conversations: vi.fn(async () => ({ items: [{ id: CONV, status: server.status }] })),
    newConversation: vi.fn(async () => ({ id: CONV, status: "ai_active" })),
    messages: vi.fn(async () => ({ items: [...server.messages] })),
    send: vi.fn(async (_id, content, clientMsgId) => {
      const message = {
        id: `srv-${server.messages.length + 1}`,
        sender: "customer",
        content,
        clientMsgId,
        createdAt: at(server.messages.length + 1),
      };
      const reply = {
        id: `srv-${server.messages.length + 2}`,
        sender: "ai",
        content: "Los sábados abrimos de 9 a 12.",
        clientMsgId: null,
        createdAt: at(server.messages.length + 2),
      };
      server.messages.push(message, reply);
      return { message, reply, conversationStatus: "ai_active", handedOffToAgent: false, duplicate: false };
    }),
  };
  return api;
}

let root;
let cleanup;
const texts = () => [...root.querySelectorAll(".msg .msg__text, .msg--system .msg__text")].map((el) => el.textContent);

async function mount(api) {
  root = document.createElement("div");
  document.body.append(root);
  cleanup = customerChatView(
    root,
    {},
    {
      widgetApi: api,
      urgencyClient: { classify: async () => ({ level: "normal" }), terminate: () => {} },
      createRealtimeClient: (options) =>
        createRealtimeClient({ ...options, url: "ws://test/ws", WebSocketImpl: FakeWebSocket, backoff: () => 1000 }),
    }
  );
  await flush(30);
  const ws = FakeWebSocket.last();
  ws.serverOpen();
  ws.serverSend({ type: "ready", kind: "customer" });
  return ws;
}

async function send(text) {
  root.querySelector("textarea").value = text;
  root.querySelector("form.chat__composer").requestSubmit();
  await flush(30);
}

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup?.();
  root?.remove();
  vi.useRealTimers();
});

describe("widget del cliente", () => {
  it("abre la conversación, se autentica en el socket SIN token (la cookie httpOnly va sola)", async () => {
    const ws = await mount(fakeApi());
    expect(ws.sent[0]).toEqual({ type: "auth" });
    expect(root.querySelector(".chat__status").textContent).toBe("Te atiende el asistente virtual");
  });

  it("enviar: el mensaje aparece al instante, se confirma, y llega la respuesta de la IA (una sola vez)", async () => {
    const api = fakeApi();
    const ws = await mount(api);
    root.querySelector("textarea").value = "¿A qué hora abren el sábado?";
    root.querySelector("form.chat__composer").requestSubmit();
    expect(root.querySelector(".msg--pending .msg__text").textContent).toBe("¿A qué hora abren el sábado?");
    await flush(30);
    // El WebSocket también trae los mismos mensajes: no se duplican.
    for (const message of api.server.messages) {
      ws.serverSend({
        type: "message.created",
        conversation: { id: CONV, status: "ai_active" },
        message: { ...message, senderType: message.sender },
      });
    }
    expect(texts()).toEqual(["¿A qué hora abren el sábado?", "Los sábados abrimos de 9 a 12."]);
    expect(root.querySelector(".msg--pending")).toBeNull();
    const [, content, clientMsgId] = api.send.mock.calls[0];
    expect(content).toBe("¿A qué hora abren el sábado?");
    expect(clientMsgId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("recibe en tiempo real al asesor y el cambio de estado", async () => {
    const ws = await mount(fakeApi());
    ws.serverSend({ type: "conversation.updated", conversation: { id: CONV, status: "agent_active" } });
    ws.serverSend({
      type: "message.created",
      conversation: { id: CONV, status: "agent_active" },
      message: {
        id: "a1",
        senderType: "agent",
        content: "Hola, soy Laura",
        createdAt: at(30),
        clientMsgId: null,
        agent: { name: "Laura" },
      },
    });
    expect(texts()).toContain("Hola, soy Laura");
    expect(root.querySelector(".msg--agent .msg__author").textContent).toBe("Laura · Asesor");
    expect(root.querySelector(".chat__status").textContent).toBe("Te atiende un asesor de Banco Cordillera");
  });

  it("ignora eventos de OTRA conversación", async () => {
    const ws = await mount(fakeApi());
    ws.serverSend({
      type: "message.created",
      conversation: { id: "otra", status: "ai_active" },
      message: { id: "x", senderType: "ai", content: "no es tuyo", createdAt: at(1) },
    });
    expect(texts()).not.toContain("no es tuyo");
  });

  it("RECONEXIÓN: lo que llegó con el socket caído se recupera por REST y no se duplica", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const api = fakeApi();
    const ws = await mount(api);
    await send("hola");
    ws.serverClose(1006);
    // Mientras estaba caído, el asesor escribió (el socket nunca lo entregó).
    api.server.messages.push({
      id: "srv-9",
      sender: "agent",
      content: "Te escribo mientras estabas desconectado",
      agentName: "Laura",
      createdAt: at(40),
    });
    await vi.advanceTimersByTimeAsync(1000);
    const again = FakeWebSocket.last();
    again.serverOpen();
    again.serverSend({ type: "ready", kind: "customer" });
    await flush(30);
    expect(texts()).toEqual(["hola", "Los sábados abrimos de 9 a 12.", "Te escribo mientras estabas desconectado"]);
  });

  it("si el envío falla, 'Reintentar' reusa el MISMO clientMsgId (el backend no lo duplica)", async () => {
    const api = fakeApi();
    const original = api.send.getMockImplementation();
    api.send.mockImplementationOnce(async () => {
      throw new HttpError("No se pudo conectar con el servidor.", { kind: "network" });
    });
    await mount(api);
    await send("mensaje importante");
    expect(root.querySelector(".msg--failed .msg__state--error").textContent).toBe("No se envió.");
    api.send.mockImplementation(original);
    root.querySelector(".msg--failed .link-btn").click();
    await flush(30);
    expect(api.send.mock.calls[1][2]).toBe(api.send.mock.calls[0][2]);
    expect(texts().filter((t) => t === "mensaje importante")).toHaveLength(1);
    expect(root.querySelector(".msg--failed")).toBeNull();
  });

  it("sin sesión, ofrece iniciar el chat y luego abre la conversación", async () => {
    const api = fakeApi();
    api.currentSession.mockRejectedValueOnce(new HttpError("Sesión del chat inválida o expirada", { status: 401 }));
    root = document.createElement("div");
    document.body.append(root);
    cleanup = customerChatView(
      root,
      {},
      {
        widgetApi: api,
        urgencyClient: { classify: async () => ({ level: "normal" }), terminate: () => {} },
        createRealtimeClient: (options) =>
          createRealtimeClient({ ...options, url: "ws://t/ws", WebSocketImpl: FakeWebSocket }),
      }
    );
    await flush(30);
    const start = root.querySelector("form.start");
    expect(start).not.toBeNull();
    start.querySelector("input").value = "Mariana";
    start.requestSubmit();
    await flush(30);
    expect(api.startSession).toHaveBeenCalledWith("Mariana");
    expect(root.querySelector("form.start")).toBeNull();
  });
});
