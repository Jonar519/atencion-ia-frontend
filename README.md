# atencion-ia-frontend

SPA de **Atención al cliente omnicanal con IA**, con dos superficies:

- **Widget de cliente** (`#/chat`): chat de texto con la IA; si la IA escala (fraude, cliente
  molesto, pide un humano…), el mismo chat pasa a un asesor en tiempo real.
- **Panel de agente** (`#/agente`): cola priorizada, historial completo (con la intención y el
  sentimiento que detectó la IA) **antes** de tomar el caso, tomar, responder y cerrar.

**Voz** (Fase 6, punto 1): el cliente llama desde el widget tras aceptar el aviso de
consentimiento; el asesor se une desde el panel y hablan por WebRTC. Guía para probarlo con tu
micrófono: [docs/prueba-voz.md](docs/prueba-voz.md).

**Fase 7** (identidad profesional y evolución visual): cuenta del asesor (recuperar contraseña,
verificación en dos pasos, sesiones activas, perfil con foto y tema oscuro), administración por rol
(base de conocimiento, respuestas predefinidas, equipo y analítica), adjuntos en el chat, la llamada
"en vivo" (forma de onda y transición de color) y estados de carga, error, vacío y conectividad.
Recorrido paso a paso: `atencion-ia-backend/docs/demo-fase7.md`.

## Estado por fase

| Fase | Contenido                                                                                          | Estado |
| ---- | -------------------------------------------------------------------------------------------------- | ------ |
| 4    | Widget de texto, panel de agente, WebSocket, Web Worker, Service Worker, diseño                    | ✅     |
| 5    | Panel: estado de la llamada, turnos de voz marcados y transcripción EN VIVO del caso abierto       | ✅     |
| 6    | UI de voz: llamar con consentimiento, micrófono, respuesta en audio, unirse con WebRTC real        | ✅     |
| 6    | E2E con Playwright (texto y voz) y GitHub Actions                                                  | ✅     |
| 7    | Identidad: navy/ámbar, tema oscuro, cuenta del asesor (recuperación, MFA, sesiones, perfil y foto) | ✅     |
| 7    | Administración por rol: base de conocimiento, respuestas predefinidas, equipo y analítica (SVG)    | ✅     |
| 7    | Adjuntos en el chat (imagen y PDF), con vista previa antes de enviar y E2E propio                  | ✅     |
| 7    | Llamada en vivo (forma de onda, una sola animación) y estados de carga/error/vacío/conexión        | ✅     |

## Stack

JavaScript sin framework + Vite 7 · router propio por hash · WebSocket nativo · **Web Worker
real** (clasificación local de urgencia mientras el cliente escribe) · **Service Worker real**
(shell offline; nunca cachea la API) · Vitest 4 + jsdom · ESLint + Prettier.

## Relación con los otros repositorios

| Repositorio            | Relación                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `atencion-ia-backend`  | Única dependencia en ejecución: API REST (`/api`) y WebSocket (`/ws`), con `AI_PROVIDER=mock` por defecto. |
| `atencion-ia-database` | Indirecta: el backend necesita la base migrada y con seed para probar a mano.                              |

Los tests de este repo **no** necesitan el backend: simulan `fetch` y el WebSocket.

## Primera vez (Windows, cmd.exe)

Requisitos: Node.js 20+ y el backend corriendo en `http://localhost:4100` (ver su README).

```bat
cd atencion-ia-frontend
npm install
npm run dev
```

Abre `http://localhost:5174`.

- **Cliente**: "Soy cliente" → tu nombre (opcional) → chatea. Prueba "no reconozco un cargo de
  $450.000" para ver el aviso local de urgencia y el traspaso a un asesor.
- **Agente**: "Soy asesor" → `laura@cordillera.example` / `Password123!` (cuentas del seed; ver
  el README de `atencion-ia-database`).

Con el cliente en una pestaña y el agente en otra, los mensajes aparecen en ambas sin recargar.

Si el backend está en otro puerto: `copy .env.example .env` y cambia `VITE_BACKEND_URL`.

## Scripts

