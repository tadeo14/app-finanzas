import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { backupFileName, exportBackup } from '../db/backup';
import { downloadFile } from '../db/files';
import { db } from '../db/schema';

const shell = 'mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 py-10';
const primary = 'w-full rounded-xl bg-brand py-3.5 text-base font-semibold text-white active:bg-brand-hover';
const secondary = 'w-full rounded-xl border border-slate-700 py-3 text-sm font-medium text-slate-200 active:bg-slate-800';

/** Exporta lo que haya en la base sin pasar por la interfaz (que es justo lo que falló). */
function ExportButton() {
  const [message, setMessage] = useState<string>();
  async function handleExport() {
    try {
      downloadFile(backupFileName(), 'application/json', JSON.stringify(await exportBackup(db)));
      setMessage('Backup exportado. Guardalo antes de seguir.');
    } catch {
      setMessage('No se pudo exportar desde acá.');
    }
  }
  return (
    <>
      <button type="button" onClick={() => void handleExport()} className={secondary}>Exportar un backup de mis datos</button>
      {message && <p role="status" className="text-sm text-slate-400">{message}</p>}
    </>
  );
}

/** Si algo falla al dibujar una pantalla, en vez de quedar en blanco se ofrece recargar y salvar los datos. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error de la interfaz', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className={shell}>
        <h1 className="text-2xl font-semibold">Algo salió mal</h1>
        <p className="text-slate-400">
          La pantalla no se pudo mostrar. Tus datos siguen guardados en este dispositivo. Probá recargar; si el problema
          se repite, exportá un backup antes de seguir.
        </p>
        <button type="button" onClick={() => window.location.assign('/')} className={primary}>Volver al inicio</button>
        <ExportButton />
      </div>
    );
  }
}

/** La base local no se pudo abrir: navegación privada, almacenamiento bloqueado o una versión más nueva de la app. */
export function StorageProblem({ error }: { error: unknown }) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return (
    <div role="alert" className={shell}>
      <h1 className="text-2xl font-semibold">No se pueden guardar datos</h1>
      <p className="text-slate-400">
        Esta app guarda todo en el almacenamiento de tu navegador y no pudo abrirlo. Suele pasar en pestañas de
        navegación privada, con el almacenamiento bloqueado o sin espacio. Probá abrirla en una pestaña normal.
      </p>
      <button type="button" onClick={() => window.location.reload()} className={primary}>Reintentar</button>
      <p className="break-words text-xs text-slate-500">{detail}</p>
    </div>
  );
}
