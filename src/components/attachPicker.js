import { h, replaceChildren } from "../lib/dom.js";
import { ACCEPT, AttachmentError, formatBytes, prepareAttachment } from "../lib/attachments.js";

/**
 * "Adjuntar" en la caja de escritura (widget del cliente y panel del asesor).
 * Elegir un archivo NO lo envía: queda como vista previa (con "Quitar") y sale
 * junto con el texto al pulsar "Enviar" (el texto va como comentario).
 */
export function createAttachPicker({ prepare = prepareAttachment, id = "attach-file" } = {}) {
  let prepared = null;
  const input = h("input", {
    id,
    type: "file",
    tabindex: -1,
    "aria-hidden": "true",
    accept: ACCEPT,
    class: "sr-only",
    on: { change: (event) => choose(event.target) },
  });
  // Un <button> real (no un <label for>): se enfoca y se activa con el teclado.
  const button = h(
    "button",
    {
      class: "btn attach__button",
      type: "button",
      title: "Adjuntar imagen o PDF (máx. 5 MB)",
      on: { click: () => input.click() },
    },
    "Adjuntar"
  );
  const preview = h("div", { class: "attach__preview", hidden: true, "aria-live": "polite" });
  const error = h("p", { class: "form-error attach__error", role: "alert", hidden: true });

  async function choose(target) {
    const file = target.files?.[0];
    target.value = "";
    error.hidden = true;
    if (!file) return;
    replaceChildren(preview, h("span", { class: "muted" }, "Preparando el archivo…"));
    preview.hidden = false;
    try {
      prepared = await prepare(file);
      showPreview();
    } catch (err) {
      clear();
      error.textContent = err instanceof AttachmentError ? err.message : "No se pudo leer el archivo.";
      error.hidden = false;
    }
  }

  function showPreview() {
    replaceChildren(
      preview,
      h("span", { class: "attach__icon", "aria-hidden": "true" }, prepared.kind === "pdf" ? "PDF" : "IMG"),
      h("span", { class: "attach__name" }, prepared.name),
      h("span", { class: "muted" }, formatBytes(prepared.size)),
      h("button", { class: "link-btn", type: "button", on: { click: clear } }, "Quitar")
    );
    preview.hidden = false;
  }

  function clear() {
    prepared = null;
    replaceChildren(preview);
    preview.hidden = true;
  }

  return {
    button,
    input,
    preview,
    error,
    /** El adjunto listo para enviar (o null) y deja el selector vacío. */
    take() {
      const current = prepared;
      clear();
      return current;
    },
    get pending() {
      return prepared;
    },
    showError(message) {
      error.textContent = message;
      error.hidden = false;
    },
  };
}

/** Datos del adjunto para mostrarlo mientras se sube (antes de que el servidor responda). */
export function localAttachment(prepared) {
  return { id: "local", contentType: prepared.type, sizeBytes: prepared.size, originalName: prepared.name };
}
