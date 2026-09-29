# atencion-ia-frontend

SPA de **Atención al cliente omnicanal con IA**, con dos superficies:
- **Widget de cliente**: chat de texto y llamada de voz dentro del navegador (WebRTC),
  con aviso de consentimiento antes de llamar.
- **Panel de agente**: cola de conversaciones priorizada, historial completo antes de
  tomar un caso, tomar/cerrar conversaciones, unirse a una llamada en curso viendo la
  transcripción en tiempo real.

## Stack

JavaScript sin framework + Vite · router propio por hash · WebSocket · Web Worker real
(clasificación local de urgencia antes de enviar) · Service Worker real · Vitest ·
Playwright (E2E).

Sesión: el access token vive **solo en memoria** (nunca en `localStorage`) y se renueva
de forma transparente con la cookie httpOnly de refresh que emite el backend.

## Relación con los otros repositorios

| Repositorio | Relación |
|---|---|
| `atencion-ia-backend` | Única dependencia: API REST + WebSocket. Los E2E necesitan el backend corriendo (con `AI_PROVIDER=mock`). |
| `atencion-ia-database` | Indirecta: los E2E necesitan la base migrada y con seed. |

## Estado

**Fase 0**: repositorio inicializado. El código llega en la Fase 4 (chat de texto) y la
Fase 6 (UI de voz), con las instrucciones de arranque en cmd.exe en este README.
