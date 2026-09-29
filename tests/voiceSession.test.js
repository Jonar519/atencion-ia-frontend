import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceSession, VOICE_CLOSE } from "../src/voice/voiceSession.js";
import { FakeWebSocket, flush } from "./support/fakeWebSocket.js";
import { FakeAudioContext, FakeRTCPeerConnection, fakeMicrophone } from "./support/fakeAudio.js";

/** Sesión de voz con socket, micrófono, audio y WebRTC simulados. */

const CALL = "d0000000-0000-4000-8000-0000000000aa";

function setup({ role = "customer", auth } = {}) {
  const mic = fakeMicrophone();
  const context = new FakeAudioContext();
  const remoteAudio = { srcObject: null, play: vi.fn(async () => {}) };
  const events = { states: [], notices: [], ended: [], partials: [], speaking: [] };
  const onAuthExpired = vi.fn(async () => {});
  const session = createVoiceSession({
    role,
    authMessage: async () =>
      auth ??
      (role === "agent"
        ? { type: "auth", callId: CALL, accessToken: "token-en-memoria" }
        : { type: "auth", callId: CALL }),
    microphone: mic,
    audioContext: context,
    remoteAudio,
    url: "ws://t/ws/voice",
    onState: (s) => events.states.push(s),
    onNotice: (n) => events.notices.push(n),
    onEnded: (e) => events.ended.push(e),
    onPartial: (p) => events.partials.push(p),
    onSpeaking: (s) => events.speaking.push(s),
    onAuthExpired,
    WebSocketImpl: FakeWebSocket,
    RTCPeerConnectionImpl: FakeRTCPeerConnection,
    backoff: () => 1_000,
  });
  return { session, mic, context, remoteAudio, events, onAuthExpired };
}

async function connected(options) {
  const ctx = setup(options);
  ctx.session.start();
  await flush();
  const ws = FakeWebSocket.last();
  ws.serverOpen();
  return { ...ctx, ws };
}

async function ready(options) {
  const ctx = await connected(options);
  ctx.ws.serverSend({
    type: "ready",
    role: options?.role ?? "customer",
    call: { id: CALL, status: "in_progress" },
    iceServers: [],
  });
  await flush();
  return ctx;
}

beforeEach(() => {
  FakeWebSocket.reset();
  FakeRTCPeerConnection.reset();
});
afterEach(() => vi.useRealTimers());

describe("sesión de voz: autenticación y envío de audio", () => {
  it("la credencial va en el PRIMER mensaje, nunca en la URL", async () => {
    const { ws } = await connected({ role: "agent" });
    expect(ws.url).toBe("ws://t/ws/voice");
    expect(ws.url).not.toContain("token");
    expect(ws.sent[0]).toEqual({ type: "auth", callId: CALL, accessToken: "token-en-memoria" });
    expect(ws.binaryType).toBe("arraybuffer");
  });

  it("no envía audio antes de 'ready' (el servidor cortaría con 4401); después, sí", async () => {
    const { ws, mic } = await connected();
    expect(mic.start).not.toHaveBeenCalled();
    ws.serverSend({ type: "ready", call: { id: CALL, status: "in_progress" }, iceServers: [] });
    await flush();
    mic.speak();
    mic.speak();
    expect(ws.binary).toHaveLength(2);
    expect(ws.binary[0].byteLength).toBe(3200);
  });

  it("silenciado, el audio NO sale", async () => {
    const { ws, mic, session } = await ready();
    session.setMuted(true);
    mic.speak();
    expect(ws.binary).toHaveLength(0);
    session.setMuted(false);
    mic.speak();
    expect(ws.binary).toHaveLength(1);
  });

  it("mientras el asistente habla, el micrófono NO se envía; vuelve al terminar de sonar", async () => {
    const { ws, mic, context, events } = await ready();
    ws.serverSend({ type: "tts.start", messageId: "m1", text: "Hola", durationMs: 200 });
    ws.serverSendBinary(new Int16Array(1600).buffer);
    ws.serverSendBinary(new Int16Array(1600).buffer);
    ws.serverSend({ type: "tts.end", messageId: "m1" });
    expect(context.sources).toHaveLength(2); // se reproduce
    mic.speak();
    expect(ws.binary).toHaveLength(0); // su propia voz no se transcribe como del cliente
    context.finishPlayback();
    mic.speak();
    expect(ws.binary).toHaveLength(1);
    expect(events.speaking).toEqual([true, false]);
  });

  it("interrumpir corta la voz del asistente, descarta lo que falte y devuelve el micrófono", async () => {
    const { ws, mic, context, session } = await ready();
    ws.serverSend({ type: "tts.start", messageId: "m1", text: "Hola", durationMs: 200 });
    ws.serverSendBinary(new Int16Array(1600).buffer);
    session.interrupt();
    expect(context.sources[0].stopped).toBe(true);
    ws.serverSendBinary(new Int16Array(1600).buffer); // tramas rezagadas de ESA respuesta
    expect(context.sources).toHaveLength(1);
    mic.speak();
    expect(ws.binary).toHaveLength(1);
  });

  it("muestra lo que se va entendiendo y lo limpia al cerrar la frase", async () => {
    const { ws, events } = await ready();
    ws.serverSend({ type: "transcript.partial", speaker: "customer", text: "Hola quisiera" });
    ws.serverSend({ type: "transcript.final", speaker: "customer", text: "Hola quisiera saber" });
    expect(events.partials).toEqual(["Hola quisiera", ""]);
  });
});

