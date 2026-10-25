// Descarga y lectura de archivos en el navegador.

export function downloadFile(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // se libera después del click para no cortar la descarga
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}
