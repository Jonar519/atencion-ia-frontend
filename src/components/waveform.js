import { h } from "../lib/dom.js";

/**
 * Forma de onda de la llamada en un CANVAS 2D (Fase 7, D1). No mide nada
 * nuevo: dibuja el MISMO nivel de energía (RMS) que el micrófono ya reporta
 * para el medidor (capture.worklet → onLevel → callBar.setLevel).
 *
 *  - Guarda los últimos `samples` niveles y los dibuja como barras simétricas
 *    (la más reciente a la derecha): se "ve" la voz entrando.
 *  - Dibuja solo cuando llega un nivel nuevo, a lo sumo una vez por cuadro
 *    (requestAnimationFrame), y NADA mientras la pestaña está oculta.
 *  - prefers-reduced-motion: sin historial que se desplaza; una sola barra
 *    horizontal con el nivel actual (la información sigue, el movimiento no).
 *  - Es decorativa para lectores de pantalla (aria-hidden): la información
 *    accesible es el <meter> y el texto "Te escuchamos" de la barra.
 */
export const LEVEL_MAX = 0.3; // mismo tope que el <meter> de la barra
const MIN_BAR = 2;

/** Alto (px) de cada barra para una lista de niveles: proporcional, con un mínimo visible. */
export function barHeights(levels, height, max = LEVEL_MAX) {
  return levels.map((level) => Math.max(MIN_BAR, Math.round((Math.min(Math.max(level, 0), max) / max) * height)));
}

export function createWaveform({ samples = 48, width = 240, height = 36, win = globalThis.window } = {}) {
  const levels = new Array(samples).fill(0);
  let muted = false;
  let frame = null;
  let stopped = false;
  const ratio = Math.max(1, Math.round(win?.devicePixelRatio ?? 1));
  const canvas = h("canvas", {
    class: "waveform",
    width: width * ratio,
    height: height * ratio,
    "aria-hidden": "true",
  });
  const ctx = canvas.getContext?.("2d") ?? null; // jsdom no tiene canvas: se sigue sin dibujar
  const reducedMotion = () => win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  function color(name) {
    return win?.getComputedStyle?.(canvas).getPropertyValue(name).trim() || "#00c2d1";
  }

  function draw() {
    frame = null;
    if (!ctx || stopped || win?.document?.hidden) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = muted ? color("--color-on-live-surface-muted") : color("--color-live-call");
    ctx.globalAlpha = muted ? 0.45 : 1;
    if (reducedMotion()) {
      const [current] = barHeights([levels[levels.length - 1]], width);
      ctx.fillRect(0, (height - 6) / 2, current, 6);
      return;
    }
    const step = width / samples;
    const barWidth = Math.max(1, step - 2); // 2 px de aire entre barras
    barHeights(levels, height).forEach((barHeight, i) => {
      ctx.fillRect(i * step, (height - barHeight) / 2, barWidth, barHeight);
    });
  }

  function schedule() {
    if (frame === null && !stopped) frame = (win?.requestAnimationFrame ?? ((fn) => setTimeout(fn, 16)))(draw);
  }

  return {
    el: canvas,
    push(level) {
      if (stopped) return;
      levels.shift();
      levels.push(muted ? 0 : level);
      schedule();
    },
    setMuted(value) {
      muted = value;
      schedule();
    },
    /** Solo tests: los niveles que se dibujarían. */
    levels: () => [...levels],
    stop() {
      stopped = true;
      if (frame !== null) (win?.cancelAnimationFrame ?? clearTimeout)(frame);
      levels.fill(0);
      frame = null;
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
