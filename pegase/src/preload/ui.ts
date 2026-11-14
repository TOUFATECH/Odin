// Preload de l'interface de Pégase (vue isolée, sandbox, sans Node) : n'expose qu'une petite API.
// Les pages web, elles, n'ont aucun preload de Pégase : elles ne voient jamais cette API.
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  etat: () => ipcRenderer.invoke('pegase:etat'),
  surEtat: (f: (e: unknown) => void) => { ipcRenderer.on('pegase:etat', (_e, etat) => f(etat)); },
  surCommande: (f: (c: string, arg?: unknown) => void) => { ipcRenderer.on('pegase:commande', (_e, c, arg) => f(c, arg)); },
  faire: (action: string, arg?: unknown) => ipcRenderer.invoke('pegase:faire', String(action), arg),
  zones: (z: unknown, couche: boolean) => ipcRenderer.send('pegase:zones', z, !!couche),
};
contextBridge.exposeInMainWorld('pegase', api);
