/**
 * Construcción del DOM SIN HTML en strings.
 *
 * Todo el contenido que viene del servidor (mensajes de clientes, de la IA,
 * de agentes) se inserta como NODO DE TEXTO: un mensaje con "<img onerror=…>"
 * se ve literal, nunca se ejecuta. ESLint prohíbe innerHTML/outerHTML/
 * insertAdjacentHTML en src/ (eslint.config.js) y tests/render.test.js lo
 * verifica con un ataque real.
 *
 * h("button", { class: "btn", type: "button", on: { click } }, "Enviar")
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = Array.isArray(value) ? value.filter(Boolean).join(" ") : value;
    else if (key === "on") for (const [event, handler] of Object.entries(value)) el.addEventListener(event, handler);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "text") el.textContent = String(value);
    else if (key in el && typeof value !== "string") el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Reemplaza el contenido de un elemento. */
export function replaceChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}
