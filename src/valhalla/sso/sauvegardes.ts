// Sauvegarde des applis sur Odin (/api/sauvegardes/<appli>) : chaque appli cliente (Vénus, Pégase…) envoie toute sa base
// (ou ses changements) avec le jeton de la personne connectée ; Odin garde les versions, chiffrées au repos (AES-256-GCM,
// clé tirée de la clé du coffre d'Odin), dans le dossier de l'appli d'Odin, un jeu par personne. Envoi et téléchargement
// en flux : une grosse base ne passe jamais toute en mémoire.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ModCtx } from '../types.ts';
import { cleDuCoffre } from './jwt.ts';
import { client, dossierSauvegardes, persona, TAILLE_MAX } from './etat.ts';
import { erreur, json, lireJeton } from './oidc.ts';

export interface Version { id: string; date: number; taille: number; empreinte: string; sorte: 'complete' | 'changements'; raison: string; nom: string; base: string | null; appareil: string }
interface Index { versions: Version[]; restaurer?: string | null; journal: Array<{ t: number; texte: string }> }
const MAGIC = Buffer.from('OSV1');
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
const dec = (v: unknown) => { try { return decodeURIComponent(s(v)); } catch { return s(v); } };

function lireIndex(dir: string): Index { try { const j = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as Index; return { versions: j.versions ?? [], restaurer: j.restaurer ?? null, journal: j.journal ?? [] }; } catch { return { versions: [], restaurer: null, journal: [] }; } }
function ecrireIndex(dir: string, ix: Index): void { mkdirSync(dir, { recursive: true }); const f = join(dir, 'index.json'), tmp = `${f}.tmp`; writeFileSync(tmp, JSON.stringify({ ...ix, journal: ix.journal.slice(-300) }, null, 1), { mode: 0o600 }); renameSync(tmp, f); }
const cleDe = (appli: string, login: string) => cleDuCoffre(`sauvegardes-v1:${appli}:${login}`);
const tri = (l: Version[]) => [...l].sort((a, b) => b.date - a.date);

/**
 * Les versions à garder (pur) : tout ce qui a moins de 48 h (100 au plus), puis une complète par jour 30 jours, puis une par
 * mois 12 mois ; la dernière complète toujours ; les changements, 48 h ou jusqu'à la complète suivante.
 */
export function aGarder(l: Version[], now: number): Set<string> {
  const keep = new Set<string>(), v = tri(l), H48 = 48 * 3600_000, J = 86_400_000;
  const derniereComplete = v.find((x) => x.sorte === 'complete');
  if (derniereComplete) keep.add(derniereComplete.id);
  for (const x of v.filter((y) => now - y.date < H48).slice(0, 100)) keep.add(x.id);
  for (const x of v) if (x.sorte === 'changements' && derniereComplete && x.date >= derniereComplete.date) keep.add(x.id);
  const jours = new Set<string>(), mois = new Set<string>();
  for (const x of v.filter((y) => y.sorte === 'complete')) {
    const d = new Date(x.date).toISOString(), j = d.slice(0, 10), m = d.slice(0, 7);
    if (now - x.date < 30 * J && !jours.has(j)) { jours.add(j); keep.add(x.id); }
    else if (now - x.date < 365 * J && !mois.has(m)) { mois.add(m); keep.add(x.id); }
  }
  return keep;
}

/** Les jeux de sauvegarde d'une appli (un par personne), pour la page de l'appli dans Odin. */
export function jeux(appli: string): Array<{ login: string; versions: Version[]; restaurer: string | null; journal: Index['journal'] }> {
  const ctx = persona(); if (!ctx) return [];
  const base = join(dossierSauvegardes(ctx, appli, 'x'), '..');
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => { const ix = lireIndex(join(base, e.name)); return { login: e.name, versions: tri(ix.versions), restaurer: ix.restaurer ?? null, journal: ix.journal }; }).filter((x) => x.versions.length);
}
/** « Restaurer » depuis la page d'Odin : l'appli le voit à sa prochaine vérification d'empreinte. */
export function demanderRestauration(appli: string, login: string, version: string): string {
  const ctx = persona(); if (!ctx) throw new Error('Persona ne tourne pas');
  const dir = dossierSauvegardes(ctx, appli, login), ix = lireIndex(dir), v = ix.versions.find((x) => x.id === version);
  if (!v) throw new Error(`version « ${version} » introuvable pour ${login}`);
  ix.restaurer = v.id; ix.journal.push({ t: Date.now(), texte: `restauration de ${v.id} demandée depuis Odin` }); ecrireIndex(dir, ix);
  return v.id;
}

