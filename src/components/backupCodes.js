import { h } from "../lib/dom.js";
import { downloadText } from "../lib/download.js";

/**
 * Códigos de respaldo de la verificación en dos pasos. El servidor los
 * entrega UNA sola vez (en la base quedan solo sus hashes): la pantalla no
 * deja continuar hasta que la persona confirma que los guardó.
 */
export function backupCodesPanel(codes, { title = "Tus códigos de respaldo", onDone } = {}) {
  const confirmId = `backup-ok-${Math.random().toString(36).slice(2, 8)}`;
  const done = h(
    "button",
    { class: "btn btn--primary", type: "button", disabled: true, on: { click: () => onDone?.() } },
    "Continuar"
  );
  const confirm = h("input", {
    id: confirmId,
    type: "checkbox",
    on: { change: (event) => (done.disabled = !event.target.checked) },
  });
  const copied = h("span", { class: "muted", role: "status" });

  return h(
    "section",
    { class: "backup-codes", "aria-label": title },
    h("h2", {}, title),
    h(
      "p",
      {},
      "Cada código sirve UNA vez para entrar si no tienes el teléfono. No se volverán a mostrar: guárdalos fuera de este equipo."
    ),
    h(
      "ol",
      { class: "backup-codes__list" },
      codes.map((code) => h("li", {}, h("code", {}, code)))
    ),
    h(
      "div",
      { class: "backup-codes__actions" },
      h(
        "button",
        {
          class: "btn",
          type: "button",
          on: { click: () => downloadText("codigos-respaldo-atencion-ia.txt", `${codes.join("\n")}\n`) },
        },
        "Descargar .txt"
      ),
      h(
        "button",
        {
          class: "btn",
          type: "button",
          on: {
            click: async () => {
              try {
                await navigator.clipboard.writeText(codes.join("\n"));
                copied.textContent = "Copiados.";
              } catch {
                copied.textContent = "No se pudo copiar: descárgalos o anótalos.";
              }
            },
          },
        },
        "Copiar"
      ),
      copied
    ),
    h(
      "p",
      { class: "backup-codes__confirm" },
      confirm,
      h("label", { for: confirmId }, " Ya guardé mis códigos en un lugar seguro")
    ),
    onDone ? done : null
  );
}
