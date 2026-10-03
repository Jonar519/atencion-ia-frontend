import { h, replaceChildren } from "../../lib/dom.js";
import * as defaultSession from "../../auth/session.js";

/**
 * Pantallas SIN sesión que abren los enlaces de los correos:
 *  - #/agente/recuperar               → pedir el enlace (misma respuesta exista o no el correo).
 *  - #/agente/restablecer?token=…     → elegir la contraseña nueva.
 *  - #/agente/confirmar-correo?token=… → confirmar el correo nuevo (con un clic explícito:
 *    un escáner de enlaces del correo no lo confirma por abrirlo).
 * El token viaja en el fragmento (#), que el navegador no envía al servidor.
 */
const MIN_PASSWORD = 12;

function page(...children) {
  return h("main", { class: "page page--login" }, ...children);
}

function backToLogin(text = "Volver al inicio de sesión") {
  return h("a", { class: "login__link", href: "#/agente/login" }, text);
}

function formFlow(root, { title, intro, fields, submitLabel, action }) {
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const submit = h("button", { class: "btn btn--primary", type: "submit" }, submitLabel);
  const form = h(
    "form",
    {
      class: "login",
      on: {
        submit: async (event) => {
          event.preventDefault();
          error.hidden = true;
          submit.disabled = true;
          try {
            const message = await action();
            replaceChildren(
              root,
              page(
                h(
                  "div",
                  { class: "login" },
                  h("h1", {}, title),
                  h("p", { class: "notice", role: "status" }, message),
                  backToLogin("Ir al inicio de sesión")
                )
              )
            );
            root.querySelector("h1")?.focus?.();
          } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
          } finally {
            submit.disabled = false;
          }
        },
      },
    },
    h("h1", {}, title),
    intro ? h("p", { class: "muted" }, intro) : null,
    ...fields,
    error,
    submit,
    backToLogin()
  );
  replaceChildren(root, page(form));
  form.querySelector("input")?.focus();
}

export function forgotPasswordView(root, _params, deps = {}) {
  const session = deps.session ?? defaultSession;
  const email = h("input", {
    id: "forgot-email",
    class: "input",
    type: "email",
    autocomplete: "email",
    required: true,
  });
  formFlow(root, {
    title: "Recuperar la contraseña",
    intro: "Te enviaremos un enlace que vence en 15 minutos y sirve una sola vez.",
    fields: [h("label", { for: "forgot-email" }, "Correo de tu cuenta"), email],
    submitLabel: "Enviar enlace",
    action: async () => (await session.forgotPassword(email.value.trim())).message,
  });
  return () => {};
}

function missingToken(root) {
  replaceChildren(
    root,
    page(
      h(
        "div",
        { class: "login" },
        h("h1", {}, "Enlace incompleto"),
        h("p", {}, "Abre el enlace completo del correo, o pide uno nuevo."),
        h("a", { class: "login__link", href: "#/agente/recuperar" }, "Pedir un enlace nuevo")
      )
    )
  );
  return () => {};
}

export function resetPasswordView(root, params, deps = {}) {
  const session = deps.session ?? defaultSession;
  const token = params.query?.token;
  if (!token) return missingToken(root);
  const password = h("input", {
    id: "reset-password",
    class: "input",
    type: "password",
    autocomplete: "new-password",
    minlength: MIN_PASSWORD,
    required: true,
    "aria-describedby": "reset-help",
  });
  const repeat = h("input", {
    id: "reset-repeat",
    class: "input",
    type: "password",
    autocomplete: "new-password",
    required: true,
  });
  formFlow(root, {
    title: "Nueva contraseña",
    fields: [
      h("label", { for: "reset-password" }, "Contraseña nueva"),
      password,
      h(
        "p",
        { id: "reset-help", class: "muted" },
        `Al menos ${MIN_PASSWORD} caracteres. Una frase larga es más fácil de recordar y más segura.`
      ),
      h("label", { for: "reset-repeat" }, "Repítela"),
      repeat,
    ],
    submitLabel: "Cambiar contraseña",
    action: async () => {
      if (password.value !== repeat.value) throw new Error("Las contraseñas no coinciden.");
      const { message } = await session.resetPassword(token, password.value);
      return `${message} Por seguridad, se cerraron todas tus sesiones abiertas.`;
    },
  });
  return () => {};
}

export function confirmEmailView(root, params, deps = {}) {
  const session = deps.session ?? defaultSession;
  const token = params.query?.token;
  if (!token) return missingToken(root);
  formFlow(root, {
    title: "Confirmar tu correo nuevo",
    intro: "Al confirmar, este correo pasa a ser el de tu cuenta y con él inicias sesión.",
    fields: [],
    submitLabel: "Confirmar correo",
    action: async () => (await session.confirmEmail(token)).message,
  });
  return () => {};
}