/** Envoie le contenu clair d'une version dans un flux (déchiffre en route). Rend false si elle est illisible. */
async function versionVers(ctx: ModCtx, appli: string, login: string, v: Version, res: NodeJS.WritableStream): Promise<void> {
  const f = join(dossierSauvegardes(ctx, appli, login), `${v.id}.osv`), cle = cleDe(appli, login); if (!cle) throw new Error('clé du coffre absente');
  const size = statSync(f).size, fd = openSync(f, 'r'), head = Buffer.alloc(16), tag = Buffer.alloc(16);
  try { readSync(fd, head, 0, 16, 0); readSync(fd, tag, 0, 16, size - 16); } finally { closeSync(fd); }
  if (!head.subarray(0, 4).equals(MAGIC)) throw new Error('fichier de sauvegarde illisible');
  const d = createDecipheriv('aes-256-gcm', cle, head.subarray(4, 16)); d.setAuthTag(tag);
  if (size - 32 <= 0) { d.final(); return; }
  await pipeline(createReadStream(f, { start: 16, end: size - 17 }), d, res);
}
/** Le contenu clair d'une version (essais, petites bases). */
export async function lireVersion(appli: string, login: string, id: string): Promise<Buffer> {
  const ctx = persona(); if (!ctx) throw new Error('Persona ne tourne pas');
  const v = lireIndex(dossierSauvegardes(ctx, appli, login)).versions.find((x) => x.id === id); if (!v) throw new Error('version introuvable');
  const parts: Buffer[] = []; const { Writable } = await import('node:stream');
  await versionVers(ctx, appli, login, v, new Writable({ write(c, _e, cb) { parts.push(c as Buffer); cb(); } }));
  return Buffer.concat(parts);
}

/** Les routes /api/sauvegardes/<appli>[/empreinte|/restauree|/<version>]. Rend true si la requête est servie. */
export async function routeSauvegardes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const m = /^\/api\/sauvegardes\/([a-z0-9_-]{1,40})(?:\/([A-Za-z0-9_-]{1,60}))?\/?$/.exec(url.pathname);
  if (!url.pathname.startsWith('/api/sauvegardes/')) return false;
  const ctx = persona();
  if (!ctx) { erreur(res, 503, 'indisponible', 'Les applis d\'Odin ne tournent pas : réessaie dans un moment.'); return true; }
  if (!m) { erreur(res, 404, 'introuvable', 'Adresse inconnue.'); return true; }
  const appli = m[1], sous = m[2] ?? '', c = client(ctx, appli);
  if (!c || c.id === 'odin') { erreur(res, 404, 'appli_inconnue', `L'appli « ${appli} » n'est pas déclarée dans Odin (Persona → Applis).`); return true; }
  const j = lireJeton(ctx, req);
  if (!j.ok) { erreur(res, j.status, j.code, j.message, {}, { 'www-authenticate': 'Bearer error="invalid_token"' }); return true; }
  if (j.charge.aud !== appli) { erreur(res, 403, 'mauvaise_appli', `Ce jeton est celui de ${String(j.charge.aud)} : connecte ${c.nom} à Odin (ou échange le jeton du poste).`); return true; }
  const login = j.p.login, dir = dossierSauvegardes(ctx, appli, login), cle = cleDe(appli, login);
  if (!cle) { erreur(res, 503, 'indisponible', 'La clé du coffre d\'Odin manque : redémarre Odin (il la crée au démarrage).'); return true; }
  const ix = lireIndex(dir), versions = tri(ix.versions), derniere = versions[0] ?? null, max = c.tailleMax ?? TAILLE_MAX;
  const meth = req.method ?? 'GET';
  if (!sous && meth === 'GET') { json(res, 200, { ok: true, appli, versions, derniere, taille_totale: versions.reduce((a, v) => a + v.taille, 0), taille_max: max, restaurer: ix.restaurer ?? null }); return true; }
  if (sous === 'empreinte' && meth === 'GET') { json(res, 200, { ok: true, empreinte: derniere?.empreinte ?? null, version: derniere?.id ?? null, date: derniere?.date ?? null, restaurer: ix.restaurer ?? null }); return true; }
  if (sous === 'restauree' && meth === 'POST') {
    const parts: Buffer[] = []; for await (const ch of req) { parts.push(ch as Buffer); if (parts.length > 64) break; }
    let v = ''; try { v = s((JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as { version?: unknown }).version); } catch { /* vide */ }
    ix.journal.push({ t: Date.now(), texte: `restaurée par ${c.nom} (${j.session.appareil.nom}) : ${v || 'version non dite'}` }); if (!v || v === ix.restaurer) ix.restaurer = null; ecrireIndex(dir, ix);
    json(res, 200, { ok: true }); return true;
  }
  if (!sous && meth === 'POST') { await recevoir(req, res, ctx, appli, login, dir, cle, max, ix, j.session.appareil.nom); return true; }
  if (sous && meth === 'GET') {
    const v = versions.find((x) => x.id === sous); if (!v) { erreur(res, 404, 'introuvable', 'Cette version n\'existe pas (ou plus).'); return true; }
    const ascii = v.nom.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(v.taille), 'content-disposition': `attachment; filename="${ascii}"`, 'x-odin-empreinte': v.empreinte, 'x-odin-sorte': v.sorte, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    try { await versionVers(ctx, appli, login, v, res); } catch { res.destroy(); }
    return true;
  }
  erreur(res, 405, 'requete_invalide', 'Méthode refusée.'); return true;
}

