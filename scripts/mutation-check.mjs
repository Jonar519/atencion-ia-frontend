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
  {
    name: "El panel muestra la transcripción en vivo de una llamada de OTRO caso",
    file: "src/views/agent/panel.view.js",
    from: "if (event.conversation.id === selectedId) showLiveTranscript(event.speaker, event.text);",
    to: "showLiveTranscript(event.speaker, event.text);",
  },
  {
    name: "VOZ: se puede llamar sin marcar 'Leí y acepto' el aviso",
    file: "src/components/consentDialog.js",
    from: "      disabled: true,\n",
    to: "      disabled: false,\n",
  },
  {
    name: "VOZ: la llamada se crea ANTES de tener el micrófono (queda colgada si lo niega)",
    file: "src/voice/customerCall.js",
    from: "    let microphone;\n    try {\n      microphone = await openMic({ audioContext });",
    to: "    await widgetApi.startCall(conversationId(), consentVersion).catch(() => {});\n    let microphone;\n    try {\n      microphone = await openMic({ audioContext });",
  },
  {
    name: "VOZ: si el servidor rechaza la llamada, el micrófono queda encendido",
    file: "src/voice/customerCall.js",
    from: "      microphone.stop();\n      return fail(err.message);",
    to: "      return fail(err.message);",
  },
  {
    name: "VOZ: salir de la vista deja la llamada y el micrófono abiertos",
    file: "src/voice/customerCall.js",
    from: "if (session && !session.ended) hangup();",
    to: "",
  },
  {
    name: "VOZ: el agente se une (toma el caso) aunque niegue el micrófono",
    file: "src/voice/agentCall.js",
    from: "        audioContext.close?.().catch?.(() => {});\n        onError(err.message);\n        return;\n      }\n      try {",
    to: "        audioContext.close?.().catch?.(() => {});\n        onError(err.message);\n        await staffApi.joinCall(callId).catch(() => {});\n        return;\n      }\n      try {",
  },
  {
    name: "VOZ: si unirse falla, el micrófono del agente queda encendido",
    file: "src/voice/agentCall.js",
    from: "        microphone.stop();\n        audioContext.close",
    to: "        audioContext.close",
  },
  {
    name: "VOZ: se envía audio silenciado",
    file: "src/voice/voiceSession.js",
    from: "if (!ready || muted || aiSpeaking || ended) return;",
    to: "if (!ready || aiSpeaking || ended) return;",
  },
  {
    name: "VOZ: se envía el micrófono mientras habla el asistente (su voz se transcribe como del cliente)",
    file: "src/voice/voiceSession.js",
    from: "if (!ready || muted || aiSpeaking || ended) return;",
    to: "if (!ready || muted || ended) return;",
  },
  {
    name: "VOZ: se envía audio antes de que el servidor autentique (4401)",
    file: "src/voice/voiceSession.js",
    from: "if (!ready || muted || aiSpeaking || ended) return;",
    to: "if (muted || aiSpeaking || ended) return;",
  },
  {
    name: "VOZ: al terminar la llamada el micrófono sigue encendido",
    file: "src/voice/voiceSession.js",
    from: "    clearTimeout(reconnectTimer);\n    microphone.stop();",
    to: "    clearTimeout(reconnectTimer);",
  },
  {
    name: "VOZ: reconecta aunque otra pestaña tomó la llamada (se la quitan sin fin)",
    file: "src/voice/voiceSession.js",
    from: "    if (CLOSE_TEXT[code]) return finish(null, CLOSE_TEXT[code]);\n",
    to: "",
  },
  {
    name: "VOZ: el cliente también ofrece WebRTC (choque de ofertas)",
    file: "src/voice/peerLink.js",
    from: '      if (role !== "agent") return; // el cliente espera la oferta del agente\n',
    to: "",
  },
  {
    name: "VOZ: los candidatos ICE se agregan sin descripción remota (el navegador los rechaza)",
    file: "src/voice/peerLink.js",
    from: "if (pc?.remoteDescription) await pc.addIceCandidate",
    to: "if (pc) await pc.addIceCandidate",
  },
  {
    name: "VOZ: el micrófono se envía sin bajar a 16 kHz (el servidor corta por exceso de audio)",
    file: "src/voice/pcm.js",
    from: "  const ratio = inputRate / outputRate;",
    to: "  const ratio = 1;",
  },
  {
    name: "VOZ: si el micrófono se desconecta a mitad de la llamada, nadie se entera",
    file: "src/voice/voiceSession.js",
    from: "    captureStarted = true;\n    watchMicrophone();",
    to: "    captureStarted = true;",
  },
  {
    name: "VOZ: cuando el asesor sale, al cliente se le dice que lo atiende el asistente (falso)",
    file: "src/voice/customerCall.js",
    from: "      } else if (wasPresent) {",
    to: "      } else if (false) {",
  },
  {
    name: "VOZ: en un caso ya atendido por un asesor, la llamada dice 'asistente virtual' (falso)",
    file: "src/voice/customerCall.js",
    from: '    if (conversationStatus() === "agent_active")\n      return "Llamada conectada.',
    to: '    if (false)\n      return "Llamada conectada.',
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
