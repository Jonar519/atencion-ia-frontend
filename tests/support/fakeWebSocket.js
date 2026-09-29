/**
 * WebSocket simulado: registra lo que envía el cliente y permite al test
 * "hacer de servidor" (abrir, mandar mensajes, cerrar con un código).
 */
export class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.sent = [];
    this.listeners = {};
    this.readyState = 0;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000) {
    this.serverClose(code);
  }

  // --- Lado "servidor" (lo usa el test) ---
  serverOpen() {
    this.readyState = 1;
    this.emit("open", {});
  }
  serverSend(message) {
    this.emit("message", { data: JSON.stringify(message) });
  }
  serverClose(code = 1006) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", { code });
  }
  emit(type, event) {
    for (const handler of this.listeners[type] ?? []) handler(event);
  }

  static last() {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }
  static reset() {
    FakeWebSocket.instances = [];
  }
}

/**
 * Deja correr las promesas pendientes (microtareas). No usa setTimeout: así
 * funciona igual con relojes simulados (vi.useFakeTimers).
 */
export async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
