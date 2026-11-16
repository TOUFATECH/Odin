// Écho · mode « Conversation » : la COPIE SONORE d'une conversation, gardée seulement si le propriétaire l'a demandé
// (bouton « Enregistrer cette conversation », éteint par défaut). Le son n'est JAMAIS en clair sur le disque : chaque
// morceau est scellé avec la clé de la machine (seal/open de vault.ts) dans ctx.dir/enregistrements/<conv>/<n>.enc.
// Le son NE passe PAS dans la base (elle ne doit pas gonfler) ; seul l'état (actif, octets, secondes, tours) va dans
// ECHO_ODIN (schéma « enregistrement »), avec repli fichier 0o600 avant que la base soit prête.
//
// Garde-fous : la copie est bornée (30 min, et un plafond d'octets) ; le plus ancien morceau est rogné au-delà. Un
// index clair par conversation (index.json, 0o600 : seulement des comptes, aucun son, aucun texte) sert à ranger et à
// rogner sans tout déchiffrer.
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BaseAttente, quandBase, type AppliBase, type DefAppli } from '../base/index.ts';
import { chiffrerChamp, exportMachineKey, open, seal } from '../../vault.ts';
import { dureeWav } from '../../web/conversation-api.ts';
import { idValide } from './conversation-historique.ts';

export const DEF_ENREGISTREMENT: DefAppli = {
  id: 'rodd_enregistrement', schema: 'enregistrement', appli: 'rodd',
  migrations: [{
    v: 1, nom: 'copies sonores : état seul (le son chiffré reste en fichiers)',
    sql: `CREATE TABLE etat (conv text PRIMARY KEY, actif boolean NOT NULL, octets bigint NOT NULL DEFAULT 0, secondes double precision NOT NULL DEFAULT 0, tours int NOT NULL DEFAULT 0, maj timestamptz NOT NULL)`,
  }],
  ecritures: {
    poser: 'INSERT INTO etat (conv, actif, octets, secondes, tours, maj) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (conv) DO UPDATE SET actif = $2, octets = $3, secondes = $4, tours = $5, maj = $6',
    effacer: 'DELETE FROM etat WHERE conv = $1',
  },
};

/** Plafonds d'une copie sonore (par conversation) : au-delà, le plus ancien morceau est rogné. */
export const MAX_SECONDES = 30 * 60, MAX_OCTETS = 60 * 1024 * 1024;
const AAD = 'enregistrement';
interface Morceau { seq: number; f: string; octets: number; secondes: number; tour: string; at: string }
interface Etat { actif: boolean; octets: number; secondes: number; tours: number }

/** La clé de la machine (créée au besoin) : impossible de garder le son sans elle. */
function cleMachine(home: string): Buffer {
  chiffrerChamp(home, ''); // garantit le coffre et la clé de la machine
  const k = exportMachineKey(home);
  if (!k) throw new Error('clé de la machine indisponible : copie sonore impossible');
  return k;
}

export class EnregistrementConversation {
  private home: string; private dossier: string; private fichierEtat: string;
  private etats = new Map<string, Etat>();
  private appli?: AppliBase;
  private off?: () => void;
  constructor(home: string, dir: string) {
    this.home = home; this.dossier = join(dir, 'enregistrements'); this.fichierEtat = join(this.dossier, 'etat.json');
    this.etats = this.lireEtats();
    this.off = quandBase((b) => {
      const a = b.appli(DEF_ENREGISTREMENT, this.dossier); this.appli = a;
      const pret = () => void this.brancher().catch((e) => { if (!(e instanceof BaseAttente)) console.error(`[base] enregistrements d'Écho : ${(e as Error).message}`); });
      a.on('prete', pret); if (a.prete) pret();
    });
  }
  fermer(): void { this.off?.(); this.off = undefined; }

