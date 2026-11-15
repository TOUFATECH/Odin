// Odyssée — la partie « livres » de Vénus, côté Odin :
//  - envies de livres et de livres audio envoyées à Venus (son moteur « médias automatiques » les cherche et les range) ;
//  - lecteur EPUB et CBZ dans Odin (le livre vient de Venus ou d'un fichier déposé), progression gardée par livre ;
//  - livres audio par chapitres : la liste vient de Venus, Odin garde le chapitre et la position pour reprendre.
// Le texte d'un livre est une DONNÉE : il est nettoyé (aucun script, aucun gestionnaire d'événement, aucune ressource
// extérieure) et n'est jamais lu comme un ordre. Tout est rangé en fichiers JSON dans le dossier de Vénus.
//
// API de Venus utilisée (le service Venus est un autre dépôt) :
//  - GET  /api/admin/acquire              → { wants: [{ id, kind: 'book' | 'audiobook' | …, title, status, progress, note }] } (déjà utilisé par venus.ts)
//  - POST /api/admin/acquire/wants        { kind: 'book' | 'audiobook', title, author? } (déjà utilisé par venus.ts)
//  - GET  /api/library?type=book|audiobook → VCard[]  (SUPPOSÉ : même forme que les autres types de la bibliothèque)
//  - GET  /api/items/:id/download          → le fichier du livre, brut (SUPPOSÉ)
//  - GET  /api/items/:id/chapters          → { chapters: [{ title, start, end }] } en secondes (SUPPOSÉ)

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpReq } from 'node:http';
import { request as httpsReq } from 'node:https';
import { extname, join, posix } from 'node:path';
import { isPrivateV4 } from '../../hlidskjalf/discover.ts';
import type { VenusConf } from '../../tools/venus.ts';
import { ouvrirZip, type Zip } from './zip.ts';

const s = (v: unknown) => String(v ?? '').trim();

// ------------------------------------------------------------------ Envies de livres

export interface EnvieLivre { id: number; kind: string; title: string; status: string; progress: number; note?: string | null; author?: string }
const ETAT: Record<string, string> = { attente: 'en attente', pas_trouve: 'pas encore trouvé', pas_sorti: 'pas encore sorti', telechargement: 'en téléchargement', range: 'rangé', erreur: 'erreur' };
/** Les envies qui sont des livres ou des livres audio (pur). */
export const enviesLivres = (wants: EnvieLivre[]) => wants.filter((w) => w.kind === 'book' || w.kind === 'audiobook');
/** Les envies de livres en texte (pur). */
export function enviesText(wants: EnvieLivre[]): string {
  const l = enviesLivres(wants);
  if (!l.length) return 'Aucune envie de livre : « je veux le livre Dune de Frank Herbert ».';
  return l.map((w) => `- ${w.kind === 'audiobook' ? '🎧' : '📖'} ${w.title}${w.author ? ` (${w.author})` : ''} · ${ETAT[w.status] ?? w.status}${w.status === 'telechargement' ? ` ${w.progress} %` : ''}${w.note && w.status === 'erreur' ? ` · ${w.note}` : ''}`).join('\n');
}
/** Le corps envoyé à Venus pour une envie de livre (pur). */
export function corpsEnvie(type: string, titre: string, auteur: string): { kind: 'book' | 'audiobook'; title: string; author?: string } {
  const t = s(titre); if (!t) throw new Error('quel livre ? donne son titre');
  return { kind: /audio/i.test(type) ? 'audiobook' : 'book', title: t.slice(0, 200), ...(s(auteur) ? { author: s(auteur).slice(0, 120) } : {}) };
}

// ------------------------------------------------------------------ Fichiers de Venus (brut)

