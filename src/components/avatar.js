import { h } from "../lib/dom.js";

/**
 * Avatar de un miembro del staff. La imagen se pide con el access token (no
 * se puede poner la URL en un <img>: el navegador no enviaría el header) y se
 * muestra con un URL blob: local. Sin foto (o si falla), las iniciales.
 */
export function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function avatar({ id, name, hasAvatar, avatarVersion }, { loadAvatar, size = "md" } = {}) {
  const el = h("span", { class: ["avatar", `avatar--${size}`], "aria-hidden": "true" }, initials(name));
  let url = null;
  if (hasAvatar && loadAvatar) {
    loadAvatar(id, avatarVersion)
      .then((blob) => {
        if (!blob) return;
        url = URL.createObjectURL(blob);
        el.replaceChildren(h("img", { src: url, alt: "" }));
      })
      .catch(() => {});
  }
  return {
    el,
    dispose: () => url && URL.revokeObjectURL(url),
  };
}
