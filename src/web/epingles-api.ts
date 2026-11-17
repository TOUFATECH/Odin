// Les épingles du menu d'Odin : les applis (et les vues) qu'on garde sous « Plus » pour les ouvrir vite.
// Gardées sur le serveur, par compte (le même menu sur l'ordinateur et le téléphone) : le propriétaire (sa session, sa
// clé d'API ou son compte Persona) a les siennes, chaque membre de la maison les siennes, et un membre n'épingle que ce
// qu'il a le droit d'ouvrir. Route appelée par le serveur web AVANT la garde des membres : elle filtre elle-même.
// Rangement : <home>/interface/epingles.json { [clé]: string[] }, écrit d'un coup.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { valhallaOf } from '../valhalla/odin.ts';
import { membreDe } from '../valhalla/sso/garde.ts';
import { aDroit, lierProprietaire, type Personne } from '../valhalla/sso/etat.ts';
import { PROPRIETAIRE } from '../valhalla/snotra/partout.ts';

export const MAX_EPINGLES = 12;
/** Les vues rangées sous « Plus », dans l'ordre du menu (réservées au propriétaire). */
export const VUES: Array<{ id: string; nom: string }> = [
  { id: 'vue:flows', nom: 'Automatisations' }, { id: 'vue:runes', nom: 'Papyrus' }, { id: 'vue:missions', nom: 'Activité' },
  { id: 'vue:skills', nom: 'Compétences' }, { id: 'vue:jobs', nom: 'Tâches planifiées' }, { id: 'vue:audit', nom: 'Journal' },
  { id: 'vue:profil', nom: 'Profil' },
];
export type EtatEpingles = Record<string, string[]>;
export type Reponse = { ok: true; epingles: string[]; max?: number; proprietaire?: boolean; vues?: Array<{ id: string; nom: string }> } | { ok: false; code: 'max' | 'interdit' | 'inconnu' | 'invalide'; error: string };

const estVue = (id: string) => VUES.some((v) => v.id === id);
/**
 * Lit ou change les épingles d'une clé (fonction pure). `aDroit(appli)` : l'appli existe et cette personne peut l'ouvrir.
 * Sans `corps` : la lecture. Rend le nouvel état (à écrire seulement s'il a changé) et la réponse.
 */
export function traiterEpingles(etat: EtatEpingles, cle: string, estProprio: boolean, aDroitA: (appli: string) => boolean, corps?: Record<string, unknown>): { etat: EtatEpingles; change: boolean; reponse: Reponse } {
  const valide = (id: string) => (id.startsWith('vue:') ? estProprio && estVue(id) : id.startsWith('appli:') && aDroitA(id.slice(6)));
  const brut = Object.prototype.hasOwnProperty.call(etat, cle) ? etat[cle] : estProprio ? VUES.map((v) => v.id) : [];
  const liste = [...new Set((Array.isArray(brut) ? brut : []).filter((x) => typeof x === 'string' && valide(x)))];
  const lu = (l: string[]): Reponse => ({ ok: true, epingles: l, max: MAX_EPINGLES, proprietaire: estProprio, vues: estProprio ? VUES : [] });
  const refus = (code: 'max' | 'interdit' | 'inconnu' | 'invalide', error: string) => ({ etat, change: false, reponse: { ok: false as const, code, error } });
  const pose = (l: string[]) => {
    const e: EtatEpingles = { ...etat, [cle]: l };
    // 500 clés au plus : les plus anciennes partent d'abord (jamais celle du propriétaire).
    const cles = Object.keys(e).filter((k) => k !== PROPRIETAIRE && k !== cle);
    for (const k of cles.slice(0, Math.max(0, Object.keys(e).length - 500))) delete e[k];
    return { etat: e, change: true, reponse: { ok: true as const, epingles: l } };
  };
  if (!corps) return { etat, change: false, reponse: lu(liste) };
  const faire = String(corps.faire ?? ''), id = String(corps.id ?? '').trim();
  switch (faire) {
    case 'epingler': {
      if (id.startsWith('vue:')) { if (!estVue(id)) return refus('inconnu', 'Vue inconnue.'); if (!estProprio) return refus('interdit', 'Seul le propriétaire épingle les vues d\'Odin.'); }
      else if (!id.startsWith('appli:') || !/^appli:[\w-]{1,40}$/.test(id)) return refus('inconnu', 'Appli inconnue.');
      else if (!aDroitA(id.slice(6))) return refus('interdit', 'Tu n\'as pas accès à cette appli.');
      if (liste.includes(id)) return { etat, change: false, reponse: { ok: true, epingles: liste } };
      if (id.startsWith('appli:') && liste.filter((x) => x.startsWith('appli:')).length >= MAX_EPINGLES) return refus('max', `${MAX_EPINGLES} applis épinglées au plus : retires-en une d'abord.`);
      return pose([...liste, id]);
    }
    case 'retirer': return liste.includes(id) ? pose(liste.filter((x) => x !== id)) : { etat, change: false, reponse: { ok: true, epingles: liste } };
    case 'ordonner': {
      const o = corps.ordre;
      if (!Array.isArray(o) || o.some((x) => typeof x !== 'string') || o.length !== liste.length || new Set(o).size !== o.length || o.some((x) => !liste.includes(x as string))) return refus('invalide', 'Le nouvel ordre doit reprendre exactement les épingles actuelles.');
      return pose(o as string[]);
    }
    case 'defaut': { const e = { ...etat }; delete e[cle]; const l = estProprio ? VUES.map((v) => v.id) : []; return { etat: e, change: true, reponse: { ok: true, epingles: l } }; }
    default: return refus('invalide', '« faire » : epingler, retirer, ordonner ou defaut.');
  }
}

