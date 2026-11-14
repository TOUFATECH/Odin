// Partage de la page d'une appli · les adresses web.
//   GET  /api/valhalla/partage?id=<appli>     ce qu'on peut exporter et partager pour cette appli, et ses partages
//   GET  /api/valhalla/partages[?id=<appli>]  les partages en cours
//   POST /api/valhalla/partage                créer un lien privé ou public (public : accord demandé)
//   POST /api/valhalla/partage_retirer        retirer un partage, ou tous
//   GET  /partage/<adresse secrète>           la copie figée : lecture seule, sans script, débit limité, jamais indexée
// Les quatre premières demandent la session du propriétaire (ou la clé d'API) ; la dernière est ouverte à qui a le lien
// (lien public) ou à qui est connecté (lien privé : toi, ou une personne de Persona invitée).
// L'export en fichier (Word, PDF, Markdown, JSON) est dans `export-api.ts`.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { isPrivateHost } from '../heimdall/policy.ts';
import { FORMATS, GOOGLE_ABSENT } from '../valhalla/export/fichier.ts';
import { STYLE_HASH, enHtml, h, pageHtml } from '../valhalla/export/html.ts';
import { dateFr, prendre, refusDe, retraitsDe } from '../valhalla/export/page.ts';
import { check as personneConnectee, portalUrl, within } from '../valhalla/modules/var.ts';
import { valhallaOf } from '../valhalla/odin.ts';
import { DUREE, Partages, type Partage } from '../valhalla/partage.ts';
import type { Valhalla } from '../valhalla/service.ts';
import { body } from './draupnir-api.ts';
import { json } from './export-api.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));

// ---------------------------------------------------------------- Le magasin des partages (un par Odin lancé)
const magasins = new WeakMap<Valhalla, Partages>();
/** L'heure d'Odin (celle des applis : les essais peuvent l'avancer). */
const horloge = (va: Valhalla): Date => { const m = va.modules()[0]; return m ? va.ctx(m.id).now() : new Date(); };
export function partagesDe(va: Valhalla): Partages {
  let x = magasins.get(va);
  if (!x) { x = new Partages(join(va.dir, 'partages'), () => horloge(va).getTime()); magasins.set(va, x); }
  return x;
}
/** Ce que la page voit d'un partage : tout sauf l'empreinte de son adresse. */
const vu = (p: Partage) => ({ id: p.id, appli: p.appli, nom: p.nom, type: p.type, cree: p.cree, fin: p.fin, ouvertures: p.ouvertures, derniere: p.derniere ?? null, onglet: p.onglet ?? null, poste: p.poste ?? null, personnes: p.personnes, groupes: p.groupes, masques: p.masques });

