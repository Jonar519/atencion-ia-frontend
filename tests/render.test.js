import { describe, expect, it } from "vitest";
import { renderMessage, renderMessageList } from "../src/components/messageList.js";
import { h } from "../src/lib/dom.js";

const ATTACKS = [
  '<img src=x onerror="window.__pwned = true">',
  "<script>window.__pwned = true</script>",
  '"><svg onload=alert(1)>',
  '<a href="javascript:alert(1)">clic</a>',
];

describe("render seguro de mensajes (XSS)", () => {
  it.each(ATTACKS)("un mensaje con %s se muestra como TEXTO, sin crear elementos", (attack) => {
    const el = renderMessage({ id: "m1", sender: "customer", content: attack, createdAt: "2026-09-29T10:00:00Z" });
    document.body.append(el);
    expect(el.querySelector(".msg__text").textContent).toBe(attack);
    expect(el.querySelectorAll("img, script, svg, a").length).toBe(0);
    expect(window.__pwned).toBeUndefined();
    el.remove();
  });

  it("también el nombre del agente y el texto de error (todo lo que viene del servidor)", () => {
    const el = renderMessage(
      {
        id: "m2",
        senderType: "agent",
        agent: { name: "<b>Laura</b>" },
        content: "hola",
        createdAt: "2026-09-29T10:00:00Z",
      },
      { perspective: "customer" }
    );
    expect(el.querySelector("b")).toBeNull();
    expect(el.querySelector(".msg__author").textContent).toContain("<b>Laura</b>");
  });

  it("h() nunca interpreta strings como HTML", () => {
    const el = h("div", {}, "<i>no</i>", ["<u>tampoco</u>"]);
    expect(el.children.length).toBe(0);
    expect(el.textContent).toBe("<i>no</i><u>tampoco</u>");
  });

  it("la lista completa tampoco inserta HTML", () => {
    const list = document.createElement("ol");
    renderMessageList(
      list,
      ATTACKS.map((content, i) => ({ id: `m${i}`, sender: "ai", content, createdAt: "2026-09-29T10:00:00Z" }))
    );
    expect(list.querySelectorAll("img, script, svg, a").length).toBe(0);
    expect(list.querySelectorAll(".msg").length).toBe(ATTACKS.length);
  });

  it("en el panel se ve el análisis de la IA; en el widget del cliente no", () => {
    const message = {
      id: "m",
      senderType: "customer",
      content: "x",
      createdAt: "2026-09-29T10:00:00Z",
      intent: "possible_fraud",
      sentiment: "angry",
    };
    expect(renderMessage(message, { perspective: "agent" }).textContent).toContain("Posible fraude · Molesto");
    expect(renderMessage(message, { perspective: "customer" }).textContent).not.toContain("Posible fraude");
  });
});
