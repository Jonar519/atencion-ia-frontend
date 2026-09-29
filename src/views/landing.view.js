import { h, replaceChildren } from "../lib/dom.js";

/** Portada (#/): en producción el widget iría incrustado en el sitio del banco; aquí se elige la superficie. */
export function landingView(root) {
  replaceChildren(
    root,
    h(
      "main",
      { class: "page page--landing" },
      h("p", { class: "eyebrow" }, "Banco Cordillera"),
      h("h1", {}, "Atención al cliente"),
      h(
        "ul",
        { class: "choices" },
        h(
          "li",
          {},
          h(
            "a",
            { class: "choice", href: "#/chat" },
            h("strong", {}, "Soy cliente"),
            h("span", {}, "Escríbenos: te responde nuestro asistente y, si lo necesitas, un asesor.")
          )
        ),
        h(
          "li",
          {},
          h(
            "a",
            { class: "choice", href: "#/agente" },
            h("strong", {}, "Soy asesor"),
            h("span", {}, "Panel de atención: cola de casos, historial y respuestas.")
          )
        )
      )
    )
  );
  return () => {};
}
