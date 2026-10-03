import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../src/auth/session.js";
import { match, route } from "../src/router.js";
import { agentLoginView } from "../src/views/agent/login.view.js";
import { confirmEmailView, forgotPasswordView, resetPasswordView } from "../src/views/agent/recovery.view.js";
import { agentProfileView } from "../src/views/agent/profile.view.js";
import { clampOffset, coverScale, zoomAround } from "../src/components/avatarCropper.js";
import { describeUserAgent } from "../src/lib/userAgent.js";
import { initials } from "../src/components/avatar.js";
import { HttpError } from "../src/api/http.js";
import { flush } from "./support/fakeWebSocket.js";

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const STAFF = { id: "a1", name: "Laura Méndez", email: "laura@x.example", role: "agent", availability: "available" };

beforeEach(() => {
  session._resetForTests();
  document.body.replaceChildren();
  window.location.hash = "";
});
afterEach(() => vi.restoreAllMocks());

describe("router: query en el hash (enlaces de los correos)", () => {
  it("separa la ruta de la query y la entrega en params.query", () => {
    const view = () => {};
    route("/prueba/restablecer", view);
    const found = match("#/prueba/restablecer?token=abc_DEF-123&x=1");
    expect(found.view).toBe(view);
    expect(found.params.query).toEqual({ token: "abc_DEF-123", x: "1" });
  });
});

describe("sesión: login en pasos", () => {
  it("con MFA, el paso 1 NO abre sesión: devuelve el desafío y no guarda token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { mfaRequired: true, challengeToken: "c".repeat(43) }));
    const result = await session.login("laura@x.example", "clave");
    expect(result).toEqual({ mfaRequired: true, challengeToken: "c".repeat(43) });
    expect(session.getAccessToken()).toBeNull();
    expect(session.getStaff()).toBeNull();
  });

  it("verifyMfa abre la sesión y avisa cuántos códigos de respaldo quedan", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(json(200, { accessToken: "a.b.c", staff: STAFF, backupCodesRemaining: 3 }));
    const result = await session.verifyMfa("c".repeat(43), "abcd-2345");
    expect(result).toEqual({ staff: STAFF, backupCodesRemaining: 3 });
    expect(session.getStaff()).toEqual(STAFF);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/auth/mfa/verify");
    expect(JSON.parse(init.body)).toEqual({ challengeToken: "c".repeat(43), code: "abcd-2345" });
  });

  it("un error muestra el mensaje del servidor con sus detalles", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(400, {
        error: "La contraseña no cumple la política",
        details: [{ message: "Debe tener al menos 12 caracteres" }],
      })
    );
    await expect(session.resetPassword("t".repeat(43), "corta")).rejects.toThrow(
      "La contraseña no cumple la política: Debe tener al menos 12 caracteres"
    );
  });

  it("updateStaff actualiza la copia local y avisa (p. ej. el nombre)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { accessToken: "a.b.c", staff: STAFF }));
    await session.login("laura@x.example", "clave");
    const seen = [];
    session.onSessionChange((event) => seen.push(event));
    session.updateStaff({ name: "Laura M." });
    expect(session.getStaff().name).toBe("Laura M.");
    expect(seen).toEqual([{ staff: expect.objectContaining({ name: "Laura M." }), reason: "updated" }]);
  });
});

function fakeLoginSession(overrides = {}) {
  return {
    restore: vi.fn(async () => null),
    login: vi.fn(async () => ({ staff: STAFF })),
    verifyMfa: vi.fn(async () => ({ staff: STAFF })),
    startEnrollment: vi.fn(async () => ({
      qrDataUrl: "data:image/png;base64,AAAA",
      secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
      otpauthUrl: "otpauth://totp/x",
    })),
    confirmEnrollment: vi.fn(async () => ({ staff: STAFF, backupCodes: ["aaaa-bbbb", "cccc-dddd"] })),
    ...overrides,
  };
}

async function submitLogin(root, email = "laura@x.example", password = "clave") {
  root.querySelector("#login-email").value = email;
  root.querySelector("#login-password").value = password;
  root.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
  await flush();
}

