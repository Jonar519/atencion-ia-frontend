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
    // (Fase 7) retry() ahora también reenvía adjuntos: misma regla, línea nueva.
    from: "send(message.clientMsgId, message.content === ATTACHMENT_PLACEHOLDER",
    to: "send(crypto.randomUUID(), message.content === ATTACHMENT_PLACEHOLDER",
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
  {
    name: "IDENTIDAD: el paso de la contraseña abre sesión aunque falte el código de MFA",
    file: "src/auth/session.js",
    from: "  if (data.accessToken) return { staff: finish(data).staff };\n  return data;",
    to: '  finish({ ...data, accessToken: data.accessToken ?? "sin-mfa", staff: data.staff ?? {} });\n  return data;',
  },
  {
    name: "IDENTIDAD: el login ignora que la cuenta pide MFA (entra al panel sin código)",
    file: "src/views/agent/login.view.js",
    from: "        if (result.mfaRequired) return showCode(result.challengeToken);\n",
    to: "",
  },
  {
    name: "IDENTIDAD: se puede continuar sin confirmar que se guardaron los códigos de respaldo",
    file: "src/components/backupCodes.js",
    from: "disabled: true, on: { click: () => onDone?.() } }",
    to: "disabled: false, on: { click: () => onDone?.() } }",
  },
  {
    name: "IDENTIDAD: confirmar el correo se dispara solo al abrir el enlace (un escáner lo confirmaría)",
    file: "src/views/agent/recovery.view.js",
    from: '  if (!token) return missingToken(root);\n  formFlow(root, {\n    title: "Confirmar tu correo nuevo",',
    to: '  if (!token) return missingToken(root);\n  session.confirmEmail(token);\n  formFlow(root, {\n    title: "Confirmar tu correo nuevo",',
  },
  {
    name: "IDENTIDAD: restablecer envía contraseñas que no coinciden",
    file: "src/views/agent/recovery.view.js",
    from: '      if (password.value !== repeat.value) throw new Error("Las contraseñas no coinciden.");\n',
    to: "",
  },
  {
    name: "SESIONES: se ofrece 'Cerrar' también en la sesión actual",
    file: "src/views/agent/profile.view.js",
    from: "        item.current\n          ? null\n          : h(",
    to: "        false\n          ? null\n          : h(",
  },
  {
    name: "PERFIL: 'Reintentar' ya no vuelve a cargar",
    file: "src/views/agent/profile.view.js",
    from: 'h("button", { class: "btn", type: "button", on: { click: load } }, "Reintentar")',
    to: 'h("button", { class: "btn", type: "button" }, "Reintentar")',
  },
  {
    name: "CONTRASTE: el texto atenuado del tema oscuro baja de AA",
    file: "src/styles/tokens.css",
    from: "  --color-ink-500: #a6b2c1;",
    to: "  --color-ink-500: #5b6472;",
  },
  {
    name: "RECORTE: la foto puede dejar huecos en el avatar",
    file: "src/components/avatarCropper.js",
    from: "return Math.min(0, Math.max(size - drawn, offset));",
    to: "return offset;",
  },
  {
    name: "CONTRASTE: el borde de los campos vuelve a 1.65:1 (invisible para baja visión)",
    file: "src/styles/tokens.css",
    from: "  --color-border-strong: #78839a;",
    to: "  --color-border-strong: #c3cad4;",
  },
  {
    name: "ROLES: el guard deja entrar a un asesor a las rutas de admin",
    file: "src/router.js",
    from: "    if (!roles.includes(staff.role)) {",
    to: "    if (false) {",
  },
  {
    name: "ROLES: la navegación de administración se le muestra a un asesor",
    file: "src/components/adminNav.js",
    from: '  if (staff?.role !== "admin") return null;',
    to: "  if (!staff) return null;",
  },
  {
    name: "PRIORIDAD: 80 deja de ser 'Urgente'",
    file: "src/lib/priority.js",
    from: '{ min: 80, level: "high"',
    to: '{ min: 81, level: "high"',
  },
  {
    name: "PRIORIDAD: la cola vuelve a mostrar solo el color, sin la etiqueta",
    file: "src/views/agent/panel.view.js",
    from: '      h("span", { class: ["prio", `prio--${priority.level}`] }, priority.text),\n',
    to: "",
  },
  {
    name: "RESPUESTAS: {cliente} se inserta sin reemplazar",
    file: "src/components/cannedPicker.js",
    from: "g, firstName(customerName))",
    to: 'g, "{cliente}")',
  },
  {
    name: "RESPUESTAS: insertar una respuesta la envía sola (sin que el asesor la revise)",
    file: "src/components/cannedPicker.js",
    from: "insertAtCursor(input, fillPlaceholders(item.body, context()));",
    to: "insertAtCursor(input, fillPlaceholders(item.body, context()));\n                  input.form?.requestSubmit();",
  },
  {
    name: "ANALÍTICA: el CSAT pierde el rótulo SIMULADO",
    file: "src/views/admin/analytics.view.js",
    from: '          "SIMULADO"',
    to: '          ""',
  },
  {
    name: "EQUIPO: se puede eliminar a un asesor con casos en curso",
    file: "src/views/admin/team.view.js",
    from: "  function deleteControl(member) {\n    if (member.activeConversations > 0) {",
    to: "  function deleteControl(member) {\n    if (false) {",
  },
  {
    name: "EQUIPO: eliminar no pide confirmación",
    file: "src/views/admin/team.view.js",
    from: "            if (!armed) {\n              armed = true;\n              button.textContent = `Confirmar: borrar",
    to: "            if (false) {\n              armed = true;\n              button.textContent = `Confirmar: borrar",
  },
  {
    name: "EQUIPO: se ofrece reasignar un caso al mismo asesor",
    file: "src/views/admin/team.view.js",
    from: "staff.filter((s) => s.id !== member.id && s.isActive && !s.deletedAt)",
    to: "staff.filter((s) => s.isActive && !s.deletedAt)",
  },
  {
    name: "ACCESIBILIDAD: el SVG de la gráfica vuelve a role=img (oculta las barras enfocables)",
    file: "src/components/barChart.js",
    from: '  chart.setAttribute("role", "group");',
    to: '  chart.setAttribute("role", "img");',
  },
  {
    name: "ADJUNTOS: el PDF se muestra dentro de la app como imagen (en vez de solo descargarse)",
    file: "src/components/attachmentView.js",
    from: '  const isPdf = attachment.contentType === "application/pdf";',
    to: "  const isPdf = false;",
  },
  {
    name: "ADJUNTOS: se sube cualquier archivo (sin revisar los primeros bytes)",
    file: "src/lib/attachments.js",
    from: '  if (!type) throw new AttachmentError("Solo puedes adjuntar imágenes (PNG, JPEG, WebP) o documentos PDF.");',
    to: "",
  },
  {
    name: "ADJUNTOS: las fotos se suben originales (con EXIF/GPS), sin re-codificar",
    file: "src/lib/attachments.js",
    from: "  const blob = await reencodeImage(file, deps);",
    to: "  const blob = file;",
  },
  {
    name: "ADJUNTOS: el texto fijo del servidor se repite debajo del adjunto",
    file: "src/components/messageList.js",
    from: "    message.attachment && message.content === ATTACHMENT_PLACEHOLDER\n      ? null\n      : h(",
    to: "    false\n      ? null\n      : h(",
  },
  {
    name: "ACCESIBILIDAD: 'Adjuntar' vuelve a ser un <label> (no se puede usar con el teclado)",
    file: "src/components/attachPicker.js",
    from: '  const button = h(\n    "button",\n    {\n      class: "btn attach__button",',
    to: '  const button = h(\n    "label",\n    {\n      class: "btn attach__button",',
  },
  {
    name: "ORDEN: los envíos salen en paralelo (el chat puede mostrarlos invertidos)",
    file: "src/lib/sendQueue.js",
    from: "    const run = tail.then(task, task);",
    to: "    const run = task();",
  },
  {
    name: "EN VIVO: la forma de onda no recibe el nivel del micrófono",
    file: "src/components/callBar.js",
    from: "      waveform.push(level);",
    to: "",
  },
  {
    name: "EN VIVO: silenciado, la forma de onda sigue mostrando voz",
    file: "src/components/waveform.js",
    from: "      levels.push(muted ? 0 : level);",
    to: "      levels.push(level);",
  },
  {
    name: "EN VIVO: la forma de onda ignora prefers-reduced-motion",
    file: "src/components/waveform.js",
    from: "    if (reducedMotion()) {",
    to: "    if (false) {",
  },
  {
    name: "EN VIVO: la forma de onda dibuja con la pestaña oculta",
    file: "src/components/waveform.js",
    from: "    if (!ctx || stopped || win?.document?.hidden) return;",
    to: "    if (!ctx || stopped) return;",
  },
  {
    name: "TRANSICIÓN: el barrido se repite cada vez (debe ser UNA por llamada)",
    file: "src/components/callBar.js",
    from: "      if (handedOff) return;\n",
    to: "",
  },
  {
    name: "TRANSICIÓN: la llamada no anuncia el traspaso de la IA a un asesor",
    file: "src/voice/customerCall.js",
    from: '      if (previous === "ai_active" && (next === "waiting_agent" || next === "agent_active")) bar.announceHandoff();',
    to: "",
  },
  {
    name: "TRANSICIÓN: se anima aunque el caso ya estaba escalado (no es una transición)",
    file: "src/voice/customerCall.js",
    from: 'if (previous === "ai_active" && (next === "waiting_agent" || next === "agent_active")) bar.announceHandoff();',
    to: 'if (next === "waiting_agent" || next === "agent_active") bar.announceHandoff();',
  },
  {
    name: "TRANSICIÓN: la animación no respeta prefers-reduced-motion",
    file: "src/styles/voice.css",
    from: "@media (prefers-reduced-motion: reduce) {\n  .callbar--handoff::after {\n    animation: none;\n    display: none;\n  }\n}",
    to: "",
  },
  {
    name: "EN VIVO: la insignia no pasa a 'Asesor conectado'",
    file: "src/voice/customerCall.js",
    from: "      bar.setAgentConnected(present);",
    to: "",
  },
  {
    name: "ÁNIMO: el badge no se actualiza con los mensajes que llegan en vivo",
    file: "src/views/agent/panel.view.js",
    from: "    sentiment.update(messages);\n",
    to: "",
  },
  {
    name: "ÁNIMO: 'empeoró' y 'mejoró' invertidos",
    file: "src/components/sentimentBadge.js",
    from: '? "empeoró" : "mejoró"',
    to: '? "mejoró" : "empeoró"',
  },
  {
    name: "TRANSICIÓN: el borde pasa a menta al EMPEZAR (el barrido menta queda invisible)",
    file: "src/components/callBar.js",
    from: "      handedOff = true;\n",
    to: '      handedOff = true;\n      el.dataset.handoff = "done";\n',
  },
  {
    name: "CONECTIVIDAD: un corte breve del WebSocket ya muestra aviso (ruido)",
    file: "src/components/connectivity.js",
    from: "export const RECONNECT_NOTICE_DELAY_MS = 2_000;",
    to: "export const RECONNECT_NOTICE_DELAY_MS = 0;",
  },
  {
    name: "CONECTIVIDAD: sin internet no se avisa",
    file: "src/components/connectivity.js",
    from: "    if (offline) {",
    to: "    if (false) {",
  },
  {
    name: "CONECTIVIDAD: 'restablecida' se queda pegado",
    file: "src/components/connectivity.js",
    from: '    if (state === "restored") restoredTimer = setTimeout(() => render(null), RESTORED_VISIBLE_MS);',
    to: "",
  },
  {
    name: "CONECTIVIDAD: una vista que se va deja el aviso de 'reconectando' pegado",
    file: "src/components/connectivity.js",
    from: "      else reconnecting.delete(source);",
    to: '      else if (status === "open") reconnecting.delete(source);',
  },
  {
    name: "ESTADOS: 'Reintentar' dispara varios reintentos con varios clics",
    file: "src/components/states.js",
    from: "            event.currentTarget.disabled = true; // un clic = un reintento\n",
    to: "",
  },
  {
    name: "ESTADOS: el panel no muestra esqueleto mientras carga las listas",
    file: "src/views/agent/panel.view.js",
    from: '    if (listState !== "ready") {\n      listState = "loading";\n      renderLists();\n    }\n',
    to: "",
  },
  {
    name: "ESTADOS: un fallo al ACTUALIZAR borra la lista que ya se veía",
    file: "src/views/agent/panel.view.js",
    from: '      if (listState === "ready") {',
    to: "      if (false) {",
  },
  {
    name: "ESTADOS: un caso que no abre solo muestra un aviso que se va (sin Reintentar)",
    file: "src/views/agent/panel.view.js",
    from: "      } else if (!detail || detail.id !== id) {",
    to: "      } else if (false) {",
  },
  {
    name: "ESTADOS: el chat sin sesión no se puede reintentar",
    file: "src/views/customer/chat.view.js",
    from: "        shell.hidden = false;\n        boot();\n",
    to: "        shell.hidden = false;\n",
  },
  {
    name: "ESTADOS: 'Reintentar' de la conversación no hace nada",
    file: "src/views/customer/chat.view.js",
    from: "() => openLatestConversation())",
    to: "() => {})",
  },
  {
    name: "VACÍOS: el ejemplo del chat vacío se ENVÍA en vez de escribirse",
    file: "src/views/customer/chat.view.js",
    from: "                      onDraft();\n",
    to: "                      onDraft();\n                      composer.requestSubmit();\n",
  },
  {
    name: "FOCO: vuelve el recuadro de foco en el <h1> al cambiar de pantalla",
    file: "src/styles/base.css",
    from: '[tabindex="-1"]:focus,\n[tabindex="-1"]:focus-visible {\n  outline: none;\n}',
    to: "",
  },
  {
    name: "ACCESIBILIDAD: los estados de la lista vuelven DENTRO del listbox (axe: aria-required-children)",
    file: "src/views/agent/panel.view.js",
    from: "    replaceChildren(listEl);\n    listEl.hidden = true;\n    replaceChildren(listStatus, content);",
    to: '    replaceChildren(listEl, h("li", {}, content));\n    listEl.hidden = false;',
  },
  {
    name: "INVITACIÓN (F2b): se envía aunque las dos contraseñas no coincidan",
    file: "src/views/agent/invitation.view.js",
    from: "            if (password.value !== repeat.value) {",
    to: "            if (false) {",
  },
  {
    name: "INVITACIÓN (F2b): un ADMIN invitado entra sin pasar por la activación de la verificación en dos pasos",
    file: "src/views/agent/invitation.view.js",
    from: "              if (result.mfaEnrollmentRequired) {",
    to: "              if (false) {",
  },
  {
    name: "INVITACIÓN (F2b): la pantalla inventa su propio mensaje según el caso (revela el estado del enlace)",
    file: "src/views/agent/invitation.view.js",
    from: "      .catch((err) => !disposed && showInvalid(err.message));",
    to: '      .catch(() => !disposed && showInvalid("Este enlace ya se usó o la cuenta ya existe."));',
  },
  {
    name: "REGISTRO (F2b): el login ofrece 'Crear cuenta' (registro público)",
    file: "src/views/agent/login.view.js",
    from: '      h("a", { class: "login__link login__forgot", href: "#/agente/recuperar" }, "¿Olvidaste tu contraseña?")',
    to: '      h("a", { class: "login__link login__forgot", href: "#/agente/recuperar" }, "¿Olvidaste tu contraseña?"),\n      h("a", { class: "login__link", href: "#/agente/registro" }, "Crear cuenta")',
  },
  {
    name: "EQUIPO (F2b): una invitación pendiente se muestra como una cuenta normal (exportar, eliminar)",
    file: "src/views/admin/team.view.js",
    from: "    if (member.invitation) return renderInvitation(member);\n",
    to: "",
  },
  {
    name: "EQUIPO (F2b): cancelar una invitación no pide confirmación",
    file: "src/views/admin/team.view.js",
    from: "            if (!armed) {\n              armed = true;\n              button.textContent = `Confirmar: cancelar la invitación de ${member.name}`;\n              return;\n            }\n",
    to: "",
  },
  {
    name: "AVISOS: el aviso (abajo a la derecha) vuelve a BLOQUEAR el clic del botón que tapa",
    file: "src/styles/base.css",
    from: "  max-width: min(24rem, calc(100vw - 2rem));\n  pointer-events: none;\n",
    to: "  max-width: min(24rem, calc(100vw - 2rem));\n",
  },
  {
    name: "AVISOS: el aviso de conectividad vuelve a BLOQUEAR lo que tapa (p. ej. 'Llamar') mientras dura el corte",
    file: "src/styles/base.css",
    from: '  /* Puede quedarse mientras dure el corte: no debe bloquear lo que tapa (p. ej. "Llamar"). */\n  pointer-events: none;\n',
    to: "",
  },
  {
    name: "MENÚ (F3): Escape no cierra el menú de usuario",
    file: "src/components/userMenu.js",
    from: '    if (event.key === "Escape" && !panel.hidden) {',
    to: "    if (false) {",
  },
  {
    name: "MENÚ (F3): al cerrar con Escape el foco se pierde (no vuelve al botón)",
    file: "src/components/userMenu.js",
    from: "    if (returnFocus) button.focus();\n",
    to: "",
  },
  {
    name: "MENÚ (F3): un clic fuera no cierra el menú",
    file: "src/components/userMenu.js",
    from: "    if (!el.contains(event.target)) close();\n",
    to: "",
  },
  {
    name: "MENÚ (F3): el menú no se limpia al cambiar de vista (escucha el documento para siempre)",
    file: "src/components/userMenu.js",
    from: "    if (!el.isConnected) return dispose();\n",
    to: "",
  },
  {
    name: "MENÚ (F3): la administración vuelve a no tener 'Mi perfil' ni 'Salir'",
    file: "src/views/admin/adminPage.js",
    from: '          h("a", { class: "link-btn", href: "#/agente" }, "Volver al panel"),\n          menu?.el',
    to: '          h("a", { class: "link-btn", href: "#/agente" }, "Volver al panel")',
  },
  {
    name: "MENÚ (F3): 'Mi perfil' vuelve a no tener 'Salir'",
    file: "src/views/agent/profile.view.js",
    from: "        userSlot.append(menu.el);\n",
    to: "",
  },
  {
    name: "MENÚ (F3): 'Salir' del menú del panel no cierra la sesión",
    file: "src/views/agent/panel.view.js",
    from: "    myMenu = userMenu(me, { onLogout, loadAvatar: (id) => profileApi.avatarOf(id) });",
    to: "    myMenu = userMenu(me, { loadAvatar: (id) => profileApi.avatarOf(id) });",
  },
  {
    name: "RECUPERACIÓN (F3): '¿Olvidaste tu contraseña?' deja de estar justo debajo de 'Entrar'",
    file: "src/views/agent/login.view.js",
    from: '      error,\n      submit,\n      h("a", { class: "login__link login__forgot", href: "#/agente/recuperar" }, "¿Olvidaste tu contraseña?")\n',
    to: '      h("a", { class: "login__link login__forgot", href: "#/agente/recuperar" }, "¿Olvidaste tu contraseña?"),\n      error,\n      submit\n',
  },
  {
    name: "PORTADA (F4): las dos opciones vuelven a ser IGUALES (el staff con el mismo bloque que el cliente)",
    file: "src/views/landing.view.js",
    from: '{ class: "landing__staff-link", href: "#/agente" }',
    to: '{ class: "landing__customer", href: "#/agente" }',
  },
  {
    name: "PORTADA (F4): el foco con teclado no muestra el estado (solo el cursor)",
    file: "src/styles/base.css",
    from: ".landing__customer:hover,\n.landing__customer:focus-visible {\n  border-left-width: 6px;",
    to: ".landing__customer:hover {\n  border-left-width: 6px;",
  },
  {
    name: "PORTADA (F4): el fragmento de conversación se lee como un chat real (sin aria-hidden)",
    file: "src/views/landing.view.js",
    from: '{ class: "landing__thread", "aria-hidden": "true" }',
    to: '{ class: "landing__thread" }',
  },
  {
    name: "PORTADA (F4): se cuela una animación nueva (transición en la regla del cliente)",
    file: "src/styles/base.css",
    from: "  border-left: var(--rule) solid var(--color-primary-rule);\n}\n.landing__customer strong {",
    to: "  border-left: var(--rule) solid var(--color-primary-rule);\n  transition: border-left-width 150ms ease;\n}\n.landing__customer strong {",
  },
  {
    name: "PORTADA (F4): se cuela el acento 'en vivo' (menta) en la regla de la asesora",
    file: "src/styles/base.css",
    from: ".landing__msg--agent {\n  border-left-color: var(--color-amber-600);",
    to: ".landing__msg--agent {\n  border-left-color: var(--color-live-agent);",
  },
  {
    name: "TEMA: se reintroduce un selector de tema en el perfil (el tema debe decidirlo el sistema)",
    file: "src/views/agent/profile.view.js",
    from: "      emailSection(),\n      passwordSection(),",
    to: '      h("fieldset", {}, h("legend", {}, "Tema del panel"), h("input", { type: "radio", name: "theme", value: "dark" })),\n      emailSection(),\n      passwordSection(),',
  },
  {
    name: "TEMA: los colores oscuros vuelven a depender de un atributo (no del sistema; no cambian en vivo)",
    file: "src/styles/tokens.css",
    from: "@media (prefers-color-scheme: dark) {\n  :root {",
    to: '@media all {\n  :root[data-theme="dark"] {',
  },
  {
    name: "TEMA: el documento vuelve a declararse 'solo claro' (controles nativos fijos en claro)",
    file: "index.html",
    from: '<meta name="color-scheme" content="light dark" />',
    to: '<meta name="color-scheme" content="light" />',
  },
  {
    name: "TEMA: una pantalla (el widget) se sale y fija su propio esquema",
    file: "src/styles/chat.css",
    from: ".page--chat {\n  padding-top: var(--space-5);\n}",
    to: ".page--chat {\n  padding-top: var(--space-5);\n  color-scheme: light;\n}",
  },
  {
    name: "CONTRASTE (portada, oscuro): el acento del CTA vuelve al ámbar de siempre y baja de 4.5:1",
    file: "src/styles/tokens.css",
    from: "    --color-on-primary-accent: #f6d08a;",
    to: "    --color-on-primary-accent: #f3c774;",
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
