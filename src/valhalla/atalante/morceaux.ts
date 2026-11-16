// Atalante · le téléchargement en plusieurs morceaux. Une requête d'essai (Range bytes=0-0) lit la taille, la
// reprise (Accept-Ranges / réponse 206), l'ETag et la date de modification. Le fichier est coupé en N morceaux
// (1 à 8, 4 par défaut, 1 Mo au moins chacun), gardés en .<nom>.partK ; chacun reprend à sa taille, puis tout est
// assemblé dans l'ordre. Un ETag ou une date de modification changés font repartir de zéro. Le débit maximum est
// commun à tous les morceaux. Un serveur qui ne sait pas reprendre : on retombe sur `download` de la forge (un seul
// flux, reprise, débit). L'empreinte SHA-256 est calculée par `sha256File` de la forge et comparée à celle de
// l'éditeur (donnée, ou trouvée dans un fichier .sha256 ou SHA256SUMS voisin, lu par `parseSums`) : fausse, le
// fichier est supprimé, comme dans la forge.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { once } from 'node:events';
import { basename, join } from 'node:path';
import { download, sha256File } from '../forge/forge.ts';
import { parseSums } from '../forge/sources.ts';
import { lienPropre } from '../lien.ts';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export const MO = 1024 * 1024, MIN_MORCEAU = MO, MAX_MORCEAUX = 8;

export interface Sonde { url: string; taille?: number; reprise: boolean; etag?: string; modifie?: string; type?: string; disposition?: string }

