import { h } from "../lib/dom.js";

/**
 * Gráfica de barras de UNA serie, en SVG construido con el DOM (sin librería
 * y sin innerHTML). Pensada para el tablero de analítica:
 *  - "column": columnas verticales (p. ej. 24 horas); "bar": barras horizontales
 *    con su etiqueta (p. ej. motivos de escalamiento).
 *  - Barras de ≤ 24 px con el extremo redondeado (4 px) y la base recta, un
 *    hueco de 2 px entre vecinas, rejilla de 1 px recesiva, un solo eje.
 *  - Una sola serie: sin leyenda (el título dice qué se grafica). El color es
 *    el token --chart-bar (≥ 3:1 sobre la superficie en ambos temas).
 *  - Cada barra se puede enfocar con el teclado (role="img" con su valor como nombre)
 *    y muestra el valor en un tooltip;
 *    además la tabla con TODOS los valores está siempre disponible ("Ver datos").
 */
const SVG = "http://www.w3.org/2000/svg";
// Marcas del eje: hasta un decimal (con tope 25, la del medio es 12,5, no "13").
const tickFormat = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs))
    if (value !== undefined && value !== null) el.setAttribute(key, String(value));
  for (const child of children)
    if (child) el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return el;
}

/** Tope "limpio" del eje: 1, 2, 2,5, 5, 10, 20, 25, 50… por encima del máximo. */
export function niceMax(max) {
  if (max <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 2.5, 5, 10].map((m) => m * exp).find((v) => v >= max);
}

/** Rectángulo con las esquinas del EXTREMO redondeadas y la base recta (path SVG). */
export function roundedEndPath(x, y, width, height, radius, orientation) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (orientation === "column") {
    // Base abajo (recta), extremo arriba (redondeado).
    return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
  }
  // Base a la izquierda (recta), extremo a la derecha (redondeado).
  return `M${x},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height - r}Q${x + width},${y + height} ${x + width - r},${y + height}H${x}Z`;
}

export function barChart({
  title,
  data,
  orientation = "column",
  unit = "",
  formatValue = (v) => String(v),
  labelEvery = 1,
}) {
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const tooltip = h("div", { class: "chart__tooltip", role: "status", hidden: true });
  const figure = h("figure", { class: ["chart", `chart--${orientation}`] });
  const caption = h("figcaption", { class: "chart__title" }, title);

  const chart =
    orientation === "column"
      ? columns(data, max, { formatValue, unit, labelEvery, show })
      : bars(data, max, { formatValue, unit, show });
  // Grupo con nombre (el título); cada barra es una imagen enfocable con su valor.
  // (Con role="img" en todo el SVG, sus hijos enfocables quedarían ocultos para los lectores de pantalla.)
  chart.setAttribute("role", "group");
  chart.setAttribute("aria-label", title);

  const table = h(
    "table",
    { class: "chart__table" },
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Categoría"), h("th", { scope: "col" }, "Valor"))),
    h(
      "tbody",
      {},
      data.map((d) => h("tr", {}, h("th", { scope: "row" }, d.label), h("td", {}, `${formatValue(d.value)}${unit}`)))
    )
  );

  figure.append(
    caption,
    h("div", { class: "chart__plot" }, chart, tooltip),
    h("details", { class: "chart__data" }, h("summary", {}, "Ver datos"), table)
  );
  return figure;

  function show(datum, anchor) {
    if (!datum) {
      tooltip.hidden = true;
      return;
    }
    tooltip.textContent = `${datum.label}: ${formatValue(datum.value)}${unit}`;
    tooltip.style.left = `${anchor.x}%`;
    tooltip.style.top = `${anchor.y}%`;
    tooltip.hidden = false;
  }
}

function bindHover(mark, hit, datum, anchor, show) {
  for (const el of [mark, hit]) {
    el.addEventListener("mouseenter", () => show(datum, anchor));
    el.addEventListener("mouseleave", () => show(null));
  }
  hit.addEventListener("focus", () => show(datum, anchor));
  hit.addEventListener("blur", () => show(null));
}

