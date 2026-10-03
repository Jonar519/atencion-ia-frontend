/**
 * Router por hash (mismo enfoque que el Proyecto 1): "#/chat", "#/agente/c/<id>".
 * Admite "query" en el hash ("#/agente/restablecer?token=…"): los enlaces de
 * los correos llevan el token en el FRAGMENTO, que el navegador nunca envía al
 * servidor. La vista lo recibe en params.query.
 * Cada vista es una función (root, params) → cleanup. Al cambiar de ruta se
 * ejecuta el cleanup de la anterior (cierra su WebSocket, timers, workers…).
 */
const routes = [];
let cleanup = null;
let currentKey = null;

/**
 * guard (opcional): (params) → true para mostrar la vista, o una ruta a la que
 * redirigir ("/agente/login", "/agente"). Puede ser async (p. ej. esperar a
 * recuperar la sesión). Es solo la PUERTA de la interfaz: quien decide qué se
 * puede hacer es siempre el backend (requireRole en cada endpoint).
 */
export function route(pattern, view, { guard } = {}) {
  routes.push({ parts: pattern.split("/").filter(Boolean), view, guard });
}

export function navigate(path) {
  window.location.hash = path;
}

export function match(hash) {
  const [path, search = ""] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(search));
  for (const candidate of routes) {
    if (candidate.parts.length !== parts.length) continue;
    const params = {};
    const ok = candidate.parts.every((part, i) => {
      if (part.startsWith(":")) {
        params[part.slice(1)] = decodeURIComponent(parts[i]);
        return true;
      }
      return part === parts[i];
    });
    if (ok) return { view: candidate.view, guard: candidate.guard, params: { ...params, query } };
  }
  return null;
}

let renderId = 0;

async function render(root) {
  const hash = window.location.hash || "#/";
  const found = match(hash) ?? match("#/");
  // Mismo patrón de vista con otro parámetro (p. ej. otra conversación del panel):
  // la vista decide si se re-monta completa; aquí se re-monta siempre por simpleza.
  const key = hash;
  if (key === currentKey) return;
  currentKey = key;
  try {
    cleanup?.();
  } catch (err) {
    console.error("Error al cerrar la vista anterior", err);
  }
  cleanup = null;
  if (found?.guard) {
    const id = ++renderId;
    const verdict = await found.guard(found.params);
    // Otra navegación ocurrió mientras se decidía: esta ya no aplica.
    if (id !== renderId || currentKey !== key) return;
    if (verdict !== true) {
      currentKey = null;
      navigate(typeof verdict === "string" ? verdict : "/");
      return;
    }
  } else {
    renderId += 1;
  }
  cleanup = found ? found.view(root, found.params) : null;
  root.querySelector("h1")?.setAttribute("tabindex", "-1");
  root.querySelector("h1")?.focus({ preventScroll: true });
}

export function startRouter(root) {
  window.addEventListener("hashchange", () => render(root));
  return render(root);
}

/**
 * Guard por rol: exige sesión (si no, al login) y uno de los roles (si no, al
 * panel con un aviso). Espera a restaurar la sesión con la cookie si hace falta.
 */
export function requireRole(session, roles, { onDenied } = {}) {
  return async () => {
    const staff = session.getStaff() ?? (await session.restore().catch(() => null));
    if (!staff) return "/agente/login";
    if (!roles.includes(staff.role)) {
      onDenied?.(staff);
      return "/agente";
    }
    return true;
  };
}