describe("vista de login", () => {
  it("sin MFA entra directo al panel", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    agentLoginView(root, {}, { session: fakeLoginSession() });
    await submitLogin(root);
    expect(window.location.hash).toBe("#/agente");
  });

  it("con MFA pide el código y con él entra", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const fake = fakeLoginSession({ login: vi.fn(async () => ({ mfaRequired: true, challengeToken: "reto" })) });
    agentLoginView(root, {}, { session: fake });
    await submitLogin(root);
    expect(window.location.hash).not.toBe("#/agente");
    const code = root.querySelector("#login-code");
    expect(code.getAttribute("autocomplete")).toBe("one-time-code");
    code.value = "123456";
    root.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(fake.verifyMfa).toHaveBeenCalledWith("reto", "123456");
    expect(window.location.hash).toBe("#/agente");
  });

  it("código incorrecto: muestra el error y deja reintentar (sin recargar)", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const fake = fakeLoginSession({
      login: vi.fn(async () => ({ mfaRequired: true, challengeToken: "reto" })),
      verifyMfa: vi.fn(async () => {
        throw new Error("El código no es correcto");
      }),
    });
    agentLoginView(root, {}, { session: fake });
    await submitLogin(root);
    root.querySelector("#login-code").value = "000000";
    root.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(root.querySelector(".form-error").textContent).toBe("El código no es correcto");
    expect(root.querySelector(".form-error").hidden).toBe(false);
    expect(root.querySelector("#login-code").value).toBe("");
  });

  it("admin sin MFA: muestra el QR, confirma y NO entra hasta confirmar que guardó los códigos", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const fake = fakeLoginSession({
      login: vi.fn(async () => ({ mfaEnrollmentRequired: true, enrollmentToken: "enrol" })),
    });
    agentLoginView(root, {}, { session: fake });
    await submitLogin(root);
    await flush();
    expect(root.querySelector(".mfa__qr").getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(root.querySelector(".mfa__secret").textContent).toBe("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");
    root.querySelector("#enroll-code").value = "654321";
    root.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(fake.confirmEnrollment).toHaveBeenCalledWith("enrol", "654321");
    expect([...root.querySelectorAll(".backup-codes__list code")].map((c) => c.textContent)).toEqual([
      "aaaa-bbbb",
      "cccc-dddd",
    ]);
    const continuar = [...root.querySelectorAll("button")].find((b) => b.textContent === "Continuar");
    expect(continuar.disabled).toBe(true);
    const checkbox = root.querySelector(".backup-codes__confirm input");
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(continuar.disabled).toBe(false);
    continuar.click();
    expect(window.location.hash).toBe("#/agente");
  });

  it("enlaza a recuperar la contraseña", () => {
    const root = document.body.appendChild(document.createElement("div"));
    agentLoginView(root, {}, { session: fakeLoginSession() });
    expect(root.querySelector('a[href="#/agente/recuperar"]').textContent).toMatch(/Olvidaste/);
  });
});

describe("recuperación sin sesión", () => {
  it("pedir el enlace muestra el mensaje del servidor (idéntico exista o no el correo)", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const fake = { forgotPassword: vi.fn(async () => ({ message: "Si el correo corresponde…" })) };
    forgotPasswordView(root, {}, { session: fake });
    root.querySelector("#forgot-email").value = " ana@x.example ";
    root.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(fake.forgotPassword).toHaveBeenCalledWith("ana@x.example");
    expect(root.querySelector(".notice").textContent).toBe("Si el correo corresponde…");
  });

  it("restablecer sin token: pide un enlace nuevo; con contraseñas distintas no llama a la API", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    resetPasswordView(root, { query: {} }, { session: {} });
    expect(root.textContent).toMatch(/Enlace incompleto/);

    const fake = { resetPassword: vi.fn() };
    resetPasswordView(root, { query: { token: "t".repeat(43) } }, { session: fake });
    root.querySelector("#reset-password").value = "Una-Frase-Larga-Segura";
    root.querySelector("#reset-repeat").value = "Otra-Distinta-Frase";
    root.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(fake.resetPassword).not.toHaveBeenCalled();
    expect(root.querySelector(".form-error").textContent).toMatch(/no coinciden/);
  });

  it("restablecer con token lo envía y avisa que se cerraron las sesiones", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const fake = { resetPassword: vi.fn(async () => ({ message: "Tu contraseña cambió." })) };
    resetPasswordView(root, { query: { token: "t".repeat(43) } }, { session: fake });
    root.querySelector("#reset-password").value = "Una-Frase-Larga-Segura";
    root.querySelector("#reset-repeat").value = "Una-Frase-Larga-Segura";
    root.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(fake.resetPassword).toHaveBeenCalledWith("t".repeat(43), "Una-Frase-Larga-Segura");
    expect(root.querySelector(".notice").textContent).toMatch(/se cerraron todas tus sesiones/);
  });

  it("confirmar el correo exige un clic (abrir el enlace no lo confirma)", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const fake = { confirmEmail: vi.fn(async () => ({ message: "Tu correo quedó actualizado." })) };
    confirmEmailView(root, { query: { token: "t".repeat(43) } }, { session: fake });
    await flush();
    expect(fake.confirmEmail).not.toHaveBeenCalled();
    root.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(fake.confirmEmail).toHaveBeenCalledWith("t".repeat(43));
  });
});

