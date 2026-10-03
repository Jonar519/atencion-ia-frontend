# Sistema de diseño

Tokens en `src/styles/tokens.css`; componentes en `base.css`, `chat.css` y `panel.css`.
Todo el CSS usa los tokens: no hay colores sueltos salvo el blanco sobre fondos oscuros.

## Identidad

- **Paleta**: la misma "navy + ámbar" del Proyecto 1, para que los proyectos de la materia se
  reconozcan como una misma marca.
- **Lenguaje visual propio de este proyecto**: superficies **planas** separadas por líneas finas
  (sin tarjetas con sombra), y una **regla de color a la izquierda** (`--rule`, 3 px) como único
  acento. Esa regla siempre significa algo:

| Dónde                          | Color de la regla       | Significado                                    |
| ------------------------------ | ----------------------- | ---------------------------------------------- |
| Mensaje del cliente            | `navy-700`              | Lo escribió el cliente                         |
| Mensaje del asesor             | `amber-600`             | Lo escribió una persona del banco              |
| Mensaje de la IA               | `ink-500`               | Respuesta automática                           |
| Mensaje que no se pudo enviar  | `red-700`               | Error (con texto "No se envió" y "Reintentar") |
| Caso en la cola, prioridad ≥80 | `--urgency-high` (rojo) | Urgente (p. ej. posible fraude)                |
| Caso en la cola, prioridad ≥50 | `--urgency-mid` (ámbar) | Requiere atención                              |
| Caso en la cola, resto         | `--urgency-low` (azul)  | Normal                                         |
| Aviso local de urgencia        | ámbar / rojo            | Lo que detectó el Web Worker al escribir       |

- **Tipografía**: Source Serif 4 (600) para títulos, Inter Variable para todo lo demás. Ambas se
  empaquetan con la app (`@fontsource`), sin pedir nada a Google Fonts: la CSP es `'self'`.
- **Escala**: tipográfica de 0.75 a 1.75 rem (`--fs-*`); espaciado de 0.25 a 2 rem (`--space-*`);
  un único radio (`--radius`, 6 px).

## Accesibilidad

- **Contraste medido** (fórmula de WCAG sobre los 20 pares texto/fondo que usa el CSS): todos
  ≥ 4.5:1 (AA). El peor es `ink-500` sobre `navy-100`, 5.07:1. Los valores están en el comentario
  de `tokens.css`.
- **El color nunca es la única pista**: cada regla de color va con texto (autor del mensaje,
  etiqueta del motivo de escalamiento, "No se envió", estado de la conexión).
- Foco visible en todo (`:focus-visible`, 3 px), enlace "saltar al contenido", la lista de
  mensajes es `aria-live="polite"`, los campos tienen `label` (visible o `sr-only`).
- `[hidden]` gana siempre (`display: none !important`): se agregó tras la prueba en vivo, donde
  `.chat { display: grid }` dejaba ver un chat que debía estar oculto.

## Bordes de los campos (Fase 7, WCAG 1.4.11)

`--color-border-strong` delimita campos de texto, selects, el área de escritura del chat y los
botones secundarios: es la única pista de dónde está el campo, así que debe llegar a 3:1 contra
cada fondo donde se apoya. Antes medía 1.65:1 (claro) y 2.51:1 (oscuro). Ahora, medido:

| Tema   | Valor     | sobre surface | sobre bg | sobre sunken |
| ------ | --------- | ------------- | -------- | ------------ |
| Claro  | `#78839a` | 3.81:1        | 3.52:1   | 3.30:1       |
| Oscuro | `#6f84a3` | 4.28:1        | 4.79:1   | 3.78:1       |

Es un gris neutro (no parte de la paleta navy/ámbar, que no cambió). Los separadores decorativos
(`--color-border`) no transmiten información y siguen claros a propósito.

## Tema oscuro (Fase 7)

- Preferencia del perfil del staff: "Como el sistema", "Claro" u "Oscuro" (`src/theme.js` pone
  `data-theme` en `<html>`; "sistema" sigue a `prefers-color-scheme` en vivo). El widget del
  cliente y el login siguen en el tema claro.
- Un solo bloque `:root[data-theme="dark"]` en `tokens.css` que redefine **todos** los colores (un
  test lo exige). Misma identidad navy + ámbar: fondos navy muy oscuros y los tonos de texto
  `-700/-800` aclarados. La paleta clara no cambió.
- Las superficies "fuertes" (barra superior, avisos, botón principal y de peligro) tienen tokens
  propios (`--color-chrome`, `--color-primary`, `--color-danger`…) porque NO se invierten.
- **Contraste medido** por `tests/contrast.test.js` con la fórmula de WCAG sobre los valores reales
  del archivo, en ambos temas: 30 pares de texto (≥ 4.5:1), 9 pares gráficos y el foco (≥ 3:1).
  Peor par de texto: claro `amber-800`/`navy-100` 4.85:1; oscuro blanco/`primary-hover` 5.43:1.
- El QR de la verificación en dos pasos se muestra siempre sobre blanco (los lectores de QR lo
  necesitan), también en el tema oscuro.

## Llamadas "en vivo" (Fase 7, D1)

La paleta base navy + ámbar no cambia. Se agrega un **acento en vivo solo para componentes de
llamada** (`styles/voice.css`; un test falla si otro archivo usa sus tokens):

