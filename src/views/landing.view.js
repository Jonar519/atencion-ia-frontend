import { h, replaceChildren } from "../lib/dom.js";

/**
 * PORTADA (#/), bloque F4. En producción el widget iría incrustado en el sitio
 * del banco; aquí se elige cómo entrar. Página PÚBLICA: siempre el tema claro de
 * marca (F1).
 *
 * Un solo momento destacado: un fragmento de conversación de tres turnos con la
 * MISMA regla de color que usa toda la app para decir quién habla (navy = el
 * cliente, gris = el asistente virtual, ámbar = una persona del banco). Cuenta
 * cómo funciona el servicio sin adornos. Es ilustrativo: va oculto para los
 * lectores de pantalla (que no lo confundan con un chat real) y su pie de
 * figura, visible, dice lo mismo en una frase.
 *
 * Jerarquía: la página es del CLIENTE (acción principal, primero también en el
 * teléfono); la entrada del staff es una línea discreta debajo.
 */
const THREAD = [
  ["customer", "Cliente", "No reconozco un cargo de $450.000 en mi tarjeta."],
  ["ai", "Asistente virtual", "Por tu seguridad, te paso con un asesor ahora mismo."],
  ["agent", "Laura · asesora", "Hola, soy Laura. Ya veo el cargo; lo revisamos juntos."],
];

export function landingView(root) {
  replaceChildren(
    root,
    h(
      "main",
      { class: "landing" },
      h(
        "div",
        { class: "landing__intro" },
        h("p", { class: "landing__brand" }, "Banco Cordillera"),
        h("h1", { class: "landing__title" }, "Atención al cliente, a cualquier hora"),
        h("p", { class: "landing__lede" }, "Te responde nuestro asistente y, si lo necesitas, una persona del banco."),
        h(
          "nav",
          { class: "landing__choices", "aria-label": "Elige cómo entrar" },
          h(
            "a",
            { class: "landing__customer", href: "#/chat" },
            h("strong", {}, "Soy cliente"),
            h("span", {}, "Escríbenos desde aquí, sin registrarte."),
            h("span", { class: "landing__cta" }, "Escribir al banco ", h("span", { "aria-hidden": "true" }, "→"))
          ),
          h(
            "p",
            { class: "landing__staff" },
            "¿Trabajas en el banco? ",
            h(
              "a",
              { class: "landing__staff-link", href: "#/agente" },
              "Entrar al panel de asesores ",
              h("span", { "aria-hidden": "true" }, "→")
            )
          )
        )
      ),
      h(
        "figure",
        { class: "landing__demo" },
        h(
          "div",
          { class: "landing__thread", "aria-hidden": "true" },
          THREAD.map(([who, label, text]) =>
            h(
              "div",
              { class: ["landing__msg", `landing__msg--${who}`] },
              h("span", { class: "landing__who" }, label),
              h("p", {}, text)
            )
          )
        ),
        h(
          "figcaption",
          { class: "landing__caption" },
          "Escribes, el asistente responde al instante y, si hace falta, una persona del banco sigue la conversación."
        )
      )
    )
  );
  return () => {};
}
