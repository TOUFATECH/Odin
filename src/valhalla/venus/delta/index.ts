// Vénus · Delta : les sources où chercher un titre. AUCUNE source n'est fournie par Odin : le propriétaire donne
// lui-même chaque adresse (un indexeur qu'il a le droit d'utiliser). Delta parle le format de recherche standard des
// indexeurs (Torznab / Newznab : une adresse `…/api?t=search&q=…`, un flux RSS de résultats en retour).
//
// Sûreté :
// - la clé d'une source ne va JAMAIS dans la base : elle est chiffrée (clé de la machine) dans un fichier à part du
//   dossier de Vénus (delta-cles.json, mode 0o600) ; elle n'apparaît dans aucun texte rendu ni aucun journal ;
// - une adresse vers la machine d'Odin elle-même ou une adresse réservée est refusée ; aucune redirection n'est suivie ;
// - la réponse est lue comme une DONNÉE (taille bornée, champs nettoyés), jamais comme un ordre.
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chiffrerChamp, dechiffrerChamp } from '../../../vault.ts';
import { hoteInterdit } from '../../lien.ts';
import type { MagasinVenus } from '../base.ts';
import { norm } from '../bibliotheque.ts';
import { lienPartageValide } from '../comete/bt/metainfo.ts';

export type TypeSource = 'torznab' | 'newznab';
export interface Source { id: string; nom: string; type: TypeSource; adresse: string; actif: boolean; priorite: number; aCle: boolean; recherches: number; trouves: number; derniereErreur?: string }
/** Un résultat d'une source, nettoyé. `direct` : un lien HTTP(S) vers le fichier vidéo lui-même (Comète sait le prendre). */
export interface Resultat { titre: string; lien: string; taille?: number; source: string; sourceNom: string; direct: boolean; genre: 'direct' | 'partage' | 'nzb' | 'inconnu'; sources?: number; publie?: number }

const s = (v: unknown) => String(v ?? '').trim();
const ID = /^[a-z0-9-]{1,40}$/;
const fichierCles = (dir: string) => join(dir, 'delta-cles.json');
const EXT_VIDEO = /\.(mp4|mkv|avi|mov|webm|m4v|ts|wmv)$/i;

function lireCles(home: string, dir: string): Record<string, string> {
  try { const o = JSON.parse(readFileSync(fichierCles(dir), 'utf8')) as Record<string, string>; const r: Record<string, string> = {}; for (const [k, v] of Object.entries(o)) { try { r[k] = dechiffrerChamp(home, v); } catch { /* illisible : ignorée */ } } return r; } catch { return {}; }
}
function ecrireCles(home: string, dir: string, cles: Record<string, string>): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const o: Record<string, string> = {}; for (const [k, v] of Object.entries(cles)) if (v) o[k] = chiffrerChamp(home, v);
  const f = fichierCles(dir), t = `${f}.tmp`; writeFileSync(t, JSON.stringify(o), { mode: 0o600 }); renameSync(t, f);
}
export const cleDe = (home: string, dir: string, id: string): string | undefined => lireCles(home, dir)[id];