| Token                | Color           | Significa        |
| -------------------- | --------------- | ---------------- |
| `--color-live-call`  | cian `#00c2d1`  | Llamada en curso |
| `--color-live-agent` | menta `#00b37e` | Asesor conectado |

**Por qué la barra de la llamada es oscura:** sobre blanco el acento NO alcanza ni 3:1 (cian
2,18:1; menta 2,71:1, medidos), así que no sirve como borde ni como texto en una barra clara. La
barra usa su propia superficie oscura (`--color-live-surface`), donde sí cumple:

| Par                                                 | Tema claro   | Tema oscuro   |
| --------------------------------------------------- | ------------ | ------------- |
| Cian / menta sobre la superficie en vivo            | 7,22 / 5,80  | 8,86 / 7,13   |
| Texto navy `#0b1626` sobre relleno cian / menta     | 8,33 / 6,70  | igual         |
| Texto blanco / atenuado sobre la superficie en vivo | 15,72 / 9,86 | 19,32 / 12,12 |

La insignia dice **"Llamada en curso"** o **"Asesor conectado"**: el color nunca va solo.

- **Forma de onda** (`components/waveform.js`): canvas 2D con el MISMO nivel de energía del medidor
  (no se mide nada nuevo); dibuja como mucho una vez por cuadro y nada con la pestaña oculta. Con
  `prefers-reduced-motion`, una sola barra con el nivel actual (sin historial que se desplaza). El
  `<meter>` sigue para lectores de pantalla.
- **La ÚNICA animación del sistema:** cuando una conversación pasa de la IA a un asesor durante la
  llamada, el menta llena el borde de la barra de izquierda a derecha (1,4 s, una vez por
  llamada) y el borde queda menta al terminar. Con `prefers-reduced-motion` el color cambia al
  instante, sin animación. Un test exige que haya **un solo `@keyframes`** en todo el CSS (los
  esqueletos de carga del bloque A dejaron de "brillar" por esta regla).
- **Ánimo del cliente en vivo** (`components/sentimentBadge.js`, panel): el análisis del último
  mensaje del cliente que ya llega por el WebSocket, con texto ("Ánimo del cliente: Muy molesto
  (empeoró)"), colores ya medidos y sin animación. No usa el acento en vivo (no es un componente
  de llamada).

## Estados de carga, error y vacío (Fase 7, D2)

Los mismos tres estados en todas las pantallas (`components/states.js`):

- **Cargando:** esqueleto ESTÁTICO (sin brillo: la única animación es la de la llamada) con
  `role="status"` y un texto oculto para lectores de pantalla ("Cargando los casos…"). Los
  rectángulos grises son `aria-hidden`.
- **Error:** qué pasó + **Reintentar** (`role="alert"`). Reintentar vuelve a pedir SOLO esa zona,
  nunca recarga la página: no se pierde lo escrito ni una llamada en curso. El botón se deshabilita
  al primer clic (un clic = un reintento). Si una lista que ya se veía falla al ACTUALIZARSE, se
  sigue mostrando y arriba aparece el aviso con Reintentar.
- **Vacío:** qué significa y qué hacer. Cola: cuándo llegan casos. Mis casos: botón "Ver la cola".
  Chat nuevo: tres preguntas de ejemplo que se ESCRIBEN en el campo (no se envían solas).

En el panel, cargando/error/vacío van en un contenedor aparte de la lista de casos: un
`role="listbox"` solo puede contener opciones (axe lo marcó en la prueba en vivo; antes de D2 el
vacío ya estaba dentro de la lista).

**Aviso de conectividad** (`components/connectivity.js`): UN solo aviso arriba al centro (abajo tapaba
el campo de escritura), nunca una pila de toasts, `role="status"`, sin animación:

| Estado       | Cuándo                                              | Texto (resumen)                                         |
| ------------ | --------------------------------------------------- | ------------------------------------------------------- |
| Sin internet | evento `offline` del navegador (tiene prioridad)    | si un mensaje no sale, queda marcado para reintentarlo  |
| Reconectando | el WebSocket lleva más de 2 s reconectando          | tus mensajes no se pierden (al volver se re-sincroniza) |
| Restablecida | al volver de cualquiera de los dos; se va a los 3 s | "Conexión restablecida."                                |

Un corte de menos de 2 s (p. ej. el servidor se reinicia) no muestra nada. El aviso no promete
reenvío automático porque no existe: un mensaje que no salió muestra "No se envió." + Reintentar.

**Foco del `<h1>`:** al cambiar de pantalla el router enfoca el `<h1>` (lectores de pantalla), que
tiene `tabindex="-1"`. Ya no muestra recuadro: `[tabindex="-1"]:focus { outline: none }`. Solo lo usan
ese `<h1>` y los selectores de archivo ocultos; nada que se alcance con Tab pierde su recuadro.

## Diseño adaptable

- Chat del cliente: una columna centrada (máx. 44 rem), usable en teléfono.
- Panel de agente: barra superior + cola a la izquierda + conversación. Debajo de 48 rem la cola
  pasa arriba (máx. 40 % de la altura) y la conversación debajo.

## No medido

- No se hizo auditoría con lector de pantalla real (NVDA/JAWS) ni Lighthouse.
- El contraste se calculó sobre los tokens; no se midió sobre capturas.
