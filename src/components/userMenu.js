import { h } from "../lib/dom.js";
import { avatar } from "./avatar.js";

/**
 * MENÚ DE USUARIO de la barra superior (bloque F3), el MISMO en el panel, la
 * administración y "Mi perfil": la foto y el nombre son un botón visible que
 * despliega quién eres, "Mi perfil" y "Salir". Antes el perfil solo se
 * alcanzaba con un clic en el nombre (sin ninguna pista) y desde la
 * administración no había forma de llegar a él ni de cerrar sesión.
 *
 * Patrón "botón que despliega" (aria-expanded + aria-controls), no role=menu:
 * son dos destinos de navegación, y así funciona igual con Tab que con lectores
 * de pantalla. Al abrir, el foco pasa al primer elemento; Escape cierra y
 * devuelve el foco al botón; un clic fuera o salir con Tab también cierran.
 */
const ROLE = { admin: "Administrador(a)", agent: "Asesor(a)" };
let nextId = 0;

export function userMenu(staff, { current = null, onLogout, loadAvatar } = {}) {
  const id = `user-menu-${++nextId}`;
  const picture = avatar(staff, { loadAvatar, size: "sm" });
  const button = h(
    "button",
    {
      class: "user-menu__button",
      type: "button",
      "aria-expanded": "false",
      "aria-controls": id,
    },
    picture.el,
    h("span", { class: "user-menu__name" }, staff.name),
    h("span", { class: "sr-only" }, " (menú de tu cuenta)"),
    h("span", { class: "user-menu__caret", "aria-hidden": "true" }, "▾")
  );
  const profileLink = h(
    "a",
    {
      class: "user-menu__item",
      href: "#/agente/perfil",
      "aria-current": current === "/agente/perfil" ? "page" : null,
    },
    "Mi perfil"
  );
  const logout = h(
    "button",
    {
      class: "user-menu__item",
      type: "button",
      on: {
        click: () => {
          close();
          onLogout?.();
        },
      },
    },
    "Salir"
  );
  const panel = h(
    "div",
    { class: "user-menu__panel", id, hidden: true },
    h(
      "div",
      { class: "user-menu__who" },
      h("strong", {}, staff.name),
      h("span", {}, ROLE[staff.role] ?? staff.role),
      staff.email ? h("span", { class: "user-menu__email" }, staff.email) : null
    ),
    h("ul", { class: "user-menu__list" }, h("li", {}, profileLink), h("li", {}, logout))
  );
  const el = h("div", { class: "user-menu" }, button, panel);

  function open() {
    button.setAttribute("aria-expanded", "true");
    panel.hidden = false;
    profileLink.focus();
  }
  function close({ returnFocus = false } = {}) {
    if (panel.hidden) return;
    button.setAttribute("aria-expanded", "false");
    panel.hidden = true;
    if (returnFocus) button.focus();
  }

  button.addEventListener("click", () => (panel.hidden ? open() : close()));
  profileLink.addEventListener("click", () => close());
  el.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault();
      close({ returnFocus: true });
    }
  });
  // Salir con Tab (o con el foco hacia otro lado) cierra el menú.
  el.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !el.contains(event.relatedTarget)) close();
  });
  function dispose() {
    document.removeEventListener("click", onDocumentClick);
    picture.dispose();
  }
  // Un clic fuera cierra. Si el menú ya no está en la página (la vista cambió), se limpia solo:
  // así ninguna pantalla tiene que acordarse de liberarlo.
  function onDocumentClick(event) {
    if (!el.isConnected) return dispose();
    if (!el.contains(event.target)) close();
  }
  document.addEventListener("click", onDocumentClick);

  return { el, close, dispose };
}
