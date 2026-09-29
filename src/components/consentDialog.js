import { h } from "../lib/dom.js";

/**
 * Aviso de consentimiento ANTES de llamar (texto y versión vienen del
 * backend: GET /api/widget/voice/consent). "Aceptar y llamar" está
 * deshabilitado hasta marcar la casilla: no se puede llamar sin aceptar.
 * Se envía la versión MOSTRADA; si el aviso cambió en el servidor, este
 * rechaza la llamada (409) y el cliente ve el aviso nuevo.
 *
 * @param {{ version: string, title?: string, points: string[] }} notice
 * @param {{ onAccept: (version: string) => void, onCancel: () => void }} handlers
 */
export function consentDialog(notice, { onAccept, onCancel }) {
  const checkbox = h("input", { id: "consent-accept", type: "checkbox" });
  const accept = h(
    "button",
    {
      class: "btn btn--primary",
      type: "button",
      disabled: true,
      on: { click: () => checkbox.checked && onAccept(notice.version) },
    },
    "Aceptar y llamar"
  );
  const cancel = h("button", { class: "btn", type: "button", on: { click: onCancel } }, "Prefiero seguir por chat");
  checkbox.addEventListener("change", () => {
    accept.disabled = !checkbox.checked;
  });

  const el = h(
    "section",
    {
      class: "consent",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "consent-title",
      dataset: { version: notice.version },
      on: { keydown: (event) => event.key === "Escape" && onCancel() },
    },
    h("h2", { id: "consent-title" }, notice.title ?? "Antes de llamar"),
    h(
      "ul",
      { class: "consent__points" },
      notice.points.map((point) => h("li", {}, point))
    ),
    h(
      "p",
      { class: "consent__tip" },
      "Consejo: usa audífonos. Así evitas el eco y que tu micrófono capte la voz del asistente o del asesor."
    ),
    h(
      "div",
      { class: "consent__check" },
      checkbox,
      h(
        "label",
        { for: "consent-accept" },
        "Leí el aviso y acepto que mi voz se transcriba y se analice con inteligencia artificial."
      )
    ),
    h("div", { class: "consent__actions" }, accept, cancel)
  );
  return { el, focus: () => checkbox.focus() };
}
