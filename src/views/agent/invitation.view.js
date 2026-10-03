import { h, replaceChildren } from "../../lib/dom.js";
import * as defaultSession from "../../auth/session.js";
import { navigate } from "../../router.js";
import { loadingState } from "../../components/states.js";
import { showMfaEnrollment } from "../../components/mfaEnrollment.js";

/**
 * COMPLETA TU CUENTA (#/agente/invitacion?token=…, bloque F2). La ÚNICA forma
 * de obtener una cuenta del panel: un admin invita y el enlace llega por correo.
 *
 *  1. Se revisa la invitación (a quién invitaron, con qué rol).
 *  2. La persona elige SU contraseña (misma política de siempre; si no cumple,
 *     el enlace no se gasta).
 *  3. Admin: debe activar la verificación en dos pasos antes de entrar.
 *     Asesor: entra, y se le recomienda activarla (es opcional).
 *
 * Un enlace que no sirve (vencido, usado, cancelado, mal copiado) muestra
 * SIEMPRE el mismo mensaje: la pantalla no revela si el correo tiene cuenta.
 */
const MIN_PASSWORD = 12;
const ROLE = { admin: "administrador(a)", agent: "asesor(a)" };

function page(...children) {
  return h("main", { class: "page page--login" }, ...children);
}

function card(...children) {
  return h("div", { class: "login" }, ...children);
}

function toLogin(text = "Ir al inicio de sesión") {
  return h("a", { class: "login__link", href: "#/agente/login" }, text);
}

export function invitationView(root, params, deps = {}) {
  const session = deps.session ?? defaultSession;
  const token = params.query?.token;
  let disposed = false;
  const main = page();
  replaceChildren(root, main);

  if (!token) {
    showInvalid("El enlace está incompleto. Ábrelo completo desde el correo de la invitación.");
  } else {
    replaceChildren(main, card(h("h1", {}, "Completa tu cuenta"), loadingState("Revisando tu invitación")));
    session
      .inspectInvitation(token)
      .then((invitation) => !disposed && showForm(invitation))
      .catch((err) => !disposed && showInvalid(err.message));
  }
  return () => {
    disposed = true;
  };

  function focusTitle() {
    main.querySelector("h1")?.setAttribute("tabindex", "-1");
    main.querySelector("h1")?.focus();
  }

  function showInvalid(message) {
    replaceChildren(
      main,
      card(
        h("h1", {}, "Invitación no válida"),
        h("p", { role: "alert" }, message),
        h("p", { class: "muted" }, "Las cuentas del panel solo se crean por invitación de un administrador."),
        toLogin()
      )
    );
    focusTitle();
  }

  function showForm(invitation) {
    const password = h("input", {
      id: "invite-password",
      class: "input",
      type: "password",
      autocomplete: "new-password",
      minlength: MIN_PASSWORD,
      required: true,
      "aria-describedby": "invite-help",
    });
    const repeat = h("input", {
      id: "invite-repeat",
      class: "input",
      type: "password",
      autocomplete: "new-password",
      required: true,
    });
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const submit = h("button", { class: "btn btn--primary", type: "submit" }, "Completar mi cuenta");
    const form = h(
      "form",
      {
        class: "login",
        on: {
          submit: async (event) => {
            event.preventDefault();
            error.hidden = true;
            if (password.value !== repeat.value) {
              error.textContent = "Las contraseñas no coinciden.";
              error.hidden = false;
              repeat.focus();
              return;
            }
            submit.disabled = true;
            try {
              const result = await session.acceptInvitation(token, password.value);
              if (disposed) return;
              if (result.mfaEnrollmentRequired) {
                showMfaEnrollment(main, {
                  session,
                  enrollmentToken: result.enrollmentToken,
                  intro:
                    "Tu contraseña quedó guardada. Como administrador(a), activa ahora la verificación en dos pasos: escanea el código con Google Authenticator, Microsoft Authenticator u otra app compatible.",
                  onDone: () => navigate("/agente"),
                });
              } else {
                showReady();
              }
            } catch (err) {
              error.textContent = err.message;
              error.hidden = false;
              password.focus();
            } finally {
              submit.disabled = false;
            }
          },
        },
      },
      h("h1", {}, "Completa tu cuenta"),
      h(
        "p",
        {},
        `Hola, ${invitation.name}. Te invitaron al panel de atención de Banco Cordillera como ${ROLE[invitation.role] ?? "asesor(a)"}.`
      ),
      h("p", { class: "muted" }, "Iniciarás sesión con este correo: ", h("strong", {}, invitation.email)),
      invitation.mfaRequired
        ? h(
            "p",
            { class: "notice" },
            "Después de elegir tu contraseña activarás la verificación en dos pasos: ten a mano una app de autenticación en tu teléfono."
          )
        : null,
      h("label", { for: "invite-password" }, "Elige tu contraseña"),
      password,
      h(
        "p",
        { id: "invite-help", class: "muted" },
        `Al menos ${MIN_PASSWORD} caracteres. Una frase larga es más fácil de recordar y más segura.`
      ),
      h("label", { for: "invite-repeat" }, "Repítela"),
      repeat,
      error,
      submit
    );
    replaceChildren(main, form);
    focusTitle();
  }

  /** Asesor: la cuenta ya está lista y con sesión. La verificación en dos pasos es opcional, pero se recomienda. */
  function showReady() {
    replaceChildren(
      main,
      card(
        h("h1", {}, "Tu cuenta está lista"),
        h("p", { class: "notice", role: "status" }, "Ya puedes atender casos desde el panel."),
        h(
          "p",
          {},
          "Te recomendamos activar la verificación en dos pasos: así, aunque alguien conozca tu contraseña, no podrá entrar sin tu teléfono."
        ),
        h(
          "div",
          { class: "profile__actions" },
          h(
            "button",
            { class: "btn btn--primary", type: "button", on: { click: () => navigate("/agente/perfil") } },
            "Activar la verificación ahora"
          ),
          h("button", { class: "btn", type: "button", on: { click: () => navigate("/agente") } }, "Ir al panel")
        )
      )
    );
    focusTitle();
  }
}