// ---------------------------------------------------------------- Les invités : les personnes de Persona
interface Personne { login: string; nom: string; groupes: string[] }
/** Les personnes qui ont un compte actif dans Persona (identifiant, nom, groupes ; jamais un mot de passe). */
async function personnes(va: Valhalla): Promise<Personne[]> {
  if (!va.modules().some((m) => m.id === 'var')) return [];
  try {
    const r = await va.act('var', 'personnes', {}, { by: 'toi' });
    const l = (r.data as { people?: Array<{ login?: unknown; name?: unknown; groups?: unknown; active?: unknown }> } | undefined)?.people ?? [];
    return l.filter((p) => p.active !== false && typeof p.login === 'string').map((p) => ({ login: String(p.login), nom: s(p.name) || String(p.login), groupes: Array.isArray(p.groups) ? p.groups.map(String) : [] }));
  } catch { return []; }
}
const hoteDe = (req: IncomingMessage) => String(req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
/** D'où ce lien pourra s'ouvrir, dit simplement (selon l'adresse par laquelle tu ouvres Odin). */
function portee(req: IncomingMessage, o: { ip: string; acces: string }): { portee: 'machine' | 'reseau' | 'internet'; note: string } {
  const hote = hoteDe(req), prive = !hote || isPrivateHost(hote) || (!isIP(hote) && !hote.includes('.'));
  if (o.ip.startsWith('fwd:') || !prive) return { portee: 'internet', note: 'Ce lien s\'ouvre depuis Internet.' };
  if (o.acces === 'local') return { portee: 'machine', note: 'Odin n\'accepte que cette machine pour l\'instant : ce lien ne s\'ouvre que d\'ici. Pour le donner à quelqu\'un, ouvre Odin à ton réseau (Réglages → Accès) ou publie-le sous ton nom de domaine (Bifröst).' };
  return { portee: 'reseau', note: 'Ce lien s\'ouvre depuis ton réseau local (ou ton VPN). Pour qu\'il marche de partout, ouvre Odin sous ton nom de domaine (Bifröst) et crée le lien depuis cette adresse.' };
}
/** Ce qu'il faut savoir sur les invités d'un lien privé, selon l'état de Persona et l'adresse utilisée. */
function noteInvites(va: Valhalla, req: IncomingMessage, gens: Personne[]): string {
  if (!gens.length) return 'Personne n\'a encore de compte dans Persona : pour l\'instant, toi seul peux ouvrir un lien privé. Ajoute tes invités dans Persona.';
  const domaine = va.modules().some((m) => m.id === 'var') ? s(va.ctx('var').settings.cookieDomain) : '', portail = portalUrl();
  if (!portail || !domaine) return 'Persona n\'a pas encore de portail de connexion : tes invités ne peuvent pas se connecter. Règle-le dans Persona (Réglages du portail).';
  if (!within(hoteDe(req), domaine)) return `Tes invités se connectent sur ${portail}. Pour qu'Odin les reconnaisse, ouvre Odin sous une adresse en ${domaine} (Bifröst → Publier Odin) et crée le lien depuis cette adresse ; depuis l'adresse actuelle, toi seul peux l'ouvrir.`;
  return '';
}
const liste = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,;]+/) : []).map((x) => s(x).trim().toLowerCase()).filter(Boolean))].slice(0, 50);
/** La date de fin demandée (`fin` : une date, ou `jours` : une durée ; 7 jours sans rien dire). */
function finDe(b: Record<string, unknown>, t: number): number | { erreur: string } {
  if (s(b.fin).trim()) {
    const brut = s(b.fin).trim(), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(brut);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59).getTime() : Date.parse(brut);
    if (!Number.isFinite(d)) return { erreur: 'Date de fin illisible : écris-la comme 2026-12-31.' };
    if (d <= t + 60_000) return { erreur: 'La date de fin doit être dans le futur.' };
    if (d > t + (DUREE.max + 1) * 864e5) return { erreur: `Un partage dure ${DUREE.max} jours au plus.` };
    return d;
  }
  const j = s(b.jours).trim() ? Number(b.jours) : DUREE.defaut;
  if (!Number.isFinite(j) || j < 1 || j > DUREE.max) return { erreur: `Choisis une durée de 1 à ${DUREE.max} jours.` };
  return t + Math.round(j * 864e5);
}
const pourQui = (p: { personnes: string[]; groupes: string[] }) => (p.personnes.length || p.groupes.length ? [...p.personnes, ...p.groupes.map((g) => `le groupe ${g}`)].join(', ') : 'toute personne connectée à Odin');

// ---------------------------------------------------------------- Les adresses du propriétaire
export interface ContexteApi { ip: string; acces: string; /** l'adresse d'Odin vue d'un autre appareil (https://…) */ origine(): string; /** le masqueur d'Odin */ connus?: (t: string) => string }

