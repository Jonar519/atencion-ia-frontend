/** Descarga un contenido generado en el navegador (sin pasar por el servidor). */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Se libera después: algunos navegadores leen el URL de forma asíncrona.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(filename, text, type = "text/plain;charset=utf-8") {
  downloadBlob(filename, new Blob([text], { type }));
}
