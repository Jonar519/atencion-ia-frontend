import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userMenu } from "../src/components/userMenu.js";
import { agentProfileView } from "../src/views/agent/profile.view.js";
import { adminTeamView } from "../src/views/admin/team.view.js";
import { agentLoginView } from "../src/views/agent/login.view.js";
import { flush } from "./support/fakeWebSocket.js";

/**
 * Bloque F3: "Mi perfil" y "Salir" visibles y alcanzables desde TODAS las
 * pantallas del staff (antes: el perfil solo con un clic en el nombre, sin
 * pista; desde la administración, ni perfil ni salir), y la recuperación de
 * contraseña justo debajo de "Entrar".
 */
const LAURA = { id: "a1", name: "Laura Méndez", email: "laura@x.example", role: "agent" };
const ADMIN = { id: "ad1", name: "Ana Admin", email: "admin@x.example", role: "admin" };

const mount = () => document.body.appendChild(document.createElement("div"));
const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

beforeEach(() => {
  document.body.replaceChildren();
  window.location.hash = "";
});
afterEach(() => vi.restoreAllMocks());

describe("menú de usuario (componente)", () => {
  function open(menu) {
    const button = menu.el.querySelector(".user-menu__button");
    button.click();
    return button;
  }

  it("es un botón VISIBLE con foto y nombre; despliega quién eres, 'Mi perfil' y 'Salir'", () => {
    const root = mount();
    const menu = userMenu(LAURA);
    root.append(menu.el);
    const button = menu.el.querySelector(".user-menu__button");
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toMatch(/Laura Méndez/);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(button.getAttribute("aria-controls"));
    expect(panel.hidden).toBe(true);

    open(menu);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toMatch(/Laura Méndez.*Asesor\(a\).*laura@x\.example/);
    const profile = panel.querySelector('a[href="#/agente/perfil"]');
    expect(profile.textContent).toBe("Mi perfil");
    expect(document.activeElement).toBe(profile); // al abrir, el foco va al primer destino
    expect([...panel.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Salir"]);
    menu.dispose();
  });

  it("Escape cierra y devuelve el foco al botón", () => {
    const root = mount();
    const menu = userMenu(LAURA);
    root.append(menu.el);
    const button = open(menu);
    key(document.activeElement, "Escape");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(menu.el.querySelector(".user-menu__panel").hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    menu.dispose();
  });

  it("un clic fuera o salir con Tab cierran el menú", () => {
    const root = mount();
    const outside = root.appendChild(document.createElement("button"));
    const menu = userMenu(LAURA);
    root.append(menu.el);
    const button = open(menu);
    outside.click();
    expect(button.getAttribute("aria-expanded")).toBe("false");

    open(menu);
    menu.el
      .querySelector(".user-menu__panel a")
      .dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
    expect(button.getAttribute("aria-expanded")).toBe("false");
    menu.dispose();
  });

  it("'Salir' cierra el menú y llama a cerrar sesión", () => {
    const root = mount();
    const onLogout = vi.fn();
    const menu = userMenu(LAURA, { onLogout });
    root.append(menu.el);
    open(menu);
    [...menu.el.querySelectorAll("button")].find((b) => b.textContent === "Salir").click();
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(menu.el.querySelector(".user-menu__panel").hidden).toBe(true);
    menu.dispose();
  });

  it("si la vista se va (el menú sale del DOM), se limpia solo en el siguiente clic", () => {
    const root = mount();
    const remove = vi.spyOn(document, "removeEventListener");
    const menu = userMenu(LAURA);
    root.append(menu.el);
    menu.el.remove();
    document.body.click();
    expect(remove).toHaveBeenCalledWith("click", expect.any(Function));
  });
});

describe("el menú está en TODAS las pantallas del staff", () => {
  it("Mi perfil: con 'Salir' (antes no lo tenía) y 'Mi perfil' marcado como la página actual", async () => {
    const root = mount();
    const session = {
      getStaff: () => LAURA,
      restore: vi.fn(async () => LAURA),
      updateStaff: vi.fn(),
      onSessionChange: () => () => {},
      logout: vi.fn(async () => {}),
    };
    const profileApi = {
      get: vi.fn(async () => ({ ...LAURA, mfaEnabled: false, hasAvatar: false })),
      sessions: vi.fn(async () => ({ items: [] })),
    };
    agentProfileView(root, {}, { profileApi, session });
    await flush(20);
    const button = root.querySelector(".topbar .user-menu__button");
    expect(button?.textContent).toMatch(/Laura Méndez/);
    button.click();
    expect(root.querySelector('.user-menu a[href="#/agente/perfil"]').getAttribute("aria-current")).toBe("page");
    [...root.querySelectorAll(".user-menu button")].find((b) => b.textContent === "Salir").click();
    await flush();
    expect(session.logout).toHaveBeenCalled();
    expect(window.location.hash).toBe("#/agente/login");
  });

  it("Administración: 'Mi perfil' y 'Salir' (antes, desde aquí no se llegaba a ninguno)", async () => {
    const root = mount();
    const session = { getStaff: () => ADMIN, logout: vi.fn(async () => {}) };
    const adminApi = { staff: vi.fn(async () => ({ items: [] })) };
    adminTeamView(root, {}, { adminApi, session });
    await flush();
    const button = root.querySelector(".topbar .user-menu__button");
    expect(button?.textContent).toMatch(/Ana Admin/);
    button.click();
    expect(root.querySelector('.user-menu a[href="#/agente/perfil"]')).not.toBeNull();
    expect(root.querySelector(".user-menu").textContent).toMatch(/Administrador\(a\)/);
    [...root.querySelectorAll(".user-menu button")].find((b) => b.textContent === "Salir").click();
    await flush();
    expect(session.logout).toHaveBeenCalled(); // la sesión de la VISTA, no otra
    expect(window.location.hash).toBe("#/agente/login");
  });
});

describe("recuperación de contraseña visible en el login", () => {
  it("'¿Olvidaste tu contraseña?' va JUSTO debajo de 'Entrar'", () => {
    const root = mount();
    agentLoginView(root, {}, { session: { restore: vi.fn(async () => null) } });
    const submit = [...root.querySelectorAll("button")].find((b) => b.textContent === "Entrar");
    const next = submit.nextElementSibling;
    expect(next.tagName).toBe("A");
    expect(next.getAttribute("href")).toBe("#/agente/recuperar");
    expect(next.textContent).toBe("¿Olvidaste tu contraseña?");
    expect(next.classList.contains("login__forgot")).toBe(true);
  });
});
