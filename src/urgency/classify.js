/**
 * Clasificación LOCAL y ligera de urgencia, mientras el cliente escribe
 * (corre en un Web Worker: src/workers/urgency.worker.js).
 *
 * Solo sirve para dar feedback inmediato ("esto se ve urgente, te conectamos
 * más rápido"). NO decide nada: el servidor clasifica cada turno por su cuenta
 * (con la IA) y aplica sus reglas de escalamiento. Un cliente que manipule
 * este código solo cambia lo que VE, no cómo lo atienden.
 */

const normalize = (text) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const RULES = [
  {
    level: "urgente",
    reason: "posible_fraude",
    patterns: [
      /no (lo |la )?(reconozco|hice|realice|autorice)/,
      /(cobro|cargo|compra|transaccion|retiro)s? (que )?(yo )?no/,
      /fraude|estafa|robaron|robo|clonaron|clonada|hackearon|suplantaron/,
      /(me|le) pidieron (la |mi )?(clave|contrasena|codigo)/,
    ],
    message: "Esto se ve urgente: si hay un cargo que no reconoces, te conectamos más rápido con un asesor.",
  },
  {
    level: "urgente",
    reason: "pide_asesor",
    patterns: [/\b(asesor|humano|persona|agente|operador)\b/, /hablar con (alguien|una persona)/],
    message: "Te comunicaremos con un asesor de nuestro equipo.",
  },
  {
    level: "atencion",
    reason: "cliente_molesto",
    patterns: [/\b(inaceptable|pesimo|pesima|ladrones|harto|harta|ridiculo|terrible)\b/],
    message: "Lamentamos la situación. Si lo necesitas, un asesor revisará tu caso.",
  },
];

/**
 * @param {string} text
 * @returns {{ level: "urgente" | "atencion" | "normal", reason: string | null, message: string | null }}
 */
export function classifyUrgency(text) {
  const normalized = normalize(text ?? "");
  if (normalized.length < 4) return { level: "normal", reason: null, message: null };
  const shouting = /!{2,}/.test(text) || (text.match(/\b[A-ZÁÉÍÓÚÑ]{4,}\b/g)?.length ?? 0) >= 2;
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return { level: rule.level, reason: rule.reason, message: rule.message };
    }
  }
  if (shouting) {
    return {
      level: "atencion",
      reason: "cliente_molesto",
      message: "Lamentamos la situación. Si lo necesitas, un asesor revisará tu caso.",
    };
  }
  return { level: "normal", reason: null, message: null };
}
