# Probar la llamada de voz con tu micrófono (cmd.exe)

Prueba de punta a punta **en tu navegador**, con tu micrófono y audífonos:

- el cliente llama desde el widget;
- el asistente (simulado) le responde con audio;
- el caso escala;
- el asesor se une desde otra pestaña, con **WebRTC real** entre las dos pestañas.

El reconocimiento de voz (STT) y la síntesis (TTS) son **simulados**
(`VOICE_PROVIDER=mock`). Lee primero la sección "Qué tan realista es" al final.

## 0. Antes de empezar

- **Chrome o Edge** actualizados. El micrófono solo funciona en `localhost` o en HTTPS.
- **Audífonos puestos.** Con parlantes, cada pestaña reproduce tu voz, el micrófono la vuelve a
  captar y el simulador la toma como frases nuevas.
- Base migrada hasta la **014**. Si ya corriste `scripts\migrate.bat` después de la Fase 5, no
  hace falta nada.
- En `atencion-ia-backend\.env`, `VOICE_PROVIDER` debe estar ausente o valer `mock`.

## 1. Levantar todo (tres ventanas de cmd)

**Ventana 1 — base de datos y API:**

```bat
cd atencion-ia-database
docker compose up -d
scripts\migrate.bat
cd ..\atencion-ia-backend
npm run dev
```

**Espera** a ver estas dos líneas:

- `API escuchando en http://localhost:4100`
- `WebSocket de voz en /ws/voice (proveedor: mock)`

**Ventana 2 — worker:**

```bat
cd atencion-ia-backend
npm run worker
```

**Ventana 3 — frontend:**

```bat
cd atencion-ia-frontend
npm install
npm run dev
```

`npm install` solo hace falta la primera vez. **Espera** a ver `Local: http://localhost:5174/`.

Si ya tenías la API o el worker abiertos de antes, déjalos: se recargan solos con el código nuevo.

## 2. Preparar las dos pestañas

Abre **dos ventanas** del navegador, una al lado de la otra:

- **Ventana A (cliente):** `http://localhost:5174/#/chat`
- **Ventana B (asesor):** `http://localhost:5174/#/agente/login`. Inicia sesión con
  `laura@cordillera.example` y la contraseña `Password123!`.

Laura puede atender como máximo 3 casos a la vez. Si al unirse ves "Ya atiendes 3 conversaciones",
cierra uno en "Mis casos" o entra como `diego@cordillera.example`.

## 3. El cliente llama (ventana A)

| #   | Haz esto                                                                     | Debes ver                                                                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Escribe un nombre (opcional) y pulsa **Iniciar chat**                        | "Te atiende el asistente virtual" y, arriba a la derecha, "● En línea" y el botón **📞 Llamar**                                                                                                                                                                                                                                                |
| 2   | Pulsa **📞 Llamar**                                                          | El recuadro **"Antes de llamar"** con el aviso: el audio no se graba, la transcripción se guarda 90 días, etc. **"Aceptar y llamar" está gris** y no hace nada                                                                                                                                                                                 |
| 3   | Marca **"Leí el aviso y acepto…"** y pulsa **Aceptar y llamar**              | El navegador pide permiso para el micrófono: pulsa **Permitir**. Aparece la barra: "Conectando la llamada…" → **"En llamada con el asistente virtual"**, y el contador 00:01, 00:02… Además, en la pestaña aparece el **punto rojo de grabación** del navegador                                                                                |
| 4   | Quédate **callado** unos 10 segundos                                         | El medidor "Tu micrófono" casi no se mueve y **no aparece nada** en el chat. El silencio no genera frases                                                                                                                                                                                                                                      |
| 5   | **Habla** 2 o 3 segundos (lo que quieras) y luego **haz silencio** 1 segundo | Mientras hablas, el medidor sube y aparece **"Te escuchamos"** y **"Estás diciendo: Hola, quisiera saber el horario…"**, que se completa palabra por palabra. Al callarte aparece tu turno ("Tú") con la **frase del guion**, luego la respuesta del asistente en texto, y **oyes pitidos cortos**, uno por palabra, que son la "voz" simulada |
| 6   | Mientras suenan los pitidos                                                  | La barra dice "**El asistente está respondiendo. Tu micrófono está en pausa…**" y aparece **Interrumpir**                                                                                                                                                                                                                                      |
| 7   | Pulsa **Interrumpir**                                                        | Los pitidos se cortan y vuelve "Habla con normalidad y haz una pausa al terminar cada frase."                                                                                                                                                                                                                                                  |
| 8   | Di una **segunda** frase y haz silencio                                      | Turno del guion: "¿Cómo bloqueo mi tarjeta si la pierdo?" y su respuesta. Usa **Interrumpir** si no quieres esperar los ~15 s de pitidos                                                                                                                                                                                                       |
| 9   | Di una **tercera** frase y haz silencio                                      | Turno del guion: "Tengo un cargo que no reconozco en mi tarjeta de crédito". El asistente dice que te comunica con un asesor y la barra cambia a **"Te estamos pasando con un asesor… no cuelgues."**                                                                                                                                          |

