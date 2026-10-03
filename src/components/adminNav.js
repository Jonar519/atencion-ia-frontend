import { h } from "../lib/dom.js";

/**
 * Navegación de ADMINISTRACIÓN. Solo se dibuja para el rol admin (y cada ruta
 * además tiene su guard y el backend su requireRole): un asesor no ve enlaces
 * a pantallas que no puede usar.
 */
export const ADMIN_LINKS = [
  ["/admin/kb", "Base de conocimiento"],
  ["/admin/respuestas", "Respuestas"],
  ["/admin/equipo", "Equipo"],
  ["/admin/analytics", "Analítica"],
];

export function adminNav(staff, current = null) {
  if (staff?.role !== "admin") return null;
  return h(
    "nav",
    { class: "admin-nav", "aria-label": "Administración" },
    ADMIN_LINKS.map(([path, label]) =>
      h("a", { class: "admin-nav__link", href: `#${path}`, "aria-current": path === current ? "page" : null }, label)
    )
  );
}
