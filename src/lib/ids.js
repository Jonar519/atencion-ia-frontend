/** UUID v4 para clientMsgId: identifica un mensaje ANTES de enviarlo (reintentos idempotentes). */
export function newClientMsgId() {
  return crypto.randomUUID();
}