| Comando                  | Qué hace                                                                  |
| ------------------------ | ------------------------------------------------------------------------- |
| `npm run dev`            | Servidor de desarrollo en 5174, con proxy de `/api` y `/ws` al backend    |
| `npm run build`          | Build de producción en `dist\` (incluye `service-worker.js` generado)     |
| `npm run preview`        | Sirve `dist\` en 4174 (con el mismo proxy): así se prueba el SW de verdad |
| `npm test`               | Tests (Vitest + jsdom)                                                    |
| `npm run test:mutations` | Rompe a propósito cada regla crítica y exige que algún test falle         |
| `npm run lint`           | ESLint + Prettier (`npm run format` corrige el formato)                   |
| `scripts\verify.bat`     | lint → tests → build, deteniéndose en el primer fallo                     |
| `scripts\e2e.bat`        | E2E completo en un entorno aislado ([e2e/README.md](e2e/README.md))       |
| `npm run test:e2e`       | Solo Playwright (con el entorno ya levantado)                             |

## Arquitectura

```
src/
  main.js                  rutas: #/ · #/chat · #/agente/login · #/agente · #/agente/perfil ·
                           #/agente/recuperar · /restablecer · /confirmar-correo · #/admin/* (solo admin)
  theme.js                 tema claro/oscuro (parte del perfil del asesor)
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
  views/                   landing, chat del cliente, login, panel, perfil, recuperación y admin/*
  components/              lista de mensajes, avisos, conexión; Fase 7: states.js (cargando/error/
                           vacío), connectivity.js, waveform.js, barChart.js, adjuntos, avatar…
  lib/                     dom.js, sendQueue.js (orden de envío), attachments.js, priority.js…
  lib/dom.js               h(): crea nodos; el texto SIEMPRE como nodo de texto
  styles/                  tokens.css (sistema de diseño, claro y oscuro) · base · chat · panel ·
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
- **Mismo origen**: Vite reenvía `/api` y `/ws` al backend, así que las cookies funcionan sin CORS
  y la CSP del `index.html` puede ser `'self'` (`connect-src 'self'`).

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

## Tests

`npm test`: 319 tests en 18 archivos — render seguro, sesión (memoria, single-flight, reintento,
logout entre pestañas), WebSocket (auth, reconexión con backoff, resync, 4409, cierre limpio),
store de mensajes, Worker de urgencia, Service Worker (incluye cargar el SW generado), chat del
cliente (envío, recepción, reintento con el mismo `clientMsgId`, aislamiento por conversación) y
panel (cola en vivo, historial antes de tomar, tomar/cerrar, caso tomado por otro, cambio de cuenta,
estado de la llamada y transcripción en vivo solo del caso abierto, como texto). Fase 7: identidad
(MFA, recuperación, sesiones, foto), guardas por rol y vistas de administración, adjuntos, llamada
en vivo, estados de la interfaz y **contraste WCAG medido sobre los valores reales de los tokens**
(`tests/contrast.test.js`, que además exige una sola animación en todo el CSS).

**E2E** (`e2e/`, Playwright): tres escenarios con cliente y asesor en dos navegadores a la vez, contra
el stack real con IA y voz simuladas.

- **Flujo de texto:** RAG → escalamiento → cola en tiempo real → tomar, responder y cerrar. Incluye
  axe, 0 violaciones de CSP y ningún token en el almacenamiento.
- **Llamada de voz:** micrófono falso de Chromium → transcripción → escalamiento → el asesor se une
  con WebRTC conectado; la forma de onda pinta el audio y el borde cambia de color UNA vez.
- **Adjuntos:** el cliente envía un PDF y una foto, el asesor los ve en vivo y responde con un
  adjunto; 0 violaciones de CSP y axe.

**CI** (`.github/workflows/ci.yml`): lint, tests, mutaciones y build; `npm audit` y gitleaks; y el
E2E completo (Postgres y Redis de servicio, backend y base de sus repos, build y `vite preview`).

`npm run test:mutations`: 84/84 reglas críticas rotas a propósito son detectadas.

La verificación en vivo (dos pestañas, reconexión real, base de prueba aparte) está en
[docs/fase4-verificacion.md](docs/fase4-verificacion.md). El sistema de diseño, en
[docs/design-system.md](docs/design-system.md).
