import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { customerChatView } from "../src/views/customer/chat.view.js";
import { agentPanelView } from "../src/views/agent/panel.view.js";
import { createRealtimeClient } from "../src/realtime/socket.js";
import { createVoiceSession } from "../src/voice/voiceSession.js";
import { HttpError } from "../src/api/http.js";
import { FakeWebSocket, flush } from "./support/fakeWebSocket.js";
import { FakeAudioContext, FakeRTCPeerConnection, fakeOpenMicrophone } from "./support/fakeAudio.js";

/**
 * La llamada desde la interfaz, de punta a punta con red, micrófono, audio y
 * WebRTC simulados: widget del cliente (Llamar → aviso → micrófono → llamada)
 * y panel del agente (Unirse → micrófono → unirse → WebRTC).
 */

const CONV = "c0000000-0000-4000-8000-0000000000aa";
const CALL = "d0000000-0000-4000-8000-0000000000aa";
const NOTICE = {
  version: "voz-v7",
  title: "Antes de llamar",
  points: ["El audio NO se graba.", "La transcripción se guarda 90 días."],
};

const voiceSockets = () => FakeWebSocket.instances.filter((ws) => ws.url.endsWith("/ws/voice"));
const lastVoice = () => voiceSockets().at(-1);

function voiceDeps({ deny = false } = {}) {
  const { open, mic } = fakeOpenMicrophone({ deny });
  return {
    mic,
    open,
    deps: {
      openMicrophone: open,
      AudioContext: FakeAudioContext,
      createVoiceSession: (options) =>
        createVoiceSession({
          ...options,
          url: "ws://t/ws/voice",
          WebSocketImpl: FakeWebSocket,
          RTCPeerConnectionImpl: FakeRTCPeerConnection,
          backoff: () => 1_000,
        }),
    },
  };
}

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
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

function customerApi(overrides = {}) {
  const order = [];
  return {
    order,
    currentSession: vi.fn(async () => ({ customerId: "b1" })),
    conversations: vi.fn(async () => ({ items: [{ id: CONV, status: "ai_active" }] })),
    newConversation: vi.fn(),
    messages: vi.fn(async () => ({ items: [] })),
    send: vi.fn(),
    endSession: vi.fn(async () => {}),
    voiceConsent: vi.fn(async () => NOTICE),
    startCall: vi.fn(async () => {
      order.push("startCall");
      return { call: { id: CALL, status: "connecting" }, iceServers: [] };
    }),
    endCall: vi.fn(async () => {}),
    ...overrides,
  };
}

async function mountCustomer(api, voice) {
  root = document.createElement("div");
  document.body.append(root);
  cleanup = customerChatView(
    root,
    {},
    {
      widgetApi: api,
      urgencyClient: { classify: async () => ({ level: "normal" }), terminate: () => {} },
      createRealtimeClient: (options) =>
        createRealtimeClient({ ...options, url: "ws://t/ws", WebSocketImpl: FakeWebSocket, backoff: () => 1_000 }),
      voice: voice.deps,
    }
  );
  await flush(30);
}

const callButton = () => [...root.querySelectorAll(".chat__header button")].find((b) => b.textContent === "Llamar");
const button = (text) => [...root.querySelectorAll("button")].find((b) => b.textContent === text);

async function openConsent() {
  callButton().click();
  await flush(20);
  return root.querySelector(".consent");
}

async function acceptAndCall() {
  const consent = await openConsent();
  const checkbox = consent.querySelector("input[type=checkbox]");
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  button("Aceptar y llamar").click();
  await flush(30);
}

async function customerInCall() {
  const api = customerApi();
  const voice = voiceDeps();
  await mountCustomer(api, voice);
  await acceptAndCall();
  const ws = lastVoice();
  ws.serverOpen();
  ws.serverSend({ type: "ready", role: "customer", call: { id: CALL, status: "in_progress" }, iceServers: [] });
  await flush(20);
  return { api, voice, ws };
}