/** L'adresse donnée par le propriétaire, vérifiée (http/https, sans identifiant dedans, pas la machine d'Odin). Pur. */
export function adresseSource(raw: unknown): URL {
  let u: URL; try { u = new URL(s(raw)); } catch { throw new Error('adresse invalide (attendu : https://…/api)'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('seules les adresses http et https sont acceptées');
  if (u.username || u.password) throw new Error("n'écris pas d'identifiant ni de mot de passe dans l'adresse : la clé a sa propre case");
  if (hoteInterdit(u.hostname)) throw new Error("adresse refusée : elle pointe vers la machine d'Odin elle-même ou vers une adresse réservée");
  for (const k of [...u.searchParams.keys()]) if (/^(apikey|t|q)$/i.test(k)) u.searchParams.delete(k);
  return u;
}

const versSource = (e: { id: string; data: Record<string, unknown> }, cles: Record<string, string>): Source => ({
  id: e.id, nom: s(e.data.nom), type: (e.data.type === 'newznab' ? 'newznab' : 'torznab'), adresse: s(e.data.adresse), actif: e.data.actif !== false,
  priorite: Number(e.data.priorite) || 25, aCle: Boolean(cles[e.id]), recherches: Number(e.data.recherches) || 0, trouves: Number(e.data.trouves) || 0,
  ...(e.data.derniereErreur ? { derniereErreur: s(e.data.derniereErreur) } : {}),
});
/** Les sources du propriétaire (sans leurs clés : seulement « a une clé »), par priorité. */
export function sources(mag: MagasinVenus): Source[] {
  const cles = lireCles(mag.home, mag.dir);
  return mag.liste('sources').map((e) => versSource(e, cles)).sort((a, b) => a.priorite - b.priorite || a.nom.localeCompare(b.nom));
}
/** Ajoute ou règle une source. Aucune adresse n'est inventée : `adresse` vient du propriétaire. */
export function poserSource(mag: MagasinVenus, o: { id?: string; nom: string; type?: string; adresse: string; cle?: string; actif?: boolean; priorite?: number }): Source {
  const nom = s(o.nom).replace(/[\u0000-\u001f]/g, '').slice(0, 60); if (!nom) throw new Error('donne un nom à la source');
  const u = adresseSource(o.adresse);
  const id = o.id ? s(o.id) : (norm(nom).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) || `source-${mag.liste('sources').length + 1}`);
  if (!ID.test(id)) throw new Error(`identifiant de source invalide : ${id}`);
  const avant = mag.get('sources', id)?.data ?? {};
  mag.poser('sources', id, { ...avant, nom, type: o.type === 'newznab' ? 'newznab' : 'torznab', adresse: u.toString(), actif: o.actif !== false, priorite: Math.min(50, Math.max(1, Math.round(Number(o.priorite) || Number(avant.priorite) || 25))) });
  if (o.cle !== undefined && s(o.cle)) { const c = lireCles(mag.home, mag.dir); c[id] = s(o.cle); ecrireCles(mag.home, mag.dir, c); }
  return sources(mag).find((x) => x.id === id)!;
}
export function retirerSource(mag: MagasinVenus, id: string): boolean {
  const c = lireCles(mag.home, mag.dir); if (c[id]) { delete c[id]; ecrireCles(mag.home, mag.dir, c); }
  return mag.retirer('sources', id);
}

// ---------------------------------------------------------------- Le flux de résultats (RSS Torznab / Newznab)
// La lecture du flux est LINÉAIRE (indexOf, jamais d'expression qui revient en arrière sur tout le texte) : un flux
// piégé (« <item » sans fin, balises jamais fermées) ne bloque pas Odin. Les expressions ne portent que sur une balise
// déjà découpée et bornée.
/** Le texte en minuscules ASCII seulement (même longueur : les positions restent justes). */
const bas = (t: string) => t.replace(/[A-Z]+/g, (c) => c.toLowerCase());
const sansCdata = (t: string) => {
  let out = '', i = 0;
  for (;;) { const a = t.indexOf('<![CDATA[', i); if (a < 0) return out + t.slice(i); const f = t.indexOf(']]>', a + 9); if (f < 0) return out + t.slice(i, a) + t.slice(a + 9); out += t.slice(i, a) + t.slice(a + 9, f); i = f + 3; }
};
const decoder = (t: string) => sansCdata(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();
/** La première balise `<nom …>…</nom>` d'un bloc : son contenu, ou '' (et ses attributs, bornés). */
function baliseBrute(bloc: string, b: string, nom: string): { attributs: string; contenu?: string } | undefined {
  for (let i = 0; ;) {
    const a = b.indexOf(`<${nom}`, i); if (a < 0) return undefined;
    const c = b.charAt(a + nom.length + 1);
    if (c !== '>' && c !== '/' && !/\s/.test(c)) { i = a + 1; continue; }
    const g = b.indexOf('>', a); if (g < 0) return undefined;
    const attributs = bloc.slice(a + nom.length + 1, Math.min(g, a + nom.length + 1 + 2000));
    if (b.charAt(g - 1) === '/') return { attributs };
    const f = b.indexOf(`</${nom}>`, g); return { attributs, ...(f < 0 ? {} : { contenu: bloc.slice(g + 1, f) }) };
  }
}
const balise = (bloc: string, b: string, nom: string) => { const x = baliseBrute(bloc, b, nom); return x?.contenu !== undefined ? decoder(x.contenu) : ''; };
const valeurAttr = (attributs: string, nom: string): string | undefined => { const m = new RegExp(`\\b${nom}=["']([^"']{0,4000})["']`, 'i').exec(attributs); return m ? m[1] : undefined; };
const attrib = (bloc: string, b: string, nom: string): string | undefined => {
  for (const pre of ['<torznab:attr', '<newznab:attr']) {
    for (let i = 0; ;) {
      const a = b.indexOf(pre, i); if (a < 0) break;
      const g = b.indexOf('>', a); if (g < 0) break;
      const t = bloc.slice(a, Math.min(g, a + 2000)); i = g;
      if (valeurAttr(t, 'name')?.toLowerCase() === nom) { const v = valeurAttr(t, 'value'); if (v !== undefined) return decoder(v); }
    }
  }
  return undefined;
};
const propre = (t: string, n: number) => t.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
/** Quel genre de lien : le fichier lui-même (direct), du partage de fichiers (magnet, .torrent), un NZB. Pur. */
export function genreDeLien(lien: string, type?: string): Resultat['genre'] {
  if (/^magnet:/i.test(lien) || /bittorrent/i.test(type ?? '') || /\.torrent(\?|$)/i.test(lien)) return 'partage';
  if (/nzb/i.test(type ?? '') || /\.nzb(\?|$)/i.test(lien)) return 'nzb';
  let chemin = ''; try { chemin = new URL(lien).pathname; } catch { return 'inconnu'; }
  if (/^https?:/i.test(lien) && (/^video\//i.test(type ?? '') || EXT_VIDEO.test(decodeURIComponent(chemin)))) return 'direct';
  return 'inconnu';
}
/** Lit un flux RSS de résultats (Torznab / Newznab). Pur, borné : au plus 200 résultats. */
export function lireFlux(xml: string, src: { id: string; nom: string }): Resultat[] {
  const out: Resultat[] = [], texte = xml.slice(0, 4_000_000), bt = bas(texte);
  // Au plus 2000 blocs regardés ; un bloc de plus de 64 ko est sauté (aucun résultat honnête n'est si long).
  for (let i = 0, vus = 0; out.length < 200 && vus < 2000; vus++) {
    let a = bt.indexOf('<item', i);
    while (a >= 0 && !/[\s>]/.test(bt.charAt(a + 5))) a = bt.indexOf('<item', a + 1);
    if (a < 0) break;
    const f = bt.indexOf('</item>', a); if (f < 0) break;
    i = f + 7; if (f - a > 65_536) continue;
    const bloc = texte.slice(a, f + 7), b = bt.slice(a, f + 7), titre = propre(balise(bloc, b, 'title'), 300);
    const enc = baliseBrute(bloc, b, 'enclosure')?.attributs ?? '';
    const encUrl = valeurAttr(enc, 'url'), encType = valeurAttr(enc, 'type'), encLen = /^\d+$/.test(valeurAttr(enc, 'length') ?? '') ? valeurAttr(enc, 'length') : undefined;
    const lien = propre(decoder(encUrl ?? '') || balise(bloc, b, 'link'), 4000);
    if (!titre || !lien) continue;
    const taille = Number(attrib(bloc, b, 'size') ?? encLen ?? balise(bloc, b, 'size')) || undefined;
    const graines = Number(attrib(bloc, b, 'seeders')); const pub = Date.parse(balise(bloc, b, 'pubdate'));
    const genre = genreDeLien(lien, encType);
    out.push({ titre, lien, ...(taille ? { taille } : {}), source: src.id, sourceNom: src.nom, direct: genre === 'direct', genre, ...(Number.isFinite(graines) ? { sources: graines } : {}), ...(Number.isFinite(pub) ? { publie: pub } : {}) });
  }
  return out;
}

/** Ce qu'on cherche. */
export interface Requete { genre: 'film' | 'episode' | 'saison'; titre: string; annee?: number; saison?: number; episode?: number }
/** L'adresse de recherche standard pour une source (la clé ajoutée seulement à l'envoi, jamais montrée). Pur. */
export function adresseRecherche(adresse: string, r: Requete, cle?: string): string {
  const u = new URL(adresse);
  if (r.genre === 'film') { u.searchParams.set('t', 'movie'); u.searchParams.set('q', r.titre); if (r.annee) u.searchParams.set('year', String(r.annee)); }
  else { u.searchParams.set('t', 'tvsearch'); u.searchParams.set('q', r.titre); if (r.saison !== undefined) u.searchParams.set('season', String(r.saison)); if (r.genre === 'episode' && r.episode !== undefined) u.searchParams.set('ep', String(r.episode)); }
  if (cle) u.searchParams.set('apikey', cle);
  return u.toString();
}
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
/** Cherche dans toutes les sources actives. Une source en panne n'arrête pas les autres : son erreur est rendue. */
export async function chercher(mag: MagasinVenus, f: Fetch, r: Requete): Promise<{ resultats: Resultat[]; erreurs: string[] }> {
  const resultats: Resultat[] = [], erreurs: string[] = [], cles = lireCles(mag.home, mag.dir);
  for (const src of sources(mag).filter((x) => x.actif)) {
    const e = mag.get('sources', src.id)!;
    try {
      const rep = await f(adresseRecherche(src.adresse, r, cles[src.id]), { redirect: 'manual', headers: { 'user-agent': 'Odin-Venus-Delta/1', accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(30_000) });
      if (rep.status !== 200) { await rep.body?.cancel().catch(() => undefined); throw new Error(`la source répond ${rep.status}`); }
      const l = lireFlux(await lireBorne(rep, 4_000_000), src); resultats.push(...l);
      mag.poser('sources', src.id, { ...e.data, recherches: src.recherches + 1, trouves: src.trouves + l.length, derniereErreur: '' });
    } catch (err) {
      const m = masquer(propre((err as Error).message, 160), cles[src.id]);
      erreurs.push(`${src.nom} : ${m}`); mag.poser('sources', src.id, { ...e.data, recherches: src.recherches + 1, derniereErreur: m });
    }
  }
  return { resultats, erreurs };
}
/** Un texte sans la clé (telle quelle ou écrite dans une adresse). Pur. */
export const masquer = (t: string, cle?: string): string => (cle ? t.replaceAll(cle, '…').replaceAll(encodeURIComponent(cle), '…').replaceAll(new URLSearchParams({ k: cle }).toString().slice(2), '…') : t);
/** Lit une réponse sans dépasser `max` octets (le reste est abandonné). */
async function lireBorne(rep: Response, max: number): Promise<string> {
  const r = rep.body?.getReader(); if (!r) return '';
  const morceaux: Uint8Array[] = []; let n = 0;
  for (;;) { const { done, value } = await r.read(); if (done) break; morceaux.push(value); n += value.length; if (n >= max) { await r.cancel().catch(() => undefined); break; } }
  return Buffer.concat(morceaux).subarray(0, max).toString('utf8');
}
/** Teste une source : une recherche vide, un flux lisible ? */
export async function testerSource(mag: MagasinVenus, f: Fetch, id: string): Promise<{ ok: boolean; texte: string }> {
  const src = sources(mag).find((x) => x.id === id); if (!src) throw new Error(`source « ${id} » inconnue`);
  const u = new URL(src.adresse); u.searchParams.set('t', 'caps'); const c = cleDe(mag.home, mag.dir, id); if (c) u.searchParams.set('apikey', c);
  try {
    const rep = await f(u.toString(), { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const t = await lireBorne(rep, 200_000);
    return rep.status === 200 && /<caps|<rss|<searching/i.test(t) ? { ok: true, texte: `${src.nom} répond.` } : { ok: false, texte: `${src.nom} : réponse inattendue (${rep.status}).` };
  } catch (e) { return { ok: false, texte: `${src.nom} : ${masquer(propre((e as Error).message, 120), c)}` }; }
}

// ---------------------------------------------------------------- Qualité voulue et choix du meilleur résultat
export type Qualite = 'toutes' | '720p' | '1080p' | '2160p';
export const QUALITES: Qualite[] = ['toutes', '720p', '1080p', '2160p'];
const RANG: Record<string, number> = { '480p': 1, '576p': 1, '720p': 2, '1080p': 3, '2160p': 4 };
/** La définition lue dans un titre de résultat (« 1080p », « 4K »…). Pur. */
export function definitionDe(t: string): string | undefined {
  if (/\b(2160p|4k|uhd)\b/i.test(t)) return '2160p';
  const m = /\b(1080|720|576|480)[pi]\b/i.exec(t); return m ? `${m[1]}p` : undefined;
}
/** Les réglages qui servent au choix. */
export interface Choix { qualite: Qualite; tailleMaxOctets: number; langue?: 'vf' | 'toutes' }
let partageAccepte = false;
/** Comète dit que son moteur de partage de fichiers est là : les liens magnet et .torrent sont gardés. */
export function accepterPartage(oui: boolean): void { partageAccepte = oui; }
/**
 * Note un résultat pour une requête : `null` + la raison s'il est écarté. Les liens directs d'abord ; un lien de
 * partage de fichiers (magnet, .torrent) est gardé quand le moteur de Comète est là, toujours APRÈS un lien direct qui
 * convient. Le titre doit vraiment correspondre (mots du titre, année, épisode). Pur (sauf le drapeau du moteur).
 */
export function noter(x: Resultat, r: Requete, c: Choix): { score: number | null; pourquoi?: string } {
  const partage = x.genre === 'partage';
  if (partage && !partageAccepte) return { score: null, pourquoi: 'partage de fichiers : pas encore dans Comète' };
  if (partage && !lienPartageValide(x.lien)) return { score: null, pourquoi: 'lien de partage de fichiers illisible ou invalide' };
  if (!x.direct && !partage) return { score: null, pourquoi: x.genre === 'nzb' ? 'NZB : pas pris en charge' : "pas un lien direct vers une vidéo" };
  const t = norm(x.titre), mots = norm(r.titre).split(' ').filter(Boolean);
  if (!mots.every((w) => t.split(' ').includes(w))) return { score: null, pourquoi: 'un autre titre' };
  if (r.genre === 'film' && r.annee && /\b(19|20)\d{2}\b/.test(x.titre) && !x.titre.includes(String(r.annee))) return { score: null, pourquoi: 'une autre année' };
  if (r.genre !== 'film') {
    const m = /[Ss](\d{1,2})[\s.\-]*[Ee](\d{1,4})/.exec(x.titre);
    if (!m || Number(m[1]) !== r.saison || (r.genre === 'episode' && Number(m[2]) !== r.episode)) return { score: null, pourquoi: 'un autre épisode' };
  }
  if (x.taille && x.taille > c.tailleMaxOctets) return { score: null, pourquoi: 'trop gros pour la taille maximale' };
  const d = definitionDe(x.titre), rang = d ? RANG[d] : 0, voulu = c.qualite === 'toutes' ? 0 : RANG[c.qualite];
  if (voulu && rang < voulu) return { score: null, pourquoi: `en dessous de ${c.qualite}` };
  let score = 100 + rang * 10 - Math.abs(rang - (voulu || 3)) * 5;
  if (c.langue === 'vf' && /\b(multi|vff?|truefrench|french)\b/i.test(x.titre)) score += 30;
  if (x.taille) score += 1;
  if (partage) score -= 1000; // un lien direct qui convient passe toujours devant
  return { score };
}
/** Le meilleur résultat (ou rien, avec les raisons des écartés). Pur. */
export function meilleur(l: Resultat[], r: Requete, c: Choix): { choisi?: Resultat; ecartes: Array<{ titre: string; pourquoi: string }> } {
  let choisi: Resultat | undefined, best = -Infinity; const ecartes: Array<{ titre: string; pourquoi: string }> = [];
  for (const x of l) { const n = noter(x, r, c); if (n.score === null) { ecartes.push({ titre: x.titre, pourquoi: n.pourquoi! }); continue; } if (n.score > best) { best = n.score; choisi = x; } }
  return { ...(choisi ? { choisi } : {}), ecartes };
}
export const sourceExiste = (dir: string): boolean => existsSync(fichierCles(dir));
