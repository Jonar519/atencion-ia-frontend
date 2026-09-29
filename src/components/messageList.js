import { h, replaceChildren } from "../lib/dom.js";
import { shortTime } from "../lib/format.js";

/**
 * Lista de mensajes, compartida por el widget del cliente y el panel.
 *
 * TODO el contenido se inserta como texto (lib/dom.js): un mensaje con
 * "<img src=x onerror=…>" se ve literal. Lo verifica tests/render.test.js.
 *
 * `perspective` decide qué mensajes van "a la derecha" (los propios):
 *   "customer" → los del cliente · "agent" → los del agente.
 */

const SENDER_LABEL = {
  customer: "Tú",
  ai: "Asistente virtual",
  agent: "Asesor",
  system: "",
};

const INTENT_LABEL = {
  general_inquiry: "Consulta",
  complaint: "Reclamo",
  possible_fraud: "Posible fraude",
  account_access: "Acceso a la cuenta",
  human_request: "Pide un asesor",
  other: "Otro",
};

const SENTIMENT_LABEL = { positive: "Positivo", neutral: "Neutral", negative: "Negativo", angry: "Molesto" };

function senderOf(message) {
  return message.sender ?? message.senderType;
}

function authorLabel(message, perspective) {
  const sender = senderOf(message);
  if (sender === "customer") return perspective === "customer" ? "Tú" : "Cliente";
  if (sender === "agent") {
    const name = message.agentName ?? message.agent?.name ?? message.senderAgent?.name;
    return perspective === "agent" ? (name ?? "Asesor") : name ? `${name} · Asesor` : "Asesor";
  }
  return SENDER_LABEL[sender] ?? "";
}

export function renderMessage(message, { perspective = "customer", onRetry } = {}) {
  const sender = senderOf(message);
  if (sender === "system") {
    return h(
      "li",
      { class: "msg msg--system", dataset: { id: message.id } },
      h("p", { class: "msg__text" }, message.content)
    );
  }
  const own = (perspective === "customer" && sender === "customer") || (perspective === "agent" && sender === "agent");
  const meta = [];
  if (message.state === "pending") meta.push(h("span", { class: "msg__state" }, "Enviando…"));
  else if (message.state === "failed") {
    meta.push(
      h("span", { class: "msg__state msg__state--error" }, message.error ?? "No se envió."),
      onRetry
        ? h("button", { class: "link-btn", type: "button", on: { click: () => onRetry(message) } }, "Reintentar")
        : null
    );
  } else meta.push(h("time", { datetime: message.createdAt }, shortTime(message.createdAt)));

  // En el panel, el análisis de la IA de cada turno del cliente.
  const analysis =
    perspective === "agent" && sender === "customer" && message.intent
      ? h(
          "span",
          { class: ["tag", `tag--${message.intent === "possible_fraud" ? "danger" : "neutral"}`] },
          INTENT_LABEL[message.intent] ?? message.intent,
          message.sentiment ? ` · ${SENTIMENT_LABEL[message.sentiment] ?? message.sentiment}` : ""
        )
      : null;

  // Turno de una llamada (transcrito o sintetizado): se marca, el color nunca es la única pista.
  const voice = message.channel === "voice" ? h("span", { class: "tag tag--voice" }, "Voz") : null;

  return h(
    "li",
    {
      class: ["msg", `msg--${sender}`, own && "msg--own", message.state && `msg--${message.state}`],
      dataset: { id: message.id },
    },
    h("p", { class: "msg__author" }, authorLabel(message, perspective), voice, analysis),
    h("p", { class: "msg__text" }, message.content),
    h("p", { class: "msg__meta" }, meta)
  );
}

/**
 * Pinta la lista completa. Mantiene el scroll abajo si el usuario ya estaba
 * abajo (no lo arrastra si estaba leyendo mensajes anteriores).
 */
export function renderMessageList(listEl, messages, options) {
  const nearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 80;
  replaceChildren(
    listEl,
    messages.map((message) => renderMessage(message, options))
  );
  if (nearBottom) listEl.scrollTop = listEl.scrollHeight;
}
