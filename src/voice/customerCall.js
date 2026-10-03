import { h } from "../lib/dom.js";
import { consentDialog } from "../components/consentDialog.js";
import { callBar } from "../components/callBar.js";
import { openMicrophone } from "./microphone.js";
import { createVoiceSession } from "./voiceSession.js";

/**
 * Llamada desde el WIDGET del cliente.
 *
 * Orden (cada paso tiene su razón):
 *  1. "Llamar" → se pide el aviso VIGENTE al servidor y se muestra.
 *  2. Sin marcar "Leí y acepto" no se puede continuar.
 *  3. Al aceptar: se crea el AudioContext (en el clic: lo exige el autoplay) y
 *     se pide el MICRÓFONO. Si el cliente lo niega, no se crea ninguna llamada.
 *  4. Recién entonces se crea la llamada (con la versión del aviso aceptado).
 *  5. Se abre el WebSocket de voz (la cookie httpOnly autentica: sin token en JS).
 * Al terminar, por la causa que sea, el micrófono se apaga (voiceSession.js).
 */

const STATE_TEXT = {
  connecting: "Conectando la llamada…",
  waiting_agent: "Te estamos pasando con un asesor… no cuelgues.",
  reconnecting: "Se cortó la conexión. Reconectando…",
};

const ENDED_VISIBLE_MS = 4_000;

export function createCustomerCallController({
  mount,
  widgetApi,
  conversationId,
  /** Estado ACTUAL de la conversación: decide qué decir cuando no hay un asesor en la línea. */
  conversationStatus = () => "ai_active",
  onActiveChange = () => {},
  voice = {},
}) {
  const openMic = voice.openMicrophone ?? openMicrophone;
  const makeSession = voice.createVoiceSession ?? createVoiceSession;
  const AudioContextImpl = voice.AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;

  const errorLine = h("p", { class: "form-error", role: "alert", hidden: true });
  mount.append(errorLine);

  let dialog = null;
  let bar = null;
  let session = null;
  let audioContext = null;
  let callId = null;
  let agentPresent = false;
  let busy = false;
  let active = false;

  function setActive(value) {
    active = value;
    mount.hidden = !value && errorLine.hidden;
    onActiveChange(value);
  }

  function showError(message) {
    errorLine.textContent = message;
    errorLine.hidden = false;
    mount.hidden = false;
  }

  function hideError() {
    errorLine.hidden = true;
    errorLine.textContent = "";
  }

  async function begin() {
    if (busy || active) return;
    busy = true;
    hideError();
    try {
      const notice = await widgetApi.voiceConsent();
      dialog = consentDialog(notice, { onAccept: accept, onCancel: cancel });
      mount.append(dialog.el);
      setActive(true);
      dialog.focus();
    } catch (err) {
      showError(err.message);
    } finally {
      busy = false;
    }
  }

  function cancel() {
    dialog?.el.remove();
    dialog = null;
    setActive(false);
  }

  function fail(message) {
    audioContext?.close?.().catch?.(() => {});
    audioContext = null;
    bar?.destroy();
    bar = null;
    setActive(false);
    showError(message);
  }

  async function accept(consentVersion) {
    dialog?.el.remove();
    dialog = null;
    audioContext = new AudioContextImpl();

    let microphone;
    try {
      microphone = await openMic({ audioContext });
    } catch (err) {
      return fail(err.message);
    }

    let started;
    try {
      started = await widgetApi.startCall(conversationId(), consentVersion);
    } catch (err) {
      microphone.stop();
      return fail(err.message);
    }
    callId = started.call.id;
    agentPresent = false;

    bar = callBar({
      role: "customer",
      onMute: (value) => {
        session?.setMuted(value);
        bar.setMuted(value);
        bar.setSpeaking(false);
      },
      onHangup: hangup,
      onInterrupt: () => session?.interrupt(),
    });
    mount.append(bar.el);
    bar.setState("connecting", STATE_TEXT.connecting);
    bar.setSpeaking(false);

    session = makeSession({
      role: "customer",
      callId,
      // La cookie httpOnly del widget viaja sola en el upgrade: el JS nunca tiene el token.
      authMessage: async () => ({ type: "auth", callId }),
      microphone,
      audioContext,
      remoteAudio: bar.remoteAudio,
      onState,
      onPartial: (text) => bar?.setPartial(text),
      onLevel: (level) => bar?.setLevel(level),
      onNotice: (text) => text && showError(text),
      onPeer,
      onSpeaking: (speaking) => bar?.setSpeaking(speaking),
      onEnded,
    });
    session.start();
  }

  /**
   * Texto de "en llamada" sin asesor en la línea. Si el caso ya lo tiene un
   * asesor, la IA NO responde: no se puede decir "con el asistente virtual".
   */
  function activeText() {
    if (agentPresent) return "En llamada con un asesor";
    if (conversationStatus() === "agent_active")
      return "Llamada conectada. Tu asesor puede unirse en cualquier momento.";
    if (conversationStatus() === "waiting_agent") return STATE_TEXT.waiting_agent;
    return "En llamada con el asistente virtual";
  }

  function onState(state) {
    if (!bar || state === "ended") return;
    if (state === "active") {
      bar.setState("active", activeText());
    } else {
      bar.setState(state, STATE_TEXT[state] ?? state);
    }
  }

  function onPeer({ role, present, connection }) {
    if (!bar) return;
    if (role === "agent") {
      const wasPresent = agentPresent;
      agentPresent = present;
      bar.setAgentConnected(present);
      if (present) {
        bar.setState("active", "En llamada con un asesor");
        bar.setPeer("Audio con el asesor: conectando…");
      } else if (wasPresent) {
        // El caso sigue a cargo del asesor: la IA NO vuelve a responder. Decirlo tal cual.
        bar.setState("active", "El asesor salió de la llamada. Puedes esperar en la línea o colgar.");
        bar.setPeer("");
      }
    }
    if (connection && agentPresent) bar.setPeer(`Audio con el asesor: ${bar.peerText(connection)}`);
  }

  function onEnded({ message }) {
    const endedBar = bar;
    session = null;
    audioContext?.close?.().catch?.(() => {});
    audioContext = null;
    endedBar?.setState("ended", message);
    setTimeout(() => {
      endedBar?.destroy();
      if (bar === endedBar) bar = null;
      setActive(false);
    }, ENDED_VISIBLE_MS);
  }

  /** Colgar: por el socket y, por si el socket no estaba abierto, también por REST (idempotente). */
  function hangup() {
    session?.hangup();
    if (callId) widgetApi.endCall(callId).catch(() => {});
  }

  return {
    begin,
    get active() {
      return active;
    },
    /**
     * La conversación cambió de estado (evento del WebSocket de eventos). Si pasó
     * de la IA a un asesor durante la llamada, la barra lo anuncia con su
     * transición (una vez) y actualiza su texto.
     */
    conversationStatusChanged(previous, next) {
      if (!bar || !session) return;
      if (previous === "ai_active" && (next === "waiting_agent" || next === "agent_active")) bar.announceHandoff();
      if (!agentPresent && previous !== next) bar.setState("active", activeText());
    },
    /** Salir de la vista con una llamada abierta: se cuelga (no queda el micrófono encendido). */
    dispose() {
      if (session && !session.ended) hangup();
      dialog?.el.remove();
      bar?.destroy();
    },
  };
}