  // ---------------- État (actif, comptes) ----------------
  private lireEtats(): Map<string, Etat> {
    try { const o = JSON.parse(readFileSync(this.fichierEtat, 'utf8')) as Record<string, Etat>; return new Map(Object.entries(o).filter(([k, v]) => idValide(k) && v && typeof v === 'object')); } catch { return new Map(); }
  }
  private ecrireEtats(): void {
    if (!this.etats.size) { rmSync(this.fichierEtat, { force: true }); return; }
    mkdirSync(this.dossier, { recursive: true, mode: 0o700 }); const t = `${this.fichierEtat}.tmp`;
    writeFileSync(t, JSON.stringify(Object.fromEntries(this.etats)), { mode: 0o600 }); renameSync(t, this.fichierEtat);
  }
  private async brancher(): Promise<void> {
    const a = this.appli!;
    // Ce qui attendait (fichier de repli) part dans la base, puis on relit la base comme vérité pour « actif ».
    for (const [conv, e] of this.etats) a.ecrire(['poser', conv, e.actif, e.octets, e.secondes, e.tours, new Date().toISOString()]);
    await a.vider();
    const r = await a.q('SELECT conv, actif, octets, secondes, tours FROM etat');
    for (const [conv, actif, octets, secondes, tours] of r.rows) this.etats.set(conv!, { actif: Boolean(actif), octets: Number(octets) || 0, secondes: Number(secondes) || 0, tours: Number(tours) || 0 });
    this.ecrireEtats();
  }
  private poser(conv: string, e: Etat): void {
    this.etats.set(conv, e); this.ecrireEtats();
    if (this.appli) this.appli.ecrire(['poser', conv, e.actif, e.octets, e.secondes, e.tours, new Date().toISOString()]);
  }

  /** Allume ou éteint la copie sonore de CETTE conversation (éteinte par défaut). Rend l'état du voyant. */
  activer(conv: string, on: boolean): boolean {
    if (!idValide(conv)) return false;
    const e = this.etats.get(conv) ?? { actif: false, octets: 0, secondes: 0, tours: 0 };
    this.poser(conv, { ...e, actif: on });
    return on;
  }
  /** La copie sonore est-elle allumée pour cette conversation ? */
  actif(conv: string): boolean { return Boolean(this.etats.get(conv)?.actif); }

  // ---------------- Le son (chiffré, en fichiers) ----------------
  private convDir(conv: string): string { return join(this.dossier, conv); }
  private indexDe(conv: string): Morceau[] {
    try { const l = JSON.parse(readFileSync(join(this.convDir(conv), 'index.json'), 'utf8')) as Morceau[]; return Array.isArray(l) ? l.filter((m) => m && typeof m.f === 'string') : []; } catch { return []; }
  }
  private ecrireIndex(conv: string, l: Morceau[]): void {
    const d = this.convDir(conv); mkdirSync(d, { recursive: true, mode: 0o700 }); const f = join(d, 'index.json'), t = `${f}.tmp`;
    writeFileSync(t, JSON.stringify(l), { mode: 0o600 }); renameSync(t, f);
  }

