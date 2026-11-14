// Import des FAVORIS d'un autre navigateur trouvé sur ce PC (code écrit pour Pégase, formats lus dans les fichiers) :
// - Chrome, Edge, Brave, Chromium, Vivaldi, Opera : fichier JSON « Bookmarks » de chaque profil (nom du profil dans « Local State »).
// - Arc : StorableSidebar.json (espaces → espaces de travail Pégase, onglets épinglés → onglets épinglés).
// - Firefox : dernière sauvegarde « bookmarkbackups/*.jsonlz4 » (format mozLz4 : en-tête + bloc LZ4, décompressé ici).
// L'historique de ces navigateurs est en SQLite : il n'est PAS lu (exception pas encore accordée par le propriétaire).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';

export interface Lien { titre: string; url: string; dossier: string[] }
export interface ProfilNav { navigateur: string; id: string; nom: string; chemin: string; type: 'chromium' | 'firefox' | 'arc'; n?: number }
export interface EspaceArc { nom: string; epingles: Lien[] }

const ESSAI = !app.isPackaged && !!process.env.PEGASE_ESSAI;
const maison = () => (ESSAI && process.env.PEGASE_IMPORT_RACINE) || homedir();
const lireJson = (f: string): any => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/** Les dossiers où chaque navigateur range ses profils, selon le système. */
function racines(): { navigateur: string; type: ProfilNav['type']; dossier: string }[] {
  const h = maison(), plat = ESSAI && process.env.PEGASE_IMPORT_SYSTEME ? process.env.PEGASE_IMPORT_SYSTEME : process.platform;
  const loc = (ESSAI && process.env.PEGASE_IMPORT_RACINE) ? join(h, 'AppData', 'Local') : (process.env.LOCALAPPDATA || join(h, 'AppData', 'Local'));
  const roa = (ESSAI && process.env.PEGASE_IMPORT_RACINE) ? join(h, 'AppData', 'Roaming') : (process.env.APPDATA || join(h, 'AppData', 'Roaming'));
  if (plat === 'win32') return [
    { navigateur: 'Chrome', type: 'chromium', dossier: join(loc, 'Google', 'Chrome', 'User Data') },
    { navigateur: 'Edge', type: 'chromium', dossier: join(loc, 'Microsoft', 'Edge', 'User Data') },
    { navigateur: 'Brave', type: 'chromium', dossier: join(loc, 'BraveSoftware', 'Brave-Browser', 'User Data') },
    { navigateur: 'Vivaldi', type: 'chromium', dossier: join(loc, 'Vivaldi', 'User Data') },
    { navigateur: 'Opera', type: 'chromium', dossier: join(roa, 'Opera Software', 'Opera Stable') },
    { navigateur: 'Firefox', type: 'firefox', dossier: join(roa, 'Mozilla', 'Firefox') },
    ...arcWindows(loc),
  ];
  if (plat === 'darwin') { const a = join(h, 'Library', 'Application Support'); return [
    { navigateur: 'Chrome', type: 'chromium', dossier: join(a, 'Google', 'Chrome') },
    { navigateur: 'Edge', type: 'chromium', dossier: join(a, 'Microsoft Edge') },
    { navigateur: 'Brave', type: 'chromium', dossier: join(a, 'BraveSoftware', 'Brave-Browser') },
    { navigateur: 'Vivaldi', type: 'chromium', dossier: join(a, 'Vivaldi') },
    { navigateur: 'Firefox', type: 'firefox', dossier: join(a, 'Firefox') },
    { navigateur: 'Arc', type: 'arc', dossier: join(a, 'Arc') },
  ]; }
  const c = join(h, '.config');
  return [
    { navigateur: 'Chrome', type: 'chromium', dossier: join(c, 'google-chrome') },
    { navigateur: 'Chromium', type: 'chromium', dossier: join(c, 'chromium') },
    { navigateur: 'Edge', type: 'chromium', dossier: join(c, 'microsoft-edge') },
    { navigateur: 'Brave', type: 'chromium', dossier: join(c, 'BraveSoftware', 'Brave-Browser') },
    { navigateur: 'Vivaldi', type: 'chromium', dossier: join(c, 'vivaldi') },
    { navigateur: 'Firefox', type: 'firefox', dossier: join(h, '.mozilla', 'firefox') },
    { navigateur: 'Firefox', type: 'firefox', dossier: join(h, 'snap', 'firefox', 'common', '.mozilla', 'firefox') },
    { navigateur: 'Firefox', type: 'firefox', dossier: join(h, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox') },
  ];
}
function arcWindows(loc: string) {
  const p = join(loc, 'Packages'); if (!existsSync(p)) return [];
  try { return readdirSync(p).filter((d) => d.startsWith('TheBrowserCompany.Arc')).map((d) => ({ navigateur: 'Arc', type: 'arc' as const, dossier: join(p, d, 'LocalCache', 'Local', 'Arc') })); } catch { return []; }
}

/** Les profils des navigateurs installés sur ce PC (avec le nombre de favoris). */
export function detecter(): ProfilNav[] {
  const out: ProfilNav[] = [];
  for (const r of racines()) {
    if (!existsSync(r.dossier)) continue;
    try {
      if (r.type === 'chromium') {
        const noms: Record<string, string> = lireJson(join(r.dossier, 'Local State'))?.profile?.info_cache ? Object.fromEntries(Object.entries(lireJson(join(r.dossier, 'Local State')).profile.info_cache).map(([k, v]: [string, any]) => [k, v?.name ?? k])) : {};
        const dossiers = existsSync(join(r.dossier, 'Bookmarks')) ? [''] : readdirSync(r.dossier).filter((d) => d === 'Default' || /^Profile \d+$/.test(d));
        for (const d of dossiers) {
          const f = join(r.dossier, d, 'Bookmarks'); if (!existsSync(f)) continue;
          out.push({ navigateur: r.navigateur, type: 'chromium', id: `${r.navigateur}:${d || 'Default'}`, nom: noms[d] ?? (d === 'Default' || !d ? 'Profil principal' : d), chemin: f, n: lireChromium(f).length });
        }
      } else if (r.type === 'firefox') {
        for (const pr of profilsFirefox(r.dossier)) { const b = derniereSauvegardeFirefox(pr.chemin); if (b) out.push({ navigateur: 'Firefox', type: 'firefox', id: `Firefox:${pr.nom}`, nom: pr.nom, chemin: b, n: lireFirefox(b).length }); }
      } else {
        const f = join(r.dossier, 'StorableSidebar.json'); if (existsSync(f)) { const a = lireArc(f); out.push({ navigateur: 'Arc', type: 'arc', id: 'Arc:barre', nom: 'Barre de côté', chemin: f, n: a.reduce((s, e) => s + e.epingles.length, 0) }); }
      }
    } catch { /* profil illisible : ignoré */ }
  }
  return out;
}

// ————— Chrome et cousins —————
export function lireChromium(fichier: string): Lien[] {
  const j = lireJson(fichier); const out: Lien[] = [];
  const noms: Record<string, string> = { bookmark_bar: 'Barre de favoris', other: 'Autres favoris', synced: 'Favoris du mobile' };
  const tour = (n: any, chemin: string[]) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'url' && typeof n.url === 'string' && /^(https?|ftp):/i.test(n.url)) out.push({ titre: String(n.name ?? n.url).slice(0, 300), url: n.url, dossier: chemin });
    else if (Array.isArray(n.children)) for (const c of n.children) tour(c, n.type === 'folder' && n.name ? [...chemin, String(n.name).slice(0, 120)] : chemin);
  };
  for (const [k, v] of Object.entries<any>(j?.roots ?? {})) if (v && typeof v === 'object' && Array.isArray(v.children)) for (const c of v.children) tour(c, k === 'bookmark_bar' ? [] : [noms[k] ?? k]);
  return out;
}