/** Export et partage, côté propriétaire (la connexion a déjà été vérifiée). Rend false si l'adresse n'est pas pour lui. */
export async function partageApi(req: IncomingMessage, res: ServerResponse, url: URL, o: ContexteApi): Promise<boolean> {
  const chemin = url.pathname;
  if (chemin !== '/api/valhalla/partage' && chemin !== '/api/valhalla/partages' && chemin !== '/api/valhalla/partage_retirer') return false;
  const va = valhallaOf();
  if (!va) { json(res, 503, { ok: false, error: 'Les applis d\'Odin ne sont pas démarrées.' }); return true; }
  const q = url.searchParams, magasin = partagesDe(va);

  if (req.method === 'GET' && chemin === '/api/valhalla/partages') {
    const m = q.get('id') ? va.module(s(q.get('id'))) : undefined;
    if (q.get('id') && !m) { json(res, 404, { ok: false, error: 'Appli inconnue.' }); return true; }
    json(res, 200, { ok: true, partages: magasin.liste(m?.id).map(vu) }); return true;
  }

  if (req.method === 'GET' && chemin === '/api/valhalla/partage') {
    const m = va.module(s(q.get('id')));
    if (!m) { json(res, 404, { ok: false, error: 'Appli inconnue.' }); return true; }
    const non = refusDe(m);
    if (non) { json(res, 200, { ok: true, id: m.id, name: m.name, export: { permis: false, raison: non }, partage: { permis: false, raison: non }, partages: [] }); return true; }
    const gens = await personnes(va), lieu = portee(req, o);
    json(res, 200, {
      ok: true, id: m.id, name: m.name,
      export: { permis: true, formats: [...FORMATS.map((f) => ({ ...f, permis: true })), { id: 'gdoc', nom: 'Google Docs', ext: '', permis: false, raison: GOOGLE_ABSENT }], retire: retraitsDe(m.id).map((r) => ({ quoi: r.quoi, pourquoi: r.pourquoi })) },
      partage: { permis: true, jours: DUREE, portee: lieu.portee, note: lieu.note, invites: { personnes: gens, groupes: [...new Set(gens.flatMap((g) => g.groupes))].sort(), note: noteInvites(va, req, gens) } },
      partages: magasin.liste(m.id).map(vu),
    });
    return true;
  }

  const lecture = chemin === '/api/valhalla/partages';
  if (lecture || req.method !== 'POST') { res.writeHead(405, { allow: lecture ? 'GET' : chemin === '/api/valhalla/partage' ? 'GET, POST' : 'POST', 'cache-control': 'no-store' }); res.end(); return true; }
  // Comme toutes les actions : l'en-tête qui prouve que la demande vient de la page d'Odin, pas d'un autre site.
  if (req.headers['x-odin'] !== '1') { json(res, 403, { error: 'en-tête x-odin manquant' }); return true; }
  let b: Record<string, unknown> = {};
  try { const j = JSON.parse((await body(req, 32 * 1024)) || '{}') as unknown; if (j && typeof j === 'object' && !Array.isArray(j)) b = j as Record<string, unknown>; } catch { json(res, 400, { ok: false, error: 'Demande illisible (JSON attendu).' }); return true; }

  if (chemin === '/api/valhalla/partage_retirer') {
    if (b.tout === true) {
      const m = s(b.id) ? va.module(s(b.id)) : undefined, n = magasin.retirerTout(m?.id);
      if (n) va.ctx(m?.id ?? va.modules()[0].id).emit('partages_retires', { nombre: n });
      json(res, 200, { ok: true, retires: n, text: n ? `${n} partage${n > 1 ? 's' : ''} retiré${n > 1 ? 's' : ''} : ${n > 1 ? 'ces liens ne marchent' : 'ce lien ne marche'} plus.` : 'Aucun partage en cours.' }); return true;
    }
    const id = s(b.partage), p = magasin.liste().find((x) => x.id === id);
    if (!p || !magasin.retirer(id)) { json(res, 200, { ok: false, error: 'Ce partage n\'existe plus (déjà retiré, ou arrivé à sa date de fin).' }); return true; }
    if (va.modules().some((m) => m.id === p.appli)) va.ctx(p.appli).emit('partage_retire', { lien: p.type === 'public' ? 'public' : 'privé' });
    json(res, 200, { ok: true, retires: 1, text: `Partage de ${p.nom} retiré : le lien ne marche plus.` }); return true;
  }

  // Créer un lien.
  const m = va.module(s(b.id));
  if (!m) { json(res, 200, { ok: false, error: 'Appli inconnue.' }); return true; }
  const non = refusDe(m);
  if (non) { json(res, 200, { ok: false, error: non, refus: true }); return true; }
  const type = s(b.type) === 'public' ? 'public' : s(b.type) === 'prive' || s(b.type) === 'privé' ? 'prive' : '';
  if (!type) { json(res, 200, { ok: false, error: 'Choisis le genre de lien : privé (il faut être connecté) ou public (toute personne qui a le lien).' }); return true; }
  const t = horloge(va).getTime(), fin = finDe(b, t);
  if (typeof fin !== 'number') { json(res, 200, { ok: false, error: fin.erreur }); return true; }
  const invites = { personnes: [] as string[], groupes: [] as string[] }, gens = type === 'prive' ? await personnes(va) : [];
  if (type === 'prive') {
    invites.personnes = liste(b.personnes); invites.groupes = liste(b.groupes);
    const inconnus = [...invites.personnes.filter((x) => !gens.some((g) => g.login === x)), ...invites.groupes.filter((x) => !gens.some((g) => g.groupes.includes(x))).map((x) => `groupe ${x}`)];
    if (inconnus.length) { json(res, 200, { ok: false, error: `Inconnu dans Persona : ${inconnus.join(', ').slice(0, 200)}. Ajoute d'abord la personne (ou le groupe) dans Persona.` }); return true; }
  }
  const vue = new URLSearchParams();
  if (b.vue && typeof b.vue === 'object' && !Array.isArray(b.vue)) for (const [k, v] of Object.entries(b.vue as Record<string, unknown>).slice(0, 20)) if (typeof v === 'string' || typeof v === 'number') vue.set(k.slice(0, 40), String(v).slice(0, 200));
  if (s(b.poste)) vue.set('poste', s(b.poste).slice(0, 200));
  if (s(b.onglet)) vue.set('onglet', s(b.onglet).slice(0, 80));
  // Un lien public ouvre une copie de la page à n'importe qui : c'est une action grave, elle demande ton accord.
  if (type === 'public' && b.confirm !== true) { json(res, 200, { ok: false, confirm: `Confirmer : créer un lien public vers la page ${m.name} ? Toute personne qui a ce lien verra une copie de cette page${s(b.onglet) ? ` (onglet « ${s(b.onglet).slice(0, 40)} »)` : ''}, sans compte, jusqu'au ${dateFr(new Date(fin))}.` }); return true; }
  const r = await prendre(va, m.id, vue, { connus: o.connus });
  if (!r.ok) { json(res, 200, { ok: false, error: r.error, ...(r.code === 'refus' ? { refus: true } : {}) }); return true; }
  let cree: { partage: Partage; jeton: string };
  try { cree = magasin.creer(r.page, { type, fin, ...invites }); } catch (e) { json(res, 200, { ok: false, error: (e as Error).message }); return true; }
  va.ctx(m.id).emit('partage_cree', { lien: type === 'public' ? 'public' : 'privé', jusqu_au: dateFr(new Date(fin)), ...(type === 'prive' ? { pour: pourQui(invites) } : {}) });
  const hote = s(req.headers.host), lieu = portee(req, o), vue2 = o.origine(), origine = o.acces === 'local' && hote ? `${/^https:/.test(vue2) ? 'https' : 'http'}://${hote}` : vue2;
  const cheminLien = `/partage/${cree.jeton}`, notes = [lieu.note, ...(type === 'prive' ? [noteInvites(va, req, gens)] : [])].filter(Boolean);
  json(res, 200, {
    ok: true, lien: `${origine.replace(/\/+$/, '')}${cheminLien}`, chemin: cheminLien, partage: vu(cree.partage), portee: lieu.portee, notes, masques: r.page.masques, retire: r.page.retire,
    text: `Lien ${type === 'public' ? 'public' : 'privé'} créé pour la page ${m.name}. Copie-le maintenant : Odin ne le montrera plus. Il marche jusqu'au ${dateFr(new Date(fin))}${type === 'prive' ? `, pour ${pourQui(invites)}` : ''}.`,
  });
  return true;
}

