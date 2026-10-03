import { h } from "../lib/dom.js";

/**
 * Estados de una zona de pantalla (Fase 7, D2), los MISMOS en todas las vistas:
 *  - Cargando: esqueleto estático (sin animación: la única del sistema es la
 *    de la llamada) + texto para lectores de pantalla.
 *  - Error: qué pasó + "Reintentar", que vuelve a pedir SOLO esa zona (nunca
 *    recarga la página: no se pierde lo escrito ni la llamada en curso).
 *  - Vacío: qué significa que no haya nada y qué hacer (con un botón si aplica).
 */
export function loadingState(label, { lines = 3, block = false } = {}) {
  return h(
    "div",
    { class: "skeleton-group", role: "status" },
    h("span", { class: "sr-only" }, `${label}…`),
    Array.from({ length: lines }, () =>
      h("div", { class: ["skeleton", block ? "skeleton--block" : "skeleton--line"], "aria-hidden": "true" })
    )
  );
}

export function errorState(message, retry, { retryLabel = "Reintentar" } = {}) {
  return h(
    "div",
    { class: "state state--error", role: "alert" },
    h("p", {}, message),
    h(
      "button",
      {
        class: "btn",
        type: "button",
        on: {
          click: (event) => {
            event.currentTarget.disabled = true; // un clic = un reintento
            retry();
          },
        },
      },
      retryLabel
    )
  );
}

export function emptyState(title, hint, action = null) {
  return h(
    "div",
    { class: "state state--empty" },
    h("p", {}, h("strong", {}, title)),
    hint ? h("p", { class: "muted" }, hint) : null,
    action
  );
}
