// scripts/mutation-check.mjs  —  npm run test:mutations
//
// Pruebas de mutación de las reglas CRÍTICAS del frontend (mismo mecanismo que
// el backend): rompe a propósito cada regla, corre los tests y EXIGE que
// fallen. Si un test sigue pasando con la regla rota, ese test no protege nada.
// Restaura SIEMPRE el archivo (try/finally). Funciona igual en cmd.exe y bash.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const MUTATIONS = [
  {
    name: "El access token se guarda en sessionStorage (un XSS lo robaría)",
    file: "src/auth/session.js",
    from: "  accessToken = token;\n",
    to: '  accessToken = token;\n  sessionStorage.setItem("atencion-ia-token", token);\n',
  },
  {
    name: "El texto de los mensajes se inserta como HTML (XSS)",
    file: "src/lib/dom.js",
    from: "el.append(child instanceof Node ? child : document.createTextNode(String(child)));",
    to: 'if (child instanceof Node) el.append(child); else el.insertAdjacentHTML("beforeend", String(child));',
  },
  {
    name: "La renovación de sesión deja de ser single-flight (varios /refresh a la vez)",
    file: "src/auth/session.js",
    from: "inFlight ??= (async () => {",
    to: "inFlight = (async () => {",
  },
  {
    name: "Un 401 del panel ya no renueva el token ni reintenta",
    file: "src/api/http.js",
    from: 'if (response.status === 401 && auth === "staff") {',
    to: "if (false) {",
  },
  {
    name: "Tras reconectar el WebSocket no se re-sincroniza (se pierden mensajes)",
    file: "src/realtime/socket.js",
    from: "if (wasReconnect) onResync();",
    to: "",
  },
  {
    name: "Con token vencido (4409) se reconecta sin renovarlo",
    file: "src/realtime/socket.js",
    from: "await onAuthExpired().catch(() => {});",
    to: "",
  },
  {
    name: "El mensaje pendiente no se reemplaza por el confirmado (se ve duplicado)",
    file: "src/chat/messageStore.js",
    from: "if (message.clientMsgId && items.has(`local:${message.clientMsgId}`)) {",
    to: "if (false) {",
  },
  {
    name: "Reintentar genera un clientMsgId NUEVO (el backend duplicaría el mensaje)",
    file: "src/views/customer/chat.view.js",
    from: "send(message.clientMsgId, message.content);",
    to: "send(crypto.randomUUID(), message.content);",
  },
  {
    name: "El widget muestra eventos de OTRAS conversaciones",
    file: "src/views/customer/chat.view.js",
    from: "if (event.conversation?.id !== conversationId) return;",
    to: "",
  },
  {
    name: "El Service Worker intercepta (y cachearía) la API",
    file: "src/sw/strategy.js",
    from: 'target.pathname.startsWith("/api/") || ',
    to: "",
  },
  {
    name: "El panel sigue mostrando un caso que otro asesor tomó",
    file: "src/views/agent/panel.view.js",
    from: "if (event.conversation.id === selectedId && event.visible === false) {",
    to: "if (false) {",
  },
  {
    name: "El Worker de urgencia entrega respuestas viejas (avisos incorrectos al escribir)",
    file: "src/urgency/urgencyClient.js",
    from: "if (resolve && id === lastId) resolve(result);",
    to: "if (resolve) resolve(result);",
  },
  {
    name: "El panel sigue mostrando al usuario anterior si otra pestaña cambió de cuenta",
    file: "src/views/agent/panel.view.js",
    from: "if (staff && me && staff.id !== me.id) {",
    to: "if (false) {",
  },
];

function runTests() {
  const result = spawnSync("npx", ["vitest", "run"], {
    shell: true,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const output = `${result.stdout}\n${result.stderr}`;
  const failed = (output.match(/Tests\s+(\d+) failed/) ?? [])[1];
  return { passed: result.status === 0, failed: failed ? Number(failed) : 0 };
}

let survivors = 0;
console.log(`Pruebas de mutación (frontend): ${MUTATIONS.length} reglas críticas\n`);

for (const [index, mutation] of MUTATIONS.entries()) {
  const original = readFileSync(mutation.file, "utf8");
  if (!original.includes(mutation.from)) {
    console.log(`✗ [${index + 1}] NO SE PUDO APLICAR (¿cambió el código?): ${mutation.name}`);
    survivors += 1;
    continue;
  }
  try {
    writeFileSync(
      mutation.file,
      original.replace(mutation.from, () => mutation.to)
    );
    const { passed, failed } = runTests();
    if (passed) {
      survivors += 1;
      console.log(`✗ [${index + 1}] SOBREVIVIÓ (ningún test lo detectó): ${mutation.name}`);
    } else {
      console.log(`✓ [${index + 1}] detectada por ${failed} test(s): ${mutation.name}`);
    }
  } finally {
    writeFileSync(mutation.file, original);
  }
}

console.log(`\n${MUTATIONS.length - survivors}/${MUTATIONS.length} mutaciones detectadas. Archivos restaurados.`);
process.exit(survivors === 0 ? 0 : 1);
