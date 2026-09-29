import { h } from "../lib/dom.js";

/** Avisos breves (región aria-live: los lectores de pantalla los anuncian). */
let region = null;

function ensureRegion() {
  region ??= document.body.appendChild(h("div", { class: "toasts", role: "status", "aria-live": "polite" }));
  return region;
}

export function toast(message, { tone = "info", timeoutMs = 5_000 } = {}) {
  const el = h("div", { class: ["toast", `toast--${tone}`] }, message);
  ensureRegion().append(el);
  setTimeout(() => el.remove(), timeoutMs);
  return el;
}