/** Suit les redirections une par une (chaque lien revérifié par lienPropre ; `garde` peut refuser un saut). */
export async function sonder(f: Fetch, lien: string, o: { signal?: AbortSignal; garde?: (u: URL) => Promise<void> | void } = {}): Promise<Sonde> {
  let u = lienPropre(lien);
  for (let saut = 0; saut < 6; saut++) {
    if (saut) { u = lienPropre(u.toString()); await o.garde?.(u); }
    const r = await f(u.toString(), { headers: { range: 'bytes=0-0', 'user-agent': 'Odin-Atalante/1', accept: '*/*' }, redirect: 'manual', signal: o.signal ?? AbortSignal.timeout(30_000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { await r.body?.cancel().catch(() => undefined); u = new URL(r.headers.get('location')!, u); continue; }
    await r.body?.cancel().catch(() => undefined);
    if (!r.ok) throw new Error(`le site répond ${r.status}`);
    const plage = /\/(\d+)\s*$/.exec(r.headers.get('content-range') ?? '')?.[1];
    const taille = r.status === 206 && plage ? Number(plage) : Number(r.headers.get('content-length')) || undefined;
    return {
      url: u.toString(), reprise: r.status === 206 && Boolean(plage), ...(taille ? { taille } : {}),
      ...(r.headers.get('etag') ? { etag: r.headers.get('etag')! } : {}), ...(r.headers.get('last-modified') ? { modifie: r.headers.get('last-modified')! } : {}),
      ...(r.headers.get('content-type') ? { type: r.headers.get('content-type')! } : {}), ...(r.headers.get('content-disposition') ? { disposition: r.headers.get('content-disposition')! } : {}),
    };
  }
  throw new Error('trop de redirections');
}

/**
 * Ce qu'on envoie dans If-Range : l'ETag s'il est fort, sinon la date de modification. Un ETag faible (W/…) ne vaut
 * rien ici : la norme HTTP (RFC 9110, 13.1.5) veut que le serveur ignore alors la plage et renvoie tout (200). Pur.
 */
export function validateur(s: Pick<Sonde, 'etag' | 'modifie'>): string | undefined {
  if (s.etag && !/^W\//i.test(s.etag)) return s.etag;
  return s.modifie || undefined;
}

/** Le découpage : N morceaux d'au moins 1 Mo (1 à 8). Pur. */
export function decouper(taille: number, voulu = 4): Array<{ debut: number; fin: number }> {
  const n = Math.max(1, Math.min(MAX_MORCEAUX, Math.round(voulu) || 4, Math.floor(taille / MIN_MORCEAU) || 1)), pas = Math.ceil(taille / n), out: Array<{ debut: number; fin: number }> = [];
  for (let k = 0; k < n; k++) { const debut = k * pas, fin = Math.min(taille, (k + 1) * pas) - 1; if (debut <= fin) out.push({ debut, fin }); }
  return out;
}

/** Débit maximum commun (Mo/s) : chaque morceau demande la permission d'écrire ses octets. */
export class Debit {
  private t0 = Date.now(); private n = 0;
  private moParSeconde?: number;
  constructor(moParSeconde?: number) { this.moParSeconde = moParSeconde; }
  async prendre(octets: number): Promise<void> {
    if (!this.moParSeconde) return;
    this.n += octets;
    const avance = this.n / (this.moParSeconde * MO) * 1000 - (Date.now() - this.t0);
    if (avance > 20) await new Promise((w) => setTimeout(w, Math.min(avance, 2000)));
  }
}

/** L'empreinte publiée à côté du fichier (lien.sha256, ou SHA256SUMS du même dossier), si elle existe. */
export async function empreinteVoisine(f: Fetch, url: string, nom: string): Promise<string | undefined> {
  const u = new URL(url), dossier = new URL('.', u).toString();
  for (const essai of [`${u.origin}${u.pathname}.sha256`, `${dossier}SHA256SUMS`, `${dossier}sha256sums.txt`]) {
    try {
      const r = await f(essai, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'Odin-Atalante/1' } });
      if (!r.ok) { await r.body?.cancel().catch(() => undefined); continue; }
      const t = (await r.text()).slice(0, 256 * 1024), sommes = parseSums(t);
      const v = sommes.get(nom) ?? (sommes.size === 0 && /^[a-f0-9]{64}\b/i.test(t.trim()) ? t.trim().slice(0, 64).toLowerCase() : undefined);
      if (v) return v;
    } catch { /* pas de fichier voisin */ }
  }
  return undefined;
}

export interface Plan {
  url: string; nom: string; dossier: string;
  morceaux?: number; debitMo?: number;
  /** l'empreinte SHA-256 donnée par l'éditeur (sinon cherchée à côté du fichier) */
  empreinte?: string;
  signal?: AbortSignal;
  progression?(fait: number, total?: number): void;
  /** la sonde déjà faite (sinon refaite) */
  sonde?: Sonde;
}
export interface Resultat { chemin: string; taille: number; sha256: string; verifie: boolean; morceaux: number; empreinteDe?: 'editeur' | 'voisin' }

const nomSur = (n: string) => { const b = basename(n); if (!b || b !== n || /^\.\.?$/.test(b) || /[\\/:*?"<>|\u0000-\u001f]/.test(b)) throw new Error('nom de fichier invalide'); return b; };
/** Les fichiers de travail d'un téléchargement (pour l'arrêter proprement). */
export const fichiersDeTravail = (dossier: string, nom: string) => [join(dossier, `.${nom}.etat.json`), join(dossier, `.${nom}.part`), join(dossier, `.${nom}.assemblage`), ...Array.from({ length: MAX_MORCEAUX }, (_v, k) => join(dossier, `.${nom}.part${k}`))];

/** Télécharge `plan.url` dans `plan.dossier/plan.nom` (reprise possible : relancer avec le même plan). */
export async function telechargerMorceaux(f: Fetch, plan: Plan): Promise<Resultat> {
  const nom = nomSur(plan.nom); mkdirSync(plan.dossier, { recursive: true });
  const fx: Fetch = (u, i) => f(u, { ...i, redirect: 'manual' });
  const sonde = plan.sonde ?? await sonder(f, plan.url, { signal: plan.signal });
  let attendu = plan.empreinte?.toLowerCase().replace(/^sha256:/, ''), empreinteDe: Resultat['empreinteDe'] = attendu ? 'editeur' : undefined;
  if (attendu && !/^[a-f0-9]{64}$/.test(attendu)) throw new Error('empreinte SHA-256 : 64 caractères hexadécimaux');
  if (!attendu) { attendu = await empreinteVoisine(fx, sonde.url, nom); if (attendu) empreinteDe = 'voisin'; }
  const final = join(plan.dossier, nom);
  // Un seul flux : le serveur ne sait pas reprendre par morceaux, le fichier est petit, ou rien ne garantit que les
  // morceaux viennent de la même version du fichier (pas d'ETag fort ni de date de modification pour If-Range).
  const valide = validateur(sonde);
  const decoupe = sonde.reprise && sonde.taille && valide ? decouper(sonde.taille, plan.morceaux ?? 4) : [];
  if (decoupe.length <= 1) {
    const r = await download(fx, { version: '', url: sonde.url, file: nom, ...(attendu ? { sha256: attendu } : {}) }, plan.dossier, { signal: plan.signal, ...(plan.debitMo ? { rate: plan.debitMo } : {}), progress: plan.progression });
    return { chemin: r.path, taille: r.size, sha256: r.sha256, verifie: r.checked, morceaux: 1, ...(empreinteDe ? { empreinteDe } : {}) };
  }
  // Plusieurs morceaux : l'état (ETag, date, taille, découpage) dit si les morceaux déjà là sont encore bons.
  const fEtat = join(plan.dossier, `.${nom}.etat.json`), etat = { etag: sonde.etag ?? '', modifie: sonde.modifie ?? '', taille: sonde.taille!, n: decoupe.length };
  let ancien: typeof etat | undefined; try { ancien = JSON.parse(readFileSync(fEtat, 'utf8')) as typeof etat; } catch { ancien = undefined; }
  const parts = decoupe.map((_m, k) => join(plan.dossier, `.${nom}.part${k}`));
  if (!ancien || ancien.etag !== etat.etag || ancien.modifie !== etat.modifie || ancien.taille !== etat.taille || ancien.n !== etat.n) {
    for (const p of fichiersDeTravail(plan.dossier, nom)) rmSync(p, { force: true });
    writeFileSync(fEtat, JSON.stringify(etat), { mode: 0o600 });
  }
  const debit = new Debit(plan.debitMo), tailles = parts.map((p) => (existsSync(p) ? statSync(p).size : 0));
  const total = sonde.taille!, avance = () => plan.progression?.(tailles.reduce((a, b) => a + b, 0), total);
  await Promise.all(decoupe.map(async (m, k) => {
    const longueur = m.fin - m.debut + 1;
    if (tailles[k] > longueur) { rmSync(parts[k], { force: true }); tailles[k] = 0; }
    if (tailles[k] === longueur) return;
    const r = await fx(sonde.url, { headers: { range: `bytes=${m.debut + tailles[k]}-${m.fin}`, 'user-agent': 'Odin-Atalante/1', 'if-range': valide! }, signal: plan.signal });
    if (r.status !== 206) { await r.body?.cancel().catch(() => undefined); throw new Error(r.status === 200 ? 'le fichier a changé sur le serveur : il repartira de zéro' : `le site répond ${r.status}`); }
    const fh = await open(parts[k], 'a', 0o600);
    try {
      const lecteur = r.body!.getReader();
      for (;;) {
        const { done, value } = await lecteur.read(); if (done) break;
        const reste = longueur - tailles[k], x = value.length > reste ? value.subarray(0, reste) : value;
        await fh.write(x); tailles[k] += x.length; avance();
        await debit.prendre(x.length);
        if (tailles[k] >= longueur) { await lecteur.cancel().catch(() => undefined); break; }
      }
    } finally { await fh.close(); }
    if (tailles[k] !== longueur) throw new Error(`morceau ${k + 1} incomplet (${tailles[k]}/${longueur}) : il reprendra où il en est`);
  }));
  // Assemblage dans l'ordre, puis empreinte.
  const tmp = join(plan.dossier, `.${nom}.assemblage`), w = createWriteStream(tmp, { mode: 0o600 });
  for (const p of parts) { for await (const c of createReadStream(p)) if (!w.write(c)) await once(w, 'drain'); }
  w.end(); await once(w, 'finish');
  const sha = await sha256File(tmp);
  if (attendu && sha !== attendu) {
    for (const p of fichiersDeTravail(plan.dossier, nom)) rmSync(p, { force: true });
    throw Object.assign(new Error(`empreinte fausse : attendu ${attendu.slice(0, 16)}…, reçu ${sha.slice(0, 16)}… (fichier supprimé)`), { code: 'SHA' });
  }
  renameSync(tmp, final);
  for (const p of fichiersDeTravail(plan.dossier, nom)) rmSync(p, { force: true });
  return { chemin: final, taille: total, sha256: sha, verifie: Boolean(attendu), morceaux: decoupe.length, ...(empreinteDe ? { empreinteDe } : {}) };
}