// ————— Firefox —————
function profilsFirefox(dossier: string): { nom: string; chemin: string }[] {
  const ini = join(dossier, 'profiles.ini'); const out: { nom: string; chemin: string }[] = [];
  if (existsSync(ini)) {
    let cur: Record<string, string> = {};
    const fin = () => { if (cur.Path) out.push({ nom: cur.Name || cur.Path, chemin: cur.IsRelative === '0' ? cur.Path : join(dossier, ...cur.Path.split('/')) }); cur = {}; };
    for (const l of readFileSync(ini, 'utf8').split(/\r?\n/)) { if (/^\[/.test(l)) fin(); else { const i = l.indexOf('='); if (i > 0) cur[l.slice(0, i).trim()] = l.slice(i + 1).trim(); } }
    fin();
  }
  const p = join(dossier, 'Profiles'); const p2 = existsSync(p) ? p : dossier;
  try { for (const d of readdirSync(p2)) { const c = join(p2, d); if (existsSync(join(c, 'bookmarkbackups')) && !out.some((x) => x.chemin === c)) out.push({ nom: d.replace(/^[a-z0-9]{8}\./, ''), chemin: c }); } } catch { /* */ }
  return out.filter((x) => existsSync(join(x.chemin, 'bookmarkbackups')));
}
function derniereSauvegardeFirefox(profil: string): string | null {
  const d = join(profil, 'bookmarkbackups');
  try { const l = readdirSync(d).filter((f) => /\.(jsonlz4|baklz4|json)$/.test(f)).map((f) => ({ f: join(d, f), t: statSync(join(d, f)).mtimeMs })).sort((a, b) => b.t - a.t); return l[0]?.f ?? null; } catch { return null; }
}

/** Décompresse un bloc LZ4 (format « block », sans en-tête de trame). */
export function lz4Bloc(src: Buffer, taille: number): Buffer {
  const out = Buffer.alloc(taille); let i = 0, o = 0;
  while (i < src.length) {
    const jeton = src[i++];
    let lit = jeton >> 4;
    if (lit === 15) { let b; do { b = src[i++]; lit += b; } while (b === 255 && i < src.length); }
    if (o + lit > taille || i + lit > src.length) throw new Error('LZ4 abîmé (littéraux)');
    src.copy(out, o, i, i + lit); i += lit; o += lit;
    if (i >= src.length) break; // le dernier groupe n'a que des littéraux
    const decalage = src[i] | (src[i + 1] << 8); i += 2;
    if (!decalage || decalage > o) throw new Error('LZ4 abîmé (décalage)');
    let n = jeton & 15;
    if (n === 15) { let b; do { b = src[i++]; n += b; } while (b === 255 && i < src.length); }
    n += 4;
    if (o + n > taille) throw new Error('LZ4 abîmé (copie)');
    for (let k = 0; k < n; k++, o++) out[o] = out[o - decalage]; // les copies peuvent se chevaucher
  }
  return o === taille ? out : out.subarray(0, o);
}
/** Le format mozLz4 de Firefox : « mozLz40\0 », la taille décompressée (32 bits, petit-boutiste), puis un bloc LZ4. */
export function mozLz4(b: Buffer): Buffer {
  if (b.subarray(0, 8).toString('latin1') !== 'mozLz40\0') throw new Error('pas un fichier mozLz4');
  return lz4Bloc(b.subarray(12), b.readUInt32LE(8));
}
export function lireFirefox(fichier: string): Lien[] {
  const brut = readFileSync(fichier);
  const j = JSON.parse((fichier.endsWith('.json') ? brut : mozLz4(brut)).toString('utf8'));
  const out: Lien[] = [];
  const noms: Record<string, string> = { toolbar: '', menu: 'Menu des marque-pages', unfiled: 'Autres marque-pages', mobile: 'Marque-pages du mobile' };
  const tour = (n: any, chemin: string[], prof: number) => {
    if (!n || prof > 40) return;
    if (n.type === 'text/x-moz-place' && typeof n.uri === 'string' && /^(https?|ftp):/i.test(n.uri)) out.push({ titre: String(n.title || n.uri).slice(0, 300), url: n.uri, dossier: chemin });
    else if (Array.isArray(n.children)) {
      const nom = prof === 1 ? (noms[n.root === 'toolbarFolder' ? 'toolbar' : n.root === 'bookmarksMenuFolder' ? 'menu' : n.root === 'unfiledBookmarksFolder' ? 'unfiled' : n.root === 'mobileFolder' ? 'mobile' : ''] ?? n.title) : n.title;
      for (const c of n.children) tour(c, prof === 0 || !nom ? chemin : [...chemin, String(nom).slice(0, 120)], prof + 1);
    }
  };
  tour(j, [], 0);
  return out;
}

// ————— Arc —————
/** Les listes d'Arc sont parfois [id, objet, id, objet…], parfois un objet { id: objet }. */
function paires(x: any): Map<string, any> {
  const m = new Map<string, any>();
  if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) { if (typeof x[i] === 'string' && x[i + 1] && typeof x[i + 1] === 'object') { m.set(x[i], x[i + 1]); i++; } else if (x[i]?.id) m.set(x[i].id, x[i]); } }
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) m.set(k, v);
  return m;
}
export function lireArc(fichier: string): EspaceArc[] {
  const j = lireJson(fichier); const out: EspaceArc[] = [];
  const conts: any[] = j?.sidebar?.containers ?? [];
  const c = conts.find((x) => x?.spaces && x?.items); if (!c) return out;
  const items = paires(c.items), espaces = paires(c.spaces);
  const tour = (id: string, chemin: string[], acc: Lien[], prof: number) => {
    const it = items.get(id); if (!it || prof > 30) return;
    const tab = it.data?.tab;
    if (tab?.savedURL && /^https?:/i.test(tab.savedURL)) acc.push({ titre: String(it.title || tab.savedTitle || tab.savedURL).slice(0, 300), url: tab.savedURL, dossier: chemin });
    for (const k of it.childrenIds ?? []) tour(k, tab ? chemin : (it.title && prof > 0 ? [...chemin, String(it.title).slice(0, 120)] : chemin), acc, prof + 1);
  };
  for (const [, e] of espaces) {
    const ids: any[] = e?.containerIDs ?? []; const k = ids.indexOf('pinned'); const cont = k >= 0 ? ids[k + 1] : null;
    const l: Lien[] = []; if (cont) tour(cont, [], l, 0);
    out.push({ nom: String(e?.title || 'Espace Arc').slice(0, 40), epingles: l });
  }
  return out;
}
