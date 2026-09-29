import { h, replaceChildren } from "../../lib/dom.js";
import * as defaultSession from "../../auth/session.js";
import { navigate } from "../../router.js";

/** Inicio de sesión del staff (#/agente/login). Si la cookie de refresh sigue vigente, entra directo. */
export function agentLoginView(root, _params, deps = {}) {
  const session = deps.session ?? defaultSession;
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
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const submit = h("button", { class: "btn btn--primary", type: "submit" }, "Entrar");

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
            await session.login(email.value.trim(), password.value);
            navigate("/agente");
          } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
            password.value = "";
            password.focus();
          } finally {
            submit.disabled = false;
          }
        },
      },
    },
    h("h1", {}, "Panel de asesores"),
    h("p", { class: "muted" }, "Banco Cordillera · Atención al cliente"),
    h("label", { for: "login-email" }, "Correo"),
    email,
    h("label", { for: "login-password" }, "Contraseña"),
    password,
    error,
    submit
  );

  replaceChildren(root, h("main", { class: "page page--login" }, form));
  session.restore().then((staff) => staff && navigate("/agente"));
  return () => {};
}
