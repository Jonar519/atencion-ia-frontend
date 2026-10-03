import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import {
  createConnectivityNotice,
  RECONNECT_NOTICE_DELAY_MS,
  RESTORED_VISIBLE_MS,
} from "../src/components/connectivity.js";
import { emptyState, errorState, loadingState } from "../src/components/states.js";
import { agentPanelView } from "../src/views/agent/panel.view.js";
import { customerChatView, EXAMPLE_QUESTIONS } from "../src/views/customer/chat.view.js";
import { route, startRouter } from "../src/router.js";
import { createRealtimeClient } from "../src/realtime/socket.js";
import { HttpError } from "../src/api/http.js";
import { FakeWebSocket, flush } from "./support/fakeWebSocket.js";

/**
 * Estados de la interfaz (Fase 7, D2): esqueleto mientras carga, error con
 * "Reintentar" que vuelve a pedir SOLO esa zona (sin recargar la página),
 * estados vacíos que orientan y el aviso de conectividad.
 */

const networkError = () => new HttpError("No se pudo conectar con el servidor.", { kind: "network" });

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("piezas comunes", () => {
  it("cargando: esqueleto estático con texto para lectores de pantalla (role=status)", () => {
    const el = loadingState("Cargando los casos", { lines: 2 });
    expect(el.getAttribute("role")).toBe("status");
    expect(el.textContent).toBe("Cargando los casos…");
    expect(el.querySelectorAll(".skeleton")).toHaveLength(2);
  });

  it("error: role=alert y 'Reintentar' llama UNA vez (el botón se deshabilita)", () => {
    const retry = vi.fn();
    const el = errorState("Falló.", retry);
    expect(el.getAttribute("role")).toBe("alert");
    const button = el.querySelector("button");
    button.click();
    button.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("vacío: título, orientación y acción opcional", () => {
    const el = emptyState("Nada aún.", "Haz esto.", document.createElement("button"));
    expect(el.textContent).toBe("Nada aún.Haz esto.");
    expect(el.querySelector("button")).not.toBeNull();
  });
});

describe("aviso de conectividad", () => {
  function fakeWin(onLine = true) {
    const listeners = {};
    return {
      navigator: { onLine },
      addEventListener: (type, fn) => (listeners[type] = fn),
      removeEventListener: () => {},
      fire: (type) => listeners[type]?.(),
    };
  }

  it("sin internet: un aviso que dice qué pasa con lo escrito; al volver, 'restablecida' y se va", () => {
    vi.useFakeTimers();
    const win = fakeWin();
    const notice = createConnectivityNotice({ win }).mount();
    expect(notice.el.hidden).toBe(true);
    win.fire("offline");
    expect(notice.state).toBe("offline");
    expect(notice.el.textContent).toMatch(
      /Sin conexión a internet\. Si un mensaje no sale, queda marcado y podrás reintentarlo/
    );
    expect(notice.el.getAttribute("role")).toBe("status");
    win.fire("online");
    expect(notice.state).toBe("restored");
    vi.advanceTimersByTime(RESTORED_VISIBLE_MS);
    expect(notice.el.hidden).toBe(true);
  });

  it("un corte BREVE del WebSocket no muestra nada; uno largo sí, y al reconectar se avisa", () => {
    vi.useFakeTimers();
    const notice = createConnectivityNotice({ win: fakeWin() }).mount();
    notice.socketStatus("panel", "reconnecting");
    vi.advanceTimersByTime(RECONNECT_NOTICE_DELAY_MS - 100);
    notice.socketStatus("panel", "open");
    vi.advanceTimersByTime(RECONNECT_NOTICE_DELAY_MS);
    expect(notice.el.hidden).toBe(true);

    notice.socketStatus("panel", "reconnecting");
    vi.advanceTimersByTime(RECONNECT_NOTICE_DELAY_MS);
    expect(notice.state).toBe("reconnecting");
    notice.socketStatus("panel", "open");
    expect(notice.state).toBe("restored");
  });

  it("sin internet tiene prioridad sobre 'reconectando'; y es UN solo aviso (no una pila)", () => {
    vi.useFakeTimers();
    const win = fakeWin();
    const notice = createConnectivityNotice({ win }).mount();
    notice.socketStatus("chat", "reconnecting");
    vi.advanceTimersByTime(RECONNECT_NOTICE_DELAY_MS);
    win.fire("offline");
    expect(notice.state).toBe("offline");
    expect(document.querySelectorAll(".connectivity")).toHaveLength(1);
  });

  it("si una vista se va mientras reconectaba, deja de contar (no queda el aviso pegado)", () => {
    vi.useFakeTimers();
    const notice = createConnectivityNotice({ win: fakeWin() }).mount();
    notice.socketStatus("chat", "reconnecting");
    vi.advanceTimersByTime(RECONNECT_NOTICE_DELAY_MS);
    notice.socketStatus("chat", "closed");
    vi.advanceTimersByTime(RESTORED_VISIBLE_MS);
    expect(notice.el.hidden).toBe(true);
  });
});

// --- Panel ---------------------------------------------------------------------------------

const STAFF = { id: "a2", name: "Laura Méndez", role: "agent", availability: "available" };
const CASE = {
  id: "c1",
  status: "waiting_agent",
  priority: 90,
  lastMessageAt: new Date().toISOString(),
  customer: { id: "b1", displayName: "Mariana" },
  assignedAgent: null,
  openEscalation: { reason: "possible_fraud", priority: 90 },
  lastMessage: { preview: "Hay una compra que no hice" },
};

function mountPanel(staffApi, notice = { socketStatus: vi.fn() }) {
  const root = document.body.appendChild(document.createElement("div"));
  agentPanelView(
    root,
    {},
    {
      staffApi,
      connectivity: notice,
      session: {
        getStaff: () => STAFF,
        restore: vi.fn(async () => STAFF),
        getAccessToken: () => "token",
        refresh: vi.fn(async () => "token"),
        onSessionChange: () => () => {},
      },
      profileApi: { avatarOf: vi.fn(async () => null) },
      createRealtimeClient: (options) =>
        createRealtimeClient({ ...options, url: "ws://t/ws", WebSocketImpl: FakeWebSocket, backoff: () => 1000 }),
    }
  );
  return root;
}

const button = (root, text) => [...root.querySelectorAll("button")].find((b) => b.textContent === text);

describe("panel: listas", () => {
  it("esqueleto mientras carga; si falla, error en la lista y 'Reintentar' la vuelve a pedir SIN recargar", async () => {
    let release;
    const queue = vi
      .fn()
      .mockImplementationOnce(() => new Promise((_, reject) => (release = () => reject(networkError()))))
      .mockResolvedValueOnce({ items: [CASE] });
    const root = mountPanel({ queue, mine: vi.fn(async () => ({ items: [] })), setAvailability: vi.fn() });
    await flush(10);
    expect(root.querySelector(".cases__status .skeleton-group")).not.toBeNull();
    release();
    await flush(10);
    const alert = root.querySelector(".cases__status [role=alert]");
    // axe (prueba en vivo): un listbox solo puede contener opciones; el error va FUERA de la lista.
    expect(root.querySelector(".cases").children).toHaveLength(0);
    expect(alert.textContent).toMatch(/No se pudieron cargar los casos/);
    const before = window.location.href;
    button(root, "Reintentar").click();
    await flush(20);
    expect(queue).toHaveBeenCalledTimes(2);
    expect(window.location.href).toBe(before);
    expect(root.querySelector(".case .case__who").textContent).toBe("Mariana");
  });

  it("si falla una ACTUALIZACIÓN, la lista que ya se veía se conserva y arriba se ofrece reintentar", async () => {
    const queue = vi
      .fn()
      .mockResolvedValueOnce({ items: [CASE] })
      .mockRejectedValueOnce(networkError());
    const root = mountPanel({ queue, mine: vi.fn(async () => ({ items: [] })), setAvailability: vi.fn() });
    await flush(20);
    const ws = FakeWebSocket.last();
    ws.serverOpen();
    ws.serverSend({ type: "ready", kind: "staff" });
    vi.useFakeTimers();
    ws.serverSend({
      type: "escalation.created",
      conversationId: "c2",
      escalationId: "e2",
      reason: "complaint",
      priority: 60,
      createdAt: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(400);
    vi.useRealTimers();
    await flush(20);
    expect(root.querySelector(".case .case__who")?.textContent).toBe("Mariana");
    expect(root.querySelector(".cases__banner").hidden).toBe(false);
    expect(root.querySelector(".cases__banner").textContent).toMatch(/No se pudo actualizar la lista/);
  });

  it("vacíos que orientan: la cola explica cuándo llegan casos; 'Mis casos' lleva a la cola", async () => {
    const root = mountPanel({
      queue: vi.fn(async () => ({ items: [] })),
      mine: vi.fn(async () => ({ items: [] })),
      setAvailability: vi.fn(),
    });
    await flush(20);
    expect(root.querySelector(".cases__status").textContent).toMatch(
      /aparecerá aquí al instante, el más urgente primero/
    );
    expect(root.querySelector(".cases").children).toHaveLength(0);
    [...root.querySelectorAll("[role=tab]")].find((t) => t.textContent.startsWith("Mis casos")).click();
    expect(root.querySelector(".cases__status").textContent).toMatch(/Toma uno de la cola/);
    button(root, "Ver la cola").click();
    expect(root.querySelector("[role=tab][aria-selected=true]").textContent).toMatch(/^Cola/);
  });

  it("abrir un caso: esqueleto; si falla, error EN el panel con 'Reintentar' que lo vuelve a abrir", async () => {
    const conversation = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ ...CASE, escalations: [] });
    let releaseMessages;
    const messages = vi
      .fn()
      .mockResolvedValueOnce({ items: [] })
      .mockImplementationOnce(() => new Promise((resolve) => (releaseMessages = () => resolve({ items: [] }))));
    const root = mountPanel({
      queue: vi.fn(async () => ({ items: [CASE] })),
      mine: vi.fn(async () => ({ items: [] })),
      conversation,
      messages,
      setAvailability: vi.fn(),
    });
    await flush(20);
    root.querySelector(".case").click();
    await flush(10);
    expect(root.querySelector(".pane [role=alert]").textContent).toMatch(/No se pudo abrir el caso/);
    button(root, "Reintentar").click();
    await flush(5);
    expect(root.querySelector(".pane .skeleton-group")).not.toBeNull(); // esqueleto mientras reintenta
    releaseMessages();
    await flush(20);
    expect(root.querySelector(".pane__title").textContent).toBe("Mariana");
  });

  it("el panel reporta el estado de su WebSocket al aviso de conectividad", async () => {
    const notice = { socketStatus: vi.fn() };
    mountPanel(
      { queue: vi.fn(async () => ({ items: [] })), mine: vi.fn(async () => ({ items: [] })), setAvailability: vi.fn() },
      notice
    );
    await flush(20);
    const ws = FakeWebSocket.last();
    ws.serverOpen();
    ws.serverSend({ type: "ready", kind: "staff" });
    expect(notice.socketStatus).toHaveBeenCalledWith("panel", "open");
  });
});

// --- Chat del cliente --------------------------------------------------------------------------

const CONV = "c0000000-0000-4000-8000-0000000000dd";

function mountChat(widgetApi) {
  const root = document.body.appendChild(document.createElement("div"));
  customerChatView(
    root,
    {},
    {
      widgetApi,
      connectivity: { socketStatus: vi.fn() },
      urgencyClient: { classify: async () => ({ level: "normal" }), terminate: () => {} },
      createRealtimeClient: (options) =>
        createRealtimeClient({ ...options, url: "ws://t/ws", WebSocketImpl: FakeWebSocket, backoff: () => 1000 }),
    }
  );
  return root;
}

describe("chat del cliente", () => {
  it("si ni siquiera se pudo consultar la sesión: error con 'Reintentar' que vuelve a arrancar (antes no había)", async () => {
    const api = {
      currentSession: vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce({}),
      conversations: vi.fn(async () => ({ items: [{ id: CONV, status: "ai_active" }] })),
      newConversation: vi.fn(),
      messages: vi.fn(async () => ({ items: [] })),
    };
    const root = mountChat(api);
    await flush(20);
    expect(root.querySelector(".chat__fatal [role=alert]").textContent).toMatch(/No se pudo conectar/);
    expect(root.querySelector(".chat").hidden).toBe(true);
    button(root, "Reintentar").click();
    await flush(30);
    expect(api.currentSession).toHaveBeenCalledTimes(2);
    expect(root.querySelector(".chat__fatal")).toBeNull();
    expect(root.querySelector(".chat").hidden).toBe(false);
  });

  it("si falla abrir la conversación (antes quedaba un error sin capturar): error en el chat y 'Reintentar'", async () => {
    const api = {
      currentSession: vi.fn(async () => ({})),
      conversations: vi
        .fn()
        .mockRejectedValueOnce(networkError())
        .mockResolvedValueOnce({ items: [{ id: CONV, status: "ai_active" }] }),
      newConversation: vi.fn(),
      messages: vi.fn(async () => ({ items: [] })),
    };
    const root = mountChat(api);
    await flush(20);
    expect(root.querySelector(".chat__messages [role=alert]").textContent).toMatch(/No pudimos abrir tu conversación/);
    expect(root.querySelector("form.chat__composer").hidden).toBe(true); // no se puede escribir a una conversación que no abrió
    button(root, "Reintentar").click();
    await flush(30);
    expect(api.conversations).toHaveBeenCalledTimes(2);
    expect(root.querySelector("form.chat__composer").hidden).toBe(false);
  });

  it("conversación vacía: orienta con ejemplos que se ESCRIBEN en la caja, no se envían", async () => {
    const api = {
      currentSession: vi.fn(async () => ({})),
      conversations: vi.fn(async () => ({ items: [{ id: CONV, status: "ai_active" }] })),
      newConversation: vi.fn(),
      messages: vi.fn(async () => ({ items: [] })),
      send: vi.fn(),
    };
    const root = mountChat(api);
    await flush(30);
    expect(root.querySelector(".chat__empty").textContent).toMatch(/¿En qué te podemos ayudar\?/);
    button(root, EXAMPLE_QUESTIONS[0]).click();
    expect(root.querySelector("textarea").value).toBe(EXAMPLE_QUESTIONS[0]);
    await flush(20); // si se hubiera enviado (asíncrono), ya se vería
    expect(api.send).not.toHaveBeenCalled();
  });
});

describe("foco del <h1> al cambiar de pantalla (pendiente del bloque A)", () => {
  it("el router sigue enfocando el <h1> (el lector de pantalla anuncia la pantalla)", async () => {
    route("/prueba-foco", (root) => {
      root.replaceChildren(Object.assign(document.createElement("h1"), { textContent: "Pantalla" }));
      return () => {};
    });
    window.location.hash = "#/prueba-foco";
    const root = document.body.appendChild(document.createElement("div"));
    await startRouter(root);
    const h1 = root.querySelector("h1");
    expect(h1.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(h1);
  });

  it("...pero sin el recuadro de foco: el contorno se quita SOLO a lo no interactivo (tabindex=-1)", () => {
    const css = fs.readFileSync("src/styles/base.css", "utf8");
    expect(css).toMatch(/\[tabindex="-1"\]:focus,\s*\[tabindex="-1"\]:focus-visible\s*\{\s*outline: none;/);
    // Lo interactivo conserva el contorno general.
    expect(css).toMatch(/:focus-visible \{\s*outline: 3px solid var\(--focus\);/);
  });
});
