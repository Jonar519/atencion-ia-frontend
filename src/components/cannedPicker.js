import { h, replaceChildren } from "../lib/dom.js";

/**
 * Selector de RESPUESTAS PREDEFINIDAS en la caja de respuesta del asesor.
 * Un clic INSERTA el texto donde está el cursor (con {cliente} y {asesor}
 * reemplazados); nunca envía: el asesor lo revisa y lo manda él.
 * La lista se pide la primera vez que se abre (y se puede reintentar).
 */
const firstName = (name) => (name ?? "").trim().split(/\s+/)[0] ?? "";

/** Reemplaza los marcadores; si falta un nombre, lo quita sin dejar "Hola ," ni espacios dobles. */
export function fillPlaceholders(text, { customerName, agentName } = {}) {
  return text
    .replace(/\{cliente\}/g, firstName(customerName))
    .replace(/\{asesor\}/g, firstName(agentName))
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Inserta en la posición del cursor (o reemplaza lo seleccionado), con un espacio de separación si hace falta. */
export function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const before = input.value.slice(0, start);
  const glue = before && !/\s$/.test(before) ? " " : "";
  input.setRangeText(glue + text, start, end, "end");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}

export function createCannedPicker({ load, input, context }) {
  let items = null;
  const listId = `canned-${Math.random().toString(36).slice(2, 8)}`;
  const search = h("input", {
    class: "input input--compact",
    type: "search",
    placeholder: "Buscar por título o atajo…",
    "aria-label": "Buscar respuesta predefinida",
    on: { input: () => renderList() },
  });
  const list = h("ul", { id: listId, class: "canned__list" });
  const panel = h(
    "div",
    { class: "canned__panel", hidden: true, role: "dialog", "aria-label": "Respuestas predefinidas" },
    search,
    list
  );
  const toggle = h(
    "button",
    {
      class: "btn canned__toggle",
      type: "button",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      "aria-controls": listId,
      on: { click: () => (panel.hidden ? open() : close()) },
    },
    "Respuestas"
  );
  const el = h("div", { class: "canned" }, toggle, panel);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
      toggle.focus();
    }
  });

  async function open() {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    if (items === null) await fetchItems();
    else renderList();
    search.focus();
  }

  function close() {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }

  async function fetchItems() {
    replaceChildren(list, h("li", { class: "skeleton skeleton--line" }), h("li", { class: "skeleton skeleton--line" }));
    try {
      ({ items } = await load());
      renderList();
    } catch (err) {
      replaceChildren(
        list,
        h(
          "li",
          { class: "state state--error", role: "alert" },
          `No se pudieron cargar. ${err.message} `,
          h("button", { class: "btn", type: "button", on: { click: fetchItems } }, "Reintentar")
        )
      );
    }
  }

  function renderList() {
    const term = search.value.trim().toLowerCase().replace(/^\//, "");
    const shown = items.filter(
      (item) => !term || item.title.toLowerCase().includes(term) || (item.shortcut ?? "").includes(term)
    );
    if (!items.length) {
      replaceChildren(
        list,
        h(
          "li",
          { class: "canned__empty muted" },
          "Aún no hay respuestas predefinidas. Un administrador puede crearlas en Administración → Respuestas."
        )
      );
      return;
    }
    if (!shown.length) {
      replaceChildren(list, h("li", { class: "canned__empty muted" }, `Ninguna coincide con “${search.value}”.`));
      return;
    }
    replaceChildren(
      list,
      shown.map((item) =>
        h(
          "li",
          {},
          h(
            "button",
            {
              class: "canned__item",
              type: "button",
              on: {
                click: () => {
                  insertAtCursor(input, fillPlaceholders(item.body, context()));
                  close();
                },
              },
            },
            h("strong", {}, item.title),
            item.shortcut ? h("code", {}, ` /${item.shortcut}`) : null,
            h("span", { class: "canned__preview muted" }, item.body)
          )
        )
      )
    );
  }

  return { el, open, close };
}