## 4. El asesor se une (ventana B)

| #   | Haz esto                                                  | Debes ver                                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | Mira la **Cola**                                          | Sin recargar, aparece tu caso marcado **Posible fraude**                                                                                                                                                                                          |
| 11  | Ábrelo                                                    | El **historial completo** antes de tomarlo: cada turno con la etiqueta **Voz** y el análisis de la IA ("Posible fraude · …"). Arriba verás **"Llamada en espera de asesor"** y el botón **📞 Unirse a la llamada**                                |
| 12  | Pulsa **Unirse a la llamada** y **Permitir** el micrófono | Arriba, la barra del asesor dice **"En llamada con el cliente"** y **"Audio con el cliente: conectado"**. El caso pasa a **Mis casos** como "En atención". En la **ventana A**: **"En llamada con un asesor"** y "Audio con el asesor: conectado" |

## 5. Hablar entre las dos pestañas (WebRTC real)

Las dos pestañas usan **el mismo micrófono**. Para que cada frase cuente como de una sola persona,
**silencia la pestaña que no está "hablando"**.

| #   | Haz esto                                                                                           | Debes ver / oír                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13  | En la ventana B pulsa **Silenciar**. Luego habla 2 s y haz silencio                                | **Te oyes a ti mismo** en los audífonos con un pequeño retraso: es la pestaña del asesor reproduciendo tu voz por **WebRTC** (de navegador a navegador, sin pasar por el servidor). En la ventana B, bajo el historial, aparece **"Cliente (en vivo) …"** palabra por palabra y luego el turno en el historial. **El asistente ya no responde** |
| 14  | En la ventana A pulsa **Silenciar**. En la B pulsa **Activar micrófono**, habla 2 s y haz silencio | Te oyes de nuevo, ahora desde la pestaña del cliente. En la ventana B aparece **"Tú (en vivo) …"** y luego el turno de **Laura** con la etiqueta **Voz** (también en el chat del cliente)                                                                                                                                                       |
| 15  | En la ventana B pulsa **Salir de la llamada**                                                      | Ventana A: "**El asesor salió de la llamada. Puedes esperar en la línea o colgar.**". Ventana B: vuelve a aparecer **Unirse a la llamada**; puedes volver a entrar                                                                                                                                                                              |
| 16  | Pulsa **Colgar** (en cualquiera de las dos)                                                        | Ambas barras dicen "**La llamada terminó.**" y desaparecen a los 4 s. En el chat queda "La llamada de voz terminó.". **El punto rojo de grabación desaparece de las pestañas**: el micrófono se apagó                                                                                                                                           |

## 6. Comprobar lo guardado (opcional)

```bat
docker exec atencion_ia_postgres psql -U postgres -d atencion_ia -c "select status, end_reason, duration_seconds, audio_storage_key from calls order by started_at desc limit 1"
docker exec atencion_ia_postgres psql -U postgres -d atencion_ia -c "select seq, speaker, left(text, 60) from call_transcript_segments where call_id = (select id from calls order by started_at desc limit 1) order by seq"
```

Esperado:

- `ended`, con su motivo y duración;
- `audio_storage_key` vacío, porque **el audio no se guarda**;
- los segmentos en orden: cliente, asistente, …, agente.

## Si algo no funciona

| Síntoma                                            | Causa probable                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| "No diste permiso para usar el micrófono…"         | Lo bloqueaste. Actívalo en el candado de la barra de direcciones → Micrófono → Permitir, y vuelve a llamar. No se creó ninguna llamada      |
| El medidor no se mueve al hablar                   | El navegador usa otro micrófono. Cámbialo en el candado → Configuración del sitio, o en la configuración de Chrome → Privacidad → Micrófono |
| "Ya hay una llamada en curso en esta conversación" | Recargaste la página durante una llamada. El servidor la corta sola en 15 s; vuelve a intentar                                              |
| "Ya atiendes 3 conversaciones, tu máximo"          | Cierra un caso en "Mis casos" o entra con otro asesor                                                                                       |
| Los turnos aparecen dos veces (cliente y asesor)   | Las dos pestañas estaban con el micrófono activo: silencia una (paso 13)                                                                    |
| "Tu micrófono se desconectó…"                      | Se desconectaron los audífonos o el sistema quitó el micrófono. Cuelga y llama de nuevo                                                     |

## Qué tan realista es esta prueba

**Es real:**

- el micrófono y su captura (AudioWorklet que convierte a 16 kHz, a tiempo real);
- el WebSocket de voz, con autenticación, estados, reconexión y cuándo el micrófono se enciende y
  se apaga;
- la reproducción del audio de respuesta;
- **el WebRTC entre las dos pestañas**: te oyes a ti mismo a través de la otra pestaña;
- el motor conversacional, el RAG, el escalamiento, la transcripción guardada y la transcripción en
  vivo en el panel.

