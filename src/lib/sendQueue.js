/**
 * Fila de envíos: cada envío empieza cuando termina el anterior (haya salido
 * bien o mal). Así el orden en el chat es el orden en que la persona los envió:
 * el servidor guarda cada mensaje cuando termina de procesarlo (un texto pasa
 * antes por el clasificador; un adjunto sin comentario, no), y dos envíos en
 * paralelo podían quedar invertidos (lo mostró la prueba en vivo del bloque C).
 */
export function createSendQueue() {
  let tail = Promise.resolve();
  return function enqueue(task) {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}