/** Télécharge un fichier brut de Venus (même clé et mêmes règles de certificat que venusApi). */
export function venusFichier(c: VenusConf, path: string, max = 400 * 1024 * 1024): Promise<Buffer> {
  const u = new URL(c.url + path), local = isPrivateV4(u.hostname) || /\.local$|^localhost$/.test(u.hostname);
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? httpsReq : httpReq)(u, { method: 'GET', headers: { 'x-api-key': c.key }, timeout: 60_000, ...(u.protocol === 'https:' && local ? { rejectUnauthorized: false } : {}) }, (res) => {
      const parts: Buffer[] = []; let n = 0;
      res.on('data', (b: Buffer) => { n += b.length; if (n > max) { req.destroy(new Error('livre trop gros')); return; } parts.push(b); });
      res.on('end', () => {
        const data = Buffer.concat(parts);
        if ((res.statusCode ?? 500) >= 400) return reject(new Error(`Venus : ${data.toString('utf8').slice(0, 200)} (HTTP ${res.statusCode})`));
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Venus ne répond pas')));
    req.on('error', reject);
    req.end();
  });
}

// ------------------------------------------------------------------ Bibliothèque de lecture (fichiers)

export type FormatLivre = 'epub' | 'cbz';
export interface Livre { id: string; titre: string; auteur?: string; format: FormatLivre; source: 'venus' | 'depot'; venusId?: number; ajoute: string }
export interface Progression { chapitre: number; position: number; at: string }

const dossier = (dir: string) => join(dir, 'odyssee');
const ecrireJson = (f: string, v: unknown) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(`${f}.tmp`, JSON.stringify(v, null, 1), { mode: 0o600 }); renameSync(`${f}.tmp`, f); };
const lireJson = <T>(f: string, d: T): T => { try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return d; } };
export const livres = (dir: string): Livre[] => lireJson<Livre[]>(join(dossier(dir), 'livres.json'), []);
export const fichierLivre = (dir: string, l: Pick<Livre, 'id' | 'format'>) => join(dossier(dir), 'livres', `${l.id}.${l.format}`);
/** Le format d'un fichier, lu dans son contenu (un EPUB déclare « application/epub+zip »), sinon par son extension. */
export function formatDe(nom: string, data: Buffer): FormatLivre {
  let z: Zip; try { z = ouvrirZip(data); } catch { throw new Error('ce fichier n\'est ni un EPUB ni un CBZ'); }
  const mime = z.lire('mimetype')?.toString('utf8').trim();
  if (mime === 'application/epub+zip' || z.a('META-INF/container.xml')) return 'epub';
  if (images(z).length) return 'cbz';
  throw new Error(`${extname(nom) || 'ce fichier'} : ni un livre EPUB ni une bande dessinée CBZ`);
}
/** Range un livre dans la bibliothèque de lecture d'Odin (il est vérifié et ses informations lues). */
export function ajouterLivre(dir: string, nom: string, data: Buffer, o: { source: Livre['source']; venusId?: number; titre?: string; auteur?: string; maintenant?: Date }): Livre {
  const format = formatDe(nom, data), z = ouvrirZip(data);
  const meta = format === 'epub' ? lireEpub(z) : undefined;
  const id = o.venusId !== undefined ? `v${o.venusId}` : `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const l: Livre = { id, titre: (meta?.titre || o.titre || nom.replace(/\.[a-z0-9]+$/i, '')).slice(0, 200), ...(meta?.auteur || o.auteur ? { auteur: (meta?.auteur || o.auteur)!.slice(0, 120) } : {}), format, source: o.source, ...(o.venusId !== undefined ? { venusId: o.venusId } : {}), ajoute: (o.maintenant ?? new Date()).toISOString() };
  const f = fichierLivre(dir, l); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, data, { mode: 0o600 });
  ecrireJson(join(dossier(dir), 'livres.json'), [...livres(dir).filter((x) => x.id !== id), l]);
  return l;
}
export function retirerLivre(dir: string, id: string): boolean {
  const l = livres(dir), x = l.find((b) => b.id === id); if (!x) return false;
  rmSync(fichierLivre(dir, x), { force: true });
  ecrireJson(join(dossier(dir), 'livres.json'), l.filter((b) => b.id !== id));
  const p = progressions(dir); delete p[id]; ecrireJson(join(dossier(dir), 'progression.json'), p);
  return true;
}
/** Un livre par son identifiant ou son titre (début de titre, sans accents ni majuscules). */
export function trouverLivre(dir: string, q: string): Livre | undefined {
  const n = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(), k = n(q), l = livres(dir);
  return l.find((b) => b.id === q) ?? l.find((b) => n(b.titre) === k) ?? l.find((b) => n(b.titre).includes(k));
}
export const progressions = (dir: string) => lireJson<Record<string, Progression>>(join(dossier(dir), 'progression.json'), {});
export function noterProgression(dir: string, id: string, chapitre: number, position: number, maintenant = new Date()): Progression {
  const p = progressions(dir), x: Progression = { chapitre: Math.max(0, Math.floor(chapitre) || 0), position: Math.max(0, Number(position) || 0), at: maintenant.toISOString() };
  p[id] = x; ecrireJson(join(dossier(dir), 'progression.json'), p); return x;
}

// ------------------------------------------------------------------ EPUB

export interface Chapitre { href: string; titre: string }
export interface InfosEpub { titre: string; auteur?: string; chapitres: Chapitre[]; racine: string }
const attr = (tag: string, nom: string) => new RegExp(`\\s${nom}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(2, 4).find((x) => x !== undefined);
const entites = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const texte = (xml: string) => entites(xml.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const sansAncre = (h: string) => decodeURIComponent(h.split('#')[0]);

/** Lit un EPUB : container.xml → OPF → ordre de lecture (spine), titres de la table des matières (NCX ou nav). */
export function lireEpub(z: Zip): InfosEpub {
  const cont = z.lire('META-INF/container.xml')?.toString('utf8') ?? '';
  const opfPath = attr(/<rootfile\b[^>]*>/i.exec(cont)?.[0] ?? '', 'full-path') ?? z.entrees.find((e) => e.nom.endsWith('.opf'))?.nom;
  if (!opfPath) throw new Error('EPUB sans fichier de description (OPF)');
  const opf = z.lire(opfPath)?.toString('utf8'); if (!opf) throw new Error('EPUB abîmé : description introuvable');
  const racine = posix.dirname(opfPath) === '.' ? '' : posix.dirname(opfPath);
  const titre = texte(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1] ?? ''), auteur = texte(/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)?.[1] ?? '');
  const manifeste = new Map<string, { href: string; type: string; props: string }>();
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) { const id = attr(m[0], 'id'), href = attr(m[0], 'href'); if (id && href) manifeste.set(id, { href: posix.normalize(posix.join(racine, sansAncre(href))), type: attr(m[0], 'media-type') ?? '', props: attr(m[0], 'properties') ?? '' }); }
  // Titres de la table des matières : EPUB 3 (nav) ou EPUB 2 (toc.ncx).
  const titres = new Map<string, string>();
  const nav = [...manifeste.values()].find((x) => /\bnav\b/.test(x.props)), ncx = [...manifeste.values()].find((x) => x.type === 'application/x-dtbncx+xml');
  if (nav) { const t = z.lire(nav.href)?.toString('utf8') ?? '', base = posix.dirname(nav.href); for (const a of t.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) { const h = attr(a[0], 'href'); if (h && !/^[a-z]+:/i.test(h)) { const k = posix.normalize(posix.join(base, sansAncre(h))); if (!titres.has(k)) titres.set(k, texte(a[2])); } } }
  else if (ncx) { const t = z.lire(ncx.href)?.toString('utf8') ?? '', base = posix.dirname(ncx.href); for (const p of t.matchAll(/<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b([^>]*)>/gi)) { const h = attr(p[0].slice(p[0].lastIndexOf('<content')), 'src'); if (h) { const k = posix.normalize(posix.join(base, sansAncre(h))); if (!titres.has(k)) titres.set(k, texte(p[1])); } } }
  const chapitres: Chapitre[] = [];
  for (const m of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const it = manifeste.get(attr(m[0], 'idref') ?? ''); if (!it || attr(m[0], 'linear') === 'no') continue;
    if (!/x?html/.test(it.type) && !/\.x?html?$/i.test(it.href)) continue;
    chapitres.push({ href: it.href, titre: titres.get(it.href) || `Chapitre ${chapitres.length + 1}` });
  }
  if (!chapitres.length) throw new Error('EPUB sans chapitre lisible');
  return { titre, ...(auteur ? { auteur } : {}), chapitres, racine };
}

