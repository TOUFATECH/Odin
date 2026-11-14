// Les mots de passe de Pégase : sur ce PC seulement (jamais synchronisés), chaque mot de passe chiffré à part
// (AES-256-GCM, clé gardée par le système avec safeStorage), le tout dans un fichier chiffré du profil.
// Jamais envoyés à l'interface sauf « Afficher 30 s » après avoir retapé le mot de passe d'Odin.
// Remplissage seulement au clic réel sur la clé, sur l'origine EXACTE de la page principale (jamais un cadre d'un
// autre site, jamais un site sosie : la comparaison est faite sur l'origine, pas sur un nom qui « ressemble »).
import { ipcMain, clipboard, type IpcMainEvent, type IpcMainInvokeEvent, type WebFrameMain } from 'electron';
import { randomInt, createHash } from 'node:crypto';
import { join } from 'node:path';
import { FichierChiffre, cleDuProfil, chiffrer, dechiffrer } from './stockage';
import { gestes } from './securite';
import { nouvelId } from './outils';
import type { ProfilOuvert } from './profil';

export interface EntreeMdp { id: string; origine: string; identifiant: string; secret: string; cree: number; maj: number; utilise?: number }
interface Donnees { entrees: EntreeMdp[]; jamais: string[] }

/** Une proposition « Enregistrer le mot de passe ? » en attente (le mot de passe reste dans le processus principal). */
export interface Proposition { origine: string; identifiant: string; motdepasse: string; quand: number; maj?: string }

const COURANTS = new Set(['123456', '123456789', 'azerty', 'azertyuiop', 'motdepasse', 'password', 'qwerty', '12345678', '111111', '000000', 'soleil', 'bonjour', '1234567890', 'iloveyou', 'admin', 'marseille', 'doudou', 'loulou', 'chouchou']);

export function solidite(m: string): 'faible' | 'moyen' | 'fort' {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].filter((r) => r.test(m)).length;
  if (m.length < 10 || COURANTS.has(m.toLowerCase()) || classes < 2 || /^(.)\1+$/.test(m)) return 'faible';
  if (m.length >= 14 && classes >= 3) return 'fort';
  return m.length >= 12 ? 'fort' : 'moyen';
}

/** Un mot de passe fort (20 caractères, sans caractères qui se confondent). */
export function generer(n = 20): string {
  const g = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '-_.!?@#%+='];
  const tous = g.join('');
  for (;;) {
    const s = Array.from({ length: n }, () => tous[randomInt(tous.length)]).join('');
    if (g.every((x) => [...s].some((c) => x.includes(c)))) return s;
  }
}

export class MotsDePasse {
  private f: FichierChiffre<Donnees>;
  private cle: Buffer;
  proposition: Proposition | null = null;
  private deverrouille = 0;
  constructor(readonly p: ProfilOuvert) {
    this.cle = cleDuProfil(join(p.opts.dossier, 'mdp')).cle; // une clé à part, gardée par le système
    this.f = new FichierChiffre<Donnees>(join(p.opts.dossier, 'motsdepasse.json.pgs'), p.base.cle, { entrees: [], jamais: [] });
  }
  private ouvrir(e: EntreeMdp): string { return dechiffrer(this.cle, Buffer.from(e.secret, 'base64')).toString('utf8'); }
  private fermer(m: string): string { return chiffrer(this.cle, Buffer.from(m, 'utf8')).toString('base64'); }

  pour(origine: string): EntreeMdp[] { return this.f.valeur.entrees.filter((e) => e.origine === origine); }

  /** La liste pour l'interface : jamais le mot de passe, seulement sa solidité et s'il est réutilisé. */
  liste(): { entrees: any[]; bilan: { n: number; reutilises: number; faibles: number }; jamais: string[] } {
    const emp = new Map<string, number>();
    const infos = this.f.valeur.entrees.map((e) => { const m = this.ouvrir(e); const h = createHash('sha256').update(m).digest('hex'); emp.set(h, (emp.get(h) ?? 0) + 1); return { e, h, s: solidite(m), l: m.length }; });
    const entrees = infos.map(({ e, h, s, l }) => ({ id: e.id, origine: e.origine, site: (() => { try { return new URL(e.origine).host; } catch { return e.origine; } })(), identifiant: e.identifiant, solidite: emp.get(h)! > 1 ? 'reutilise' : s, autres: emp.get(h)! - 1, longueur: l, maj: e.maj }))
      .sort((a, b) => a.site.localeCompare(b.site));
    return { entrees, bilan: { n: entrees.length, reutilises: entrees.filter((x) => x.solidite === 'reutilise').length, faibles: entrees.filter((x) => x.solidite === 'faible').length }, jamais: this.f.valeur.jamais };
  }

