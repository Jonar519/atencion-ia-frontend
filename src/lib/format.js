const timeFormat = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" });

/** "10:32 a. m." si es de hoy; "28 sept" si es de otro día. */
export function shortTime(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toDateString() === now.toDateString() ? timeFormat.format(date) : dateFormat.format(date);
}

/** "hace 3 min" para la cola (cuánto lleva esperando un cliente). */
export function waitingFor(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `hace ${hours} h` : `hace ${Math.floor(hours / 24)} d`;
}

const dateTimeFormat = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });

/** "30 sept 2026, 10:32 a. m." (panel de sesiones). */
export function formatDateTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : dateTimeFormat.format(date);
}
