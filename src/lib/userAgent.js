/**
 * Nombre legible de un dispositivo a partir del User-Agent ("Chrome en Windows").
 * Solo para mostrarlo en el panel de sesiones: es orientativo (el User-Agent lo
 * elige el navegador y se puede falsificar), nunca se usa para decidir nada.
 */
const BROWSERS = [
  [/Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];
const SYSTEMS = [
  [/Windows/, "Windows"],
  [/Android/, "Android"],
  [/iPhone|iPad|iOS/, "iOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

export function describeUserAgent(ua) {
  if (!ua) return "Dispositivo desconocido";
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (browser && system) return `${browser} en ${system}`;
  return browser ?? system ?? "Otro dispositivo";
}