describe("sesión de voz: micrófono que se desconecta", () => {
  it("si el micrófono muere a mitad de la llamada, se avisa (no queda 'en llamada' sin sonido)", async () => {
    const { mic, events } = await ready();
    mic.track.unplug();
    expect(events.notices.at(-1)).toMatch(/micrófono se desconectó/);
  });

  it("apagarlo nosotros al colgar NO genera ese aviso", async () => {
    const { mic, events, session } = await ready();
    session.hangup();
    mic.track.unplug(); // aunque llegara el evento después de terminar
    expect(events.notices).toEqual([]);
  });
});

describe("sesión de voz: fin de la llamada y reconexión", () => {
  it("cuando el servidor termina la llamada, el micrófono se APAGA", async () => {
    const { ws, mic, events } = await ready();
    ws.serverSend({ type: "call.ended", reason: "agent_hangup" });
    expect(mic.stop).toHaveBeenCalled();
    expect(mic.track.stopped).toBe(true);
    expect(events.ended[0].message).toBe("El asesor terminó la llamada.");
    expect(ws.readyState).toBe(3);
  });

  it("colgar avisa al servidor, cierra y apaga el micrófono", async () => {
    const { ws, mic, session } = await ready();
    session.hangup();
    expect(ws.sent.at(-1)).toEqual({ type: "hangup" });
    expect(mic.track.stopped).toBe(true);
    expect(session.ended).toBe(true);
  });

  it("si otra pestaña tomó la llamada (4410), NO reconecta (se la quitarían sin fin) y apaga el micrófono", async () => {
    vi.useFakeTimers();
    const { ws, mic, events } = await ready();
    ws.serverClose(VOICE_CLOSE.replaced);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(mic.track.stopped).toBe(true);
    expect(events.ended[0].message).toMatch(/otra pestaña/);
  });

  it("sin permiso para la llamada (4403) tampoco reconecta", async () => {
    vi.useFakeTimers();
    const { ws } = await connected();
    ws.serverClose(VOICE_CLOSE.forbidden);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("un corte de red reconecta dentro de la gracia y sigue enviando", async () => {
    vi.useFakeTimers();
    const { ws, mic, events } = await ready();
    ws.serverClose(1006);
    expect(events.states.at(-1)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1_000);
    const again = FakeWebSocket.last();
    expect(again).not.toBe(ws);
    again.serverOpen();
    expect(again.sent[0]).toEqual({ type: "auth", callId: CALL });
    again.serverSend({ type: "ready", call: { id: CALL, status: "in_progress" }, iceServers: [] });
    mic.speak();
    expect(again.binary).toHaveLength(1);
    expect(mic.track.stopped).toBe(false);
  });

  it("tras reconectar, NO envía audio hasta que el servidor autentique la nueva conexión", async () => {
    vi.useFakeTimers();
    const { ws, mic } = await ready();
    ws.serverClose(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    const again = FakeWebSocket.last();
    again.serverOpen(); // abierto, pero sin "ready" todavía: el micrófono sigue capturando
    mic.speak();
    expect(again.binary).toHaveLength(0);
    again.serverSend({ type: "ready", call: { id: CALL, status: "in_progress" }, iceServers: [] });
    mic.speak();
    expect(again.binary).toHaveLength(1);
  });

  it("si la red no vuelve a tiempo, termina y apaga el micrófono", async () => {
    vi.useFakeTimers();
    const { ws, mic, events } = await ready();
    ws.serverClose(1006);
    for (let i = 0; i < 20 && !events.ended.length; i += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      FakeWebSocket.last().serverClose(1006);
    }
    expect(events.ended[0].message).toMatch(/Se perdió la conexión/);
    expect(mic.track.stopped).toBe(true);
  });

  it("con el token vencido (4409), renueva antes de reconectar", async () => {
    vi.useFakeTimers();
    const { ws, onAuthExpired } = await ready({ role: "agent" });
    ws.serverClose(VOICE_CLOSE.tokenExpired);
    await vi.advanceTimersByTimeAsync(0);
    expect(onAuthExpired).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});

describe("sesión de voz: WebRTC por el socket de voz", () => {
  it("el agente ofrece cuando el cliente está presente, y la oferta viaja por el socket de voz", async () => {
    const { ws } = await ready({ role: "agent" });
    ws.serverSend({ type: "peer", role: "customer", present: true });
    await flush();
    expect(ws.sent.at(-1)).toEqual({ type: "signal", signal: { type: "offer", sdp: "v=0 oferta" } });
  });

  it("el audio de la otra persona suena en el elemento de audio", async () => {
    const { ws, remoteAudio } = await ready();
    ws.serverSend({ type: "signal", signal: { type: "offer", sdp: "v=0" } });
    await flush();
    expect(ws.sent.at(-1)).toEqual({ type: "signal", signal: { type: "answer", sdp: "v=0 respuesta" } });
    FakeRTCPeerConnection.last().ontrack({ streams: [{ id: "asesor" }] });
    expect(remoteAudio.srcObject).toEqual({ id: "asesor" });
    expect(remoteAudio.play).toHaveBeenCalled();
  });
});