// ---------------------------------------------------------------- La copie figée : /partage/<adresse secrète>
/** Débit par adresse : tant de pages en cinq minutes, et moins encore d'adresses fausses (quelqu'un qui cherche au hasard). */
export const DEBIT = { fenetre: 5 * 60_000, pages: 60, fausses: 12 } as const;
const visites = new Map<string, { pages: number[]; fausses: number[] }>();
function visiteur(ip: string, t: number): { pages: number[]; fausses: number[] } {
  if (visites.size > 5000) for (const [k, v] of visites) if (!v.pages.some((x) => t - x < DEBIT.fenetre)) visites.delete(k);
  const v = visites.get(ip) ?? { pages: [], fausses: [] };
  v.pages = v.pages.filter((x) => t - x < DEBIT.fenetre && x <= t); v.fausses = v.fausses.filter((x) => t - x < DEBIT.fenetre && x <= t);
  visites.set(ip, v);
  return v;
}
/** Les en-têtes d'une page de partage : rien à charger, aucun script, jamais indexée ni gardée, jamais dans un cadre. */
const entetes = (o: { bac?: boolean } = {}) => ({
  'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet', 'x-frame-options': 'DENY',
  'content-security-policy': `default-src 'none'; style-src 'sha256-${STYLE_HASH}'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'${o.bac ? '; sandbox' : ''}`,
});
function message(res: ServerResponse, code: number, titre: string, texte: string, plus: Record<string, string> = {}, liens = ''): void {
  res.writeHead(code, { ...entetes(), ...plus });
  res.end(pageHtml({ titre, etroit: true, corps: `<h1>${h(titre)}</h1><p>${h(texte)}</p>${liens}` }));
}

