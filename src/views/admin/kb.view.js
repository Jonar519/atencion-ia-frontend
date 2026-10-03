import { h, replaceChildren } from "../../lib/dom.js";
import { adminApi as defaultAdminApi } from "../../api/admin.js";
import * as defaultSession from "../../auth/session.js";
import { formatDateTime } from "../../lib/format.js";
import { toast } from "../../components/toast.js";
import { adminPage, emptyState, errorState, loadingState } from "./adminPage.js";

/**
 * BASE DE CONOCIMIENTO (#/admin/kb, solo admin): pantalla mínima para crear,
 * editar, publicar/archivar y borrar artículos. Lo publicado es lo único que
 * el asistente usa para responder (RAG); guardar re-indexa en segundo plano.
 */
const STATUS = { draft: "Borrador", published: "Publicado", archived: "Archivado" };
const FILTERS = [
  ["", "Todos"],
  ["published", "Publicados"],
  ["draft", "Borradores"],
  ["archived", "Archivados"],
];

/** "Cómo bloquear mi tarjeta" → "como-bloquear-mi-tarjeta" (lo que exige la API). */
export function slugify(title) {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function adminKbView(root, _params, deps = {}) {
  const adminApi = deps.adminApi ?? defaultAdminApi;
  const session = deps.session ?? defaultSession;
  const main = adminPage(root, { title: "Base de conocimiento", current: "/admin/kb", staff: session.getStaff() });
  let filter = "";
  let disposed = false;

  const list = h("div", { class: "admin-list" });
  const editor = h("div", { class: "admin-editor" });
  const filterSelect = h(
    "select",
    { id: "kb-filter", class: "input input--compact", on: { change: (e) => ((filter = e.target.value), load()) } },
    FILTERS.map(([value, label]) => h("option", { value }, label))
  );
  replaceChildren(
    main,
    h(
      "div",
      { class: "admin-toolbar" },
      h("label", { for: "kb-filter" }, "Mostrar"),
      filterSelect,
      h(
        "button",
        { class: "btn btn--primary", type: "button", on: { click: () => openEditor(null) } },
        "Nuevo artículo"
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
    replaceChildren(list, loadingState("Cargando artículos"));
    try {
      const { items } = await adminApi.articles({ status: filter || undefined });
      if (disposed) return;
      replaceChildren(
        list,
        items.length
          ? h("ul", { class: "admin-rows" }, items.map(renderRow))
          : emptyState(
              filter ? "No hay artículos con ese estado." : "Aún no hay artículos.",
              "El asistente solo responde con lo que está PUBLICADO aquí. Crea el primero con “Nuevo artículo”."
            )
      );
    } catch (err) {
      replaceChildren(list, errorState(`No se pudieron cargar los artículos. ${err.message}`, load));
    } finally {
      main.setAttribute("aria-busy", "false");
    }
  }

  function renderRow(article) {
    return h(
      "li",
      { class: "admin-row" },
      h(
        "button",
        { class: "admin-row__main", type: "button", on: { click: () => openEditor(article.id) } },
        h("strong", {}, article.title),
        h(
          "span",
          { class: "muted" },
          `${article.category} · v${article.version} · ${formatDateTime(article.updatedAt)}`
        )
      ),
      h("span", { class: ["pill", `pill--kb-${article.status}`] }, STATUS[article.status] ?? article.status)
    );
  }

  async function openEditor(id) {
    replaceChildren(editor, loadingState("Cargando el artículo"));
    let article = null;
    try {
      if (id) article = await adminApi.article(id);
    } catch (err) {
      replaceChildren(
        editor,
        errorState(`No se pudo abrir el artículo. ${err.message}`, () => openEditor(id))
      );
      return;
    }
    const field = (name, label, input, help) => {
      input.id = `kb-${name}`;
      return [h("label", { for: input.id }, label), input, help ? h("p", { class: "muted" }, help) : null];
    };
    const title = h("input", {
      class: "input",
      required: true,
      minlength: 3,
      maxlength: 200,
      value: article?.title ?? "",
    });
    const slug = h("input", {
      class: "input",
      required: true,
      maxlength: 120,
      pattern: "[a-z0-9]+(-[a-z0-9]+)*",
      value: article?.slug ?? "",
    });
    let slugTouched = Boolean(article);
    slug.addEventListener("input", () => (slugTouched = true));
    title.addEventListener("input", () => {
      if (!slugTouched) slug.value = slugify(title.value);
    });
    const category = h("input", {
      class: "input",
      required: true,
      minlength: 2,
      maxlength: 60,
      value: article?.category ?? "",
    });
    const tags = h("input", { class: "input", value: (article?.tags ?? []).join(", ") });
    const body = h(
      "textarea",
      { class: "input admin-editor__body", required: true, minlength: 20, rows: 12 },
      article?.body ?? ""
    );
    const status = h(
      "select",
      { class: "input" },
      Object.entries(STATUS)
        .filter(([value]) => article || value !== "archived")
        .map(([value, label]) => h("option", { value, selected: (article?.status ?? "draft") === value }, label))
    );
    const result = h("p", { class: "profile__feedback", hidden: true });
    const save = h(
      "button",
      { class: "btn btn--primary", type: "submit" },
      article ? "Guardar cambios" : "Crear artículo"
    );

    const form = h(
      "form",
      {
        class: "profile__form admin-editor__form",
        "aria-label": article ? "Editar artículo" : "Nuevo artículo",
        on: {
          submit: async (event) => {
            event.preventDefault();
            save.disabled = true;
            result.hidden = true;
            const data = {
              title: title.value.trim(),
              slug: slug.value.trim(),
              category: category.value.trim(),
              tags: tags.value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
              body: body.value,
              status: status.value,
            };
            try {
              const saved = article
                ? await adminApi.updateArticle(article.id, data)
                : await adminApi.createArticle(data);
              toast(
                saved.status === "published" ? "Guardado. El asistente lo usará en cuanto se indexe." : "Guardado."
              );
              await load();
              openEditor(saved.id);
            } catch (err) {
              result.className = "profile__feedback form-error";
              result.setAttribute("role", "alert");
              result.textContent = err.message;
              result.hidden = false;
            } finally {
              save.disabled = false;
            }
          },
        },
      },
      h("h2", {}, article ? `Editar: ${article.title}` : "Nuevo artículo"),
      ...field("title", "Título", title),
      ...field("slug", "Identificador (URL)", slug, "Minúsculas, números y guiones. Se sugiere a partir del título."),
      ...field("category", "Categoría", category),
      ...field("tags", "Etiquetas (separadas por comas)", tags),
      ...field("body", "Contenido", body, "Mínimo 20 caracteres. Escribe como le explicarías al cliente."),
      ...field("status", "Estado", status, "Solo lo PUBLICADO llega al asistente. Archivar lo retira sin borrarlo."),
      result,
      h(
        "div",
        { class: "profile__actions" },
        save,
        article ? deleteButton(article) : null,
        h("button", { class: "link-btn", type: "button", on: { click: () => replaceChildren(editor) } }, "Cerrar")
      )
    );
    replaceChildren(editor, form);
    title.focus();
  }

  /** Borrar pide confirmar en un segundo clic (no hay "deshacer"). */
  function deleteButton(article) {
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
              button.textContent = "¿Borrar definitivamente? Clic de nuevo";
              return;
            }
            button.disabled = true;
            try {
              await adminApi.deleteArticle(article.id);
              toast("Artículo borrado.");
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
