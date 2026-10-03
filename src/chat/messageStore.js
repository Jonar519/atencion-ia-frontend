/**
 * Almacén de mensajes de UNA conversación en la pantalla.
 *
 * Un mismo mensaje puede llegar por tres caminos: la respuesta del POST que lo
 * envió, el evento del WebSocket y la re-sincronización por REST después de
 * una reconexión. Este almacén garantiza que se vea UNA sola vez:
 *  - se identifica por id del servidor;
 *  - un mensaje propio aún sin confirmar ("pending") se identifica por su
 *    clientMsgId, y cuando llega la versión del servidor con ese mismo
 *    clientMsgId, la reemplaza (no se duplica);
 *  - el orden es por fecha del servidor (createdAt) y, en empate, por id.
 *
 * Reintentar un mensaje fallido reutiliza su clientMsgId: el backend lo trata
 * como el mismo mensaje (idempotencia), así que un reintento tras un corte
 * nunca lo duplica.
 */

export function createMessageStore() {
  /** @type {Map<string, object>} clave: id del servidor o "local:<clientMsgId>" */
  const items = new Map();
  const listeners = new Set();

  const emit = () => {
    const list = snapshot();
    for (const listener of listeners) listener(list);
  };

  function snapshot() {
    return [...items.values()].sort((a, b) => {
      // Los pendientes siempre al final, en el orden en que se escribieron.
      if (a.state === "pending" || a.state === "failed" || b.state === "pending" || b.state === "failed") {
        const rank = (m) => (m.state === "pending" || m.state === "failed" ? 1 : 0);
        return rank(a) - rank(b) || a.localSeq - b.localSeq || a.createdAt.localeCompare(b.createdAt);
      }
      return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    });
  }

  let localSeq = 0;

  function upsertOne(message) {
    if (message.clientMsgId && items.has(`local:${message.clientMsgId}`)) {
      items.delete(`local:${message.clientMsgId}`);
    }
    const previous = items.get(message.id);
    items.set(message.id, { ...previous, ...message, state: "sent", localSeq: previous?.localSeq ?? 0 });
  }

  return {
    /** Mensaje(s) confirmados por el servidor (POST, WebSocket o REST). */
    upsert(messages) {
      for (const message of [messages].flat()) if (message?.id) upsertOne(message);
      emit();
    },
    /** Mensaje propio antes de enviarlo: aparece al instante como "enviando…". */
    /** attachment (opcional): datos del adjunto que se está subiendo, para mostrarlo ya ("subiendo…"). */
    addPending({ clientMsgId, content, sender, attachment = null }) {
      items.set(`local:${clientMsgId}`, {
        id: `local:${clientMsgId}`,
        clientMsgId,
        content,
        sender,
        attachment,
        createdAt: new Date().toISOString(),
        state: "pending",
        localSeq: ++localSeq,
      });
      emit();
    },
    markFailed(clientMsgId, error) {
      const item = items.get(`local:${clientMsgId}`);
      if (!item) return;
      items.set(item.id, { ...item, state: "failed", error });
      emit();
    },
    markPending(clientMsgId) {
      const item = items.get(`local:${clientMsgId}`);
      if (!item) return;
      items.set(item.id, { ...item, state: "pending", error: undefined });
      emit();
    },
    get(clientMsgId) {
      return items.get(`local:${clientMsgId}`) ?? null;
    },
    clear() {
      items.clear();
      emit();
    },
    list: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  };
}