**Es simulado:**

- **El reconocimiento (STT) reacciona al sonido, no a las palabras.** Mide la energía del audio:
  - si hablas al menos 0,3 s y haces una pausa de 0,7 s, eso es una "frase";
  - el silencio no produce nada;
  - un ruido fuerte y sostenido (teclear cerca, un ventilador) sí puede contar como frase.

  El texto de cada frase es la siguiente línea de un **guion fijo de 3 frases** que se repite,
  **sin importar lo que dijiste**. La tercera siempre escala por "posible fraude". Esas frases se
  guardan con confianza 0,5, para distinguirlas de una transcripción real.

- **La respuesta hablada son pitidos** (uno por palabra, con la duración de una frase real). El
  **texto** de la respuesta sí es real: sale del RAG y del motor.
- El guion es el mismo para el cliente y para el asesor: lo que "dice" Laura también sale del guion.

**Qué te confirma la prueba:**

- que el sistema detecta cuándo hablas y cuándo callas;
- que todo el flujo llamada → turno → respuesta → audio → escalamiento → asesor funciona en tu
  navegador;
- que el audio viaja de verdad entre las dos pestañas.

**Qué NO te confirma:** la calidad del reconocimiento, ni que el contenido de lo que dices guíe la
conversación. Para eso hace falta el proveedor real (Deepgram, ADR 0011 del backend).

## Verificación hecha antes de entregarte esta guía

Se hizo en el **entorno aislado**:

| Recurso       | Entorno aislado   |
| ------------- | ----------------- |
| Base de datos | `atencion_ia_e2e` |
| Redis         | db 1              |
| API           | puerto 4101       |
| Frontend      | puerto 5175       |

Se usó el navegador integrado con dos pestañas (cliente y asesor). Ese navegador no tiene un
micrófono utilizable, así que se usó un **micrófono sintético**: un tono que se enciende y se apaga
para simular "hablar" y "callar", entregado por `getUserMedia`. **No se usó el micrófono real del
equipo.** El resto del código es el real: AudioWorklet, WebSocket de voz y RTCPeerConnection.

**Lo que se midió:**

- **Envío de audio.**
  - Tramas de 3200 bytes a unos 32 KB/s, es decir, tiempo real a 16 kHz.
  - El primer y único mensaje JSON es `auth`, y la URL no lleva ningún token.
  - Con el cliente en silencio, se enviaron 0 tramas.
- **Frase del cliente.**
  - Mientras hablaba: "Te escuchamos", medidor en 0,21 y "Estás diciendo: …".
  - Tras la pausa: su turno y la respuesta del RAG.
  - La respuesta sonó entera: el micrófono volvió solo cuando terminó el audio.
  - "Interrumpir" cortó la respuesta.
- **Escalamiento.** A la tercera frase la llamada pasó a "Te estamos pasando con un asesor".
- **WebRTC real entre las dos pestañas.**
  - Estado `connected`, unos 50 paquetes por segundo.
  - El asesor recibe un nivel de 0,30 cuando el cliente habla y 0 cuando calla.
  - El cliente recibe 0,21 cuando habla el asesor.
- **Transcripción en vivo en el panel.** "Tú (en vivo) Hola, quisiera saber el horario…" palabra por
  palabra, y luego el turno de Laura con la etiqueta "Voz".
- **Fin de la llamada.**
  - Al colgar, las dos barras dicen "La llamada terminó.".
  - En ambas pestañas la pista del micrófono queda `ended` y WebRTC queda `closed`.
  - En la base: `customer_hangup`, 9 segmentos en orden y enlazados a sus turnos, y las **dos**
    participaciones del asesor (salió y volvió a entrar).
- **Unirse al tope de casos.** Laura estaba en su máximo de 3 casos: el servidor respondió 409, el
  panel lo explicó y **el micrófono se apagó** (pista `ended`).
- **Base de desarrollo intacta.** La suma del volcado completo de datos, quitando la línea aleatoria
  `\restrict` de `pg_dump`, es idéntica antes y después.

**Tres defectos que encontró la prueba en vivo** (ya corregidos, cada uno con su test y su
mutación):

1. Si el micrófono se desconecta a mitad de la llamada, la app seguía "en llamada" sin enviar
   nada. Ahora avisa.
2. Cuando el asesor sale de la llamada, al cliente se le decía "En llamada con el asistente
   virtual", pero la IA no responde en un caso que ya tiene asesor. Ahora dice que el asesor salió.
3. Al llamar en un caso que ya atiende un asesor, pasaba lo mismo. Ahora dice "Tu asesor puede
   unirse en cualquier momento".

**No medido:**

- con un micrófono y una voz humana reales (eso lo pruebas tú con esta guía);
- entre dos equipos distintos, que requiere HTTPS y probablemente un servidor TURN;
- en navegadores distintos de Chromium;
- la latencia.
