import { h, replaceChildren } from "../../lib/dom.js";
import { profileApi as defaultProfileApi } from "../../api/profile.js";
import * as defaultSession from "../../auth/session.js";
import { navigate } from "../../router.js";
import { avatar } from "../../components/avatar.js";
import { createAvatarCropper, loadImage } from "../../components/avatarCropper.js";
import { backupCodesPanel } from "../../components/backupCodes.js";
import { toast } from "../../components/toast.js";
import { downloadText } from "../../lib/download.js";
import { formatDateTime } from "../../lib/format.js";
import { describeUserAgent } from "../../lib/userAgent.js";
import { loadingState } from "../../components/states.js";

/**
 * MI PERFIL (#/agente/perfil): datos, foto, apariencia, correo, contraseña,
 * verificación en dos pasos, sesiones activas y exportación de datos.
 * Cada sección guarda por separado y muestra su propio resultado o error
 * (sin recargar la página). Lo sensible pide la contraseña actual.
 */
/** "::1" (este mismo equipo) se guarda truncado como 0:0:0::; se muestra con palabras. */
function networkLabel(ip) {
  if (!ip) return "";
  return ip === "0:0:0::" || ip === "127.0.0.0" ? " · este equipo" : ` · red ${ip}`;
}

const THEMES = [
  ["system", "Como el sistema"],
  ["light", "Claro"],
  ["dark", "Oscuro"],
];

