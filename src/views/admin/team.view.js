import { h, replaceChildren } from "../../lib/dom.js";
import { adminApi as defaultAdminApi } from "../../api/admin.js";
import * as defaultSession from "../../auth/session.js";
import { toast } from "../../components/toast.js";
import { downloadText } from "../../lib/download.js";
import { priorityInfo } from "../../lib/priority.js";
import { formatDateTime } from "../../lib/format.js";
import { adminPage, emptyState, errorState, loadingState } from "./adminPage.js";

/**
 * EQUIPO (#/admin/equipo, solo admin): INVITAR a alguien (bloque F2: la única
 * forma de dar de alta una cuenta), reenviar o cancelar una invitación
 * pendiente, exportar los datos de un asesor, reasignar sus casos en curso y
 * eliminar (anonimizar) su cuenta. El enlace de invitación nunca aparece aquí:
 * solo viaja por correo (quien lo tuviera podría elegir la contraseña de otro).
 * Eliminar exige que no tenga casos: el botón lo explica y el backend lo
 * impone igual (409). Reglas: docs/data-retention.md (backend).
 */
const AVAILABILITY = { available: "Disponible", busy: "Ocupado", away: "Ausente", offline: "Desconectado" };

export function adminTeamView(root, _params, deps = {}) {
  const adminApi = deps.adminApi ?? defaultAdminApi;
  const session = deps.session ?? defaultSession;
  const me = session.getStaff();
  const main = adminPage(root, { title: "Equipo", current: "/admin/equipo", staff: me, session });
  let staff = [];
  let disposed = false;
  load();
  return () => {
    disposed = true;
  };

  async function load() {
    main.setAttribute("aria-busy", "true");
    replaceChildren(main, loadingState("Cargando el equipo"));
    try {
      ({ items: staff } = await adminApi.staff());
      if (disposed) return;
      replaceChildren(
        main,
        inviteControl(),
        staff.length
          ? h("ul", { class: "team" }, staff.map(renderMember))
          : emptyState("Todavía no hay nadie en el equipo.", "Invita a la primera persona con «Invitar asesor».")
      );
    } catch (err) {
      replaceChildren(main, errorState(`No se pudo cargar el equipo. ${err.message}`, load));
    } finally {
      main.setAttribute("aria-busy", "false");
    }
  }

  /** "Invitar asesor": despliega el formulario (nombre, correo, rol). La invitación va por correo. */
  function inviteControl() {
    const panel = h("div", { class: "team__invite", id: "team-invite", hidden: true });
    const toggle = h(
      "button",
      {
        class: "btn btn--primary",
        type: "button",
        "aria-expanded": "false",
        "aria-controls": "team-invite",
        on: {
          click: () => {
            const open = toggle.getAttribute("aria-expanded") !== "true";
            toggle.setAttribute("aria-expanded", String(open));
            panel.hidden = !open;
            if (open) {
              replaceChildren(
                panel,
                inviteForm(() => toggle.click())
              );
              panel.querySelector("input")?.focus();
            } else {
              replaceChildren(panel);
              toggle.focus();
            }
          },
        },
      },
      "Invitar asesor"
    );
    return h(
      "section",
      { class: "team__toolbar", "aria-label": "Invitar" },
      h(
        "p",
        { class: "muted" },
        "Las cuentas solo se crean por invitación: la persona recibe un enlace por correo (vence en 72 horas) y elige su contraseña."
      ),
      toggle,
      panel
    );
  }

  function inviteForm(close) {
    const name = h("input", { id: "invite-name", class: "input", autocomplete: "off", required: true, maxlength: 150 });
    const email = h("input", {
      id: "invite-email",
      class: "input",
      type: "email",
      autocomplete: "off",
      required: true,
    });
    const role = h(
      "select",
      { id: "invite-role", class: "input", "aria-describedby": "invite-role-help" },
      h("option", { value: "agent" }, "Asesor(a)"),
      h("option", { value: "admin" }, "Administrador(a)")
    );
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const submit = h("button", { class: "btn btn--primary", type: "submit" }, "Enviar invitación");
    return h(
      "form",
      {
        class: "team__invite-form",
        on: {
          submit: async (event) => {
            event.preventDefault();
            error.hidden = true;
            submit.disabled = true;
            try {
              const invited = await adminApi.invite({
                name: name.value.trim(),
                email: email.value.trim(),
                role: role.value,
              });
              toast(`Invitación enviada a ${invited.email}. El enlace vence en 72 horas.`);
              await load();
            } catch (err) {
              error.textContent = err.message;
              error.hidden = false;
              submit.disabled = false;
            }
          },
        },
      },
      h("label", { for: "invite-name" }, "Nombre"),
      name,
      h("label", { for: "invite-email" }, "Correo"),
      email,
      h("label", { for: "invite-role" }, "Rol"),
      role,
      h(
        "p",
        { id: "invite-role-help", class: "muted" },
        "Un administrador deberá activar la verificación en dos pasos al completar su cuenta."
      ),
      error,
      h(
        "div",
        { class: "profile__actions" },
        submit,
        h("button", { class: "btn", type: "button", on: { click: close } }, "Cancelar")
      )
    );
  }

  /** Invitación pendiente: su estado y vencimiento; se reenvía o se cancela (no se exporta ni se elimina). */
  function renderInvitation(member) {
    const { invitation } = member;
    const actions = h("div", { class: "profile__actions" });
    actions.append(
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
                await adminApi.resendInvitation(member.id);
                toast(`Enviamos un enlace nuevo a ${member.email}. El anterior ya no sirve.`);
                await load();
              } catch (err) {
                toast(err.message, { tone: "error" });
                button.disabled = false;
              }
            },
          },
        },
        "Reenviar invitación"
      ),
      cancelInvitationControl(member)
    );
    return h(
      "li",
      { class: "team__member team__member--pending", dataset: { id: member.id } },
      h(
        "div",
        { class: "team__info" },
        h("strong", {}, member.name),
        h("span", { class: "muted" }, member.email),
        h(
          "span",
          { class: "team__meta" },
          h("span", { class: "pill" }, member.role === "admin" ? "Administrador" : "Asesor"),
          " ",
          invitation.expired
            ? h("span", { class: "pill pill--danger" }, "Invitación vencida: reenvíala")
            : h(
                "span",
                { class: "pill pill--pending" },
                `Invitación pendiente · vence ${formatDateTime(invitation.expiresAt)}`
              )
        )
      ),
      actions
    );
  }

  /** Cancelar = la cuenta pendiente se borra y su enlace deja de servir. Confirmación en dos pasos. */
  function cancelInvitationControl(member) {
    let armed = false;
    const button = h(
      "button",
      {
        class: "btn btn--danger",
        type: "button",
        on: {
          click: async () => {
            if (!armed) {
              armed = true;
              button.textContent = `Confirmar: cancelar la invitación de ${member.name}`;
              return;
            }
            button.disabled = true;
            try {
              await adminApi.cancelInvitation(member.id);
              toast("Invitación cancelada: el enlace ya no sirve.");
              await load();
            } catch (err) {
              toast(err.message, { tone: "error" });
              button.disabled = false;
            }
          },
        },
      },
      "Cancelar invitación"
    );
    return button;
  }

  function renderMember(member) {
    if (member.invitation) return renderInvitation(member);
    const deleted = Boolean(member.deletedAt);
    const actions = h("div", { class: "profile__actions" });
    const details = h("div", { class: "team__details" });
    const item = h(
      "li",
      { class: ["team__member", deleted && "team__member--deleted"], dataset: { id: member.id } },
      h(
        "div",
        { class: "team__info" },
        h("strong", {}, member.name),
        h("span", { class: "muted" }, deleted ? "Cuenta eliminada (anonimizada)" : member.email),
        h(
          "span",
          { class: "team__meta" },
          h("span", { class: "pill" }, member.role === "admin" ? "Administrador" : "Asesor"),
          deleted
            ? null
            : member.isActive
              ? ` ${AVAILABILITY[member.availability] ?? member.availability}`
              : " Desactivada",
          member.activeConversations
            ? h("span", { class: "pill pill--agent_active" }, `${member.activeConversations} caso(s) en curso`)
            : null
        )
      ),
      actions,
      details
    );
    if (deleted) return item;

    const canExport = member.role === "agent";
    if (canExport) {
      actions.append(
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
                  const data = await adminApi.exportStaff(member.id);
                  downloadText(
                    `asesor-${member.id.slice(0, 8)}.json`,
                    JSON.stringify(data, null, 2),
                    "application/json"
                  );
                } catch (err) {
                  toast(err.message, { tone: "error" });
                } finally {
                  button.disabled = false;
                }
              },
            },
          },
          "Exportar datos"
        )
      );
    }
    if (member.activeConversations > 0) {
      actions.append(
        h(
          "button",
          {
            class: "btn",
            type: "button",
            "aria-expanded": "false",
            on: { click: (e) => toggleReassign(e.currentTarget, member, details) },
          },
          `Reasignar ${member.activeConversations} caso(s)`
        )
      );
    }
    if (member.role === "agent" && member.id !== me?.id) actions.append(deleteControl(member));
    return item;
  }

  async function toggleReassign(button, member, details) {
    if (button.getAttribute("aria-expanded") === "true") {
      button.setAttribute("aria-expanded", "false");
      replaceChildren(details);
      return;
    }
    button.setAttribute("aria-expanded", "true");
    replaceChildren(details, loadingState("Cargando sus casos"));
    try {
      const { items } = await adminApi.casesOf(member.id);
      const targets = staff.filter((s) => s.id !== member.id && s.isActive && !s.deletedAt);
      if (!items.length) {
        replaceChildren(details, h("p", { class: "muted" }, "Ya no tiene casos en curso."));
        return;
      }
      if (!targets.length) {
        replaceChildren(details, h("p", { class: "form-error" }, "No hay otro miembro activo al que reasignar."));
        return;
      }
      replaceChildren(
        details,
        h(
          "ul",
          { class: "team__cases" },
          items.map((c) => reassignRow(c, targets))
        )
      );
    } catch (err) {
      replaceChildren(
        details,
        errorState(`No se pudieron cargar sus casos. ${err.message}`, () => toggleReassign(button, member, details))
      );
    }
  }

  function reassignRow(conversation, targets) {
    const id = `reassign-${conversation.id}`;
    const select = h(
      "select",
      { id, class: "input input--compact" },
      targets.map((t) => h("option", { value: t.id }, `${t.name} (${t.activeConversations}/${t.maxConcurrent})`))
    );
    const priority = priorityInfo(conversation.priority);
    return h(
      "li",
      { class: "team__case" },
      h(
        "span",
        {},
        conversation.customer?.displayName || "Cliente anónimo",
        " ",
        h("span", { class: ["prio", `prio--${priority.level}`] }, priority.text)
      ),
      h("label", { class: "sr-only", for: id }, "Reasignar a"),
      select,
      h(
        "button",
        {
          class: "btn btn--primary",
          type: "button",
          on: {
            click: async (event) => {
              const button = event.currentTarget;
              button.disabled = true;
              try {
                await adminApi.reassign(conversation.id, select.value);
                toast("Caso reasignado.");
                await load();
              } catch (err) {
                toast(err.message, { tone: "error" });
                button.disabled = false;
              }
            },
          },
        },
        "Reasignar"
      )
    );
  }

  /** Eliminar = anonimizar: deshabilitado con explicación si tiene casos; si no, confirmación en dos pasos. */
  function deleteControl(member) {
    if (member.activeConversations > 0) {
      return h(
        "button",
        { class: "btn btn--danger", type: "button", disabled: true, title: "Primero reasigna sus casos en curso" },
        "Eliminar cuenta (reasigna antes sus casos)"
      );
    }
    let armed = false;
    const button = h(
      "button",
      {
        class: "btn btn--danger",
        type: "button",
        on: {
          click: async () => {
            if (!armed) {
              armed = true;
              button.textContent = `Confirmar: borrar los datos personales de ${member.name}`;
              button.setAttribute("aria-describedby", `anon-${member.id}`);
              button.after(
                h(
                  "p",
                  { id: `anon-${member.id}`, class: "form-error", role: "alert" },
                  "No se puede deshacer: se borran su nombre, correo, teléfono, foto y MFA; sus mensajes quedan con un nombre anónimo."
                )
              );
              return;
            }
            button.disabled = true;
            try {
              await adminApi.anonymize(member.id);
              toast("Cuenta eliminada (anonimizada).");
              await load();
            } catch (err) {
              toast(err.message, { tone: "error" });
              button.disabled = false;
            }
          },
        },
      },
      "Eliminar cuenta"
    );
    return button;
  }
}
