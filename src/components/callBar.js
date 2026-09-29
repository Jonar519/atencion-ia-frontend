import { h, replaceChildren } from "../lib/dom.js";

/**
 * Barra de la llamada en curso (widget del cliente y panel del agente).
 *
 * Muestra lo necesario para saber que la llamada FUNCIONA:
 *  - estado (conectando, en curso, esperando asesor, reconectando, terminada);
 *  - duración;
 *  - medidor del micrófono + "Te escuchamos" cuando hay voz (el mismo umbral de
 *    energía que usa el reconocimiento simulado del servidor): si el medidor no
 *    se mueve al hablar, el micrófono no está llegando;
 *  - lo que el reconocimiento va entendiendo ("Estás diciendo: …");
 *  - si el asistente está hablando (y que el micrófono está en pausa);
 *  - el estado del audio en vivo con la otra persona (WebRTC).
 * Todo el texto entra como texto (lib/dom.js), también lo transcrito.
 */

/** Mismo umbral que el STT simulado del backend (mock.provider.ts: VOICE_RMS_THRESHOLD). */
export const VOICE_LEVEL_THRESHOLD = 0.02;

const PEER_TEXT = {
  connecting: "conectando…",
  connected: "conectado",
  disconnected: "se cortó, reintentando…",
  failed: "no se pudo conectar",
  waiting: "esperando a la otra persona",
  closed: "cerrado",
};

export function callBar({ role, onMute, onHangup, onInterrupt, onLeave }) {
  const status = h("span", { class: "callbar__status", role: "status", "aria-live": "polite" }, "Conectando…");
  const timer = h("span", { class: "callbar__timer", "aria-label": "Duración" }, "00:00");
  const meter = h("meter", { id: `mic-level-${role}`, class: "callbar__meter", min: 0, max: 0.3, value: 0 });
  const heard = h("span", { class: "callbar__heard", hidden: true }, "Te escuchamos");
  const hint = h("p", { class: "callbar__hint" }, "");
  const partial = h("p", { class: "callbar__partial", hidden: true, "aria-live": "polite" });
  const peerLine = h("p", { class: "callbar__peer", hidden: true });
  const muteButton = h(
    "button",
    { class: "btn", type: "button", "aria-pressed": "false", on: { click: () => onMute(!muted) } },
    "Silenciar"
  );
  const interruptButton = h(
    "button",
    { class: "btn", type: "button", hidden: true, on: { click: () => onInterrupt?.() } },
    "Interrumpir"
  );
  const leaveButton =
    role === "agent"
      ? h("button", { class: "btn", type: "button", on: { click: () => onLeave?.() } }, "Salir de la llamada")
      : null;
  const hangupButton = h("button", { class: "btn btn--danger", type: "button", on: { click: onHangup } }, "Colgar");
  // El audio de la OTRA persona (WebRTC). Sin controles: suena solo.
  const remoteAudio = h("audio", { class: "callbar__remote", autoplay: true });

  let muted = false;
  let startedAt = null;
  let tick = null;

  const el = h(
    "section",
    { class: "callbar", "aria-label": "Llamada de voz", dataset: { state: "connecting" } },
    h("div", { class: "callbar__head" }, status, timer),
    h("div", { class: "callbar__mic" }, h("label", { for: `mic-level-${role}` }, "Tu micrófono"), meter, heard),
    hint,
    partial,
    peerLine,
    h("div", { class: "callbar__actions" }, muteButton, interruptButton, leaveButton, hangupButton),
    remoteAudio
  );

  function format(ms) {
    const total = Math.floor(ms / 1000);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  return {
    el,
    remoteAudio,
    setState(state, text) {
      el.dataset.state = state;
      status.textContent = text;
      if (state !== "connecting" && state !== "ended" && !tick) {
        startedAt = Date.now();
        tick = setInterval(() => {
          timer.textContent = format(Date.now() - startedAt);
        }, 1000);
      }
      if (state === "ended") {
        clearInterval(tick);
        tick = null;
        for (const button of [muteButton, interruptButton, leaveButton, hangupButton])
          if (button) button.disabled = true;
        meter.value = 0;
        heard.hidden = true;
        partial.hidden = true;
      }
    },
    setLevel(level) {
      meter.value = Math.min(level, 0.3);
      heard.hidden = muted || level < VOICE_LEVEL_THRESHOLD;
    },
    setPartial(text) {
      partial.hidden = !text;
      replaceChildren(partial, text ? [h("span", { class: "callbar__who" }, "Estás diciendo: "), text] : []);
    },
    setSpeaking(speaking) {
      interruptButton.hidden = !speaking;
      hint.textContent = speaking
        ? "El asistente está respondiendo. Tu micrófono está en pausa mientras habla."
        : muted
          ? "Micrófono silenciado."
          : "Habla con normalidad y haz una pausa al terminar cada frase.";
    },
    setMuted(value) {
      muted = value;
      muteButton.textContent = value ? "Activar micrófono" : "Silenciar";
      muteButton.setAttribute("aria-pressed", String(value));
      if (value) heard.hidden = true;
    },
    setPeer(text) {
      peerLine.hidden = !text;
      peerLine.textContent = text;
    },
    peerText: (state) => PEER_TEXT[state] ?? state,
    destroy() {
      clearInterval(tick);
      remoteAudio.srcObject = null;
      el.remove();
    },
  };
}
