import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { barHeights, createWaveform, LEVEL_MAX } from "../src/components/waveform.js";
import { callBar } from "../src/components/callBar.js";
import { createSentimentBadge, latestSentiment, trendOf } from "../src/components/sentimentBadge.js";
import { customerChatView } from "../src/views/customer/chat.view.js";
import { agentPanelView } from "../src/views/agent/panel.view.js";
import { createRealtimeClient } from "../src/realtime/socket.js";
import { createVoiceSession } from "../src/voice/voiceSession.js";
import { FakeWebSocket, flush } from "./support/fakeWebSocket.js";
import { FakeAudioContext, FakeRTCPeerConnection, fakeOpenMicrophone } from "./support/fakeAudio.js";

/**
 * Dirección visual "en vivo" (Fase 7, D1): forma de onda en canvas, insignia
 * del acento en vivo, la ÚNICA transición animada (traspaso de la IA a un
 * asesor durante la llamada) y el ánimo del cliente en vivo en el panel.
 */

/** Ventana falsa con un canvas 2D que registra lo que se dibuja. */
function fakeWindow({ reduced = false, hidden = false } = {}) {
  const frames = [];
  const win = {
    devicePixelRatio: 1,
    document: { hidden },
    matchMedia: (q) => ({ matches: reduced && q.includes("reduced-motion") }),
    getComputedStyle: () => ({ getPropertyValue: (name) => (name === "--color-live-call" ? "#00c2d1" : "#c3cedb") }),
    requestAnimationFrame: (fn) => frames.push(fn),
    cancelAnimationFrame: () => {},
  };
  return { win, frames, runFrame: () => frames.splice(0).forEach((fn) => fn()) };
}

function recordingContext() {
  const rects = [];
  const ctx = {
    rects,
    fillStyle: "",
    globalAlpha: 1,
    setTransform: () => {},
    clearRect: () => rects.splice(0),
    fillRect: (x, y, w, h) => rects.push({ x, y, w, h, color: ctx.fillStyle }),
  };
  return ctx;
}

function waveformWithCanvas(options) {
  const ctx = recordingContext();
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = () => ctx;
  try {
    return { ...createWaveform(options), ctx };
  } finally {
    HTMLCanvasElement.prototype.getContext = original;
  }
}

describe("forma de onda (canvas 2D, mismo nivel que el medidor)", () => {
  it("alto de cada barra proporcional al nivel, con un mínimo visible y tope en el máximo del medidor", () => {
    expect(barHeights([0, LEVEL_MAX / 2, LEVEL_MAX, 1, -1], 36)).toEqual([2, 18, 36, 36, 2]);
  });

  it("guarda los últimos niveles (el más reciente a la derecha) y dibuja una barra por nivel", () => {
    const { win, runFrame } = fakeWindow();
    const wave = waveformWithCanvas({ samples: 4, win });
    wave.push(0.3);
    wave.push(0.15);
    expect(wave.levels()).toEqual([0, 0, 0.3, 0.15]);
    runFrame();
    expect(wave.ctx.rects).toHaveLength(4);
    expect(wave.ctx.rects.map((r) => r.h)).toEqual([2, 2, 36, 18]);
    expect(wave.ctx.rects[0].color).toBe("#00c2d1"); // acento "llamada en curso"
  });

  it("varios niveles en el mismo cuadro se dibujan UNA vez (requestAnimationFrame)", () => {
    const { win, frames } = fakeWindow();
    const wave = waveformWithCanvas({ win });
    for (let i = 0; i < 10; i++) wave.push(0.1);
    expect(frames).toHaveLength(1);
  });

  it("con la pestaña oculta no dibuja (no gasta CPU en segundo plano)", () => {
    const { win, runFrame } = fakeWindow({ hidden: true });
    const wave = waveformWithCanvas({ win });
    wave.push(0.2);
    runFrame();
    expect(wave.ctx.rects).toEqual([]);
  });

  it("prefers-reduced-motion: sin historial que se desplaza, una sola barra con el nivel actual", () => {
    const { win, runFrame } = fakeWindow({ reduced: true });
    const wave = waveformWithCanvas({ win, width: 240 });
    wave.push(LEVEL_MAX);
    runFrame();
    expect(wave.ctx.rects).toHaveLength(1);
    expect(wave.ctx.rects[0].w).toBe(240);
  });

  it("silenciado dibuja plano (nivel 0) y con el color atenuado; detenida, ignora niveles", () => {
    const { win, runFrame } = fakeWindow();
    const wave = waveformWithCanvas({ samples: 2, win });
    wave.setMuted(true);
    wave.push(0.3);
    runFrame();
    expect(wave.levels()).toEqual([0, 0]);
    expect(wave.ctx.rects[0].color).toBe("#c3cedb");
    wave.stop();
    wave.push(0.3);
    expect(wave.levels()).toEqual([0, 0]);
  });
});