function gridAndAxis(max, width, height, pad, orientation) {
  const group = svg("g", { class: "chart__grid", "aria-hidden": "true" });
  for (const fraction of [0, 0.5, 1]) {
    const value = max * fraction;
    if (orientation === "column") {
      const y = pad.top + (1 - fraction) * (height - pad.top - pad.bottom);
      group.append(svg("line", { x1: pad.left, x2: width - pad.right, y1: y, y2: y }));
      group.append(
        svg("text", { x: pad.left - 6, y: y + 4, "text-anchor": "end", class: "chart__tick" }, tickFormat.format(value))
      );
    } else {
      const x = pad.left + fraction * (width - pad.left - pad.right);
      group.append(svg("line", { x1: x, x2: x, y1: pad.top, y2: height - pad.bottom }));
      group.append(
        svg(
          "text",
          { x, y: height - pad.bottom + 14, "text-anchor": "middle", class: "chart__tick" },
          tickFormat.format(value)
        )
      );
    }
  }
  return group;
}

function columns(data, max, { formatValue, labelEvery, show }) {
  const width = 1040;
  const height = 220;
  const pad = { top: 12, right: 8, bottom: 26, left: 32 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / data.length;
  const barW = Math.min(24, slot - 2); // hueco de al menos 2 px entre vecinas
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart__svg" });
  // Nunca más ancho que su viewBox: el texto no crece por encima de su tamaño (CSSOM, permitido por la CSP).
  root.style.maxWidth = `${width}px`;
  root.append(gridAndAxis(max, width, height, pad, "column"));
  data.forEach((datum, i) => {
    const barH = (datum.value / max) * plotH;
    const x = pad.left + i * slot + (slot - barW) / 2;
    const y = pad.top + plotH - barH;
    const mark =
      datum.value > 0 ? svg("path", { class: "chart__bar", d: roundedEndPath(x, y, barW, barH, 4, "column") }) : null;
    // Zona de interacción más grande que la barra (toda la franja).
    const hit = svg("rect", {
      class: "chart__hit",
      x: pad.left + i * slot,
      y: pad.top,
      width: slot,
      height: plotH,
      tabindex: 0,
      role: "img",
      "aria-label": `${datum.label}: ${formatValue(datum.value)}`,
    });
    if (mark) root.append(mark);
    root.append(hit);
    bindHover(mark ?? hit, hit, datum, { x: ((x + barW / 2) / width) * 100, y: (y / height) * 100 }, show);
    if (i % labelEvery === 0) {
      root.append(
        svg(
          "text",
          { x: x + barW / 2, y: height - 8, "text-anchor": "middle", class: "chart__tick" },
          datum.short ?? datum.label
        )
      );
    }
  });
  return root;
}

function bars(data, max, { formatValue, unit, show }) {
  const width = 520;
  const rowH = 30;
  const pad = { top: 6, right: 56, bottom: 20, left: 170 };
  const height = pad.top + pad.bottom + data.length * rowH;
  const plotW = width - pad.left - pad.right;
  const barH = Math.min(24, rowH - 2);
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart__svg" });
  // Nunca más ancho que su viewBox: el texto no crece por encima de su tamaño (CSSOM, permitido por la CSP).
  root.style.maxWidth = `${width}px`;
  root.append(gridAndAxis(max, width, height, pad, "bar"));
  data.forEach((datum, i) => {
    const y = pad.top + i * rowH + (rowH - barH) / 2;
    const barW = (datum.value / max) * plotW;
    const mark =
      datum.value > 0
        ? svg("path", { class: "chart__bar", d: roundedEndPath(pad.left, y, barW, barH, 4, "bar") })
        : null;
    const hit = svg("rect", {
      class: "chart__hit",
      x: 0,
      y: pad.top + i * rowH,
      width,
      height: rowH,
      tabindex: 0,
      role: "img",
      "aria-label": `${datum.label}: ${formatValue(datum.value)}${unit}`,
    });
    root.append(
      svg("text", { x: pad.left - 8, y: y + barH / 2 + 4, "text-anchor": "end", class: "chart__label" }, datum.label)
    );
    if (mark) root.append(mark);
    // Valor en la punta de la barra (texto en tinta, nunca en el color de la serie).
    root.append(
      svg(
        "text",
        { x: pad.left + barW + 6, y: y + barH / 2 + 4, class: "chart__value" },
        `${formatValue(datum.value)}${unit}`
      )
    );
    root.append(hit);
    bindHover(mark ?? hit, hit, datum, { x: ((pad.left + barW) / width) * 100, y: (y / height) * 100 }, show);
  });
  return root;
}