  enregistrer(origine: string, identifiant: string, motdepasse: string): void {
    const l = this.f.valeur.entrees;
    const deja = l.find((e) => e.origine === origine && e.identifiant === identifiant);
    if (deja) { deja.secret = this.fermer(motdepasse); deja.maj = Date.now(); }
    else l.push({ id: nouvelId('m'), origine, identifiant, secret: this.fermer(motdepasse), cree: Date.now(), maj: Date.now() });
    this.f.sauver(true);
  }
  supprimer(id: string): void { this.f.valeur.entrees = this.f.valeur.entrees.filter((e) => e.id !== id); this.f.sauver(true); }
  jamaisPour(origine: string): void { if (!this.f.valeur.jamais.includes(origine)) this.f.valeur.jamais.push(origine); this.f.sauver(true); }
  plusJamais(origine: string): void { this.f.valeur.jamais = this.f.valeur.jamais.filter((x) => x !== origine); this.f.sauver(true); }

  /** Faut-il proposer d'enregistrer ce qui vient d'être tapé ? */
  proposer(origine: string, identifiant: string, motdepasse: string): boolean {
    if (!motdepasse || this.f.valeur.jamais.includes(origine)) return false;
    const deja = this.pour(origine).find((e) => e.identifiant === identifiant);
    if (deja && this.ouvrir(deja) === motdepasse) { deja.utilise = Date.now(); this.f.sauver(); return false; }
    this.proposition = { origine, identifiant, motdepasse, quand: Date.now(), ...(deja ? { maj: deja.id } : {}) };
    return true;
  }

  /** Afficher ou copier : seulement pendant 30 s après avoir retapé le mot de passe d'Odin. */
  deverrouiller(): void { this.deverrouille = Date.now() + 30_000; }
  ouvert(): boolean { return Date.now() < this.deverrouille; }
  reveler(id: string): string | null { if (!this.ouvert()) return null; const e = this.f.valeur.entrees.find((x) => x.id === id); return e ? this.ouvrir(e) : null; }
  remplir(id: string, origine: string): { identifiant: string; motdepasse: string } | null {
    const e = this.f.valeur.entrees.find((x) => x.id === id && x.origine === origine); if (!e) return null;
    e.utilise = Date.now(); this.f.sauver();
    return { identifiant: e.identifiant, motdepasse: this.ouvrir(e) };
  }
}

// ————— Les messages du monde isolé des pages (preload/page.ts) —————
type Trouver = (wcId: number) => { p: ProfilOuvert; m: MotsDePasse; avertir: () => void; gerer: () => void } | null;

/** L'origine d'un cadre, seulement si c'est la page principale (ou un cadre de la MÊME origine qu'elle). */
export function origineSure(f: WebFrameMain | null | undefined): string | null {
  if (!f || !f.top) return null;
  let o: string, t: string;
  try { o = new URL(f.url).origin; t = new URL(f.top.url).origin; } catch { return null; }
  if (!/^https?:/.test(o) || o !== t) return null; // jamais un cadre d'un autre site
  return o;
}
/** Un vrai geste de la personne dans cette page il y a moins de `ms` (vu par le processus principal, pas par la page). */
const geste = (wcId: number, ms: number) => Date.now() - (gestes.get(wcId) ?? 0) < ms;

export function brancherMotsDePasse(trouver: Trouver): void {
  ipcMain.on('pegase:mdp-soumis', (e: IpcMainEvent, d: { identifiant?: unknown; motdepasse?: unknown }) => {
    const t = trouver(e.sender.id); if (!t || t.p.prive || !t.p.reglages().proposerMdp) return;
    const f = e.senderFrame; if (!f || f !== f.top) return; // seulement la page principale
    const o = origineSure(f); if (!o || !geste(e.sender.id, 5000)) return;
    if (typeof d?.motdepasse !== 'string' || typeof d?.identifiant !== 'string') return;
    if (t.m.proposer(o, d.identifiant.slice(0, 300), d.motdepasse.slice(0, 1000))) t.avertir();
  });
  ipcMain.handle('pegase:mdp-cles', (e: IpcMainInvokeEvent) => {
    const t = trouver(e.sender.id); const o = origineSure(e.senderFrame); if (!t || !o) return [];
    return t.m.pour(o).map((x) => ({ id: x.id, identifiant: x.identifiant }));
  });
  ipcMain.handle('pegase:mdp-remplir', (e: IpcMainInvokeEvent, id: unknown) => {
    const t = trouver(e.sender.id); const o = origineSure(e.senderFrame);
    if (!t || !o || typeof id !== 'string' || !geste(e.sender.id, 3000)) return null; // un vrai clic, sur le site exact
    return t.m.remplir(id, o);
  });
  ipcMain.handle('pegase:mdp-generer', (e: IpcMainInvokeEvent) => (trouver(e.sender.id) && origineSure(e.senderFrame) && geste(e.sender.id, 3000) ? generer() : null));
  ipcMain.on('pegase:mdp-gerer', (e: IpcMainEvent) => { if (geste(e.sender.id, 3000)) trouver(e.sender.id)?.gerer(); });
}

/** Copie un mot de passe, puis vide le presse-papiers 30 s après s'il n'a pas changé. */
export function copierSecret(v: string): void {
  clipboard.writeText(v);
  const h = createHash('sha256').update(v).digest('hex');
  setTimeout(async () => { if (createHash('sha256').update(String(await clipboard.readText())).digest('hex') === h) clipboard.writeText(''); }, 30_000).unref?.();
}
