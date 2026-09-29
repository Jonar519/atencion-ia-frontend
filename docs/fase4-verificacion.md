# Fase 4 · Verificación en vivo

Prueba de punta a punta en el navegador: cliente y agente en **dos pestañas**, viendo la misma
conversación en tiempo real, con `AI_PROVIDER=mock`.

## Entorno aislado (la base de desarrollo no se toca)

Todo corrió contra una base y un Redis **aparte**, para no modificar `atencion_ia`:

| Pieza    | Desarrollo (sin tocar)   | Prueba en vivo                    |
| -------- | ------------------------ | --------------------------------- |
| Base     | `atencion_ia`            | `atencion_ia_e2e`                 |
| Redis    | `redis://localhost:6380` | `redis://localhost:6380/1` (db 1) |
| API      | 4100                     | 4101                              |
| Worker   | métricas en 9465         | métricas en 9466                  |
| Frontend | 5174                     | 5175                              |

Evidencia de que la base de desarrollo quedó intacta: un md5 del volcado de sus datos antes y
después de la prueba coincide (`a4769bd0dee021507f0152ac2592e71f` en ambos). La base e2e terminó
con 34 mensajes y 2 sesiones de widget.

### Reproducirlo (cmd.exe, desde la carpeta que contiene los tres repos)

```bat
docker exec atencion_ia_postgres createdb -U postgres atencion_ia_e2e
cd atencion-ia-database
set DB_NAME=atencion_ia_e2e
scripts\migrate.bat
scripts\seed.bat
set DB_NAME=
cd ..\atencion-ia-backend
npm run build
```

Luego, en tres ventanas de cmd distintas (desde `atencion-ia-backend` las dos primeras y desde
`atencion-ia-frontend` la tercera):

```bat
set PORT=4101&& set DATABASE_URL=postgresql://postgres:postgres@localhost:5434/atencion_ia_e2e&& set REDIS_URL=redis://localhost:6380/1&& set CORS_ORIGIN=http://localhost:5175&& npm start
```

```bat
set WORKER_METRICS_PORT=9466&& set DATABASE_URL=postgresql://postgres:postgres@localhost:5434/atencion_ia_e2e&& set REDIS_URL=redis://localhost:6380/1&& npm run worker:start
```

```bat
set VITE_BACKEND_URL=http://localhost:4101&& npm run dev -- --port 5175
```

(Sin espacio antes de `&&`: en cmd.exe el espacio quedaría dentro del valor de la variable.)

Para borrarla al terminar: `docker exec atencion_ia_postgres dropdb -U postgres atencion_ia_e2e`.

## Qué se verificó

| #   | Paso                                                                                                                           | Resultado |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | El cliente inicia sesión: la cookie `atencion_ia_widget` es httpOnly y el token no aparece en la respuesta                     | ✅        |
| 2   | El WebSocket del widget se conecta a través del proxy de Vite (mismo origen) y queda "En línea"                                | ✅        |
| 3   | Pregunta sobre horarios → respuesta del RAG (mock) en el chat                                                                  | ✅        |
| 4   | Al escribir "no reconozco un cargo…" aparece el aviso local **antes** de enviar; se confirmó que el script del Worker se cargó | ✅        |
| 5   | El mensaje de fraude escala: el caso aparece en la cola de Laura **sin recargar**, marcado urgente                             | ✅        |
| 6   | Laura ve el historial completo, con intención y sentimiento, **antes** de tomar el caso                                        | ✅        |
| 7   | Laura toma el caso y responde: el cliente ve el cambio de estado y la respuesta en tiempo real                                 | ✅        |
| 8   | Resync tras reconexión (ver abajo)                                                                                             | ✅        |

### Resync tras reconexión: cómo se probó de verdad

El primer intento solo mostraba que el WebSocket volvía a conectar, y eso **no** demuestra que no
se pierden mensajes. La prueba válida:

1. Con widget y panel abiertos, se detuvo la API e2e: ambos pasaron a "Reconectando…".
2. Con la API caída, se insertó un mensaje directamente en `atencion_ia_e2e` (nadie lo publicó
   por el WebSocket).
3. Se levantó la API: ambos reconectaron, hicieron `GET …/messages` (visto en las peticiones de
   red) y el mensaje insertado apareció en las dos pestañas.

## Defectos que encontró la prueba en vivo (y no los tests)

- **El chat "oculto" se veía detrás del formulario de inicio**: `.chat { display: grid }` le
  ganaba al atributo `hidden`. Se corrigió con `[hidden] { display: none !important }` en
  `base.css`. jsdom no reproduce esa cascada (un test con `getComputedStyle` pasaba con y sin el
  arreglo, así que se descartó); `tests/styles.test.js` verifica que la regla siga en la hoja.
- **Service Worker roto en el build**: el reemplazo de la lista de precache tocaba también un
  comentario y el SW fallaba al cargar. Ahora `scripts/sw-build.js` reemplaza solo la
  declaración exacta (o falla el build), y un test carga el SW generado.
- **Cambio de cuenta en otra pestaña**: si en otra pestaña entra una cuenta distinta, el panel
  seguía mostrando al usuario anterior. Ahora se recarga (test + mutación 13).

## No verificado en vivo

- **Dos agentes a la vez en navegadores distintos** (Laura y Diego): la cookie de refresh es por
  navegador y el panel de pruebas era uno solo. Que un agente no reciba por WebSocket los casos
  de otro está cubierto por los tests de integración del backend (`websocket.test.ts`) y por sus
  mutaciones 14–17.
- Rendimiento, uso de memoria y latencia de los eventos: **no medidos**.
- Navegadores distintos de Chromium: **no probados**.
- El Service Worker en modo offline se probó con tests (estrategia y SW generado), no
  desconectando la red en el navegador.
