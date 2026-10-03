import { h, replaceChildren } from "../lib/dom.js";
import { backupCodesPanel } from "./backupCodes.js";

/**
 * Activar la verificación en dos pasos con un token de un solo uso (sin sesión
 * todavía): QR + clave → código de 6 dígitos → la sesión se abre y, ANTES de
 * entrar, la persona guarda sus códigos de respaldo.
 *
 * La usan el login (admin sin MFA) y "Completa tu cuenta" (admin invitado,
 * bloque F2): una sola implementación del paso.
 */
export function showMfaEnrollment(container, { session, enrollmentToken, intro, onDone }) {
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const qr = h("img", { class: "mfa__qr", alt: "Código QR para tu app de autenticación", width: 220, height: 220 });
  const secretText = h("code", { class: "mfa__secret" });
  const code = h("input", {
    id: "enroll-code",
    class: "input input--code",
    inputmode: "numeric",
    autocomplete: "one-time-code",
    maxlength: 6,
    required: true,
  });
  const submit = h("button", { class: "btn btn--primary", type: "submit" }, "Activar y entrar");
  const form = h(
    "form",
    {
      class: "login login--wide",
      on: {
        submit: async (event) => {
          event.preventDefault();
          error.hidden = true;
          submit.disabled = true;
          try {
            const result = await session.confirmEnrollment(enrollmentToken, code.value.trim());
            // La sesión ya está abierta, pero primero debe guardar sus códigos.
            replaceChildren(
              container,
              backupCodesPanel(result.backupCodes, { title: "Guarda tus códigos de respaldo", onDone })
            );
          } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
          } finally {
            submit.disabled = false;
          }
        },
      },
    },
    h("h1", {}, "Activa la verificación en dos pasos"),
    h(
      "p",
      {},
      intro ??
        "Las cuentas de administrador deben usarla. Escanea el código con Google Authenticator, Microsoft Authenticator u otra app compatible."
    ),
    h(
      "div",
      { class: "mfa__setup" },
      qr,
      h("p", { class: "muted" }, "¿No puedes escanear? Escribe esta clave: ", secretText)
    ),
    h("label", { for: "enroll-code" }, "Código de 6 dígitos que muestra la app"),
    code,
    error,
    submit
  );
  replaceChildren(container, form);
  code.focus();
  session
    .startEnrollment(enrollmentToken)
    .then((setup) => {
      qr.src = setup.qrDataUrl;
      secretText.textContent = setup.secret.replace(/(.{4})/g, "$1 ").trim();
    })
    .catch((err) => {
      error.textContent = err.message;
      error.hidden = false;
    });
  return form;
}
