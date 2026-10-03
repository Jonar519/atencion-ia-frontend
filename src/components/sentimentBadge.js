import { h } from "../lib/dom.js";

/**
 * Ánimo del cliente EN VIVO en la vista del asesor (Fase 7, D1).
 *
 * Fuente: el análisis de la IA que ya trae cada mensaje del cliente (por el
 * WebSocket de eventos y por la API): no hay un canal nuevo. Muestra el del
 * ÚLTIMO mensaje del cliente que tenga análisis y si empeoró o mejoró respecto
 * del anterior. Siempre con TEXTO (el color acompaña, nunca es la única pista)
 * y sin animación. role="status": un lector de pantalla lo anuncia solo cuando
 * cambia el texto.
 */
export const SENTIMENT = {
  positive: { label: "Contento", rank: 0 },
  neutral: { label: "Neutral", rank: 1 },
  negative: { label: "Molesto", rank: 2 },
  angry: { label: "Muy molesto", rank: 3 },
};

/** Último ánimo del cliente (y el anterior) a partir de la lista de mensajes de la conversación. */
export function latestSentiment(messages) {
  const analyzed = messages.filter(
    (m) => (m.senderType ?? m.sender) === "customer" && m.sentiment && SENTIMENT[m.sentiment]
  );
  const current = analyzed.at(-1)?.sentiment ?? null;
  const previous = analyzed.at(-2)?.sentiment ?? null;
  return { current, previous };
}

export function trendOf(current, previous) {
  if (!current || !previous || current === previous) return null;
  return SENTIMENT[current].rank > SENTIMENT[previous].rank ? "empeoró" : "mejoró";
}

export function createSentimentBadge() {
  const el = h("span", { class: "sentiment", role: "status", hidden: true });
  let shown = "";
  return {
    el,
    update(messages) {
      const { current, previous } = latestSentiment(messages);
      if (!current) {
        el.hidden = true;
        shown = "";
        return;
      }
      const trend = trendOf(current, previous);
      const text = `Ánimo del cliente: ${SENTIMENT[current].label}${trend ? ` (${trend})` : ""}`;
      el.hidden = false;
      el.className = `sentiment sentiment--${current}`;
      el.dataset.sentiment = current;
      // Solo se toca el texto si cambió: así el lector de pantalla no repite lo mismo.
      if (text !== shown) {
        el.textContent = text;
        shown = text;
      }
    },
  };
}
