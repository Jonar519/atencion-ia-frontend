import { h, replaceChildren } from "../../lib/dom.js";
import { adminNav } from "../../components/adminNav.js";

/**
 * Esqueleto común de las pantallas de administración: barra superior con el
 * título, la navegación de admin y la vuelta al panel. Devuelve el <main> donde
 * la pantalla dibuja su contenido.
 */
export function adminPage(root, { title, current, staff }) {
  const main = h("main", { class: "admin__main", "aria-busy": "true" });
  replaceChildren(
    root,
    h(
      "div",
      { class: "admin" },
      h(
        "header",
        { class: "topbar" },
        h("h1", { class: "topbar__title" }, title),
        h(
          "div",
          { class: "topbar__actions" },
          adminNav(staff, current),
          h("a", { class: "link-btn", href: "#/agente" }, "Volver al panel")
        )
      ),
      main
    )
  );
  return main;
}

// Estados de carga, error y vacío: los mismos de toda la app (components/states.js).
export { emptyState, errorState, loadingState } from "../../components/states.js";
