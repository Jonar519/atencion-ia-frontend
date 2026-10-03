# E2E del flujo crítico (Playwright)

Tres escenarios, cada uno con **dos navegadores a la vez** (cliente y asesor) contra un stack real:
API, worker, PostgreSQL y Redis, con la IA y la voz **simuladas** (`AI_PROVIDER=mock`,
`VOICE_PROVIDER=mock`). El frontend es el **build** servido con `vite preview`, es decir, con su
CSP y su Service Worker, como en producción.

| Spec                    | Qué recorre                                                                                                                                                                                                                                                                                             | Además verifica                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `critical-flow.spec.js` | El cliente pregunta → la IA responde **con la KB** ("lunes a viernes") → reporta un fraude → se escala → el caso aparece en la cola del asesor **sin recargar**, con el historial y "Posible fraude" → lo toma → responde → el cliente lo ve en vivo → el asesor cierra → el cliente ve que terminó     | **axe** (WCAG 2.1 A/AA) en el panel y el widget sin violaciones _serious_/_critical_; **0 violaciones de CSP**; **ningún token** (JWT ni `wgt_…`) en `localStorage`/`sessionStorage`                                                                                                               |
| `voice-call.spec.js`    | "Llamar" → aviso (el botón está deshabilitado hasta aceptar) → micrófono → "Te escuchamos" → 3 frases transcritas (con "Interrumpir") → respuesta de la IA → **escala** → el asesor se une → **WebRTC conectado** en las dos puntas → el cliente cuelga → las dos barras muestran "La llamada terminó." | 0 violaciones de CSP; la pista de audio del cliente llega **viva** al asesor. Fase 7: la forma de onda pinta el audio del micrófono, la única animación (`callbar-handoff`) corre **una** vez y el borde termina en menta; "Asesor conectado" en las dos barras y el ánimo del cliente en el panel |
| `attachments.spec.js`   | El cliente adjunta un **PDF** con comentario (vista previa antes de enviar) y una **foto** elegida con el selector real (el navegador la re-codifica) → el asesor los ve **en vivo** (tarjeta con Descargar y la foto en el chat) → el asesor responde con un adjunto que el cliente recibe             | 0 violaciones de CSP (las imágenes se muestran con URL `blob:`); axe sin violaciones _serious_/_critical_                                                                                                                                                                                          |

**Micrófono:** Chromium usa un micrófono **falso** que reproduce un audio con ritmo de habla
(sílabas y pausas). Lo genera `global-setup.js` en `e2e/.generated/` y el permiso se concede sin
preguntar. El resto es real: AudioWorklet, WebSocket de voz y RTCPeerConnection.

Cada corrida **crea su propio asesor** (con el admin del seed), así no choca con el máximo de casos
de las corridas anteriores.

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

Las variables son **solo de prueba**: no usa tu `.env`. Los adjuntos y fotos que suben las pruebas van a
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
