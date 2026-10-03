import { h, replaceChildren } from "../../lib/dom.js";
import * as defaultSession from "../../auth/session.js";
import { navigate } from "../../router.js";
import { backupCodesPanel } from "../../components/backupCodes.js";
import { toast } from "../../components/toast.js";

/**
 * Inicio de sesión del staff (#/agente/login), en pasos:
 *  1. Correo + contraseña.
 *  2a. Si la cuenta tiene verificación en dos pasos: el código de la app (o uno de respaldo).
 *  2b. Si es un admin SIN verificación: debe activarla ahora (QR + código) y
 *      guardar sus códigos de respaldo antes de entrar.
 * Si la cookie de refresh sigue vigente, entra directo.
 */
export function agentLoginView(root, _params, deps = {}) {
  const session = deps.session ?? defaultSession;
  let disposed = false;

  const main = h("main", { class: "page page--login" });
  replaceChildren(root, main);
  showCredentials();
  session.restore().then((staff) => !disposed && staff && navigate("/agente"));
  return () => {
    disposed = true;
  };

  function show(form) {
    replaceChildren(main, form);
    form.querySelector("input")?.focus();
  }

  function errorBox() {
    return h("p", { class: "form-error", role: "alert", hidden: true });
  }

  /** Envía un formulario: deshabilita el botón, muestra el error sin recargar. */
  function onSubmit(form, error, submit, action) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      try {
        await action();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      } finally {
        submit.disabled = false;
      }
    });
  }

  function showCredentials() {
    const email = h("input", {
      id: "login-email",
      class: "input",
      type: "email",
      autocomplete: "username",
      required: true,
    });
    const password = h("input", {
      id: "login-password",
      class: "input",
      type: "password",
      autocomplete: "current-password",
      required: true,
    });
    const error = errorBox();
    const submit = h("button", { class: "btn btn--primary", type: "submit" }, "Entrar");
    const form = h(
      "form",
      { class: "login" },
      h("h1", {}, "Panel de asesores"),
      h("p", { class: "muted" }, "Banco Cordillera · Atención al cliente"),
      h("label", { for: "login-email" }, "Correo"),
      email,
      h("label", { for: "login-password" }, "Contraseña"),
      password,
      error,
      submit,
      h("a", { class: "login__link", href: "#/agente/recuperar" }, "¿Olvidaste tu contraseña?")
    );
    onSubmit(form, error, submit, async () => {
      try {
        const result = await session.login(email.value.trim(), password.value);
        if (result.mfaRequired) return showCode(result.challengeToken);
        if (result.mfaEnrollmentRequired) return showEnrollment(result.enrollmentToken);
        navigate("/agente");
      } catch (err) {
        password.value = "";
        password.focus();
        throw err;
      }
    });
    show(form);
  }

  function showCode(challengeToken) {
    const code = h("input", {
      id: "login-code",
      class: "input input--code",
      inputmode: "numeric",
      autocomplete: "one-time-code",
      maxlength: 9,
      required: true,
      "aria-describedby": "login-code-help",
    });
    const error = errorBox();
    const submit = h("button", { class: "btn btn--primary", type: "submit" }, "Verificar");
    const form = h(
      "form",
      { class: "login" },
      h("h1", {}, "Verificación en dos pasos"),
      h("label", { for: "login-code" }, "Código de tu app de autenticación"),
      code,
      h(
        "p",
        { id: "login-code-help", class: "muted" },
        "Escribe los 6 dígitos que muestra la app. Si no tienes el teléfono, usa uno de tus códigos de respaldo."
      ),
      error,
      submit,
      h("button", { class: "link-btn", type: "button", on: { click: showCredentials } }, "Volver")
    );
    onSubmit(form, error, submit, async () => {
      try {
        const result = await session.verifyMfa(challengeToken, code.value.trim());
        if (result.backupCodesRemaining !== undefined) {
          toast(`Usaste un código de respaldo. Te quedan ${result.backupCodesRemaining}.`, {
            tone: result.backupCodesRemaining <= 2 ? "error" : "info",
            timeoutMs: 10_000,
          });
        }
        navigate("/agente");
      } catch (err) {
        code.value = "";
        code.focus();
        // El desafío murió (5 intentos o venció): hay que empezar de nuevo.
        if (/venció|ya se usó/.test(err.message)) setTimeout(showCredentials, 2500);
        throw err;
      }
    });
    show(form);
  }

  async function showEnrollment(enrollmentToken) {
    const error = errorBox();
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
      { class: "login login--wide" },
      h("h1", {}, "Activa la verificación en dos pasos"),
      h(
        "p",
        {},
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
    onSubmit(form, error, submit, async () => {
      const result = await session.confirmEnrollment(enrollmentToken, code.value.trim());
      // La sesión ya está abierta, pero primero debe guardar sus códigos.
      replaceChildren(
        main,
        backupCodesPanel(result.backupCodes, {
          title: "Guarda tus códigos de respaldo",
          onDone: () => navigate("/agente"),
        })
      );
    });
    show(form);
    try {
      const setup = await session.startEnrollment(enrollmentToken);
      qr.src = setup.qrDataUrl;
      secretText.textContent = setup.secret.replace(/(.{4})/g, "$1 ").trim();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  }
}
