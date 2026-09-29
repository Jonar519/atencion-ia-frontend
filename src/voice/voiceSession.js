import { backoffDelay } from "../lib/backoff.js";
import { createAudioPlayer } from "./audioPlayer.js";
import { createPeerLink } from "./peerLink.js";

/**
 * Sesión de voz de UN participante (cliente o agente) en una llamada:
 * WebSocket de voz (backend: src/realtime/voiceServer.ts) + micrófono +
 * reproductor + WebRTC con el otro participante.
 *
 * Reglas (probadas en tests/voiceSession.test.js y con mutaciones):
 *  - La credencial va en el PRIMER mensaje del socket, nunca en la URL.
 *  - El audio se envía SOLO después de "ready", y nunca si está silenciado.
 *  - Mientras el asistente habla, el micrófono NO se envía (su voz no debe
 *    transcribirse como si fuera del cliente). El cliente puede interrumpirlo.
 *  - El micrófono se APAGA siempre al terminar: se cuelgue, la corte el
 *    servidor, se abra en otra pestaña o se salga de la página.
 *  - Reconexión: solo si la red se cortó (el servidor da ~15 s de gracia).
 *    Nunca si la llamada terminó, si no hay permiso, ni si otra pestaña la
 *    tomó (4410): si reconectara, las dos pestañas se quitarían la llamada
 *    una a la otra sin fin.
 *
 * Estados (onState): connecting | active | waiting_agent | reconnecting | ended
 */

export const VOICE_CLOSE = {
  invalid: 4400,
  unauthorized: 4401,
  forbidden: 4403,
  authTimeout: 4408,
  tokenExpired: 4409,
  replaced: 4410,
  tooMuch: 4429,
};

const MAX_RECONNECT_MS = 12_000;

