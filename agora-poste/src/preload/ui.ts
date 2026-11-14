// Preload de la fenêtre d'Agora (vue isolée, sandbox, sans Node) : n'expose qu'une petite API.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('agora', {
  etat: () => ipcRenderer.invoke('agora:etat'),
  surEtat: (f: (e: unknown) => void) => { ipcRenderer.on('agora:etat', (_e, etat) => f(etat)); },
  faire: (action: string, arg?: Record<string, unknown>) => ipcRenderer.invoke('agora:faire', String(action), arg ?? {}),
});
