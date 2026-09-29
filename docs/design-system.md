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

## Diseño adaptable

- Chat del cliente: una columna centrada (máx. 44 rem), usable en teléfono.
- Panel de agente: barra superior + cola a la izquierda + conversación. Debajo de 48 rem la cola
  pasa arriba (máx. 40 % de la altura) y la conversación debajo.

## No medido

- No se hizo auditoría con lector de pantalla real (NVDA/JAWS) ni Lighthouse.
- El contraste se calculó sobre los tokens; no se midió sobre capturas.