export interface ContextePublic { ip: string; https: boolean; /** ce navigateur est-il connecté comme propriétaire ? (demandé seulement pour un lien privé) */ proprietaire(): boolean }

/** La copie figée d'un partage. Rend false si l'adresse n'est pas une adresse de partage. */
export async function partagePublic(req: IncomingMessage, res: ServerResponse, url: URL, o: ContextePublic): Promise<boolean> {
  const m = /^\/partage\/([^/]{1,200})$/.exec(url.pathname);
  if (!m) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' }); res.end(); return true; }
  const va = valhallaOf();
  if (!va) { message(res, 503, 'Odin démarre', 'Réessaie dans un instant.'); return true; }
  const t = horloge(va).getTime(), v = visiteur(o.ip, t);
  if (v.pages.length >= DEBIT.pages || v.fausses.length >= DEBIT.fausses) {
    const plusVieux = Math.min(...(v.fausses.length >= DEBIT.fausses ? v.fausses : v.pages)), attente = Math.max(1, Math.ceil((plusVieux + DEBIT.fenetre - t) / 1000));
    message(res, 429, 'Trop de demandes', 'Réessaie dans quelques minutes.', { 'retry-after': String(attente) }); return true;
  }
  v.pages.push(t);
  const magasin = partagesDe(va), trouve = magasin.trouver(m[1]);
  if (!trouve) { v.fausses.push(t); message(res, 404, 'Lien inactif', 'Ce partage n\'existe pas ou n\'existe plus : il a été retiré, ou sa date de fin est passée.'); return true; }
  const { partage, page } = trouve;
  if (partage.type === 'prive') {
    const hote = hoteDe(req);
    let ok = o.proprietaire(), refus = false;
    if (!ok) {
      const qui = personneConnectee(s(req.headers.cookie), hote);
      if (qui === 'refusé') refus = true;
      else if (qui) { ok = (!partage.personnes.length && !partage.groupes.length) || partage.personnes.includes(qui.user) || partage.groupes.some((g) => qui.groups.includes(g)); refus = !ok; }
    }
    if (refus) { message(res, 403, 'Ce partage n\'est pas pour toi', 'Ton compte n\'a pas été invité à voir cette page. Demande à la personne qui t\'a envoyé le lien.'); return true; }
    if (!ok) {
      const portail = portalUrl(), domaine = va.modules().some((x) => x.id === 'var') ? s(va.ctx('var').settings.cookieDomain) : '', ici = `${o.https ? 'https' : 'http'}://${s(req.headers.host)}${url.pathname}`;
      const liens = `<div class="liens">${portail && domaine && within(hote, domaine) ? `<a href="${h(`${portail}/?rd=${encodeURIComponent(ici)}`)}">J'ai un compte : me connecter</a>` : ''}<a href="${h(url.pathname)}">Je suis déjà connecté : réessayer</a><a href="/">C'est mon Odin : l'ouvrir</a></div>`;
      message(res, 401, 'Ce lien est privé', 'Il s\'ouvre seulement pour les personnes invitées, une fois connectées à Odin.', {}, liens); return true;
    }
  }
  if (req.method === 'GET') magasin.compter(partage.id);
  const bandeau = `Copie de la page ${page.app.name} d'Odin, prise le ${dateFr(new Date(page.at))}. Elle ne se met pas à jour. ${partage.type === 'prive' ? 'Lien privé, réservé aux personnes invitées, valable' : 'Ce lien marche'} jusqu'au ${dateFr(new Date(partage.fin))}.`;
  res.writeHead(200, entetes({ bac: true }));
  res.end(enHtml(page, bandeau));
  return true;
}