async function recevoir(req: IncomingMessage, res: ServerResponse, ctx: ModCtx, appli: string, login: string, dir: string, cle: Buffer, max: number, ix: Index, appareil: string): Promise<void> {
  const want = s(req.headers['x-odin-empreinte']).toLowerCase(), sorte = s(req.headers['x-odin-sorte']) || 'complete', base = s(req.headers['x-odin-base']);
  if (!/^[a-f0-9]{64}$/.test(want)) return erreur(res, 400, 'requete_invalide', 'En-tête x-odin-empreinte : le SHA-256 du contenu (64 caractères hexadécimaux).');
  if (sorte !== 'complete' && sorte !== 'changements') return erreur(res, 400, 'requete_invalide', 'x-odin-sorte : complete ou changements.');
  if (sorte === 'changements' && !ix.versions.some((v) => v.id === base && v.sorte === 'complete')) return erreur(res, 400, 'requete_invalide', 'x-odin-base : la version complète sur laquelle s\'appliquent ces changements.');
  if (Number(req.headers['content-length'] ?? 0) > max) { req.resume(); return erreur(res, 413, 'trop_gros', `Sauvegarde trop grosse (au plus ${Math.round(max / 1048576)} Mo, réglable dans Persona → Applis).`, { limite: max }); }
  const derniere = tri(ix.versions)[0];
  mkdirSync(dir, { recursive: true });
  const now = Date.now(), id = `v${new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(2).toString('hex')}`, tmp = join(dir, `.${id}.tmp`);
  const iv = randomBytes(12), ci = createCipheriv('aes-256-gcm', cle, iv), h = createHash('sha256'), ws = createWriteStream(tmp, { mode: 0o600 });
  let n = 0, trop = false;
  const fin = new Promise<void>((ok, ko) => { ws.on('finish', ok); ws.on('error', ko); });
  ws.write(MAGIC); ws.write(iv);
  try {
    for await (const ch of req) {
      const b = ch as Buffer; n += b.length; if (n > max) { trop = true; break; }
      h.update(b); if (!ws.write(ci.update(b))) await new Promise<void>((r) => { ws.once('drain', () => r()); });
    }
    ws.write(ci.final()); ws.end(ci.getAuthTag()); await fin;
  } catch { ws.destroy(); rmSync(tmp, { force: true }); return erreur(res, 400, 'requete_invalide', 'Envoi interrompu : renvoie la sauvegarde.'); }
  if (trop) { rmSync(tmp, { force: true }); req.resume(); return erreur(res, 413, 'trop_gros', `Sauvegarde trop grosse (au plus ${Math.round(max / 1048576)} Mo, réglable dans Persona → Applis).`, { limite: max }); }
  const got = h.digest('hex');
  if (got !== want) { rmSync(tmp, { force: true }); return erreur(res, 400, 'empreinte_fausse', 'Le contenu reçu ne correspond pas à son empreinte : renvoie la sauvegarde.'); }
  if (derniere && derniere.empreinte === got && derniere.sorte === sorte) { rmSync(tmp, { force: true }); return json(res, 200, { ok: true, inchange: true, version: derniere }); }
  renameSync(tmp, join(dir, `${id}.osv`));
  const v: Version = { id, date: now, taille: n, empreinte: got, sorte, raison: dec(req.headers['x-odin-raison']).slice(0, 120), nom: dec(req.headers['x-odin-nom']).replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 120) || `${appli}-sauvegarde.bin`, base: sorte === 'changements' ? base : null, appareil };
  ix.versions.push(v); ix.journal.push({ t: now, texte: `${v.sorte === 'complete' ? 'sauvegarde complète' : 'changements'} reçue (${n} octets${v.raison ? `, ${v.raison}` : ''}) depuis ${appareil}` });
  const keep = aGarder(ix.versions, now);
  for (const x of ix.versions) if (!keep.has(x.id)) rmSync(join(dir, `${x.id}.osv`), { force: true });
  ix.versions = ix.versions.filter((x) => keep.has(x.id));
  ecrireIndex(dir, ix);
  ctx.emit('sauvegarde_appli', { appli, login, taille: n, sorte });
  json(res, 201, { ok: true, inchange: false, version: v });
}
