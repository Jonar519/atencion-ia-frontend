import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invitationView } from "../src/views/agent/invitation.view.js";
import { agentLoginView } from "../src/views/agent/login.view.js";
import { adminTeamView } from "../src/views/admin/team.view.js";
import { LoginError } from "../src/auth/session.js";
import { flush } from "./support/fakeWebSocket.js";

/**
 * Bloque F2: la ÚNICA forma de obtener una cuenta es una invitación. Pantalla
 * pública "Completa tu cuenta", la parte de Equipo para invitar, y que el
 * login no ofrezca ningún registro público.
 */
const INVALID = "La invitación no es válida: venció, ya se usó o el enlace está incompleto.";
const ADMIN = { id: "ad1", name: "Admin Soporte", role: "admin", availability: "available" };

function fakeSession(overrides = {}) {
  return {
    getStaff: () => null,
    restore: vi.fn(async () => null),
    onSessionChange: () => () => {},
    inspectInvitation: vi.fn(async () => ({
      name: "Valentina Rojas",
      email: "valentina@x.example",
      role: "agent",
      mfaRequired: false,
    })),
    acceptInvitation: vi.fn(async () => ({ staff: { id: "n1", role: "agent" } })),
    startEnrollment: vi.fn(async () => ({ qrDataUrl: "data:image/png;base64,AAAA", secret: "ABCDEFGHIJKLMNOP" })),
    confirmEnrollment: vi.fn(async () => ({ staff: {}, backupCodes: [] })),
    ...overrides,
  };
}

const mount = () => document.body.appendChild(document.createElement("div"));
const button = (root, text) => [...root.querySelectorAll("button")].find((b) => b.textContent.startsWith(text));

function fill(root, password, repeat = password) {
  root.querySelector("#invite-password").value = password;
  root.querySelector("#invite-repeat").value = repeat;
  root.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
}

beforeEach(() => {
  document.body.replaceChildren();
  window.location.hash = "";
});
afterEach(() => vi.restoreAllMocks());

describe("Completa tu cuenta (#/agente/invitacion)", () => {
  it("sin token: invitación no válida, sin consultar al servidor", async () => {
    const root = mount();
    const session = fakeSession();
    invitationView(root, { query: {} }, { session });
    expect(root.querySelector("h1").textContent).toBe("Invitación no válida");
    expect(session.inspectInvitation).not.toHaveBeenCalled();
  });

  it("enlace que no sirve: muestra el mensaje del servidor TAL CUAL (el mismo para cualquier caso)", async () => {
    const root = mount();
    const session = fakeSession({ inspectInvitation: vi.fn(async () => Promise.reject(new LoginError(INVALID))) });
    invitationView(root, { query: { token: "cualquiera" } }, { session });
    expect(root.querySelector("[role=status]")).not.toBeNull(); // cargando
    await flush();
    expect(root.querySelector("h1").textContent).toBe("Invitación no válida");
    expect(root.querySelector("[role=alert]").textContent).toBe(INVALID);
    expect(root.querySelector("form")).toBeNull();
    expect(root.textContent).toMatch(/solo se crean por invitación/);
  });

  it("asesor: muestra a quién invitaron; contraseñas distintas no se envían", async () => {
    const root = mount();
    const session = fakeSession();
    invitationView(root, { query: { token: "tok-1" } }, { session });
    await flush();
    expect(session.inspectInvitation).toHaveBeenCalledWith("tok-1");
    expect(root.textContent).toMatch(/Hola, Valentina Rojas\. Te invitaron .* como asesor\(a\)/);
    expect(root.textContent).toMatch(/valentina@x\.example/);
    expect(root.textContent).not.toMatch(/verificación en dos pasos: ten a mano/);
    fill(root, "una frase larga y propia", "otra distinta del todo");
    await flush();
    expect(session.acceptInvitation).not.toHaveBeenCalled();
    expect(root.querySelector(".form-error").textContent).toBe("Las contraseñas no coinciden.");
  });

  it("asesor: al completar queda con sesión y se le RECOMIENDA (no exige) la verificación en dos pasos", async () => {
    const root = mount();
    const session = fakeSession();
    invitationView(root, { query: { token: "tok-1" } }, { session });
    await flush();
    fill(root, "una frase larga y propia");
    await flush();
    expect(session.acceptInvitation).toHaveBeenCalledWith("tok-1", "una frase larga y propia");
    expect(root.querySelector("h1").textContent).toBe("Tu cuenta está lista");
    button(root, "Activar la verificación ahora").click();
    expect(window.location.hash).toBe("#/agente/perfil");
    expect(button(root, "Ir al panel")).toBeDefined();
  });

  it("una contraseña rechazada por la política se muestra y el formulario sigue (el enlace no se gastó)", async () => {
    const root = mount();
    const session = fakeSession({
      acceptInvitation: vi.fn(async () =>
        Promise.reject(new LoginError("La contraseña no cumple la política: Usa al menos 12 caracteres"))
      ),
    });
    invitationView(root, { query: { token: "tok-1" } }, { session });
    await flush();
    fill(root, "corta");
    await flush();
    expect(root.querySelector(".form-error").textContent).toMatch(/no cumple la política/);
    expect(root.querySelector("#invite-password")).not.toBeNull();
  });

  it("administrador: avisa antes, y al completar pasa OBLIGATORIAMENTE a activar la verificación (QR)", async () => {
    const root = mount();
    const session = fakeSession({
      inspectInvitation: vi.fn(async () => ({ name: "Ana", email: "ana@x.example", role: "admin", mfaRequired: true })),
      acceptInvitation: vi.fn(async () => ({ mfaEnrollmentRequired: true, enrollmentToken: "enr-1" })),
    });
    invitationView(root, { query: { token: "tok-2" } }, { session });
    await flush();
    expect(root.textContent).toMatch(/como administrador\(a\)/);
    expect(root.textContent).toMatch(/activarás la verificación en dos pasos/);
    fill(root, "una frase larga y propia");
    await flush();
    expect(root.querySelector("h1").textContent).toBe("Activa la verificación en dos pasos");
    expect(session.startEnrollment).toHaveBeenCalledWith("enr-1");
    expect(root.querySelector(".mfa__qr").src).toMatch(/^data:image\/png/);
    expect(root.textContent).not.toMatch(/Tu cuenta está lista/);
  });
});

