/**
 * Router por hash (mismo enfoque que el Proyecto 1): "#/chat", "#/agente/c/<id>".
 * Cada vista es una función (root, params) → cleanup. Al cambiar de ruta se
 * ejecuta el cleanup de la anterior (cierra su WebSocket, timers, workers…).
 */
const routes = [];
let cleanup = null;
let currentKey = null;

export function route(pattern, view) {
  routes.push({ parts: pattern.split("/").filter(Boolean), view });
}

export function navigate(path) {
  window.location.hash = path;
}

export function match(hash) {
  const parts = hash.replace(/^#/, "").split("/").filter(Boolean);
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
    if (ok) return { view: candidate.view, params };
  }
  return null;
}

function render(root) {
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
  cleanup = found ? found.view(root, found.params) : null;
  root.querySelector("h1")?.setAttribute("tabindex", "-1");
  root.querySelector("h1")?.focus({ preventScroll: true });
}

export function startRouter(root) {
  window.addEventListener("hashchange", () => render(root));
  render(root);
}
