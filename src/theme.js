/**
 * Tema claro/oscuro del PANEL (Fase 7). La preferencia es del perfil del
 * staff ("system" | "light" | "dark"); "system" sigue al sistema operativo y
 * cambia en vivo si el sistema cambia. Se aplica con data-theme en <html>
 * (tokens en styles/tokens.css). Sin sesión (widget del cliente, login) el
 * tema es el claro de siempre.
 */
let current = "light-default";
let media = null;

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
}

function onSystemChange() {
  if (current === "system") document.documentElement.dataset.theme = systemPrefersDark() ? "dark" : "light";
}

/** Tema efectivo que queda aplicado ("light" | "dark"). */
export function applyTheme(preference) {
  current = preference ?? "light-default";
  const root = document.documentElement;
  if (current === "light-default") {
    delete root.dataset.theme;
  } else {
    const dark = current === "dark" || (current === "system" && systemPrefersDark());
    root.dataset.theme = dark ? "dark" : "light";
  }
  if (!media && typeof window !== "undefined" && window.matchMedia) {
    media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener?.("change", onSystemChange);
  }
  return root.dataset.theme ?? "light";
}

/** Sigue a la sesión: al entrar aplica la preferencia del perfil; al salir vuelve al claro. */
export function bindThemeToSession(session) {
  applyTheme(session.getStaff()?.theme ?? null);
  return session.onSessionChange(({ staff }) => applyTheme(staff?.theme ?? null));
}
