import { h, replaceChildren } from "../lib/dom.js";
import { formatBytes } from "../lib/attachments.js";
import { downloadBlob } from "../lib/download.js";

/**
 * Cómo se ve un ADJUNTO dentro de un mensaje (widget y panel).
 *
 *  - Imagen: se muestra en el chat (con texto alternativo).
 *  - PDF: tarjeta con nombre y tamaño y botón "Descargar". Nunca se abre
 *    dentro de la app (el servidor además lo envía como descarga y con CSP sandbox).
 *  - El nombre del archivo lo escribió quien lo subió: va SIEMPRE como texto.
 *
 * Los archivos se piden UNA vez por adjunto y se guardan como URL blob: (la
 * lista de mensajes se redibuja con cada mensaje nuevo y el servidor responde
 * no-store: sin este caché, cada imagen se volvería a descargar).
 */
export function createAttachmentCache(load) {
  const entries = new Map();
  function get(attachment) {
    if (!entries.has(attachment.id)) {
      const pending = Promise.resolve(load(attachment)).then((blob) => ({ blob, url: URL.createObjectURL(blob) }));
      pending.catch(() => entries.delete(attachment.id));
      entries.set(attachment.id, pending);
    }
    return entries.get(attachment.id);
  }
  return {
    /** Promesa de la URL blob: del adjunto (se reutiliza; si falla, se puede reintentar). */
    url: (attachment) => get(attachment).then((entry) => entry.url),
    /** Descarga con el Blob ya guardado (un fetch() de la URL blob: lo bloquearía la CSP connect-src). */
    async download(attachment) {
      downloadBlob(attachment.originalName, (await get(attachment)).blob);
    },
    dispose() {
      for (const pending of entries.values()) pending.then((entry) => URL.revokeObjectURL(entry.url)).catch(() => {});
      entries.clear();
    },
  };
}

export function renderAttachment(attachment, { cache, pending = false } = {}) {
  const isPdf = attachment.contentType === "application/pdf";
  const meta = `${isPdf ? "PDF" : "Imagen"} · ${formatBytes(attachment.sizeBytes)}`;

  if (pending || !cache) {
    return h(
      "div",
      { class: "attachment attachment--pending" },
      h("span", { class: "attachment__icon", "aria-hidden": "true" }, isPdf ? "PDF" : "IMG"),
      h("span", { class: "attachment__name" }, attachment.originalName),
      h("span", { class: "attachment__meta" }, pending ? `${meta} · subiendo…` : meta)
    );
  }

  if (isPdf) {
    const status = h("span", { class: "attachment__meta", role: "status" }, meta);
    return h(
      "div",
      { class: "attachment attachment--pdf" },
      h("span", { class: "attachment__icon", "aria-hidden": "true" }, "PDF"),
      h("span", { class: "attachment__name" }, attachment.originalName),
      status,
      h(
        "button",
        {
          class: "btn btn--small",
          type: "button",
          "aria-label": `Descargar ${attachment.originalName}`,
          on: {
            click: async (event) => {
              const button = event.currentTarget;
              button.disabled = true;
              try {
                await cache.download(attachment);
                status.textContent = meta;
              } catch {
                status.textContent = "No se pudo descargar. Intenta de nuevo.";
              } finally {
                button.disabled = false;
              }
            },
          },
        },
        "Descargar"
      )
    );
  }

  const figure = h(
    "figure",
    { class: "attachment attachment--image" },
    h("div", { class: "attachment__loading skeleton" }, h("span", { class: "sr-only" }, "Cargando imagen…"))
  );
  const show = () =>
    cache.url(attachment).then(
      (url) =>
        replaceChildren(
          figure,
          h("img", { src: url, alt: `Imagen adjunta: ${attachment.originalName}`, loading: "lazy" }),
          h(
            "figcaption",
            { class: "attachment__meta" },
            `${attachment.originalName} · ${formatBytes(attachment.sizeBytes)}`
          )
        ),
      () =>
        replaceChildren(
          figure,
          h(
            "p",
            { class: "attachment__error", role: "alert" },
            "No se pudo cargar la imagen. ",
            h("button", { class: "link-btn", type: "button", on: { click: show } }, "Reintentar")
          )
        )
    );
  show();
  return figure;
}
