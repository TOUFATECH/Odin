// Types de plume-main.cjs (pour les essais d'Odin et l'agent Pégase).
export interface DepsPlume {
  ipcMain: { handle(canal: string, f: (e: any, d: any) => unknown): void; on(canal: string, f: (e: any, d: any) => unknown): void };
  appelOdin(chemin: string, corps?: unknown, webContentsId?: number): Promise<{ status: number; j: any }>;
  estPage(webContentsId: number): boolean;
  ouvrirReglages(webContentsId?: number): void;
  groupe?(webContentsId: number): string;
  pages(webContentsId?: number): Iterable<{ isDestroyed(): boolean; send(canal: string, ...args: unknown[]): void }>;
}
export function brancherPlume(o: DepsPlume): { diffuser(etat: unknown, webContentsId?: number): void; nettoyer(chemin: string, corps: unknown): unknown };
export function nettoyer(chemin: string, corps: unknown): unknown;