export function voiceSocketUrl(location = window.location) {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/voice`;
}

const ENDED_TEXT = {
  customer_hangup: "La llamada terminó.",
  agent_hangup: "El asesor terminó la llamada.",
  timeout: "La llamada terminó por tiempo.",
  error: "La llamada terminó por un error.",
};

const CLOSE_TEXT = {
  [VOICE_CLOSE.replaced]: "La llamada continúa en otra pestaña.",
  [VOICE_CLOSE.forbidden]: "Esta llamada ya no está disponible.",
  [VOICE_CLOSE.tooMuch]: "La llamada se cortó por enviar demasiado audio.",
  [VOICE_CLOSE.invalid]: "La llamada se cortó por un error de audio.",
};

/**
 * @param {object} options
 * @param {"customer"|"agent"} options.role
 * @param {() => Promise<object|null>} options.authMessage  { type: "auth", callId, accessToken? }
 * @param {object} options.microphone        resultado de openMicrophone()
 * @param {AudioContext} options.audioContext
 * @param {HTMLAudioElement} options.remoteAudio  donde suena el otro participante
 */
export function createVoiceSession({
  role,
  authMessage,
  microphone,
  audioContext,
  remoteAudio,
  url = voiceSocketUrl(),
  onState = () => {},
  onPartial = () => {},
  onLevel = () => {},
  onNotice = () => {},
  onPeer = () => {},
  onSpeaking = () => {},
  onEnded = () => {},
  onAuthExpired = async () => {},
  WebSocketImpl = globalThis.WebSocket,
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
  createPlayer = createAudioPlayer,
  backoff = backoffDelay,
}) {
  let socket = null;
  let ready = false;
  let muted = false;
  let aiSpeaking = false;
  /** Tras "Interrumpir", se descartan las tramas que falten de ESA respuesta. */
  let skipAiAudio = false;
  let ended = false;
  let attempt = 0;
  let firstDropAt = null;
  let reconnectTimer = null;
  let captureStarted = false;
  let peer = null;

  const player = createPlayer({
    audioContext,
    onIdle: () => {
      if (!aiSpeaking) return;
      aiSpeaking = false;
      onSpeaking(false);
    },
  });

  function send(message) {
    if (socket?.readyState === 1) socket.send(JSON.stringify(message));
  }

  function sendAudio(frame) {
    // Tres condiciones para que el audio salga: sesión lista, sin silencio y sin el asistente hablando.
    if (!ready || muted || aiSpeaking || ended) return;
    if (socket?.readyState === 1) socket.send(frame);
  }

  /**
   * Si el micrófono muere a mitad de la llamada (se desconectan los audífonos,
   * el sistema lo revoca), el navegador termina la pista: se avisa en vez de
   * seguir "en llamada" sin que nada se escuche. (Nuestro propio stop() no
   * dispara este evento.)
   */
  function watchMicrophone() {
    for (const track of microphone.stream.getAudioTracks()) {
      track.addEventListener?.("ended", () => {
        if (!ended)
          onNotice("Tu micrófono se desconectó. Revisa tus audífonos; si no vuelve, cuelga y llama de nuevo.");
      });
    }
  }

  async function startCapture() {
    if (captureStarted) return;
    captureStarted = true;
    watchMicrophone();
    try {
      await microphone.start(sendAudio, onLevel);
    } catch {
      onNotice("No pudimos procesar el audio del micrófono.");
      finish("error");
    }
  }

  function ensurePeer(iceServers) {
    if (peer || !RTCPeerConnectionImpl) return;
    peer = createPeerLink({
      role,
      localStream: microphone.stream,
      iceServers,
      sendSignal: (signal) => send({ type: "signal", signal }),
      onRemoteStream: (stream) => {
        remoteAudio.srcObject = stream;
        remoteAudio.play?.().catch(() => {});
      },
      onState: (state) => onPeer({ connection: state }),
      RTCPeerConnectionImpl,
    });
    peer.setMuted(muted);
  }

  function onMessage(event) {
    if (typeof event.data !== "string") {
      // Audio del asistente (PCM16).
      if (!skipAiAudio) player.enqueue(event.data);
      return;
    }
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    switch (message.type) {
      case "ready":
        ready = true;
        attempt = 0;
        firstDropAt = null;
        ensurePeer(message.iceServers ?? []);
        onState(message.call?.status === "waiting_agent" ? "waiting_agent" : "active");
        startCapture();
        break;
      case "call.status":
        if (message.status === "waiting_agent") onState("waiting_agent");
        else if (message.status === "in_progress") onState("active");
        break;
      case "transcript.partial":
        onPartial(message.text);
        break;
      case "transcript.final":
        onPartial("");
        break;
      case "tts.start":
        skipAiAudio = false;
        aiSpeaking = true;
        onSpeaking(true);
        player.begin();
        break;
      case "tts.end":
        player.end();
        break;
      case "tts.unavailable":
        onNotice("No pudimos reproducir la respuesta en audio; la tienes escrita en el chat.");
        break;
      case "peer":
        onPeer({ role: message.role, present: message.present });
        peer?.onPeer(message.present);
        break;
      case "signal":
        peer?.onSignal(message.signal).catch(() => onNotice("No se pudo conectar el audio con el asesor."));
        break;
      case "notice":
      case "error":
        onNotice(message.text ?? message.message);
        break;
      case "call.ended":
        finish(message.reason);
        break;
    }
  }

  async function connect() {
    if (ended) return;
    const auth = await authMessage().catch(() => null);
    if (ended) return;
    if (!auth) return finish("error", "No pudimos autenticar la llamada.");
    const ws = new WebSocketImpl(url);
    ws.binaryType = "arraybuffer";
    socket = ws;
    ws.addEventListener("open", () => ws.send(JSON.stringify(auth)));
    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", (event) => onClose(ws, event.code));
  }

  async function onClose(ws, code) {
    if (socket === ws) socket = null;
    ready = false;
    if (ended) return;
    if (code === 1000) return finish(null);
    if (CLOSE_TEXT[code]) return finish(null, CLOSE_TEXT[code]);
    if (code === VOICE_CLOSE.tokenExpired || code === VOICE_CLOSE.unauthorized) {
      await onAuthExpired().catch(() => {});
    }
    // Corte de red: se reintenta dentro de la gracia que da el servidor.
    firstDropAt ??= Date.now();
    if (Date.now() - firstDropAt > MAX_RECONNECT_MS) return finish(null, "Se perdió la conexión de la llamada.");
    onState("reconnecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoff(attempt++));
  }

  /** Termina TODO del lado del navegador (idempotente). */
  function finish(reason, notice) {
    if (ended) return;
    ended = true;
    ready = false;
    clearTimeout(reconnectTimer);
    microphone.stop();
    player.stop();
    peer?.close();
    if (remoteAudio) remoteAudio.srcObject = null;
    const ws = socket;
    socket = null;
    if (ws && ws.readyState <= 1) ws.close(1000, "fin");
    onState("ended");
    onEnded({ reason, message: notice ?? ENDED_TEXT[reason] ?? "La llamada terminó." });
  }

  return {
    start: () => connect(),
    /** Colgar: el servidor termina la llamada para todos. */
    hangup() {
      send({ type: "hangup" });
      finish(role === "customer" ? "customer_hangup" : "agent_hangup");
    },
    /** Salir sin colgar (agente): se cierra solo esta conexión. */
    leave() {
      finish(null, "Saliste de la llamada.");
    },
    setMuted(value) {
      muted = value;
      peer?.setMuted(value);
    },
    /** El cliente interrumpe al asistente: se corta su audio y vuelve el micrófono. */
    interrupt() {
      skipAiAudio = true;
      player.stop();
    },
    get ended() {
      return ended;
    },
  };
}
