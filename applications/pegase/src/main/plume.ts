// Plume dans Pégase (pegase-plume/ d'Odin, contrat docs/plume-protocole.md) : le correcteur d'Odin pendant qu'on écrit
// dans les pages web. Le script de page (dist/preload/plume.js, monde isolé, Shadow DOM fermé) demande ici par IPC ;
// seul ce processus parle à Odin, avec le jeton du profil (ou la connexion unique) — la page ne voit jamais le jeton.
// Jamais dans une fenêtre privée (le script n'y est même pas chargé, et ce côté refuse aussi), ni sur les pages de
// l'interface d'Odin elle-même (elle a son propre Plume). Rien d'autre qu'Odin ne reçoit le texte.
import { app, ipcMain, webContents, type WebContents } from 'electron';
import type { ProfilOuvert } from './profil';
import type { Synchro } from './odin';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PLUME: { brancherPlume(o: unknown): { diffuser(etat: unknown, id?: number): void } } = require('./plume-main.cjs');

export interface HotePlume {
  profils(): Iterable<ProfilOuvert>;
  synchro(p: ProfilOuvert): Synchro | undefined;
  /** ouvre une adresse dans un nouvel onglet de la fenêtre qui montre cette page (ou d'une fenêtre du profil) */
  ouvrir(p: ProfilOuvert, wcId: number | undefined, url: string): void;
}
export interface PlumePegase {
  /** L'état de Plume pour ce profil (null : pas relié à Odin, ou fenêtre privée). */
  etat(p: ProfilOuvert): Promise<Record<string, unknown> | null>;
  /** Change un réglage de Plume (« Dans Pégase ») et prévient les pages du profil. */
  regler(p: ProfilOuvert, patch: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  /** Réglages → Plume, dans l'interface d'Odin. */
  ouvrirReglages(p: ProfilOuvert, wcId?: number): boolean;
}

const memeOrigine = (a: string, b: string) => { try { return new URL(a).origin === new URL(b).origin; } catch { return false; } };

export function brancherPlumePegase(h: HotePlume): PlumePegase {
  const profilDe = (id: number | undefined): ProfilOuvert | null => {
    if (id === undefined) return null;
    const wc = webContents.fromId(id); if (!wc || wc.isDestroyed()) return null;
    return [...h.profils()].find((p) => p.session === wc.session) ?? null;
  };
  // Les essais de Pégase (hors paquet, PEGASE_ESSAI) lisent l'état de Plume dans le monde isolé de la page.
  ipcMain.handle('pegase:plume-essai', () => !app.isPackaged && !!process.env.PEGASE_ESSAI);
  const pagesDe = (p: ProfilOuvert): WebContents[] => [...p.vivants.values()].map((v) => v.vue?.webContents).filter((w): w is WebContents => !!w && !w.isDestroyed());
  const appel = async (p: ProfilOuvert, chemin: string, corps?: unknown) => {
    const sy = h.synchro(p); if (p.prive || !sy?.lien) return { status: 0, j: {} };
    return sy.api(chemin, { ...(corps === undefined ? {} : { corps }), delai: 8000 });
  };
  const brin = PLUME.brancherPlume({
    ipcMain,
    estPage: (id: number) => {
      const p = profilDe(id); if (!p || p.prive) return false;
      const lien = h.synchro(p)?.lien, wc = webContents.fromId(id);
      // L'interface d'Odin ouverte dans Pégase a déjà son Plume (« Dans Odin et ses applis ») : pas deux fois.
      return !(lien && wc && memeOrigine(wc.getURL(), lien.adresse));
    },
    appelOdin: (chemin: string, corps: unknown, id: number) => { const p = profilDe(id); return p ? appel(p, chemin, corps) : Promise.resolve({ status: 0, j: {} }); },
    ouvrirReglages: (id: number) => { const p = profilDe(id); if (p) ouvrirReglages(p, id); },
    groupe: (id: number) => profilDe(id)?.id ?? '',
    pages: (id: number) => { const p = profilDe(id); return p ? pagesDe(p) : []; },
  });
  const ouvrirReglages = (p: ProfilOuvert, wcId?: number): boolean => {
    const l = h.synchro(p)?.lien; if (p.prive || !l) return false;
    h.ouvrir(p, wcId, `${l.adresse.replace(/\/+$/, '')}/#plume`); return true;
  };
  return {
    async etat(p) {
      const r = await appel(p, '/api/plume/etat').catch(() => ({ status: 0, j: {} }));
      return r.status === 200 ? r.j : null;
    },
    async regler(p, patch) {
      const r = await appel(p, '/api/plume/reglages', patch).catch(() => ({ status: 0, j: {} }));
      if (r.status !== 200) return null;
      const une = pagesDe(p)[0]; if (une) brin.diffuser(r.j, une.id); else for (const wc of pagesDe(p)) wc.send('pegase:plume-etat', r.j);
      return r.j;
    },
    ouvrirReglages,
  };
}