const PROFILE = {
  id: "a1",
  name: "Laura Méndez",
  email: "laura@x.example",
  role: "agent",
  phone: null,
  mfaEnabled: false,
  mfaRequired: false,
  backupCodesRemaining: 0,
  hasAvatar: false,
  avatarVersion: null,
};

function fakeProfileApi(overrides = {}) {
  return {
    get: vi.fn(async () => PROFILE),
    update: vi.fn(async (patch) => ({ ...PROFILE, ...patch })),
    sessions: vi.fn(async () => ({
      items: [
        {
          id: "s1",
          current: true,
          userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0",
          ipAddress: "192.0.2.0",
          location: "Bogotá, Colombia",
          startedAt: "2026-09-30T10:00:00Z",
          lastActiveAt: "2026-09-30T11:00:00Z",
        },
        {
          id: "s2",
          current: false,
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1",
          ipAddress: "10.0.0.0",
          location: "Red local",
          startedAt: "2026-09-29T10:00:00Z",
          lastActiveAt: "2026-09-29T12:00:00Z",
        },
      ],
    })),
    revokeSession: vi.fn(async () => null),
    revokeOtherSessions: vi.fn(async () => ({ closed: 1 })),
    avatarOf: vi.fn(async () => null),
    exportData: vi.fn(async () => ({ format: "atencion-ia/staff-export@1" })),
    mfaSetup: vi.fn(),
    mfaConfirm: vi.fn(),
    mfaDisable: vi.fn(),
    mfaBackupCodes: vi.fn(),
    ...overrides,
  };
}

function fakeStaffSession(staff = STAFF) {
  return {
    getStaff: () => staff,
    restore: vi.fn(async () => staff),
    updateStaff: vi.fn(),
    onSessionChange: () => () => {},
  };
}

describe("vista Mi perfil", () => {
  it("muestra un esqueleto mientras carga y luego todas las secciones", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    let release;
    const api = fakeProfileApi({ get: vi.fn(() => new Promise((resolve) => (release = () => resolve(PROFILE)))) });
    agentProfileView(root, {}, { profileApi: api, session: fakeStaffSession() });
    await flush();
    expect(root.querySelector(".skeleton")).not.toBeNull();
    expect(root.querySelector(".profile__content").getAttribute("aria-busy")).toBe("true");
    release();
    await flush();
    expect(root.querySelector(".skeleton--block")).toBeNull();
    const titles = [...root.querySelectorAll(".profile__section h2")].map((el) => el.textContent);
    expect(titles).toEqual([
      "Tus datos",
      "Foto",
      "Correo",
      "Contraseña",
      "Verificación en dos pasos",
      "Sesiones activas",
      "Tus datos personales",
    ]);
  });

  it("si falla la carga, 'Reintentar' vuelve a pedir SIN recargar la página", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const get = vi
      .fn()
      .mockRejectedValueOnce(new HttpError("No se pudo conectar con el servidor.", { kind: "network" }))
      .mockResolvedValueOnce(PROFILE);
    agentProfileView(root, {}, { profileApi: fakeProfileApi({ get }), session: fakeStaffSession() });
    await flush();
    const alert = root.querySelector(".state--error");
    expect(alert.getAttribute("role")).toBe("alert");
    [...alert.querySelectorAll("button")].find((b) => b.textContent === "Reintentar").click();
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    expect(root.querySelector(".state--error")).toBeNull();
    expect(root.querySelector("#profile-name").value).toBe("Laura Méndez");
  });

  it("sesiones: ubicación APROXIMADA, sin botón 'Cerrar' en la actual, y 'cerrar las demás'", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const api = fakeProfileApi();
    agentProfileView(root, {}, { profileApi: api, session: fakeStaffSession() });
    await flush();
    await flush();
    const items = [...root.querySelectorAll(".session")];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toMatch(/Chrome en Windows.*Esta sesión.*Bogotá, Colombia \(ubicación aproximada\)/);
    expect(items[0].querySelector("button")).toBeNull();
    expect(items[1].textContent).toMatch(/Safari en iOS/);
    items[1].querySelector("button").click();
    await flush();
    expect(api.revokeSession).toHaveBeenCalledWith("s2");
    [...root.querySelectorAll("button")]
      .find((b) => b.textContent === "Cerrar sesión en los demás dispositivos")
      .click();
    await flush();
    expect(api.revokeOtherSessions).toHaveBeenCalled();
  });

  it("NO ofrece ningún control de tema: lo decide el sistema operativo (y nada lo guarda en el perfil)", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const api = fakeProfileApi();
    agentProfileView(root, {}, { profileApi: api, session: fakeStaffSession() });
    await flush();
    expect(root.querySelector('[name="theme"], [name*="tema" i], select[id*="theme"], [data-theme]')).toBeNull();
    expect(root.textContent).not.toMatch(/Apariencia|Tema del panel|Oscuro|Claro/);
    expect(api.update.mock.calls.flat().some((body) => body && "theme" in body)).toBe(false);
  });

  it("un admin ve la MFA como obligatoria y sin opción de desactivarla", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const admin = { ...PROFILE, role: "admin", mfaEnabled: true, mfaRequired: true, backupCodesRemaining: 7 };
    agentProfileView(
      root,
      {},
      { profileApi: fakeProfileApi({ get: vi.fn(async () => admin) }), session: fakeStaffSession() }
    );
    await flush();
    const mfa = root.querySelector('[aria-labelledby="sec-mfa"]');
    expect(mfa.textContent).toMatch(/obligatoria para administradores/);
    expect(mfa.textContent).toMatch(/Te quedan 7 código/);
    expect(mfa.querySelector("details")).toBeNull();
  });

  it("el error de una sección se muestra en ESA sección (role=alert) y no borra lo escrito", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const api = fakeProfileApi({
      changePassword: vi.fn(async () => {
        throw new HttpError("La contraseña actual no es correcta", { status: 400 });
      }),
    });
    agentProfileView(root, {}, { profileApi: api, session: fakeStaffSession() });
    await flush();
    root.querySelector("#pwd-current").value = "mala";
    root.querySelector("#pwd-new").value = "Una-Frase-Larga-Segura";
    root.querySelector("#pwd-repeat").value = "Una-Frase-Larga-Segura";
    root
      .querySelector("#pwd-current")
      .closest("form")
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    const section = root.querySelector('[aria-labelledby="sec-contrasena"]');
    const alert = section.querySelector('[role="alert"]');
    expect(alert.textContent).toBe("La contraseña actual no es correcta");
    expect(root.querySelector("#pwd-new").value).toBe("Una-Frase-Larga-Segura");
  });
});

