import { describe, expect, it } from "vitest";
import { createMessageStore } from "../src/chat/messageStore.js";

const msg = (id, createdAt, extra = {}) => ({ id, sender: "ai", content: id, createdAt, ...extra });

describe("almacén de mensajes", () => {
  it("el mismo mensaje por el POST, el WebSocket y la re-sincronización se ve UNA vez", () => {
    const store = createMessageStore();
    const reply = msg("m1", "2026-09-29T10:00:01Z");
    store.upsert(reply); // respuesta del POST
    store.upsert({ ...reply }); // evento del WebSocket
    store.upsert([reply, msg("m2", "2026-09-29T10:00:02Z")]); // re-sincronización por REST
    expect(store.list().map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("el mensaje propio pendiente se REEMPLAZA por el confirmado (mismo clientMsgId), no se duplica", () => {
    const store = createMessageStore();
    store.addPending({ clientMsgId: "cm-1", content: "hola", sender: "customer" });
    expect(store.list()[0]).toMatchObject({ state: "pending", id: "local:cm-1" });
    store.upsert(msg("srv-1", "2026-09-29T10:00:00Z", { sender: "customer", content: "hola", clientMsgId: "cm-1" }));
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ id: "srv-1", state: "sent" });
  });

  it("ordena por la hora del SERVIDOR, aunque los eventos lleguen desordenados", () => {
    const store = createMessageStore();
    store.upsert(msg("b", "2026-09-29T10:00:02Z"));
    store.upsert(msg("a", "2026-09-29T10:00:01Z"));
    store.upsert(msg("c", "2026-09-29T10:00:03Z"));
    expect(store.list().map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("los pendientes quedan al final en el orden en que se escribieron", () => {
    const store = createMessageStore();
    store.addPending({ clientMsgId: "x2", content: "segundo", sender: "customer" });
    store.upsert(msg("m1", "2099-01-01T00:00:00Z"));
    store.addPending({ clientMsgId: "x3", content: "tercero", sender: "customer" });
    expect(store.list().map((m) => m.content)).toEqual(["m1", "segundo", "tercero"]);
  });

  it("un fallido conserva su clientMsgId para reintentar (el backend no lo duplica)", () => {
    const store = createMessageStore();
    store.addPending({ clientMsgId: "cm-9", content: "hola", sender: "customer" });
    store.markFailed("cm-9", "No se envió.");
    expect(store.get("cm-9")).toMatchObject({ state: "failed", clientMsgId: "cm-9" });
    store.markPending("cm-9");
    expect(store.get("cm-9")).toMatchObject({ state: "pending", clientMsgId: "cm-9" });
  });

  it("notifica a los suscriptores en cada cambio", () => {
    const store = createMessageStore();
    const seen = [];
    store.subscribe((list) => seen.push(list.length));
    store.upsert(msg("m1", "2026-09-29T10:00:00Z"));
    store.clear();
    expect(seen).toEqual([0, 1, 0]);
  });
});
