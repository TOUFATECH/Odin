// Plume partout : les routes /api/plume/* (contrat : docs/plume-protocole.md).
// Appelées par le serveur web avant la garde de la connexion unique : chaque personne (le propriétaire, un membre de
// Persona connecté à l'interface, ou la personne d'un Pégase) a son propre réglage, et seulement le sien.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { valhallaOf } from '../valhalla/odin.ts';
import { membreDe } from '../valhalla/sso/garde.ts';
import { lireJeton } from '../valhalla/sso/oidc.ts';
import { lierProprietaire, type Personne } from '../valhalla/sso/etat.ts';
import { identifier } from '../valhalla/pegase/identites.ts';
import { ajouterMot, changer, corrigerVif, etatPublic, ignorer, MAX_TEXTE_VIF, plumeCtx, plusIgnorer, PROPRIETAIRE, reglage, retirerMot, type Champ } from '../valhalla/snotra/partout.ts';

export interface DepsPlume {
  /** la requête vient-elle du propriétaire (session de son interface ou clé d'API) ? */ proprietaire(): boolean;
  /** son prénom (pour l'état) */ nomProprietaire: string;
  /** un essai de jeton raté (limite d'essais d'Odin) */ fail(): void;
  ip: string;
}
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
const refus = (res: ServerResponse, code: number, c: string, message: string) => json(res, code, { ok: false, code: c, message, error: message });

/** Qui demande ? `cle` : la clé du réglage (`@proprietaire` ou l'identifiant Persona). */
async function qui(req: IncomingMessage, d: DepsPlume): Promise<{ cle: string; nom: string; cookie: boolean } | { erreur: [number, string, string] }> {
  const bearer = /^Bearer\s+(\S+)$/i.exec(s(req.headers.authorization))?.[1] ?? '';
  const v = valhallaOf(), varCtx = v?.module('var') ? v.ctx('var') : undefined;
  // Le propriétaire d'Odin a un seul réglage, qu'il vienne de son interface, de son compte Persona ou de son Pégase (même e-mail).
  const cleDe = (p: Personne) => { const pr = varCtx ? lierProprietaire(varCtx) : undefined; return p.proprio || (pr && (p.id === pr.id || (pr.email && p.email && pr.email.toLowerCase() === p.email.toLowerCase()))) ? PROPRIETAIRE : p.login; };
  // Pégase : jeton d'appareil (pg1.…) ou jeton d'accès de la connexion unique (JWT, audience « pegase »).
  if (bearer && (bearer.startsWith('pg1.') || bearer.split('.').length === 3)) {
    if (!v || !varCtx) return { erreur: [503, 'indisponible', 'Persona n\'est pas démarré : réessaie dans un instant.'] };
    if (bearer.startsWith('pg1.')) {
      if (!v.module('pegase')) return { erreur: [503, 'indisponible', 'Pégase n\'est pas démarré dans Odin.'] };
      const id = await identifier(v.ctx('pegase'), varCtx, bearer, { proprietaire: d.nomProprietaire, ip: d.ip, req });
      if (!id.ok) { if (id.code === 'jeton_invalide') d.fail(); return { erreur: [id.http, id.code, id.texte] }; }
      return { cle: cleDe(id.personne as Personne), nom: id.personne.name, cookie: false };
    }
    const x = lireJeton(varCtx, req);
    if (!x.ok || x.charge.aud !== 'pegase') { d.fail(); return { erreur: x.ok ? [401, 'connexion', 'Ce jeton n\'est pas fait pour Pégase.'] : [x.status, x.code, x.message] }; }
    return { cle: cleDe(x.p), nom: x.p.name, cookie: false };
  }
  // Interface d'Odin : un membre de Persona (cookie de session), sinon le propriétaire (session ou clé d'API).
  const m = membreDe(s(req.headers.cookie));
  if (m) return { cle: cleDe(m.p), nom: m.p.name, cookie: true };
  if (d.proprietaire()) return { cle: PROPRIETAIRE, nom: d.nomProprietaire, cookie: !bearer };
  return { erreur: [401, 'connexion', 'Connecte-toi à Odin pour que Plume corrige.'] };
}

async function corps(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > 64 * 1024) return undefined; parts.push(c as Buffer); }
  try { const j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : undefined; } catch { return undefined; }
}

