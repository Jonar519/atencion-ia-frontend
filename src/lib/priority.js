/**
 * Prioridad legible (Fase 7). La API guarda un número 0–100 (reglas del motor
 * de escalamiento); el panel lo muestra con una palabra JUNTO al número para
 * que no haya que saber qué significa "90". Mismos umbrales que la regla de
 * color de la cola (docs/design-system.md): ≥ 80 urgente, ≥ 50 alta.
 */
export const PRIORITY_LEVELS = [
  { min: 80, level: "high", label: "Urgente" },
  { min: 50, level: "mid", label: "Alta" },
  { min: 0, level: "low", label: "Normal" },
];

export function priorityInfo(priority) {
  const value = Number.isFinite(priority) ? Math.max(0, Math.min(100, Math.round(priority))) : 0;
  const { level, label } = PRIORITY_LEVELS.find((p) => value >= p.min);
  return { value, level, label, text: `${label} · ${value}` };
}