const BALISES = new Set('p br hr h1 h2 h3 h4 h5 h6 em strong b i u s sub sup small blockquote q cite pre code ul ol li dl dt dd table thead tbody tfoot tr th td caption figure figcaption img span div section article aside header footer abbr ruby rt rp'.split(' '));
const VIDES = new Set(['br', 'hr', 'img']);
const IMG_TYPE: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': '', '.avif': 'image/avif' };
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Nettoie un chapitre XHTML : seules des balises de mise en page sont gardées (liste fermée), sans aucun attribut
 * sauf alt/title/colspan/rowspan ; les images du livre sont mises en ligne (data:), toute adresse extérieure est
 * retirée ; scripts, styles, formulaires, cadres, SVG et liens disparaissent (le texte des liens reste). Pur.
 */
export function nettoyer(xhtml: string, chapitre: string, z?: Zip, maxImage = 4 * 1024 * 1024): string {
  let x = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(xhtml)?.[1] ?? xhtml;
  x = x.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<(script|style|iframe|object|embed|form|svg|math|template|noscript|audio|video|canvas|select|textarea|button)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta|base|input|svg|audio|video|source|track)\b[^>]*\/?>/gi, '');
  const out: string[] = [], ouvertes: string[] = [];
  for (const morceau of x.split(/(<[^>]*>)/)) {
    if (!morceau.startsWith('<')) { out.push(morceau.replace(/</g, '&lt;').replace(/>/g, '&gt;')); continue; }
    const m = /^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*?)(\/)?\s*>$/.exec(morceau); if (!m) continue;
    const nom = m[2].toLowerCase().replace(/^.*:/, ''), fin = Boolean(m[1]);
    if (!BALISES.has(nom)) continue;
    if (fin) { const i = ouvertes.lastIndexOf(nom); if (i >= 0) { while (ouvertes.length > i) out.push(`</${ouvertes.pop()}>`); } continue; }
    const garde: string[] = [];
    for (const a of ['alt', 'title', 'colspan', 'rowspan']) { const v = attr(` ${m[3]}`, a); if (v !== undefined && (a.endsWith('span') ? /^\d{1,2}$/.test(v) : true)) garde.push(`${a}="${esc(entites(v)).slice(0, 300)}"`); }
    if (nom === 'img') {
      const src = attr(` ${m[3]}`, 'src') ?? attr(` ${m[3]}`, 'xlink:href'); if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || !z) continue;
      const chemin = posix.normalize(posix.join(posix.dirname(chapitre), sansAncre(src))), type = IMG_TYPE[posix.extname(chemin).toLowerCase()];
      const data = type ? z.lire(chemin) : undefined; if (!data || data.length > maxImage) continue;
      out.push(`<img src="data:${type};base64,${data.toString('base64')}"${garde.length ? ` ${garde.join(' ')}` : ''}>`); continue;
    }
    out.push(`<${nom}${garde.length ? ` ${garde.join(' ')}` : ''}>`);
    if (!VIDES.has(nom) && !m[4]) ouvertes.push(nom);
  }
  while (ouvertes.length) out.push(`</${ouvertes.pop()}>`);
  return out.join('').trim();
}