export function agentProfileView(root, _params, deps = {}) {
  const profileApi = deps.profileApi ?? defaultProfileApi;
  const session = deps.session ?? defaultSession;
  let disposed = false;
  let profile = null;
  const cleanups = [];

  const content = h("div", { class: "profile__content", "aria-busy": "true" });
  replaceChildren(
    root,
    h(
      "div",
      { class: "profile" },
      h(
        "header",
        { class: "topbar" },
        h("h1", { class: "topbar__title" }, "Mi perfil"),
        h("div", { class: "topbar__actions" }, h("a", { class: "link-btn", href: "#/agente" }, "Volver al panel"))
      ),
      h("main", { class: "profile__main" }, content)
    )
  );
  load();

  return () => {
    disposed = true;
    cleanups.forEach((fn) => fn());
  };

  // --- Carga, con esqueleto y error recuperable ---
  async function load() {
    replaceChildren(content, skeleton());
    content.setAttribute("aria-busy", "true");
    try {
      const me = session.getStaff() ?? (await session.restore());
      if (!me) return navigate("/agente/login");
      profile = await profileApi.get();
      if (disposed) return;
      render();
    } catch (err) {
      if (disposed) return;
      replaceChildren(
        content,
        h(
          "div",
          { class: "state state--error", role: "alert" },
          h("p", {}, `No se pudo cargar tu perfil. ${err.message}`),
          h("button", { class: "btn", type: "button", on: { click: load } }, "Reintentar")
        )
      );
    } finally {
      content.setAttribute("aria-busy", "false");
    }
  }

  function skeleton() {
    return loadingState("Cargando tu perfil", { lines: 3, block: true });
  }

  function render() {
    replaceChildren(
      content,
      identitySection(),
      avatarSection(),
      appearanceSection(),
      emailSection(),
      passwordSection(),
      mfaSection(),
      sessionsSection(),
      exportSection()
    );
  }

  function applyProfile(next) {
    profile = next;
    session.updateStaff({
      name: next.name,
      theme: next.theme,
      mfaEnabled: next.mfaEnabled,
      hasAvatar: next.hasAvatar,
      avatarVersion: next.avatarVersion,
    });
  }

  // --- Piezas comunes ---
  function section(id, title, ...children) {
    return h("section", { class: "profile__section", "aria-labelledby": id }, h("h2", { id }, title), ...children);
  }

  /** Mensaje de resultado de una sección: éxito (status) o error (alert). */
  function feedback() {
    const el = h("p", { class: "profile__feedback", hidden: true });
    return {
      el,
      ok(text) {
        el.className = "profile__feedback profile__feedback--ok";
        el.setAttribute("role", "status");
        el.textContent = text;
        el.hidden = false;
      },
      error(text) {
        el.className = "profile__feedback form-error";
        el.setAttribute("role", "alert");
        el.textContent = text;
        el.hidden = false;
      },
      clear() {
        el.hidden = true;
      },
    };
  }

  function field(id, label, input, help) {
    input.id = id;
    return [h("label", { for: id }, label), input, help ? h("p", { class: "muted", id: `${id}-help` }, help) : null];
  }

  function input(props) {
    return h("input", { class: "input", ...props });
  }

  /** Formulario con envío protegido (botón deshabilitado mientras espera) y mensaje de resultado. */
  function form(label, children, submitLabel, action) {
    const result = feedback();
    const submit = h("button", { class: "btn btn--primary", type: "submit" }, submitLabel);
    const el = h(
      "form",
      {
        class: "profile__form",
        "aria-label": label,
        on: {
          submit: async (event) => {
            event.preventDefault();
            result.clear();
            submit.disabled = true;
            try {
              const message = await action();
              if (message) result.ok(message);
            } catch (err) {
              result.error(err.message);
            } finally {
              submit.disabled = false;
            }
          },
        },
      },
      ...children,
      result.el,
      submit
    );
    return el;
  }

  // --- Secciones ---
  function identitySection() {
    const name = input({ required: true, minlength: 2, maxlength: 150, autocomplete: "name", value: profile.name });
    const phone = input({ type: "tel", autocomplete: "tel", maxlength: 30, value: profile.phone ?? "" });
    return section(
      "sec-datos",
      "Tus datos",
      h("p", { class: "muted" }, `Rol: ${profile.role === "admin" ? "Administrador" : "Asesor"} · ${profile.email}`),
      form(
        "Tus datos",
        [
          ...field("profile-name", "Nombre", name),
          ...field("profile-phone", "Teléfono (opcional)", phone, "Ej.: +57 300 123 4567. Solo lo ve el equipo."),
        ],
        "Guardar",
        async () => {
          applyProfile(await profileApi.update({ name: name.value.trim(), phone: phone.value.trim() }));
          return "Datos guardados.";
        }
      )
    );
  }

  function avatarSection() {
    const result = feedback();
    const preview = h("div", { class: "profile__avatar" });
    const editor = h("div", { class: "profile__cropper" });
    let cropper = null;
    let current = null;

    function showCurrent() {
      current?.dispose();
      current = avatar(profile, { loadAvatar: (id) => profileApi.avatarOf(id), size: "lg" });
      replaceChildren(preview, current.el);
    }
    cleanups.push(() => current?.dispose());
    showCurrent();

    const file = h("input", {
      id: "avatar-file",
      type: "file",
      accept: "image/png,image/jpeg,image/webp",
      class: "sr-only",
      tabindex: -1,
      "aria-hidden": "true",
      on: {
        change: async (event) => {
          result.clear();
          const chosen = event.target.files?.[0];
          event.target.value = "";
          if (!chosen) return;
          try {
            cropper = createAvatarCropper(await loadImage(chosen));
            replaceChildren(
              editor,
              cropper.el,
              h(
                "div",
                { class: "profile__actions" },
                h("button", { class: "btn btn--primary", type: "button", on: { click: save } }, "Guardar foto"),
                h("button", { class: "btn", type: "button", on: { click: cancel } }, "Cancelar")
              )
            );
            editor.querySelector("canvas")?.focus();
          } catch (err) {
            result.error(err.message);
          }
        },
      },
    });

    async function save(event) {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        applyProfile(await profileApi.setAvatar(await cropper.toBlob()));
        cancel();
        showCurrent();
        result.ok("Foto actualizada.");
      } catch (err) {
        result.error(err.message);
      } finally {
        button.disabled = false;
      }
    }

    function cancel() {
      cropper = null;
      replaceChildren(editor);
    }

    const remove = h(
      "button",
      {
        class: "btn",
        type: "button",
        hidden: !profile.hasAvatar,
        on: {
          click: async () => {
            try {
              applyProfile(await profileApi.deleteAvatar());
              remove.hidden = true;
              showCurrent();
              result.ok("Foto eliminada.");
            } catch (err) {
              result.error(err.message);
            }
          },
        },
      },
      "Quitar foto"
    );

    return section(
      "sec-foto",
      "Foto",
      h(
        "div",
        { class: "profile__row" },
        preview,
        h(
          "div",
          { class: "profile__actions" },
          // <button> real (no <label for>): se enfoca y se activa con el teclado.
          h("button", { class: "btn", type: "button", on: { click: () => file.click() } }, "Elegir una foto"),
          file,
          remove
        )
      ),
      h("p", { class: "muted" }, "Se recorta en tu navegador y se sube solo el recorte (256 × 256 px)."),
      editor,
      result.el
    );
  }

  function appearanceSection() {
    const result = feedback();
    const options = THEMES.map(([value, label]) =>
      h(
        "label",
        { class: "choice-inline" },
        h("input", {
          type: "radio",
          name: "theme",
          value,
          checked: profile.theme === value,
          on: {
            change: async () => {
              result.clear();
              try {
                applyProfile(await profileApi.update({ theme: value }));
                result.ok("Tema guardado.");
              } catch (err) {
                result.error(err.message);
              }
            },
          },
        }),
        ` ${label}`
      )
    );
    return section(
      "sec-apariencia",
      "Apariencia",
      h("fieldset", { class: "profile__fieldset" }, h("legend", {}, "Tema del panel"), ...options),
      result.el
    );
  }

  function emailSection() {
    const newEmail = input({ type: "email", required: true, autocomplete: "email" });
    const password = input({ type: "password", required: true, autocomplete: "current-password" });
    return section(
      "sec-correo",
      "Correo",
      h("p", {}, "Actual: ", h("strong", {}, profile.email)),
      form(
        "Cambiar el correo",
        [...field("email-new", "Correo nuevo", newEmail), ...field("email-password", "Tu contraseña actual", password)],
        "Enviar enlace de confirmación",
        async () => {
          const { message } = await profileApi.changeEmail(newEmail.value.trim(), password.value);
          password.value = "";
          return `${message} También avisamos a tu correo actual.`;
        }
      )
    );
  }

  function passwordSection() {
    const current = input({ type: "password", required: true, autocomplete: "current-password" });
    const next = input({ type: "password", required: true, minlength: 12, autocomplete: "new-password" });
    const repeat = input({ type: "password", required: true, autocomplete: "new-password" });
    return section(
      "sec-contrasena",
      "Contraseña",
      form(
        "Cambiar la contraseña",
        [
          ...field("pwd-current", "Contraseña actual", current),
          ...field("pwd-new", "Contraseña nueva", next, "Al menos 12 caracteres; no uses tu nombre ni tu correo."),
          ...field("pwd-repeat", "Repite la nueva", repeat),
        ],
        "Cambiar contraseña",
        async () => {
          if (next.value !== repeat.value) throw new Error("Las contraseñas nuevas no coinciden.");
          const { otherSessionsClosed } = await profileApi.changePassword(current.value, next.value);
          current.value = next.value = repeat.value = "";
          return otherSessionsClosed
            ? `Contraseña cambiada. Se cerraron ${otherSessionsClosed} sesión(es) en otros dispositivos.`
            : "Contraseña cambiada.";
        }
      )
    );
  }

  function mfaSection() {
    const body = h("div", {});
    const result = feedback();

    function codeInput(id) {
      return input({ id, inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, required: true });
    }

    function showCodes(codes, message) {
      replaceChildren(
        body,
        backupCodesPanel(codes, {
          onDone: () => {
            result.ok(message);
            renderState();
          },
        })
      );
    }

    function renderState() {
      if (!profile.mfaEnabled) {
        replaceChildren(
          body,
          h("p", {}, "Desactivada. Actívala para que tu contraseña sola no alcance para entrar a tu cuenta."),
          h("button", { class: "btn btn--primary", type: "button", on: { click: startSetup } }, "Activar")
        );
        return;
      }
      const regenCode = codeInput("mfa-regen-code");
      replaceChildren(
        body,
        h(
          "p",
          {},
          h("strong", {}, "Activa"),
          profile.mfaRequired ? " (obligatoria para administradores)" : "",
          `. Te quedan ${profile.backupCodesRemaining} código(s) de respaldo.`
        ),
        form(
          "Nuevos códigos de respaldo",
          field("mfa-regen-code", "Código de tu app", regenCode),
          "Generar códigos nuevos",
          async () => {
            const { backupCodes } = await profileApi.mfaBackupCodes(regenCode.value.trim());
            profile = { ...profile, backupCodesRemaining: backupCodes.length };
            showCodes(backupCodes, "Códigos nuevos generados; los anteriores ya no sirven.");
          }
        ),
        profile.mfaRequired ? null : disableForm()
      );
    }

    function disableForm() {
      const password = input({ type: "password", required: true, autocomplete: "current-password" });
      const code = codeInput("mfa-off-code");
      return h(
        "details",
        { class: "profile__danger" },
        h("summary", {}, "Desactivar la verificación en dos pasos"),
        form(
          "Desactivar la verificación en dos pasos",
          [
            ...field("mfa-off-password", "Contraseña actual", password),
            ...field("mfa-off-code", "Código de tu app", code),
          ],
          "Desactivar",
          async () => {
            await profileApi.mfaDisable(password.value, code.value.trim());
            applyProfile({ ...profile, mfaEnabled: false, backupCodesRemaining: 0 });
            renderState();
            result.ok("Verificación en dos pasos desactivada.");
          }
        )
      );
    }

    async function startSetup(event) {
      event.currentTarget.disabled = true;
      result.clear();
      try {
        const setup = await profileApi.mfaSetup();
        const code = codeInput("mfa-setup-code");
        replaceChildren(
          body,
          h("p", {}, "Escanea el código con tu app de autenticación y escribe los 6 dígitos que muestra."),
          h(
            "div",
            { class: "mfa__setup" },
            h("img", {
              class: "mfa__qr",
              src: setup.qrDataUrl,
              alt: "Código QR para tu app de autenticación",
              width: 220,
              height: 220,
            }),
            h(
              "p",
              { class: "muted" },
              "¿No puedes escanear? Clave: ",
              h("code", { class: "mfa__secret" }, setup.secret.replace(/(.{4})/g, "$1 ").trim())
            )
          ),
          form(
            "Confirmar la verificación en dos pasos",
            field("mfa-setup-code", "Código de 6 dígitos", code),
            "Activar",
            async () => {
              const { backupCodes } = await profileApi.mfaConfirm(code.value.trim());
              applyProfile({ ...profile, mfaEnabled: true, backupCodesRemaining: backupCodes.length });
              showCodes(backupCodes, "Verificación en dos pasos activada.");
            }
          ),
          h("button", { class: "link-btn", type: "button", on: { click: renderState } }, "Cancelar")
        );
        body.querySelector("input")?.focus();
      } catch (err) {
        result.error(err.message);
        renderState();
      }
    }

    renderState();
    return section("sec-mfa", "Verificación en dos pasos", body, result.el);
  }

  function sessionsSection() {
    const list = h("ul", { class: "sessions", "aria-busy": "true" });
    const result = feedback();
    const revokeOthers = h(
      "button",
      {
        class: "btn",
        type: "button",
        on: {
          click: async () => {
            revokeOthers.disabled = true;
            try {
              const { closed } = await profileApi.revokeOtherSessions();
              result.ok(closed ? `Se cerraron ${closed} sesión(es).` : "No había otras sesiones abiertas.");
              await loadSessions();
            } catch (err) {
              result.error(err.message);
            } finally {
              revokeOthers.disabled = false;
            }
          },
        },
      },
      "Cerrar sesión en los demás dispositivos"
    );

    async function loadSessions() {
      list.setAttribute("aria-busy", "true");
      replaceChildren(
        list,
        h("li", { class: "skeleton skeleton--line" }),
        h("li", { class: "skeleton skeleton--line" })
      );
      try {
        const { items } = await profileApi.sessions();
        if (disposed) return;
        replaceChildren(list, items.map(renderSession));
      } catch (err) {
        replaceChildren(
          list,
          h(
            "li",
            { class: "state state--error", role: "alert" },
            `No se pudieron cargar las sesiones. ${err.message} `,
            h("button", { class: "btn", type: "button", on: { click: loadSessions } }, "Reintentar")
          )
        );
      } finally {
        list.setAttribute("aria-busy", "false");
      }
    }

    function renderSession(item) {
      return h(
        "li",
        { class: ["session", item.current && "session--current"] },
        h(
          "div",
          {},
          h("strong", {}, describeUserAgent(item.userAgent)),
          item.current ? h("span", { class: "pill pill--agent_active" }, "Esta sesión") : null,
          h(
            "p",
            { class: "muted" },
            item.location ? `${item.location} (ubicación aproximada)` : "Ubicación desconocida",
            networkLabel(item.ipAddress)
          ),
          h(
            "p",
            { class: "muted" },
            `Inició ${formatDateTime(item.startedAt)} · última actividad ${formatDateTime(item.lastActiveAt)}`
          )
        ),
        item.current
          ? null
          : h(
              "button",
              {
                class: "btn",
                type: "button",
                on: {
                  click: async (event) => {
                    const button = event.currentTarget;
                    button.disabled = true;
                    try {
                      await profileApi.revokeSession(item.id);
                      result.ok("Sesión cerrada.");
                      await loadSessions();
                    } catch (err) {
                      result.error(err.message);
                      button.disabled = false;
                    }
                  },
                },
              },
              "Cerrar"
            )
      );
    }

    loadSessions();
    return section(
      "sec-sesiones",
      "Sesiones activas",
      h(
        "p",
        { class: "muted" },
        "La ubicación es APROXIMADA: se deduce del rango de la dirección IP con una base local, y la IP se guarda sin su último número."
      ),
      list,
      result.el,
      revokeOthers
    );
  }

  function exportSection() {
    const result = feedback();
    return section(
      "sec-datos-export",
      "Tus datos personales",
      h(
        "p",
        { class: "muted" },
        "Descarga lo que el sistema guarda sobre ti (perfil, sesiones y actividad) en un archivo JSON."
      ),
      h(
        "button",
        {
          class: "btn",
          type: "button",
          on: {
            click: async (event) => {
              const button = event.currentTarget;
              button.disabled = true;
              try {
                const data = await profileApi.exportData();
                downloadText("mis-datos-atencion-ia.json", JSON.stringify(data, null, 2), "application/json");
                result.ok("Descarga lista.");
              } catch (err) {
                result.error(err.message);
                toast(err.message, { tone: "error" });
              } finally {
                button.disabled = false;
              }
            },
          },
        },
        "Descargar mis datos"
      ),
      result.el
    );
  }
}
