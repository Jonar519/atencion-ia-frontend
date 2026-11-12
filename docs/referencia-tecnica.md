# Referencia técnica del frontend

Detalle para quien quiera revisar el código: scripts, arquitectura de la SPA (sesiones, tiempo real,
Web Worker, Service Worker, voz, XSS), despliegue en Vercel y tests. La guía para evaluar el
proyecto completo está en el
[README de atencion-ia-backend](https://github.com/Jonar519/atencion-ia-backend#readme), y la de este
repositorio en su [README](../README.md).

## Scripts

| Comando                  | Qué hace                                                               |
| ------------------------ | ---------------------------------------------------------------------- |
| `npm run dev`            | Servidor de desarrollo en 5174 (la API en `VITE_API_URL`)              |
| `npm run build`          | Build de producción en `dist\` (incluye `service-worker.js` generado)  |
| `npm run preview`        | Sirve `dist\` en 4174: así se prueba el SW y la CSP de verdad          |
| `npm test`               | Tests (Vitest + jsdom)                                                 |
| `npm run test:mutations` | Rompe a propósito cada regla crítica y exige que algún test falle      |
| `npm run lint`           | ESLint + Prettier (`npm run format` corrige el formato)                |
| `scripts\verify.bat`     | lint → tests → build, deteniéndose en el primer fallo                  |
| `scripts\e2e.bat`        | E2E completo en un entorno aislado ([e2e/README.md](../e2e/README.md)) |
| `npm run test:e2e`       | Solo Playwright (con el entorno ya levantado)                          |

## Arquitectura

```
src/
  main.js                  arranque: rutas (app.js), aviso de conectividad, Service Worker
  app.js                   rutas: #/ · #/chat · #/agente/login · #/agente · #/agente/perfil ·
                           #/agente/recuperar · /restablecer · /confirmar-correo · /invitacion ·
                           #/admin/* (solo admin)
  router.js                router por hash; cada vista devuelve una función de limpieza
  auth/session.js          access token EN MEMORIA; refresh single-flight; logout entre pestañas
  api/http.js              fetch + CSRF + un reintento tras renovar ante un 401
  api/widget.js · staff.js endpoints del cliente y del panel; profile.js y admin.js (Fase 7)
  realtime/socket.js       WebSocket: auth en el primer mensaje, backoff + jitter, resync, 4409
  chat/messageStore.js     mensajes por id del servidor, sin duplicar los optimistas (clientMsgId)
  urgency/                 clasificador local + cliente del Worker (descarta respuestas viejas)
  workers/urgency.worker.js
  sw/                      estrategia (función pura), Service Worker y registro
  voice/                   llamada: pcm (16 kHz), AudioWorklet, micrófono, reproductor, WebRTC,
                           sesión del socket de voz, y los controladores del cliente y del asesor
  views/                   landing, chat del cliente, login, panel, perfil, recuperación,
                           invitación ("Completa tu cuenta") y admin/*
  components/              lista de mensajes, avisos, conexión; Fase 7: states.js (cargando/error/
                           vacío), connectivity.js, waveform.js, barChart.js, adjuntos, avatar,
                           userMenu.js (Mi perfil / Salir), mfaEnrollment.js (login e invitación)…
  lib/                     dom.js, sendQueue.js (orden de envío), attachments.js, priority.js…
  lib/dom.js               h(): crea nodos; el texto SIEMPRE como nodo de texto
  styles/                  tokens.css (sistema de diseño; oscuro = el del sistema, en CSS) · base · chat · panel ·
                           voice · admin · profile · attachments
```

### Sesiones: nada sensible al alcance de JavaScript persistente

- **Agente**: el access token vive solo en una variable del módulo (nunca `localStorage` ni
  `sessionStorage`). Al recargar, `restore()` pide uno nuevo con la cookie httpOnly de refresh.
  Si varias peticiones reciben 401 a la vez, se hace **un solo** `/refresh` (single-flight).
  Cerrar sesión en una pestaña la cierra en las demás (`BroadcastChannel`), y si en otra pestaña
  entra una cuenta distinta, el panel se recarga en vez de seguir mostrando al usuario anterior.
- **Cliente**: la sesión del widget es una cookie httpOnly `atencion_ia_widget` (`SameSite=Strict`).
  El token `wgt_…` nunca llega al JavaScript; las escrituras llevan `X-Requested-With: atencion-ia`
  (CSRF), igual que el refresh del agente.
- **API en otro origen** (`VITE_API_URL`, `src/api/base.js`): la app (`atencion.<dominio>`) y la
  API (`api-atencion.<dominio>`) son orígenes distintos del **mismo sitio**, así que las cookies
  `SameSite=Strict` viajan. Todo `fetch` usa `credentials: "include"` y la API responde con CORS
  con credenciales solo a los orígenes de su `CORS_ORIGIN`. Los WebSockets de chat y de voz se
  arman desde `VITE_API_URL` (`wss://…/ws`, `wss://…/ws/voice`), nunca desde `location.host`.
  La CSP del build permite en `connect-src` solo `'self'` y ese origen (https y wss). El Service
  Worker no intercepta nada de otro origen: la API nunca pasa por su caché.

### Tiempo real

El WebSocket es **solo de recepción**: los envíos van por REST (idempotentes por `clientMsgId`).
Al conectar, el cliente se autentica en el primer mensaje (el token no viaja en la URL). Si la
conexión cae, reintenta con backoff exponencial y jitter (1 s → 30 s); al reconectar **vuelve a
pedir el historial** por REST, porque lo publicado mientras estaba desconectado no se reenvía.
Con cierre 4409 (token vencido) el panel renueva el token antes de reconectar.

### Web Worker de urgencia

Mientras el cliente escribe, `urgency.worker.js` clasifica el texto localmente (fraude, pide
asesor, molestia) y el chat muestra un aviso ("Esto se ve urgente…"). **No decide nada**: el
servidor clasifica cada turno con la IA y aplica sus propias reglas. Manipular este código solo
cambia lo que ve el cliente. Las respuestas que llegan fuera de orden se descartan.

### Service Worker

Estrategia en `src/sw/strategy.js` (función pura, con tests): **nunca** intercepta `/api`, `/ws`,
otros orígenes ni métodos distintos de GET (las conversaciones son datos personales y no se
guardan en Cache Storage). Navegaciones → `index.html` con revalidación, u `offline.html` sin red.
`/assets/*` (nombres con hash) → cache-first. `scripts/sw-build.js` inyecta la lista de precache
en el build y **falla** si no encuentra la declaración exacta que debe reemplazar.

### Voz

- **Consentimiento primero:** el aviso vigente viene del backend y "Aceptar y llamar" está
  deshabilitado hasta marcar "Leí y acepto". Se envía la versión mostrada.
- **Micrófono antes que la llamada:** si el permiso se niega, no se crea ninguna llamada (ni el
  asesor toma el caso).
- **Captura:** un AudioWorklet baja el micrófono a PCM16 mono de 16 kHz, en tramas de 100 ms
  (~32 KB/s, lo que el servidor admite en tiempo real).
- **Qué se envía:** solo después de `ready`, nunca silenciado, y **no mientras habla el
  asistente** (su voz no debe transcribirse como del cliente). "Interrumpir" lo corta.
- **WebRTC entre cliente y asesor:** solo el asesor ofrece; los candidatos ICE se guardan hasta
  tener la descripción remota. El audio va de navegador a navegador.
- **El micrófono se apaga siempre:** al colgar, cuando el servidor termina la llamada, al salir de
  la vista o si otra pestaña toma la llamada. En este último caso **no reconecta**: si lo hiciera,
  las pestañas se la quitarían una a otra sin fin.
- **Micrófono desconectado:** si se desconecta a mitad de la llamada, se avisa.

### XSS

Todo el texto (mensajes de clientes, de la IA, nombres) entra al DOM como nodo de texto vía
`h()`. ESLint prohíbe `innerHTML`, `outerHTML` e `insertAdjacentHTML`.

## Despliegue (Vercel)

[`vercel.json`](../vercel.json): `npm ci` + `npm run build`, salida `dist`. El router es por hash, así
que no hay rewrites. Lo sujetan `tests/vercel.test.js` y 4 mutaciones.

- Cabeceras en toda respuesta: `Content-Security-Policy: frame-ancestors 'none'` (en `<meta>` no
  funciona; la política completa sigue en el `<meta>` del build), `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy`, HSTS, COOP `same-origin` y `Permissions-Policy` con el micrófono
  solo para la propia app (llamadas de voz).
- Caché: `/assets/*` inmutable por un año; `/`, `index.html`, `service-worker.js`, `offline.html`
  y `offline.css` con `no-cache`.
- Ninguna URL ni secreto en el repo: `VITE_API_URL` se define en el proyecto de Vercel (el build
  falla si falta o no es https).

## Tests

`npm test`: 416 tests en 24 archivos — render seguro, sesión (memoria, single-flight, reintento,
logout entre pestañas), WebSocket (auth, reconexión con backoff, resync, 4409, cierre limpio),
store de mensajes, Worker de urgencia, Service Worker (incluye cargar el SW generado), chat del
cliente (envío, recepción, reintento con el mismo `clientMsgId`, aislamiento por conversación) y
panel (cola en vivo, historial antes de tomar, tomar/cerrar, caso tomado por otro, cambio de cuenta,
estado de la llamada y transcripción en vivo solo del caso abierto, como texto). Fase 7: identidad
(MFA, recuperación, sesiones, foto), guardas por rol y vistas de administración, adjuntos, llamada
en vivo, estados de la interfaz y **contraste WCAG medido sobre los valores reales de los tokens**
(`tests/contrast.test.js`, que además exige una sola animación en todo el CSS). Bloque F:
invitaciones y Equipo, ningún registro público, menú de usuario (teclado y foco), portada
(jerarquía, fragmento ilustrativo, micro-interacción sin animación) y el tema del sistema
(`tests/systemTheme.test.js`: ningún selector, ninguna pantalla que se salga).

**E2E** (`e2e/`, Playwright): seis escenarios contra el stack real con IA y voz simuladas
(detalle en [e2e/README.md](../e2e/README.md)).

- **Flujo de texto:** RAG → escalamiento → cola en tiempo real → tomar, responder y cerrar. Incluye
  axe, 0 violaciones de CSP y ningún token en el almacenamiento.
- **Llamada de voz:** micrófono falso de Chromium → transcripción → escalamiento → el asesor se une
  con WebRTC conectado; la forma de onda pinta el audio y el borde cambia de color UNA vez.
- **Adjuntos:** el cliente envía un PDF y una foto, el asesor los ve en vivo y responde con un
  adjunto; 0 violaciones de CSP y axe.
- **Invitación:** el admin invita desde Equipo → el correo simulado → la asesora completa su cuenta →
  el enlace no sirve dos veces → inicia sesión.
- **Tema del sistema:** las 13 pantallas en claro y en oscuro (fondo y axe en cada una) y el cambio
  en vivo sin recargar.
- **API en otro origen:** la app y la API en orígenes distintos, como en producción: REST y
  WebSockets van al origen de `VITE_API_URL`, las cookies viajan con CORS con credenciales y al recargar
  la sesión se recupera; 0 violaciones de CSP.

**CI** (`.github/workflows/ci.yml`): lint, tests, mutaciones y build; `npm audit` y gitleaks; y el
E2E completo (Postgres y Redis de servicio, backend y base de sus repos, build y `vite preview`).

`npm run test:mutations`: 124/124 reglas críticas rotas a propósito son detectadas.

La verificación en vivo (dos pestañas, reconexión real, base de prueba aparte) está en
[docs/fase4-verificacion.md](fase4-verificacion.md). El sistema de diseño, en
[docs/design-system.md](design-system.md).