/** Rend true si la requête est servie ici. */
export async function plumeRoute(req: IncomingMessage, res: ServerResponse, url: URL, d: DepsPlume): Promise<boolean> {
  const route = url.pathname.slice('/api/plume/'.length), meth = req.method ?? 'GET';
  if (!['etat', 'corriger', 'reglages', 'dictionnaire', 'ignorer'].includes(route)) return false;
  const ctx = plumeCtx(valhallaOf());
  const q = await qui(req, d);
  if ('erreur' in q) { refus(res, ...q.erreur); return true; }
  if (meth === 'POST' && q.cookie && req.headers['x-odin'] !== '1') { refus(res, 403, 'x_odin', 'En-tête x-odin manquant.'); return true; }
  if (!ctx) { refus(res, 503, 'indisponible', 'Plume n\'est pas démarré dans Odin : réessaie dans un instant.'); return true; }
  if (meth !== 'GET' && meth !== 'POST') { refus(res, 405, 'methode', 'GET ou POST.'); return true; }
  if ((route === 'etat' || route === 'corriger' || route === 'reglages') && meth !== (route === 'etat' ? 'GET' : 'POST')) { refus(res, 405, 'methode', route === 'etat' ? 'GET attendu.' : 'POST attendu.'); return true; }
  let b: Record<string, unknown> = {};
  if (meth === 'POST') { const x = await corps(req); if (!x) { refus(res, 400, 'requete_invalide', 'Corps JSON attendu (64 Ko au plus).'); return true; } b = x; }
  const etat = () => etatPublic(ctx, q.cle, q.nom);

  if (route === 'etat') { json(res, 200, etat()); return true; }
  if (route === 'reglages') { changer(ctx, q.cle, b); json(res, 200, etat()); return true; }
  if (route === 'corriger') {
    const r = reglage(ctx, q.cle), ou = s(b.ou) === 'pegase' ? 'pegase' : 'odin';
    if (!r.actif || !r[ou]) { json(res, 200, { ok: true, actif: false, maj: r.maj, fautes: [] }); return true; }
    if (typeof b.texte !== 'string') { refus(res, 400, 'requete_invalide', 'Le texte manque.'); return true; }
    if (b.texte.length > MAX_TEXTE_VIF) { refus(res, 413, 'trop_long', `Texte trop long pour Plume en direct (${MAX_TEXTE_VIF} caractères au plus).`); return true; }
    const champ: Champ = s(b.champ) === 'recherche' ? 'recherche' : s(b.champ) === 'ligne' ? 'ligne' : 'texte';
    const c = await corrigerVif(ctx, b.texte, { grammaire: r.grammaire, champ, langue: s(b.langue) || r.langue, dico: r.dico, ignores: r.ignores });
    json(res, 200, { ok: true, actif: true, maj: r.maj, moteur: c.moteur, ms: c.ms, fautes: c.fautes, ...(c.incomplet ? { incomplet: true } : {}) }); return true;
  }
  if (route === 'dictionnaire') {
    if (meth === 'POST') {
      if (b.ajouter !== undefined) { const r = ajouterMot(ctx, q.cle, s(b.ajouter)); if (typeof r === 'string') { refus(res, 400, 'mot', r); return true; } }
      else if (b.retirer !== undefined) retirerMot(ctx, q.cle, s(b.retirer));
      else { refus(res, 400, 'requete_invalide', '« ajouter » ou « retirer » attendu.'); return true; }
    }
    json(res, 200, { ok: true, mots: reglage(ctx, q.cle).dico }); return true;
  }
  // ignorer
  if (meth === 'POST') {
    if (b.oublier === true) changer(ctx, q.cle, { ignores: [] });
    else if (b.retirer && typeof b.retirer === 'object') plusIgnorer(ctx, q.cle, b.retirer as { avant: string; regle: string });
    else if (s(b.avant)) ignorer(ctx, q.cle, { avant: String(b.avant), regle: s(b.regle) });
    else { refus(res, 400, 'requete_invalide', '« avant » (et « regle »), « retirer » ou « oublier » attendu.'); return true; }
  }
  json(res, 200, { ok: true, ignores: reglage(ctx, q.cle).ignores }); return true;
}