// ------------------------------------------------------------------ CBZ

const EST_IMAGE = /\.(jpe?g|png|gif|webp|avif)$/i;
/** Les pages d'une bande dessinée : les images, dans l'ordre naturel des noms (« 2 » avant « 10 »). Pur. */
export function images(z: Zip): string[] {
  return z.entrees.map((e) => e.nom).filter((n) => EST_IMAGE.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n)).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' }));
}

// ------------------------------------------------------------------ Lire une page

export type PageLivre =
  | { type: 'html'; livre: string; titre: string; chapitre: number; total: number; chapitres: string[]; html: string }
  | { type: 'image'; livre: string; titre: string; chapitre: number; total: number; image: string };

/** Un chapitre (EPUB) ou une page (CBZ) d'un livre de la bibliothèque, prêt à afficher. */
export function lirePage(dir: string, l: Livre, n: number): PageLivre {
  const f = fichierLivre(dir, l); if (!existsSync(f)) throw new Error(`le fichier de « ${l.titre} » a disparu : ajoute-le de nouveau`);
  const z = ouvrirZip(readFileSync(f));
  if (l.format === 'cbz') {
    const pages = images(z), i = Math.min(Math.max(0, Math.floor(n) || 0), pages.length - 1), nom = pages[i];
    const ext = posix.extname(nom).toLowerCase(), type = IMG_TYPE[ext] || 'image/jpeg';
    return { type: 'image', livre: l.id, titre: l.titre, chapitre: i, total: pages.length, image: `data:${type};base64,${z.lire(nom)!.toString('base64')}` };
  }
  const e = lireEpub(z), i = Math.min(Math.max(0, Math.floor(n) || 0), e.chapitres.length - 1), c = e.chapitres[i];
  return { type: 'html', livre: l.id, titre: l.titre, chapitre: i, total: e.chapitres.length, chapitres: e.chapitres.map((x) => x.titre), html: nettoyer(z.lire(c.href)?.toString('utf8') ?? '', c.href, z) };
}

