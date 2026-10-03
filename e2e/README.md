# E2E del flujo crítico (Playwright)

Cinco escenarios, varios con **dos navegadores a la vez** (cliente y asesor), contra un stack real:
API, worker, PostgreSQL y Redis, con la IA y la voz **simuladas** (`AI_PROVIDER=mock`,
`VOICE_PROVIDER=mock`). El frontend es el **build** servido con `vite preview`, es decir, con su
CSP y su Service Worker, como en producción.

| Spec                    | Qué recorre                                                                                                                                                                                                                                                                                                                          | Además verifica                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `critical-flow.spec.js` | El cliente pregunta → la IA responde **con la KB** ("lunes a viernes") → reporta un fraude → se escala → el caso aparece en la cola del asesor **sin recargar**, con el historial y "Posible fraude" → lo toma → responde → el cliente lo ve en vivo → el asesor cierra → el cliente ve que terminó                                  | **axe** (WCAG 2.1 A/AA) en el panel y el widget sin violaciones _serious_/_critical_; **0 violaciones de CSP**; **ningún token** (JWT ni `wgt_…`) en `localStorage`/`sessionStorage`                                                                                                               |
| `voice-call.spec.js`    | "Llamar" → aviso (el botón está deshabilitado hasta aceptar) → micrófono → "Te escuchamos" → 3 frases transcritas (con "Interrumpir") → respuesta de la IA → **escala** → el asesor se une → **WebRTC conectado** en las dos puntas → el cliente cuelga → las dos barras muestran "La llamada terminó."                              | 0 violaciones de CSP; la pista de audio del cliente llega **viva** al asesor. Fase 7: la forma de onda pinta el audio del micrófono, la única animación (`callbar-handoff`) corre **una** vez y el borde termina en menta; "Asesor conectado" en las dos barras y el ánimo del cliente en el panel |
| `invitations.spec.js`   | El admin entra por la interfaz con contraseña y código TOTP → **Equipo → Invitar asesor** → el enlace se lee del **correo simulado** (`email_outbox`, `e2e/outbox.js`) → la invitada lo abre en SU navegador → **Completa tu cuenta** → el mismo enlace ya no sirve → inicia sesión con su contraseña → en Equipo ya no es pendiente | El enlace **nunca** aparece en la pantalla del admin; axe en Equipo y en "Completa tu cuenta"; 0 violaciones de CSP                                                                                                                                                                                |
| `system-theme.spec.js`  | Las **13 pantallas** (portada, login, recuperación, invitación, widget en tres estados, panel, perfil y las 4 de administración) con el tema del sistema emulado en **claro y en oscuro**                                                                                                                                            | El fondo del tema y **axe** en cada pantalla y tema; el cambio de tema del sistema con la página abierta, **sin recargar**                                                                                                                                                                         |
| `attachments.spec.js`   | El cliente adjunta un **PDF** con comentario (vista previa antes de enviar) y una **foto** elegida con el selector real (el navegador la re-codifica) → el asesor los ve **en vivo** (tarjeta con Descargar y la foto en el chat) → el asesor responde con un adjunto que el cliente recibe                                          | 0 violaciones de CSP (las imágenes se muestran con URL `blob:`); axe sin violaciones _serious_/_critical_                                                                                                                                                                                          |

**Micrófono:** Chromium usa un micrófono **falso** que reproduce un audio con ritmo de habla
(sílabas y pausas). Lo genera `global-setup.js` en `e2e/.generated/` y el permiso se concede sin
preguntar. El resto es real: AudioWorklet, WebSocket de voz y RTCPeerConnection.

Cada corrida **crea su propio asesor** por el único camino que existe, la **invitación**: el admin
del seed invita por la API, el enlace se lee del correo simulado y el agente completa su cuenta. Así
no choca con el máximo de casos de las corridas anteriores. El lector del correo usa `psql` en la
CI y `docker exec` en local, y se niega a leer la base de desarrollo.

El admin del seed activa su verificación en dos pasos en el `globalSetup` (flujo real con QR y
código TOTP). El secreto se guarda en `e2e/.generated/` (ignorado por git) para que los escenarios
que entran por la interfaz calculen un código **nuevo**: el backend rechaza reutilizar el de un
paso de 30 s ya usado.

## Correrlo en local (cmd.exe)

Desde `atencion-ia-frontend`, con Postgres y Redis de `atencion-ia-database` levantados y Google
Chrome instalado:

```bat
scripts\e2e.bat
```

El script:

1. Crea o migra la base **`atencion_ia_e2e`** y carga el seed (nunca la de desarrollo). Redis: base lógica 1.
2. Compila el backend e indexa la KB.
3. Abre tres ventanas minimizadas: API en 4101, worker (métricas en 9466) y `vite preview` en 4175.
4. Corre Playwright.
5. Cierra todo.

Las variables son **solo de prueba**: no usa tu `.env`. Los límites por IP van ×5
(`RATE_LIMIT_SCALE=5`): cada corrida completa varias invitaciones y la base 1 de Redis conserva los
contadores entre corridas locales seguidas (ningún escenario prueba los límites). Los adjuntos y fotos que suben las pruebas van a
`%TEMP%\atencion-ia-e2e-storage`, nunca a la carpeta de desarrollo `..\atencion-ia-storage`.

Playwright usa **tu Chrome** con un perfil temporal (no toca tu perfil). Para usar Edge:
`set E2E_CHANNEL=msedge` antes del script.

Si ya tienes el entorno levantado por tu cuenta: `npm run test:e2e`, con `E2E_BASE_URL` si no está
en `http://localhost:4175`.

## En CI

En `.github/workflows/ci.yml`, job `e2e`:

- servicios de Postgres (pgvector) y Redis;
- checkout de `atencion-ia-backend` y `atencion-ia-database`;
- migraciones, seed, KB indexada, API y worker compilados;
- build + `vite preview` y Playwright con **su** Chromium.

El reporte HTML, las trazas y los logs quedan como artefacto.

## Qué NO cubre

- **Proveedores reales** de IA y voz (Anthropic, Voyage, Deepgram): el contenido real de lo que se
  dice no se entiende (ver `docs/prueba-voz.md`).
- WebRTC entre **equipos distintos** (NAT, TURN): aquí los dos contextos están en la misma máquina.
- Navegadores distintos de Chromium.
