import { h, replaceChildren } from "../../lib/dom.js";
import { adminApi as defaultAdminApi } from "../../api/admin.js";
import * as defaultSession from "../../auth/session.js";
import { toast } from "../../components/toast.js";
import { adminPage, emptyState, errorState, loadingState } from "./adminPage.js";

/**
 * RESPUESTAS PREDEFINIDAS (#/admin/respuestas, solo admin). Los asesores las
 * insertan con un clic en su caja de respuesta; las desactivadas no les
 * aparecen. Marcadores: {cliente} (nombre de pila del cliente) y {asesor}.
 */
export function adminCannedView(root, _params, deps = {}) {
  const adminApi = deps.adminApi ?? defaultAdminApi;
  const session = deps.session ?? defaultSession;
  const main = adminPage(root, {
    title: "Respuestas predefinidas",
    current: "/admin/respuestas",
    staff: session.getStaff(),
    session,
  });
  const list = h("div", { class: "admin-list" });
  const editor = h("div", { class: "admin-editor" });
  let disposed = false;

  replaceChildren(
    main,
    h(
      "div",
      { class: "admin-toolbar" },
      h("p", { class: "muted" }, "Marcadores: {cliente} y {asesor} se reemplazan al insertar la respuesta."),
      h(
        "button",
        { class: "btn btn--primary", type: "button", on: { click: () => openEditor(null) } },
        "Nueva respuesta"
      )
    ),
    h("div", { class: "admin-split" }, list, editor)
  );
  load();
  return () => {
    disposed = true;
  };

  async function load() {
    main.setAttribute("aria-busy", "true");
    replaceChildren(list, loadingState("Cargando respuestas"));
    try {
      const { items } = await adminApi.cannedAll();
      if (disposed) return;
      replaceChildren(
        list,
        items.length
          ? h("ul", { class: "admin-rows" }, items.map(renderRow))
          : emptyState(
              "Aún no hay respuestas predefinidas.",
              "Crea las frases que el equipo repite (saludo, verificación de identidad, cierre) para responder más rápido."
            )
      );
    } catch (err) {
      replaceChildren(list, errorState(`No se pudieron cargar las respuestas. ${err.message}`, load));
    } finally {
      main.setAttribute("aria-busy", "false");
    }
  }

  function renderRow(item) {
    return h(
      "li",
      { class: ["admin-row", !item.isActive && "admin-row--off"] },
      h(
        "button",
        { class: "admin-row__main", type: "button", on: { click: () => openEditor(item) } },
        h("strong", {}, item.title),
        h("span", { class: "muted admin-row__preview" }, item.body)
      ),
      item.shortcut ? h("code", { class: "admin-row__shortcut" }, `/${item.shortcut}`) : null,
      item.isActive ? null : h("span", { class: "pill" }, "Desactivada")
    );
  }

  function openEditor(item) {
    const title = h("input", {
      id: "canned-title",
      class: "input",
      required: true,
      minlength: 2,
      maxlength: 80,
      value: item?.title ?? "",
    });
    const shortcut = h("input", {
      id: "canned-shortcut",
      class: "input",
      maxlength: 30,
      pattern: "[a-z0-9]+(-[a-z0-9]+)*",
      value: item?.shortcut ?? "",
    });
    const body = h(
      "textarea",
      { id: "canned-body", class: "input", required: true, maxlength: 2000, rows: 6 },
      item?.body ?? ""
    );
    const active = h("input", { id: "canned-active", type: "checkbox", checked: item ? item.isActive : true });
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const save = h("button", { class: "btn btn--primary", type: "submit" }, item ? "Guardar" : "Crear");

    const form = h(
      "form",
      {
        class: "profile__form",
        "aria-label": item ? "Editar respuesta" : "Nueva respuesta",
        on: {
          submit: async (event) => {
            event.preventDefault();
            error.hidden = true;
            save.disabled = true;
            const data = {
              title: title.value.trim(),
              body: body.value.trim(),
              shortcut: shortcut.value.trim() || null,
              isActive: active.checked,
            };
            try {
              if (item) await adminApi.updateCanned(item.id, data);
              else await adminApi.createCanned(data);
              toast("Respuesta guardada.");
              replaceChildren(editor);
              await load();
            } catch (err) {
              error.textContent = err.message;
              error.hidden = false;
            } finally {
              save.disabled = false;
            }
          },
        },
      },
      h("h2", {}, item ? "Editar respuesta" : "Nueva respuesta"),
      h("label", { for: "canned-title" }, "Título"),
      title,
      h("label", { for: "canned-body" }, "Texto"),
      body,
      h("label", { for: "canned-shortcut" }, "Atajo (opcional)"),
      shortcut,
      h("p", { class: "muted" }, "Ej.: saludo, bloqueo-tarjeta. El asesor puede buscarla por el atajo."),
      h(
        "p",
        { class: "backup-codes__confirm" },
        active,
        h("label", { for: "canned-active" }, " Activa (visible para los asesores)")
      ),
      error,
      h(
        "div",
        { class: "profile__actions" },
        save,
        item ? deleteButton(item) : null,
        h("button", { class: "link-btn", type: "button", on: { click: () => replaceChildren(editor) } }, "Cerrar")
      )
    );
    replaceChildren(editor, form);
    title.focus();
  }

  function deleteButton(item) {
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
              button.textContent = "¿Borrar? Clic de nuevo";
              return;
            }
            button.disabled = true;
            try {
              await adminApi.deleteCanned(item.id);
              toast("Respuesta borrada.");
              replaceChildren(editor);
              await load();
            } catch (err) {
              toast(err.message, { tone: "error" });
              button.disabled = false;
            }
          },
        },
      },
      "Borrar"
    );
    return button;
  }
}