describe("barra de la llamada: acento en vivo y la única transición", () => {
  const noop = () => {};
  const makeBar = () => callBar({ role: "customer", onMute: noop, onHangup: noop });

  it("la forma de onda se ve y el <meter> queda solo para lectores de pantalla", () => {
    const bar = makeBar();
    expect(bar.el.querySelector("canvas.waveform").getAttribute("aria-hidden")).toBe("true");
    expect(bar.el.querySelector("meter").classList.contains("sr-only")).toBe(true);
    bar.setLevel(0.1);
    expect(bar.el.querySelector("meter").value).toBeCloseTo(0.1);
    // El MISMO nivel alimenta la forma de onda (no se mide nada nuevo).
    expect(bar.waveform.levels().at(-1)).toBe(0.1);
    bar.setMuted(true);
    bar.setLevel(0.2);
    expect(bar.waveform.levels().at(-1)).toBe(0);
  });

  it("insignia con TEXTO: 'Llamada en curso' (cian) → 'Asesor conectado' (menta)", () => {
    const bar = makeBar();
    bar.setState("active", "En llamada");
    const live = bar.el.querySelector(".callbar__live");
    expect(live.hidden).toBe(false);
    expect(live.textContent).toBe("Llamada en curso");
    expect(live.dataset.live).toBe("call");
    bar.setAgentConnected(true);
    expect(live.textContent).toBe("Asesor conectado");
    expect(bar.el.dataset.live).toBe("agent");
    bar.setState("ended", "Llamada terminada");
    expect(live.hidden).toBe(true);
  });

  it("el traspaso se anuncia UNA vez: el borde pasa a menta al TERMINAR el barrido (no al empezar)", () => {
    const bar = makeBar();
    bar.announceHandoff();
    expect(bar.el.classList.contains("callbar--handoff")).toBe(true);
    expect(bar.el.dataset.handoff).toBeUndefined(); // mientras barre, el borde conserva su color
    bar.el.dispatchEvent(new Event("animationend"));
    expect(bar.el.classList.contains("callbar--handoff")).toBe(false);
    expect(bar.el.dataset.handoff).toBe("done");
    bar.announceHandoff();
    expect(bar.el.classList.contains("callbar--handoff")).toBe(false);
  });

  it("con prefers-reduced-motion no hay animación: el color cambia al instante", () => {
    const original = globalThis.matchMedia;
    globalThis.matchMedia = (q) => ({ matches: q.includes("reduced-motion") });
    try {
      const bar = makeBar();
      bar.announceHandoff();
      expect(bar.el.classList.contains("callbar--handoff")).toBe(false);
      expect(bar.el.dataset.handoff).toBe("done");
    } finally {
      globalThis.matchMedia = original;
    }
  });

  it("si el navegador no emite animationend, igual termina (respaldo con temporizador)", () => {
    vi.useFakeTimers();
    try {
      const bar = makeBar();
      bar.announceHandoff();
      vi.advanceTimersByTime(2100);
      expect(bar.el.dataset.handoff).toBe("done");
      expect(bar.el.classList.contains("callbar--handoff")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// --- Integración: el traspaso durante una llamada real del widget -----------------------------

const CONV = "c0000000-0000-4000-8000-0000000000cc";
const CALL = "d0000000-0000-4000-8000-0000000000cc";
let root;
let cleanup;

beforeEach(() => {
  FakeWebSocket.reset();
  FakeRTCPeerConnection.reset();
  FakeAudioContext.reset();
});
afterEach(() => {
  cleanup?.();
  root?.remove();
});

async function customerInCall(status = "ai_active") {
  const { open, mic } = fakeOpenMicrophone();
  root = document.body.appendChild(document.createElement("div"));
  cleanup = customerChatView(
    root,
    {},
    {
      widgetApi: {
        currentSession: vi.fn(async () => ({})),
        conversations: vi.fn(async () => ({ items: [{ id: CONV, status }] })),
        newConversation: vi.fn(),
        messages: vi.fn(async () => ({ items: [] })),
        send: vi.fn(),
        voiceConsent: vi.fn(async () => ({ version: "v1", title: "Antes de llamar", points: ["x"] })),
        startCall: vi.fn(async () => ({ call: { id: CALL, status: "connecting" }, iceServers: [] })),
        endCall: vi.fn(async () => {}),
      },
      urgencyClient: { classify: async () => ({ level: "normal" }), terminate: () => {} },
      createRealtimeClient: (options) =>
        createRealtimeClient({ ...options, url: "ws://t/ws", WebSocketImpl: FakeWebSocket, backoff: () => 1000 }),
      voice: {
        openMicrophone: open,
        AudioContext: FakeAudioContext,
        createVoiceSession: (options) =>
          createVoiceSession({
            ...options,
            url: "ws://t/ws/voice",
            WebSocketImpl: FakeWebSocket,
            RTCPeerConnectionImpl: FakeRTCPeerConnection,
            backoff: () => 1000,
          }),
      },
    }
  );
  await flush(30);
  const events = FakeWebSocket.instances.find((ws) => ws.url === "ws://t/ws");
  events.serverOpen();
  events.serverSend({ type: "ready", kind: "customer" });
  [...root.querySelectorAll("button")].find((b) => b.textContent === "Llamar").click();
  await flush(20);
  const checkbox = root.querySelector(".consent input[type=checkbox]");
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  [...root.querySelectorAll("button")].find((b) => b.textContent === "Aceptar y llamar").click();
  await flush(30);
  const voice = FakeWebSocket.instances.filter((ws) => ws.url.endsWith("/ws/voice")).at(-1);
  voice.serverOpen();
  voice.serverSend({ type: "ready", role: "customer", call: { id: CALL, status: "in_progress" }, iceServers: [] });
  await flush(20);
  return { events, voice, mic, bar: root.querySelector(".callbar") };
}

describe("traspaso en una llamada real del widget", () => {
  it("IA → en espera de asesor: la barra hace su barrido UNA vez; cuando el asesor entra, 'Asesor conectado'", async () => {
    const { events, voice, mic, bar } = await customerInCall();
    mic.speak(0.12); // el nivel del micrófono llega a la forma de onda de la barra
    expect(bar.querySelector("meter").value).toBeCloseTo(0.12);
    expect(bar.querySelector("canvas.waveform")).not.toBeNull();
    expect(bar.classList.contains("callbar--handoff")).toBe(false);

    events.serverSend({
      type: "conversation.updated",
      conversation: { id: CONV, status: "waiting_agent" },
      visible: true,
    });
    await flush();
    expect(bar.classList.contains("callbar--handoff")).toBe(true);
    expect(bar.querySelector(".callbar__status").textContent).toMatch(/pasando con un asesor/);

    bar.dispatchEvent(new Event("animationend"));
    events.serverSend({
      type: "conversation.updated",
      conversation: { id: CONV, status: "agent_active" },
      visible: true,
    });
    await flush();
    expect(bar.classList.contains("callbar--handoff")).toBe(false); // UNA sola vez por llamada

    voice.serverSend({ type: "peer", role: "agent", present: true });
    expect(bar.querySelector(".callbar__live").textContent).toBe("Asesor conectado");
  });

  it("si la llamada empieza con el caso YA escalado, no hay barrido (no es una transición)", async () => {
    const { events, bar } = await customerInCall("waiting_agent");
    events.serverSend({
      type: "conversation.updated",
      conversation: { id: CONV, status: "agent_active" },
      visible: true,
    });
    await flush();
    expect(bar.classList.contains("callbar--handoff")).toBe(false);
  });
});

describe("ánimo del cliente en vivo (panel)", () => {
  it("toma el ÚLTIMO mensaje del cliente con análisis y dice si empeoró o mejoró", () => {
    const msgs = [
      { senderType: "customer", sentiment: "neutral" },
      { senderType: "ai", sentiment: null },
      { senderType: "customer", sentiment: "angry" },
      { senderType: "customer", sentiment: null }, // p. ej. un adjunto sin comentario: no cuenta
    ];
    expect(latestSentiment(msgs)).toEqual({ current: "angry", previous: "neutral" });
    expect(trendOf("angry", "neutral")).toBe("empeoró");
    expect(trendOf("positive", "negative")).toBe("mejoró");
    expect(trendOf("neutral", "neutral")).toBeNull();
  });

  it("el texto solo cambia cuando cambia el ánimo (el lector de pantalla no lo repite)", () => {
    const badge = createSentimentBadge();
    expect(badge.el.hidden).toBe(true);
    badge.update([{ senderType: "customer", sentiment: "negative" }]);
    expect(badge.el.textContent).toBe("Ánimo del cliente: Molesto");
    expect(badge.el.getAttribute("role")).toBe("status");
    const node = badge.el.firstChild;
    badge.update([{ senderType: "customer", sentiment: "negative" }]);
    expect(badge.el.firstChild).toBe(node);
  });

  it("en el panel se actualiza con cada mensaje del cliente que llega por el WebSocket", async () => {
    const STAFF = { id: "a2", name: "Laura Méndez", role: "agent", availability: "available" };
    const CASE = {
      id: "c1",
      status: "agent_active",
      priority: 60,
      lastMessageAt: new Date().toISOString(),
      customer: { id: "b1", displayName: "Mariana" },
      assignedAgent: { id: "a2", name: "Laura Méndez" },
      openEscalation: { reason: "human_requested", priority: 60 },
      lastMessage: { preview: "hola" },
    };
    root = document.body.appendChild(document.createElement("div"));
    cleanup = agentPanelView(
      root,
      {},
      {
        staffApi: {
          queue: vi.fn(async () => ({ items: [] })),
          mine: vi.fn(async () => ({ items: [CASE] })),
          conversation: vi.fn(async () => ({ ...CASE, escalations: [] })),
          messages: vi.fn(async () => ({
            items: [
              {
                id: "m1",
                senderType: "customer",
                content: "Hola",
                createdAt: "2026-10-02T10:00:00Z",
                sentiment: "neutral",
              },
            ],
          })),
          setAvailability: vi.fn(),
        },
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
    await flush(40);
    const ws = FakeWebSocket.last();
    ws.serverOpen();
    ws.serverSend({ type: "ready", kind: "staff" });
    [...root.querySelectorAll("[role=tab]")].find((t) => t.textContent.startsWith("Mis casos")).click();
    root.querySelector(".case").click();
    await flush(40);
    const badge = root.querySelector(".pane__meta .sentiment");
    expect(badge.textContent).toBe("Ánimo del cliente: Neutral");

    ws.serverSend({
      type: "message.created",
      conversation: { id: "c1", status: "agent_active", assignedAgentId: "a2", customerId: "b1" },
      message: {
        id: "m2",
        conversationId: "c1",
        senderType: "customer",
        channel: "text",
        content: "¡Esto es inaceptable!",
        createdAt: "2026-10-02T10:01:00Z",
        clientMsgId: null,
        agent: null,
        attachment: null,
        intent: "complaint",
        sentiment: "angry",
      },
    });
    await flush(10);
    expect(root.querySelector(".pane__meta .sentiment").textContent).toBe("Ánimo del cliente: Muy molesto (empeoró)");
    expect(root.querySelector(".pane__meta .sentiment").classList.contains("sentiment--angry")).toBe(true);
  });
});