describe("llamada desde el widget del cliente", () => {
  it("si el caso ya lo atiende un asesor, la barra NO dice 'asistente virtual' (la IA no responde)", async () => {
    const api = customerApi({ conversations: vi.fn(async () => ({ items: [{ id: CONV, status: "agent_active" }] })) });
    await mountCustomer(api, voiceDeps());
    await acceptAndCall();
    const ws = lastVoice();
    ws.serverOpen();
    ws.serverSend({ type: "ready", role: "customer", call: { id: CALL, status: "in_progress" }, iceServers: [] });
    await flush(10);
    const status = root.querySelector(".callbar__status").textContent;
    expect(status).not.toMatch(/asistente virtual/);
    expect(status).toMatch(/Tu asesor puede unirse/);
  });

  it("el botón 'Llamar' aparece al abrir la conversación y muestra el aviso vigente del servidor", async () => {
    const api = customerApi();
    await mountCustomer(api, voiceDeps());
    expect(callButton().hidden).toBe(false);
    const consent = await openConsent();
    expect(consent.textContent).toContain("El audio NO se graba.");
    expect(consent.getAttribute("role")).toBe("dialog");
  });

  it("sin marcar 'Leí y acepto' NO se puede llamar: ni micrófono ni llamada", async () => {
    const api = customerApi();
    const voice = voiceDeps();
    await mountCustomer(api, voice);
    await openConsent();
    const accept = button("Aceptar y llamar");
    expect(accept.disabled).toBe(true);
    accept.click();
    await flush(20);
    expect(voice.open).not.toHaveBeenCalled();
    expect(api.startCall).not.toHaveBeenCalled();
  });

  it("'Prefiero seguir por chat' cierra el aviso sin pedir micrófono", async () => {
    const api = customerApi();
    const voice = voiceDeps();
    await mountCustomer(api, voice);
    await openConsent();
    button("Prefiero seguir por chat").click();
    await flush();
    expect(root.querySelector(".consent")).toBeNull();
    expect(voice.open).not.toHaveBeenCalled();
    expect(callButton().hidden).toBe(false);
  });

  it("al aceptar: PRIMERO el micrófono, DESPUÉS la llamada, con la versión del aviso MOSTRADO", async () => {
    const api = customerApi();
    const voice = voiceDeps();
    voice.open.mockImplementation(async () => {
      api.order.push("micrófono");
      return voice.mic;
    });
    await mountCustomer(api, voice);
    await acceptAndCall();
    expect(api.order).toEqual(["micrófono", "startCall"]);
    expect(api.startCall).toHaveBeenCalledWith(CONV, "voz-v7");
    // El socket de voz se autentica con la cookie: sin token en el mensaje ni en la URL.
    const ws = lastVoice();
    ws.serverOpen();
    expect(ws.sent[0]).toEqual({ type: "auth", callId: CALL });
    expect(ws.url).toBe("ws://t/ws/voice");
  });

  it("si el cliente niega el micrófono, NO se crea la llamada y se explica qué hacer", async () => {
    const api = customerApi();
    await mountCustomer(api, voiceDeps({ deny: true }));
    await acceptAndCall();
    expect(api.startCall).not.toHaveBeenCalled();
    expect(root.querySelector(".chat__call .form-error").textContent).toMatch(/permiso para usar el micrófono/);
    expect(callButton().hidden).toBe(false);
  });

  it("si el servidor rechaza la llamada, el micrófono se APAGA y se muestra el motivo", async () => {
    const api = customerApi({
      startCall: vi.fn(async () => {
        throw new HttpError("Ya hay una llamada en curso en esta conversación.", { status: 409 });
      }),
    });
    const voice = voiceDeps();
    await mountCustomer(api, voice);
    await acceptAndCall();
    expect(voice.mic.track.stopped).toBe(true);
    expect(root.querySelector(".chat__call .form-error").textContent).toMatch(/Ya hay una llamada/);
  });

  it("en llamada: estado, medidor 'Te escuchamos', lo que se entiende (como TEXTO) y el asistente hablando", async () => {
    const { voice, ws } = await customerInCall();
    const bar = root.querySelector(".callbar");
    expect(bar.querySelector(".callbar__status").textContent).toBe("En llamada con el asistente virtual");
    expect(callButton().hidden).toBe(true);

    voice.mic.speak(0.1);
    expect(bar.querySelector(".callbar__heard").hidden).toBe(false);
    expect(ws.binary).toHaveLength(1);
    voice.mic.speak(0.001);
    expect(bar.querySelector(".callbar__heard").hidden).toBe(true);

    ws.serverSend({ type: "transcript.partial", speaker: "customer", text: '<img src=x onerror="alert(1)"> Hola' });
    const partial = bar.querySelector(".callbar__partial");
    expect(partial.textContent).toBe('Estás diciendo: <img src=x onerror="alert(1)"> Hola');
    expect(partial.querySelector("img")).toBeNull();

    ws.serverSend({ type: "tts.start", messageId: "m1", text: "Según nuestra información…", durationMs: 500 });
    expect(bar.querySelector(".callbar__hint").textContent).toMatch(/micrófono está en pausa/);
    expect(button("Interrumpir").hidden).toBe(false);

    ws.serverSend({ type: "call.status", status: "waiting_agent" });
    expect(bar.querySelector(".callbar__status").textContent).toMatch(/pasando con un asesor/);
    ws.serverSend({ type: "peer", role: "agent", present: true });
    expect(bar.querySelector(".callbar__status").textContent).toBe("En llamada con un asesor");
    // Si el asesor sale, NO se dice que vuelve el asistente (el caso sigue a cargo del asesor).
    ws.serverSend({ type: "peer", role: "agent", present: false });
    expect(bar.querySelector(".callbar__status").textContent).toMatch(/El asesor salió de la llamada/);
  });

  it("silenciar detiene el envío de audio y lo indica", async () => {
    const { voice, ws } = await customerInCall();
    button("Silenciar").click();
    voice.mic.speak(0.2);
    expect(ws.binary).toHaveLength(0);
    expect(button("Activar micrófono").getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector(".callbar__heard").hidden).toBe(true);
  });

  it("colgar: avisa por el socket y por REST, y apaga el micrófono", async () => {
    const { api, voice, ws } = await customerInCall();
    button("Colgar").click();
    await flush();
    expect(ws.sent.at(-1)).toEqual({ type: "hangup" });
    expect(api.endCall).toHaveBeenCalledWith(CALL);
    expect(voice.mic.track.stopped).toBe(true);
    expect(root.querySelector(".callbar").dataset.state).toBe("ended");
  });

  it("salir de la página con una llamada abierta la cuelga (no queda el micrófono encendido)", async () => {
    const { api, voice } = await customerInCall();
    cleanup();
    cleanup = null;
    expect(api.endCall).toHaveBeenCalledWith(CALL);
    expect(voice.mic.track.stopped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Agente
// ---------------------------------------------------------------------------

const LAURA = { id: "a2", name: "Laura Méndez", role: "agent", availability: "available" };

function agentApi({
  status = "waiting_agent",
  assignedAgent = null,
  calls = [{ id: CALL, status: "waiting_agent" }],
} = {}) {
  const order = [];
  const item = {
    id: CONV,
    status,
    priority: 90,
    lastMessageAt: new Date().toISOString(),
    customer: { id: "b1", displayName: "Mariana" },
    assignedAgent,
    openEscalation: { reason: "possible_fraud", priority: 90 },
    lastMessage: { preview: "No reconozco un cargo" },
  };
  return {
    order,
    queue: vi.fn(async () => ({ items: status === "waiting_agent" ? [item] : [] })),
    mine: vi.fn(async () => ({ items: status === "agent_active" ? [item] : [] })),
    conversation: vi.fn(async () => ({ ...item, escalations: [], calls })),
    messages: vi.fn(async () => ({ items: [] })),
    take: vi.fn(),
    close: vi.fn(),
    reply: vi.fn(),
    setAvailability: vi.fn(),
    joinCall: vi.fn(async () => {
      order.push("joinCall");
      return { call: { id: CALL }, transcript: [] };
    }),
    leaveCall: vi.fn(async () => {}),
    endCall: vi.fn(async () => {}),
  };
}

function agentSession() {
  return {
    getStaff: () => LAURA,
    restore: vi.fn(async () => LAURA),
    getAccessToken: () => "token-en-memoria",
    refresh: vi.fn(async () => "token-nuevo"),
    logout: vi.fn(async () => {}),
    onSessionChange: () => () => {},
  };
}

async function mountPanel(api, voice) {
  root = document.createElement("div");
  document.body.append(root);
  cleanup = agentPanelView(
    root,
    {},
    {
      staffApi: api,
      session: agentSession(),
      voice: voice.deps,
      createRealtimeClient: (options) =>
        createRealtimeClient({ ...options, url: "ws://t/ws", WebSocketImpl: FakeWebSocket, backoff: () => 1_000 }),
    }
  );
  await flush(40);
  root.querySelector(".case")?.click();
  await flush(40);
}

describe("unirse a la llamada desde el panel", () => {
  it("el botón aparece para un caso en cola con llamada activa, y no si no hay llamada", async () => {
    await mountPanel(agentApi(), voiceDeps());
    expect(button("Unirse a la llamada")).toBeTruthy();
    cleanup();
    root.remove();
    await mountPanel(agentApi({ calls: [{ id: CALL, status: "ended" }] }), voiceDeps());
    expect(button("Unirse a la llamada")).toBeUndefined();
  });

  it("PRIMERO el micrófono, DESPUÉS unirse (que toma el caso); el socket de voz se autentica con el token en memoria", async () => {
    const api = agentApi();
    const voice = voiceDeps();
    voice.open.mockImplementation(async () => {
      api.order.push("micrófono");
      return voice.mic;
    });
    await mountPanel(api, voice);
    button("Unirse a la llamada").click();
    await flush(40);
    expect(api.order).toEqual(["micrófono", "joinCall"]);
    const ws = lastVoice();
    ws.serverOpen();
    await flush();
    expect(ws.sent[0]).toEqual({ type: "auth", callId: CALL, accessToken: "token-en-memoria" });
    expect(ws.url).not.toContain("token");
  });

  it("si el agente niega el micrófono, NO se une (no toma el caso)", async () => {
    const api = agentApi();
    await mountPanel(api, voiceDeps({ deny: true }));
    button("Unirse a la llamada").click();
    await flush(40);
    expect(api.joinCall).not.toHaveBeenCalled();
    expect(voiceSockets()).toHaveLength(0);
  });

  it("si unirse falla (otro lo tomó), el micrófono se APAGA", async () => {
    const api = agentApi();
    api.joinCall.mockRejectedValue(new HttpError("Otro agente ya tomó esta conversación", { status: 409 }));
    const voice = voiceDeps();
    await mountPanel(api, voice);
    button("Unirse a la llamada").click();
    await flush(40);
    expect(voice.mic.track.stopped).toBe(true);
    expect(voiceSockets()).toHaveLength(0);
  });

  it("en la llamada: ofrece WebRTC cuando el cliente está, oye al cliente, y 'Salir' no cuelga", async () => {
    const api = agentApi();
    const voice = voiceDeps();
    await mountPanel(api, voice);
    button("Unirse a la llamada").click();
    await flush(40);
    const ws = lastVoice();
    ws.serverOpen();
    await flush();
    ws.serverSend({ type: "ready", role: "agent", call: { id: CALL, status: "in_progress" }, iceServers: [] });
    ws.serverSend({ type: "peer", role: "customer", present: true });
    await flush(20);
    expect(ws.sent.at(-1)).toEqual({ type: "signal", signal: { type: "offer", sdp: "v=0 oferta" } });
    const dock = root.querySelector(".call-dock");
    expect(dock.hidden).toBe(false);
    expect(dock.querySelector(".callbar__peer").textContent).toMatch(/Audio con el cliente/);
    // Ya en llamada, no se ofrece unirse otra vez.
    expect(button("Unirse a la llamada")).toBeUndefined();

    button("Salir de la llamada").click();
    await flush();
    expect(api.leaveCall).toHaveBeenCalledWith(CALL);
    expect(api.endCall).not.toHaveBeenCalled();
    expect(ws.sent.some((m) => m.type === "hangup")).toBe(false);
    expect(voice.mic.track.stopped).toBe(true);
  });

  it("'Colgar' termina la llamada para todos", async () => {
    const api = agentApi();
    const voice = voiceDeps();
    await mountPanel(api, voice);
    button("Unirse a la llamada").click();
    await flush(40);
    const ws = lastVoice();
    ws.serverOpen();
    ws.serverSend({ type: "ready", role: "agent", call: { id: CALL, status: "in_progress" }, iceServers: [] });
    await flush();
    button("Colgar").click();
    await flush();
    expect(ws.sent.at(-1)).toEqual({ type: "hangup" });
    expect(api.endCall).toHaveBeenCalledWith(CALL);
    expect(voice.mic.track.stopped).toBe(true);
  });
});