// ---------------------------------------------------------------- Rangement

export function lireEpingles(fichier: string): EtatEpingles {
  try { const j = JSON.parse(readFileSync(fichier, 'utf8')) as unknown; return j && typeof j === 'object' && !Array.isArray(j) ? j as EtatEpingles : {}; } catch { return {}; }
}
export function ecrireEpingles(fichier: string, e: EtatEpingles): void {
  mkdirSync(dirname(fichier), { recursive: true });
  const tmp = `${fichier}.tmp`; writeFileSync(tmp, JSON.stringify(e)); renameSync(tmp, fichier);
}
export const fichierEpingles = (home: string) => join(home, 'interface', 'epingles.json');

// ---------------------------------------------------------------- La route

export interface DepsEpingles { /** la requête vient-elle du propriétaire (session ou clé d'API) ? */ proprietaire(): boolean; /** un essai raté */ fail(): void }
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function corps(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > 16 * 1024) return undefined; parts.push(c as Buffer); }
  try { const j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : undefined; } catch { return undefined; }
}

/** GET et POST /api/epingles. Rend true si la requête est servie ici. */
export async function epinglesRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: DepsEpingles): Promise<boolean> {
  if (url.pathname !== '/api/epingles') return false;
  const meth = req.method ?? 'GET';
  if (meth !== 'GET' && meth !== 'POST') { json(res, 405, { ok: false, code: 'methode', error: 'GET ou POST.' }); return true; }
  const v = valhallaOf();
  if (!v) { json(res, 503, { ok: false, code: 'indisponible', error: 'Odin démarre : réessaie dans un instant.' }); return true; }
  // Qui demande ? Un membre de Persona (cookie), sinon le propriétaire (session ou clé d'API).
  const bearer = /^Bearer\s+\S+$/i.test(s(req.headers.authorization));
  const varCtx = v.module('var') ? v.ctx('var') : undefined;
  const m = membreDe(s(req.headers.cookie));
  let cle: string, proprio: boolean, personne: Personne | undefined;
  if (m) {
    const pr = varCtx ? lierProprietaire(varCtx) : undefined;
    proprio = Boolean(m.p.proprio || (pr && (m.p.id === pr.id || (pr.email && m.p.email && pr.email.toLowerCase() === m.p.email.toLowerCase()))));
    cle = proprio ? PROPRIETAIRE : m.p.login; personne = m.p;
  } else if (d.proprietaire()) { cle = PROPRIETAIRE; proprio = true; }
  else { json(res, 401, { ok: false, code: 'connexion', error: 'Connecte-toi à Odin.' }); return true; }
  if (meth === 'POST' && !bearer && req.headers['x-odin'] !== '1') { json(res, 403, { ok: false, code: 'x_odin', error: 'En-tête x-odin manquant.' }); return true; }
  const droit = (appli: string) => { const mod = v.modules().find((x) => x.id === appli); if (!mod) return false; if (proprio) return true; return Boolean(m && aDroit(m.ctx, personne, appli)); };
  const f = fichierEpingles(join(v.dir, '..'));
  let b: Record<string, unknown> | undefined;
  if (meth === 'POST') { b = await corps(req); if (!b) { json(res, 400, { ok: false, code: 'invalide', error: 'Corps JSON attendu.' }); return true; } }
  const r = traiterEpingles(lireEpingles(f), cle, proprio, droit, b);
  if (r.change) { try { ecrireEpingles(f, r.etat); } catch { json(res, 500, { ok: false, code: 'disque', error: 'Impossible d\'enregistrer les épingles.' }); return true; } }
  json(res, 200, r.reponse); return true;
}
