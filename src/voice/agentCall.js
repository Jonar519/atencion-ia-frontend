import { callBar } from "../components/callBar.js";
import { openMicrophone } from "./microphone.js";
import { createVoiceSession } from "./voiceSession.js";

/**
 * "Unirse a la llamada" desde el PANEL.
 *
 *  1. AudioContext en el clic y permiso del MICRÓFONO primero: si el agente lo
 *     niega, no toma el caso ni queda registrado en la llamada.
 *  2. POST /api/calls/:id/join: si el caso está en la cola, lo TOMA (misma
 *     regla atómica que "Tomar caso") y el servidor registra la participación.
 *     El historial del panel ya tiene la transcripción acumulada.
 *  3. WebSocket de voz con el access token EN MEMORIA en el primer mensaje.
 *     El agente inicia la conexión WebRTC cuando el cliente está presente.
 *
 * Un solo agente por pestaña puede estar en una llamada a la vez.
 */

const STATE_TEXT = {
  connecting: "Uniéndote a la llamada…",
  active: "En llamada con el cliente",
  waiting_agent: "En llamada con el cliente",
  reconnecting: "Se cortó la conexión. Reconectando…",
};

const ENDED_VISIBLE_MS = 4_000;

export function createAgentCallController({
  mount,
  staffApi,
  session: auth,
  onJoined = () => {},
  onEnded: onCallEnded = () => {},
  onError = () => {},
  voice = {},
}) {
  const openMic = voice.openMicrophone ?? openMicrophone;
  const makeSession = voice.createVoiceSession ?? createVoiceSession;
  const AudioContextImpl = voice.AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;

  let current = null; // { callId, conversationId, bar, session, audioContext }
  let busy = false;

  async function join(callId, conversationId) {
    if (busy || current) return;
    busy = true;
    const audioContext = new AudioContextImpl();
    try {
      let microphone;
      try {
        microphone = await openMic({ audioContext });
      } catch (err) {
        audioContext.close?.().catch?.(() => {});
        onError(err.message);
        return;
      }
      try {
        await staffApi.joinCall(callId);
      } catch (err) {
        microphone.stop();
        audioContext.close?.().catch?.(() => {});
        onError(err.message);
        return;
      }

      const bar = callBar({
        role: "agent",
        onMute: (value) => {
          current?.session.setMuted(value);
          bar.setMuted(value);
          bar.setSpeaking(false);
        },
        onHangup: () => hangup(),
        onLeave: () => leave(),
      });
      mount.replaceChildren(bar.el);
      mount.hidden = false;
      bar.setState("connecting", STATE_TEXT.connecting);
      bar.setSpeaking(false);
      bar.setPeer("Audio con el cliente: esperando al cliente…");

      const voiceSession = makeSession({
        role: "agent",
        callId,
        authMessage: async () => {
          const token = auth.getAccessToken() ?? (await auth.refresh());
          return token ? { type: "auth", callId, accessToken: token } : null;
        },
        onAuthExpired: () => auth.refresh(),
        microphone,
        audioContext,
        remoteAudio: bar.remoteAudio,
        onState: (state) => state !== "ended" && bar.setState(state, STATE_TEXT[state] ?? state),
        onLevel: (level) => bar.setLevel(level),
        onPartial: () => {}, // el panel ya muestra "Tú (en vivo)" por el WebSocket de eventos
        onNotice: (text) => text && onError(text),
        onPeer: ({ role, present, connection }) => {
          if (role === "customer")
            bar.setPeer(present ? "Audio con el cliente: conectando…" : "El cliente no está conectado.");
          if (connection) bar.setPeer(`Audio con el cliente: ${bar.peerText(connection)}`);
        },
        onSpeaking: () => {},
        onEnded: ({ message }) => finish(message),
      });
      current = { callId, conversationId, bar, session: voiceSession, audioContext };
      onJoined(conversationId);
      voiceSession.start();
    } finally {
      busy = false;
    }
  }

  function finish(message) {
    const ended = current;
    if (!ended) return;
    current = null;
    ended.audioContext.close?.().catch?.(() => {});
    ended.bar.setState("ended", message);
    onCallEnded(ended.conversationId);
    setTimeout(() => {
      ended.bar.destroy();
      if (!current) mount.hidden = true;
    }, ENDED_VISIBLE_MS);
  }

  /** Colgar para todos (el agente asignado puede hacerlo). */
  function hangup() {
    if (!current) return;
    const { callId, session } = current;
    session.hangup();
    staffApi.endCall(callId).catch(() => {});
  }

  /** Salir sin colgar: el cliente sigue en la llamada (queda registrado que el agente salió). */
  function leave() {
    if (!current) return;
    const { callId, session } = current;
    session.leave();
    staffApi.leaveCall(callId).catch(() => {});
  }

  return {
    join,
    get activeCallId() {
      return current?.callId ?? null;
    },
    dispose() {
      if (current) leave();
    },
  };
}