  /** Ajoute le son d'un tour (scellé). Rogne le plus ancien morceau si la copie dépasse les plafonds. */
  ajouter(conv: string, tour: string, wav: Uint8Array): void {
    if (!idValide(conv) || !wav.length) return;
    const key = cleMachine(this.home), d = this.convDir(conv);
    mkdirSync(d, { recursive: true, mode: 0o700 });
    const l = this.indexDe(conv), seq = (l.reduce((m, x) => Math.max(m, x.seq), -1) + 1);
    const nom = `${String(seq).padStart(6, '0')}.enc`;
    const blob = seal(key, Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength), AAD);
    writeFileSync(join(d, nom), blob, { mode: 0o600 });
    l.push({ seq, f: nom, octets: blob.length, secondes: dureeWav(wav) ?? 0, tour: idValide(tour) ? tour : 'sans-id', at: new Date().toISOString() });
    // Rogner le plus ancien tant qu'on dépasse (toujours garder au moins le dernier morceau).
    while (l.length > 1 && (l.reduce((s, x) => s + x.octets, 0) > MAX_OCTETS || l.reduce((s, x) => s + x.secondes, 0) > MAX_SECONDES)) {
      const vieux = l.shift()!; rmSync(join(d, vieux.f), { force: true });
    }
    this.ecrireIndex(conv, l);
    const octets = l.reduce((s, x) => s + x.octets, 0), secondes = l.reduce((s, x) => s + x.secondes, 0);
    const e = this.etats.get(conv) ?? { actif: true, octets: 0, secondes: 0, tours: 0 };
    this.poser(conv, { actif: e.actif, octets, secondes, tours: l.length });
  }

  /** La taille (octets chiffrés) de la copie sonore d'une conversation. */
  taille(conv: string): number { return idValide(conv) ? this.indexDe(conv).reduce((s, x) => s + x.octets, 0) : 0; }
  /** La durée gardée (secondes), d'après l'index clair. */
  secondes(conv: string): number { return idValide(conv) ? this.indexDe(conv).reduce((s, x) => s + x.secondes, 0) : 0; }
  /** Y a-t-il une copie sonore pour cette conversation ? */
  existe(conv: string): boolean { return this.indexDe(conv).length > 0; }
  /** Toutes les conversations connues de l'enregistreur : un état d'enregistrement OU une copie sonore sur le disque.
   * Sert à lister et à tout effacer même quand le texte n'a pas été gardé (le son ne doit jamais rester orphelin). */
  convs(): string[] {
    const s = new Set<string>([...this.etats.keys()].filter(idValide));
    try { for (const d of readdirSync(this.dossier, { withFileTypes: true })) if (d.isDirectory() && idValide(d.name)) s.add(d.name); } catch { /* aucun dossier */ }
    return [...s];
  }

  /** Le WAV complet, déchiffré (les morceaux assemblés dans l'ordre). Vide s'il n'y a rien. */
  assembler(conv: string): Buffer {
    if (!idValide(conv)) return Buffer.alloc(0);
    const key = exportMachineKey(this.home); if (!key) return Buffer.alloc(0);
    const d = this.convDir(conv), l = [...this.indexDe(conv)].sort((a, b) => a.seq - b.seq);
    const parts: Buffer[] = [];
    for (const m of l) { try { parts.push(open(key, readFileSync(join(d, m.f)), AAD)); } catch { /* morceau illisible : ignoré */ } }
    return parts.length ? assemblerWav(parts) : Buffer.alloc(0);
  }

  /** Efface la copie sonore d'une conversation (vraiment : les fichiers chiffrés et l'état). */
  effacer(conv: string): void {
    if (!idValide(conv)) return;
    rmSync(this.convDir(conv), { recursive: true, force: true });
    if (this.etats.delete(conv)) { this.ecrireEtats(); if (this.appli) this.appli.ecrire(['effacer', conv]); }
  }
}

// ---------------- Assemblage WAV ----------------
/** fmt et data d'un WAV (ou rien si ce n'en est pas un). */
function litWav(b: Buffer): { fmt: Buffer; data: Buffer } | undefined {
  if (b.length < 12 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return undefined;
  let i = 12; let fmt: Buffer | undefined, data: Buffer | undefined;
  while (i + 8 <= b.length) {
    const id = b.toString('ascii', i, i + 4), n = b.readUInt32LE(i + 4), corps = b.subarray(i + 8, Math.min(b.length, i + 8 + n));
    if (id === 'fmt ') fmt = corps; if (id === 'data') data = corps;
    i += 8 + n + (n % 2);
  }
  return fmt && data ? { fmt, data } : undefined;
}
/** Assemble des morceaux WAV de même format en un seul WAV ; au pire, concatène les octets bruts. */
export function assemblerWav(parts: Buffer[]): Buffer {
  const wavs = parts.map(litWav).filter((x): x is { fmt: Buffer; data: Buffer } => Boolean(x));
  if (!wavs.length) return Buffer.concat(parts);
  const fmt = wavs[0].fmt, data = Buffer.concat(wavs.filter((w) => w.fmt.equals(fmt)).map((w) => w.data));
  const tete = Buffer.alloc(20 + fmt.length + 8);
  tete.write('RIFF', 0, 'ascii'); tete.writeUInt32LE(4 + (8 + fmt.length) + (8 + data.length), 4); tete.write('WAVE', 8, 'ascii');
  tete.write('fmt ', 12, 'ascii'); tete.writeUInt32LE(fmt.length, 16); fmt.copy(tete, 20);
  tete.write('data', 20 + fmt.length, 'ascii'); tete.writeUInt32LE(data.length, 24 + fmt.length);
  return Buffer.concat([tete, data]);
}

/** La copie sonore d'un contexte d'appli (une par contexte, comme historiqueDe). */
const parCtx = new WeakMap<object, EnregistrementConversation>();
export function enregistrementDe(ctx: { home: string; dir: string }): EnregistrementConversation {
  let e = parCtx.get(ctx); if (!e) { e = new EnregistrementConversation(ctx.home, ctx.dir); parCtx.set(ctx, e); }
  return e;
}
