import { h } from "../lib/dom.js";

const TEXT = {
  connecting: "Conectando…",
  open: "En línea",
  reconnecting: "Reconectando… tus mensajes no se pierden",
  closed: "Desconectado",
};

/** Indicador del estado del tiempo real (el texto cambia; el punto de color no es la única pista). */
export function connectionIndicator() {
  const text = h("span", {}, TEXT.connecting);
  const el = h(
    "span",
    { class: "conn", dataset: { status: "connecting" }, role: "status", "aria-live": "polite" },
    h("span", { class: "conn__dot", "aria-hidden": "true" }),
    text
  );
  return {
    el,
    set(status) {
      el.dataset.status = status;
      text.textContent = TEXT[status] ?? status;
    },
  };
}
