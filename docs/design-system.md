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

## Tema claro y oscuro: lo decide el sistema operativo

- **Una sola regla, sin excepciones:** TODA la aplicación (portada, widget del cliente, login,
  recuperación, "Completa tu cuenta", panel, perfil y administración) sigue el tema del sistema
  operativo del dispositivo (`prefers-color-scheme`), para todos los roles. **No hay ningún control
  para elegirlo** ni preferencia guardada: la columna `theme` del perfil se eliminó (migración 019).
- **Solo CSS:** los colores oscuros viven en `@media (prefers-color-scheme: dark) { :root { … } }`
  en `tokens.css`, y `<meta name="color-scheme" content="light dark">` hace que los controles
  nativos también sigan al sistema. Si el sistema cambia con la app abierta (p. ej. el modo oscuro
  de Windows), el navegador vuelve a evaluar la regla y la app cambia **al instante, sin recargar ni
  JavaScript**, y sin parpadeo al cargar (el tema se conoce antes del primer pintado).
- **Ninguna pantalla puede salirse:** solo `tokens.css` define colores o fija el esquema (un test
  lo exige, junto con que no exista `data-theme` ni JavaScript que decida el tema). El E2E
  `e2e/system-theme.spec.js` recorre las 13 pantallas en claro y en oscuro con Chrome (fondo y axe
  en cada una) y comprueba el cambio en vivo.
- (Historia: en el bloque A el tema era una preferencia del perfil, y en el F1 las páginas públicas
  quedaban fijas en claro. Ambos modelos se reemplazaron por esta regla.)
- El bloque oscuro redefine **todos** los colores (un test lo exige). Misma identidad navy + ámbar: fondos navy muy oscuros y los tonos de texto
  `-700/-800` aclarados. La paleta clara no cambió.
- Las superficies "fuertes" (barra superior, avisos, botón principal y de peligro) tienen tokens
  propios (`--color-chrome`, `--color-primary`, `--color-danger`…) porque NO se invierten.
- **Contraste medido** por `tests/contrast.test.js` con la fórmula de WCAG sobre los valores reales
  del archivo, en ambos temas: 30 pares de texto (≥ 4.5:1), 9 pares gráficos y el foco (≥ 3:1).
  Peor par de texto: claro `amber-800`/`navy-100` 4.85:1; oscuro blanco/`primary-hover` 5.43:1.
- El QR de la verificación en dos pasos se muestra siempre sobre blanco (los lectores de QR lo
  necesitan), también en el tema oscuro.
- Los avisos flotantes (`.toast`, conectividad) llevan un borde fino `--color-border`: en oscuro
  su fondo `chrome` casi coincide con el de la página y no se separaban de lo que tapan.

## Portada (F4), en los dos temas

Un solo momento destacado (fragmento de conversación con la regla de color real: navy = cliente,
gris = asistente, ámbar = persona del banco), el cliente como acción principal y una sola
micro-interacción instantánea (la regla se ensancha y la acción se subraya). Los dos pares sobre el
bloque principal tienen tokens propios porque en oscuro el ámbar de siempre no alcanza:

| Par (medido en `tests/contrast.test.js`)               | Claro        | Oscuro       | Mínimo |
| ------------------------------------------------------ | ------------ | ------------ | ------ |
| Texto blanco sobre el bloque del cliente (`primary`)   | 11,53:1      | 6,97:1       | 4,5    |
| "Escribir al banco →" al enfocar (`on-primary-accent`) | 10,49:1      | 4,75:1       | 4,5    |
| Regla del bloque del cliente (`primary-rule`)          | 3,13:1       | 4,39:1       | 3      |
| Título y marca (`navy-900` / `bg`)                     | 14,51:1      | 15,48:1      | 4,5    |
| Textos secundarios y pie de figura (`ink-500` / `bg`)  | 5,52:1       | 8,49:1       | 4,5    |
| Enlace del staff (`navy-500` / `bg`)                   | 6,43:1       | 8,62:1       | 4,5    |
| Mensajes: texto y etiquetas sobre sus fondos           | 5,07–13,40:1 | 5,92–15,39:1 | 4,5    |
| Reglas de los mensajes y del enlace del staff          | 3,40–11,53:1 | 7,31–8,98:1  | 3      |

`primary-rule` en claro es el ámbar `#b9770e` y en oscuro `#f3c774`; `on-primary-accent` en claro
`#fcf3e7` y en oscuro `#f6d08a` (el único tono nuevo de la paleta: ningún ámbar existente llegaba a
4,5:1 sobre el `primary` oscuro). El par más justo es la regla en claro (3,13:1): el test falla si
cualquiera de los dos colores se oscurece.

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

## Menú de usuario, avisos e invitación (bloque F)

- **Menú de usuario** (`components/userMenu.js`), el mismo en el panel, la administración y "Mi
  perfil": la foto y el nombre son un botón visible (borde `on-chrome-muted` sobre la barra) que
  despliega rol, correo, **Mi perfil** y **Salir**. Patrón "botón que despliega" (`aria-expanded`),
  no `role=menu`: al abrir el foco va a "Mi perfil", Escape cierra y devuelve el foco, un clic fuera
  o salir con Tab también cierran. Sin animación.
- **Avisos flotantes** (`.toasts` y conectividad): `pointer-events: none`. Tapan unos segundos pero
  nunca bloquean el clic del botón que cubren; no contienen nada clicable (un test lo vigila).
- **"Completa tu cuenta"** (invitación) usa los mismos estilos del login y la recuperación; la
  activación de la verificación en dos pasos es un único componente (`components/mfaEnrollment.js`)
  que comparten el login y la invitación.
- **Login:** "¿Olvidaste tu contraseña?" va centrado justo debajo de "Entrar".

## Diseño adaptable

- Chat del cliente: una columna centrada (máx. 44 rem), usable en teléfono.
- Panel de agente: barra superior + cola a la izquierda + conversación. Debajo de 48 rem la cola
  pasa arriba (máx. 40 % de la altura) y la conversación debajo.

## No medido

- No se hizo auditoría con lector de pantalla real (NVDA/JAWS) ni Lighthouse.
- El contraste se calculó sobre los tokens; no se midió sobre capturas.
