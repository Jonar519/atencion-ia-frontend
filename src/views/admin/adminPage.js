import { h, replaceChildren } from "../../lib/dom.js";
import { adminNav } from "../../components/adminNav.js";
import { userMenu } from "../../components/userMenu.js";
import * as defaultSession from "../../auth/session.js";
import { profileApi as defaultProfileApi } from "../../api/profile.js";
import { navigate } from "../../router.js";

/**
 * Esqueleto común de las pantallas de administración: barra superior con el
 * título, la navegación de admin, la vuelta al panel y el menú de usuario
 * ("Mi perfil" y "Salir": antes no había forma de llegar a ellos desde aquí).
 * Devuelve el <main> donde la pantalla dibuja su contenido.
 */
export function adminPage(root, { title, current, staff, session = defaultSession, profileApi = defaultProfileApi }) {
  const menu = staff
    ? userMenu(staff, {
        loadAvatar: (id) => profileApi.avatarOf(id),
        onLogout: async () => {
          await session.logout();
          navigate("/agente/login");
        },
      })
    : null;
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
          h("a", { class: "link-btn", href: "#/agente" }, "Volver al panel"),
          menu?.el
        )
      ),
      main
    )
  );
  return main;
}

// Estados de carga, error y vacío: los mismos de toda la app (components/states.js).
export { emptyState, errorState, loadingState } from "../../components/states.js";