describe("recorte del avatar (matemática del canvas)", () => {
  it("el lado corto cubre el cuadrado con zoom 1", () => {
    expect(coverScale(800, 400, 256, 1)).toBe(0.64);
    expect(coverScale(400, 800, 256, 2)).toBe(1.28);
  });

  it("la imagen nunca deja huecos: el desplazamiento se limita", () => {
    expect(clampOffset(10, 512, 256)).toBe(0);
    expect(clampOffset(-300, 512, 256)).toBe(-256);
    expect(clampOffset(-100, 512, 256)).toBe(-100);
  });

  it("al acercar se mantiene el centro", () => {
    // Imagen centrada de 512 px (offset -128) a escala 1 → escala 2: sigue centrada (offset -384).
    expect(zoomAround(-128, 1, 2, 256)).toBe(-384);
  });
});

describe("utilidades", () => {
  it("describe el dispositivo a partir del User-Agent", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit Chrome/130 Safari/537")).toBe(
      "Chrome en Windows"
    );
    expect(describeUserAgent("Mozilla/5.0 (Macintosh) AppleWebKit Version/17 Safari/605")).toBe("Safari en macOS");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/130 Edg/130")).toBe("Edge en Windows");
    expect(describeUserAgent(null)).toBe("Dispositivo desconocido");
  });

  it("iniciales del avatar", () => {
    expect(initials("Laura Méndez Ruiz")).toBe("LR");
    expect(initials("Ana")).toBe("A");
    expect(initials("")).toBe("?");
  });
});

describe("errores con detalles en texto (regresión de la prueba en vivo)", () => {
  it("la política de contraseñas llega como lista de textos y se muestra completa", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ error: "La contraseña no cumple la política", details: ["No debe contener tu correo"] }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
    );
    await expect(session.resetPassword("t".repeat(43), "x")).rejects.toThrow(
      "La contraseña no cumple la política: No debe contener tu correo"
    );
    const { api } = await import("../src/api/http.js");
    await expect(api.post("/api/profile/password", {}, { auth: "none" })).rejects.toThrow(
      "La contraseña no cumple la política: No debe contener tu correo"
    );
  });
});