// ------------------------------------------------------------------ Livres audio par chapitres

export interface ChapitreAudio { title: string; start: number; end: number }
/** Les chapitres renvoyés par Venus, remis en ordre et vérifiés (pur). */
export function chapitresAudio(r: unknown): ChapitreAudio[] {
  const l = (r && typeof r === 'object' && Array.isArray((r as { chapters?: unknown }).chapters) ? (r as { chapters: unknown[] }).chapters : Array.isArray(r) ? r : []) as Array<Record<string, unknown>>;
  return l.map((c, i) => ({ title: s(c.title) || `Chapitre ${i + 1}`, start: Number(c.start) || 0, end: Number(c.end) || 0 })).filter((c) => c.end >= c.start).sort((a, b) => a.start - b.start);
}
const hms = (t: number) => { const x = Math.max(0, Math.floor(t)), h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), sec = x % 60; return `${h ? `${h} h ` : ''}${String(m).padStart(h ? 2 : 1, '0')} min ${String(sec).padStart(2, '0')} s`; };
/** Où reprendre un livre audio : le chapitre et la position dans ce chapitre (secondes), d'après la progression gardée (pur). */
export function reprise(ch: ChapitreAudio[], p?: Progression): { chapitre: number; position: number; texte: string } {
  if (!ch.length) return { chapitre: 0, position: 0, texte: 'Venus ne donne pas de chapitres pour ce livre audio.' };
  const i = Math.min(Math.max(0, p?.chapitre ?? 0), ch.length - 1), c = ch[i], duree = c.end - c.start;
  // Un chapitre presque fini (moins de 5 s) : on reprend au début du suivant.
  if (p && duree > 0 && p.position >= duree - 5 && i + 1 < ch.length) return { chapitre: i + 1, position: 0, texte: `Reprise au début du chapitre ${i + 2} : ${ch[i + 1].title}.` };
  const pos = Math.min(Math.max(0, p?.position ?? 0), Math.max(0, duree));
  return { chapitre: i, position: pos, texte: p ? `Reprise au chapitre ${i + 1} (${c.title}), à ${hms(pos)}.` : `Début : chapitre 1, ${c.title}.` };
}
/** La liste des chapitres en texte, le chapitre en cours marqué (pur). */
export function chapitresText(ch: ChapitreAudio[], en = -1): string {
  return ch.map((c, i) => `${i === en ? '▶' : '-'} ${i + 1}. ${c.title} · ${hms(c.end - c.start)}`).join('\n') || 'Aucun chapitre.';
}