describe("no hay registro público", () => {
  it("el login no ofrece crear una cuenta: solo entrar y recuperar la contraseña", async () => {
    const root = mount();
    agentLoginView(root, {}, { session: fakeSession() });
    const text = root.textContent;
    expect(text).not.toMatch(/crear (una |tu )?cuenta|reg[ií]str|sign ?up|solicitar acceso/i);
    const links = [...root.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["#/agente/recuperar"]);
  });
});

describe("Equipo: invitar (admin)", () => {
  const PENDING = {
    id: "p1",
    name: "Valentina Rojas",
    email: "valentina@x.example",
    role: "agent",
    isActive: false,
    availability: "offline",
    maxConcurrent: 3,
    activeConversations: 0,
    invitation: { expiresAt: "2026-10-06T12:00:00.000Z", expired: false },
  };

  function fakeAdminApi(items, overrides = {}) {
    return {
      staff: vi.fn(async () => ({ items })),
      invite: vi.fn(async (data) => ({ id: "p9", ...data, invitation: { expired: false } })),
      resendInvitation: vi.fn(async () => ({})),
      cancelInvitation: vi.fn(async () => undefined),
      exportStaff: vi.fn(),
      anonymize: vi.fn(),
      ...overrides,
    };
  }

  it("'Invitar asesor' despliega el formulario y envía nombre, correo y rol (nunca una contraseña)", async () => {
    const root = mount();
    const api = fakeAdminApi([]);
    adminTeamView(root, {}, { adminApi: api, session: { getStaff: () => ADMIN } });
    await flush();
    expect(root.textContent).toMatch(/Invita a la primera persona/);
    const toggle = button(root, "Invitar asesor");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector("input[type=password]")).toBeNull();
    root.querySelector("#invite-name").value = "  Valentina Rojas ";
    root.querySelector("#invite-email").value = "valentina@x.example";
    root.querySelector("#invite-role").value = "admin";
    root.querySelector(".team__invite-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(api.invite).toHaveBeenCalledWith({ name: "Valentina Rojas", email: "valentina@x.example", role: "admin" });
    expect(api.staff).toHaveBeenCalledTimes(2);
  });

  it("un error (p. ej. correo repetido) se muestra en el formulario", async () => {
    const root = mount();
    const api = fakeAdminApi([], {
      invite: vi.fn(async () => Promise.reject(new Error("Ya existe una cuenta (o una invitación) con ese correo"))),
    });
    adminTeamView(root, {}, { adminApi: api, session: { getStaff: () => ADMIN } });
    await flush();
    button(root, "Invitar asesor").click();
    root.querySelector("#invite-name").value = "Otra";
    root.querySelector("#invite-email").value = "otra@x.example";
    root.querySelector(".team__invite-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(root.querySelector(".team__invite-form .form-error").textContent).toMatch(/Ya existe/);
  });

  it("una invitación pendiente muestra su vencimiento y SOLO reenviar o cancelar (ni exportar ni eliminar)", async () => {
    const root = mount();
    const api = fakeAdminApi([PENDING]);
    adminTeamView(root, {}, { adminApi: api, session: { getStaff: () => ADMIN } });
    await flush();
    const row = root.querySelector('[data-id="p1"]');
    expect(row.textContent).toMatch(/Invitación pendiente · vence/);
    const labels = [...row.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["Reenviar invitación", "Cancelar invitación"]);

    button(row, "Reenviar invitación").click();
    await flush();
    expect(api.resendInvitation).toHaveBeenCalledWith("p1");
  });

  it("una invitación vencida lo dice; cancelar pide confirmación en dos pasos", async () => {
    const root = mount();
    const api = fakeAdminApi([{ ...PENDING, invitation: { expiresAt: "2026-10-01T00:00:00Z", expired: true } }]);
    adminTeamView(root, {}, { adminApi: api, session: { getStaff: () => ADMIN } });
    await flush();
    const row = root.querySelector('[data-id="p1"]');
    expect(row.textContent).toMatch(/Invitación vencida: reenvíala/);
    const cancel = button(row, "Cancelar invitación");
    cancel.click();
    expect(api.cancelInvitation).not.toHaveBeenCalled();
    expect(cancel.textContent).toMatch(/Confirmar: cancelar la invitación de Valentina Rojas/);
    cancel.click();
    await flush();
    expect(api.cancelInvitation).toHaveBeenCalledWith("p1");
  });
});
