// Les routes des stores d'Agora (ordinateurs, téléphones) : /api/agora/*.
//
// Chaque appel porte un jeton d'appli de la connexion unique d'Odin (audience « agora », obtenu par /sso/connexion,
// /sso/autoriser ou /sso/echange) : l'appareil est celui de la session SSO (on ne peut pas parler au nom d'un autre),
// la personne celle du jeton. Rien d'autre n'est gardé (pas de second jeton).
//
//   GET  bonjour                 Odin est-il là ? (sans jeton)
//   POST inscrire                l'appareil s'inscrit (nom, plateforme, système, version du store, « géré »)
//   GET  store                   ce qui est proposé / imposé / retiré pour CET appareil
//   GET  flux                    les ordres (installer, désinstaller, mettre à jour) en direct (SSE), à la seconde
//   POST etat                    compte rendu d'un élément (installation, installée, version, progression, erreur)
//   POST inventaire              ce qui est installé en ce moment (au démarrage du store)
//   GET  telecharger?element=…   l'installateur (en-tête x-odin-empreinte : le client vérifie AVANT d'installer)
//   POST desinscrire             l'appareil quitte le store (déconnexion)
//
// Ce que l'appareil envoie (noms, messages d'erreur) est une donnée, jamais un ordre : tout est borné et nettoyé.

import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { valhallaOf } from '../valhalla/odin.ts';
import { lireJeton } from '../valhalla/sso/oidc.ts';
import { personnes, type Personne } from '../valhalla/sso/etat.ts';
import { depotDe, OUVERT, paquetPour, type Appareil, type EtatInstall, type Ordre } from '../valhalla/agora/store.ts';
import { ACTIONS, modePour, reconcilier, storeDe } from '../valhalla/agora/regles.ts';
import { cheminFichier } from '../valhalla/modules/agora.ts';
import type { ModCtx } from '../valhalla/types.ts';
import type { Valhalla } from '../valhalla/service.ts';

export interface AgoraDeps { ip: string; version: string; /** les applis d'Odin (par défaut : celles qui tournent) */ valhalla?: Valhalla }
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
const propre = (v: unknown, n: number) => s(v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').slice(0, n);
const PF = ['windows', 'mac', 'linux', 'android', 'ios', 'autre'] as const;
const ETATS: EtatInstall[] = ['absente', 'installation', 'installee', 'desinstallation', 'erreur'];
function json(res: ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return void res.end();
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(JSON.stringify(body));
}
const err = (res: ServerResponse, http: number, code: string, message: string) => json(res, http, { ok: false, code, message });
class Trop extends Error {}
async function lireJson(req: IncomingMessage, max = 64 * 1024): Promise<Record<string, unknown> | undefined> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) throw new Trop(); parts.push(c as Buffer); }
  try { const v = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined; } catch { return undefined; }
}
const pub = (a: Appareil, enLigne: boolean) => ({ id: a.id, nom: a.nom, plateforme: a.plateforme, systeme: a.systeme, personne: a.nomPersonne, gere: Boolean(a.gere), enLigne });
const ordrePub = (ag: ModCtx, o: Ordre) => { const e = depotDe(ag.dir).element(o.element); return { id: o.id, element: o.element, nom: e?.nom ?? o.element, action: o.action, ...(o.version ? { version: o.version } : {}), impose: true, par: o.par, qui: o.qui }; };

/** Les routes /api/agora/* ; rend false si la requête n'est pas pour Agora. */
export async function agoraRoute(req: IncomingMessage, res: ServerResponse, url: URL, deps: AgoraDeps): Promise<boolean> {
  if (!url.pathname.startsWith('/api/agora/')) return false;
  const route = url.pathname.slice('/api/agora/'.length), meth = req.method ?? 'GET';
  try { await traiter(req, res, url, route, meth, deps); }
  catch (e) {
    if (e instanceof Trop) { err(res, 413, 'trop_gros', 'Envoi trop gros.'); req.socket?.destroySoon?.(); }
    else { console.error(`[agora] ${(e as Error).message}`); err(res, 500, 'interne', 'Odin a eu un problème en traitant cette demande : réessaie dans un instant.'); }
  }
  return true;
}

async function traiter(req: IncomingMessage, res: ServerResponse, url: URL, route: string, meth: string, deps: AgoraDeps): Promise<void> {
  const v = deps.valhalla ?? valhallaOf();
  if (meth === 'GET' && route === 'bonjour') return json(res, 200, { odin: true, agora: Boolean(v?.module('agora')), version: deps.version, protocole: 1 });
  if (!v || !v.module('agora') || !v.module('var')) return err(res, 503, 'indisponible', 'Le store d\'Odin (Agora) ou Persona n\'est pas démarré : réessaie dans un instant.');
  const ag = v.ctx('agora'), pctx = v.ctx('var'), d = depotDe(ag.dir), now = ag.now().getTime(), ip = deps.ip.replace(/^fwd:/, '');
  // ---- Le jeton d'appli de la connexion unique (audience « agora »).
  const j = lireJeton(pctx, req);
  if (!j.ok) return err(res, j.status, j.code, j.message);
  if (j.charge.aud !== 'agora') return err(res, 403, 'mauvaise_appli', 'Ce jeton n\'est pas celui du store d\'Odin : connecte le store avec ton compte Odin.');
  const p: Personne = j.p, idAp = s(j.session.appareil.id);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(idAp)) return err(res, 400, 'appareil_requis', 'Cette connexion n\'a pas d\'identifiant d\'appareil : reconnecte le store.');
  if (meth === 'POST' && !/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return err(res, 415, 'json_attendu', 'Envoie le corps en JSON (content-type: application/json).');

  if (meth === 'POST' && route === 'inscrire') {
    const b = await lireJson(req); if (!b) return err(res, 400, 'requete_invalide', 'Corps JSON illisible.');
    const pfDonnee = s(b.plateforme || j.session.appareil.plateforme).toLowerCase(), plateforme = (PF as readonly string[]).includes(pfDonnee) ? pfDonnee as Appareil['plateforme'] : 'autre';
    const nom = propre(b.nom || j.session.appareil.nom, 60) || 'Appareil';
    let a = d.appareils.find((x) => x.id === idAp), neuf = false;
    if (!a) { a = { id: idAp, nom, plateforme, systeme: '', sub: p.id, login: p.login, nomPersonne: p.name, cree: now, vu: now, applis: {}, forces: {} }; d.appareils.push(a); neuf = true; }
    const avant = a.login;
    Object.assign(a, { nom, plateforme, systeme: propre(b.systeme, 40), sub: p.id, login: p.login, nomPersonne: p.name, vu: now, ip, version: propre(b.version, 20), gere: b.gere === true && plateforme === 'android' });
    if (a.retire) { delete a.retire; neuf = true; }
    d.sauverAppareils();
    if (neuf) {
      d.noter(now, p.name, `Appareil inscrit : ${a.nom} (${plateforme}${a.systeme ? ` ${a.systeme}` : ''}) depuis ${ip}`);
      ag.alert({ level: 'info', title: `Agora : nouvel appareil pour ${p.name}`, detail: `« ${a.nom} » (${plateforme}${a.systeme ? `, ${a.systeme}` : ''}, depuis ${ip}) s'est inscrit au store avec le compte de ${p.name}. Si ce n'est pas toi ou un proche, retire-le et coupe la connexion dans Persona.`, key: `agora:nouvel:${a.id}`, fix: { action: 'retirer_appareil', label: 'Retirer cet appareil', input: { appareil: a.id }, module: 'agora' } });
      ag.emit('nouvel_appareil', { appareil: a.nom, personne: p.name, systeme: plateforme });
    } else if (avant !== p.login) d.noter(now, p.name, `${a.nom} est maintenant à ${p.name} (avant : ${avant})`);
    reconcilier(ag);
    return json(res, 200, { ok: true, appareil: pub(a, d.enLigne.has(a.id)), personne: { nom: p.name, login: p.login, groupes: p.groups }, store: storeDe(ag, p, a), ordres: d.ordres.filter((o) => o.appareil === a!.id && OUVERT.includes(o.etat)).map((o) => ordrePub(ag, o)) });
  }

  // ---- Les autres routes : l'appareil doit être inscrit, et à cette personne.
  const a = d.appareils.find((x) => x.id === idAp && !x.retire);
  if (!a) {
    ag.alert({ level: 'moyenne', title: 'Agora : appareil inconnu', detail: `Un appareil pas (ou plus) inscrit au store (« ${propre(j.session.appareil.nom, 60)} », compte ${p.name}, depuis ${ip}) a voulu ${route === 'flux' ? 'recevoir les ordres' : route === 'telecharger' ? 'télécharger un installateur' : 'parler au store'}. Il doit d'abord s'inscrire ; si tu l'as retiré, c'est normal qu'il soit refusé.`, key: `agora:inconnu:${idAp}` });
    return err(res, 404, 'appareil_inconnu', 'Cet appareil n\'est pas inscrit au store d\'Odin : inscris-le de nouveau.');
  }
  if (a.sub !== p.id) return err(res, 409, 'autre_personne', `Cet appareil est inscrit au nom de ${a.nomPersonne} : inscris-le de nouveau avec ton compte.`);
  a.vu = now;

  if (meth === 'GET' && route === 'store') {
    return json(res, 200, { ok: true, appareil: pub(a, d.enLigne.has(a.id)), personne: { nom: p.name, login: p.login, groupes: p.groups }, store: storeDe(ag, p, a), ordres: d.ordres.filter((o) => o.appareil === a.id && OUVERT.includes(o.etat)).map((o) => ordrePub(ag, o)),
      historique: d.ordres.filter((o) => o.appareil === a.id && !OUVERT.includes(o.etat)).slice(-50).reverse().map((o) => ({ ...ordrePub(ag, o), etat: o.etat, quand: o.maj, ...(o.erreur ? { erreur: o.erreur } : {}) })) });
  }

  if (meth === 'GET' && route === 'flux') {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff' });
    res.socket?.setNoDelay?.(true);
    const envoyer = (type: string, data: unknown) => { if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
    const marquer = (o: Ordre) => { if (o.etat === 'attente') { o.etat = 'envoye'; o.envoye = ag.now().getTime(); o.maj = o.envoye; } };
    d.enLigne.set(a.id, (d.enLigne.get(a.id) ?? 0) + 1);
    envoyer('bonjour', { appareil: pub(a, true), serveur: ag.now().getTime() });
    reconcilier(ag);
    let n = 0; for (const o of d.ordres) if (o.appareil === a.id && OUVERT.includes(o.etat)) { envoyer('ordre', ordrePub(ag, o)); marquer(o); n++; }
    if (n) d.sauverOrdres();
    const surOrdre = (id: string, o: Ordre) => { if (id !== a.id) return; envoyer('ordre', ordrePub(ag, o)); marquer(o); d.sauverOrdres(); };
    const surAnnule = (id: string, oid: string) => { if (id === a.id) envoyer('annule', { id: oid }); };
    const surStore = (id: string) => { if (id === a.id || id === '*') envoyer('store', { quand: ag.now().getTime() }); };
    const surRetire = (id: string) => { if (id === a.id) { envoyer('retire', { message: 'Cet appareil a été retiré du store par un admin.' }); fin(); } };
    const ping = setInterval(() => { if (!res.writableEnded) res.write(': signe de vie\n\n'); }, 20_000);
    // Le flux se ferme à la fin du jeton : le store se reconnecte avec un jeton neuf (une session coupée n'écoute plus).
    const exp = Number(j.charge.exp) * 1000 - Date.now(), finJeton = setTimeout(() => fin(), Math.max(1000, Math.min(exp, 2 ** 31 - 1)));
    let fini = false;
    function fin(): void {
      if (fini) return; fini = true; clearInterval(ping); clearTimeout(finJeton);
      d.bus.off('ordre', surOrdre); d.bus.off('annule', surAnnule); d.bus.off('store', surStore); d.bus.off('retire', surRetire); d.bus.off('fin', fin);
      const k = (d.enLigne.get(a!.id) ?? 1) - 1; if (k > 0) d.enLigne.set(a!.id, k); else d.enLigne.delete(a!.id);
      a!.vu = Date.now(); if (!res.writableEnded) res.end();
    }
    d.bus.on('ordre', surOrdre); d.bus.on('annule', surAnnule); d.bus.on('store', surStore); d.bus.on('retire', surRetire); d.bus.on('fin', fin);
    req.on('close', fin); res.on('close', fin);
    return;
  }

  if (meth === 'POST' && (route === 'etat' || route === 'inventaire')) {
    const b = await lireJson(req); if (!b) return err(res, 400, 'requete_invalide', 'Corps JSON illisible.');
    const liste = route === 'inventaire' ? (Array.isArray(b.applis) ? b.applis as Array<Record<string, unknown>> : []) : [b];
    if (liste.length > 500) return err(res, 400, 'requete_invalide', 'Trop d\'applis dans l\'inventaire.');
    const vus = new Set<string>();
    for (const x of liste) {
      const e = d.element(s(x.element)); if (!e) continue;
      const etat = s(x.etat) as EtatInstall; if (!ETATS.includes(etat)) return err(res, 400, 'requete_invalide', `État inconnu : ${propre(x.etat, 20)} (${ETATS.join(', ')}).`);
      vus.add(e.id);
      const prog = Number(x.progression), erreur = propre(x.erreur, 200), version = propre(x.version, 40), cur = a.applis[e.id];
      a.applis[e.id] = { etat, ...(version ? { version } : etat === 'installee' || etat === 'erreur' ? (cur?.version ? { version: cur.version } : {}) : {}), ...(Number.isFinite(prog) && etat !== 'installee' ? { progression: Math.max(0, Math.min(100, Math.round(prog))) } : {}), ...(erreur ? { erreur } : {}), par: x.par === 'personne' ? 'personne' : cur?.par ?? 'impose', maj: now };
      // L'ordre en cours pour cet élément.
      const o = (s(x.ordre) && d.ordres.find((y) => y.id === s(x.ordre) && y.appareil === a.id)) || d.ouvert(a.id, e.id);
      if (o && OUVERT.includes(o.etat)) {
        const fait = (o.action === 'desinstaller' && etat === 'absente') || (o.action !== 'desinstaller' && etat === 'installee' && (!o.version || version === o.version));
        if (fait) { o.etat = 'fait'; delete o.progression; d.noter(now, a.nomPersonne, `${ACTIONS[o.action]} ${e.nom} sur ${a.nom} : fait${version ? ` (${version})` : ''}`); }
        else if (etat === 'erreur') {
          o.etat = 'echec'; o.erreur = erreur || 'raison inconnue';
          d.noter(now, a.nomPersonne, `${ACTIONS[o.action]} ${e.nom} sur ${a.nom} : ÉCHEC (${o.erreur})`, true);
          ag.alert({ level: 'moyenne', title: `Agora : ${o.action === 'desinstaller' ? 'désinstallation' : 'installation'} de ${e.nom} échouée sur ${a.nom}`, detail: `${a.nom} (${a.nomPersonne}) dit : « ${o.erreur} ». ${o.tentative < 3 ? 'Le store réessaiera.' : 'Trois essais ratés : il attend que tu relances.'}`, key: `agora:echec:${a.id}:${e.id}`, fix: { action: 'reessayer', label: 'Réessayer', input: { appareil: a.id, element: e.id }, module: 'agora' } });
          ag.emit('installation_echouee', { appareil: a.nom, element: e.nom, erreur: o.erreur });
        } else if (etat === 'installation' || etat === 'desinstallation') { o.etat = 'en_cours'; if (Number.isFinite(prog)) o.progression = Math.max(0, Math.min(100, Math.round(prog))); }
        o.maj = now;
      } else if (etat === 'installee' && x.par === 'personne' && cur?.etat !== 'installee') d.noter(now, a.nomPersonne, `${e.nom} ${version} installé par ${a.nomPersonne} sur ${a.nom}`);
      else if (etat === 'absente' && cur?.etat === 'installee' && x.par === 'personne') d.noter(now, a.nomPersonne, `${e.nom} désinstallé par ${a.nomPersonne} sur ${a.nom}`);
    }
    if (route === 'inventaire') for (const [id, x] of Object.entries(a.applis)) if (!vus.has(id) && x.etat === 'installee') a.applis[id] = { etat: 'absente', maj: now };
    d.sauverAppareils(); d.sauverOrdres(); reconcilier(ag);
    return json(res, 200, { ok: true });
  }

  if (meth === 'GET' && route === 'telecharger') {
    const e = d.element(s(url.searchParams.get('element')));
    if (!e) return err(res, 404, 'introuvable', 'Cet élément n\'est plus dans le store.');
    const pf = s(url.searchParams.get('plateforme')) || a.plateforme, ver = s(url.searchParams.get('version'));
    const m = modePour(pctx, e, personnes(pctx).find((x) => x.id === p.id) ?? p);
    if (a.forces[e.id] !== 'installee' && (!m || m.mode === 'retiree')) return err(res, 403, 'pas_le_droit', `Tu n'as pas droit à ${e.nom} : demande à un admin de t'ajouter au bon groupe.`);
    const pk = e.paquets.find((x) => x.plateforme === pf && (!ver || x.version === ver)) ?? paquetPour(e, pf);
    if (!pk) return err(res, 404, 'introuvable', `${e.nom} n'a pas d'installateur pour ${pf}.`);
    if (pk.lien && !pk.fichier) return json(res, 409, { ok: false, code: 'lien', message: 'Cet installateur se télécharge à son adresse d\'origine.', lien: pk.lien, sha256: pk.sha256 });
    const f = cheminFichier(ag, pk); if (!f) return err(res, 410, 'fichier_absent', `L'installateur de ${e.nom} n'est plus sur Odin : un admin doit le remettre dans le store.`);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(statSync(f).size), 'content-disposition': `attachment; filename="${pk.nomFichier.replace(/"/g, '')}"`, 'x-odin-empreinte': pk.sha256, 'x-odin-version': pk.version, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    createReadStream(f).pipe(res);
    return;
  }

  if (meth === 'POST' && route === 'desinscrire') {
    a.retire = now; for (const o of d.ordres) if (o.appareil === a.id && OUVERT.includes(o.etat)) { o.etat = 'annule'; o.maj = now; }
    d.sauverAppareils(); d.sauverOrdres(); d.bus.emit('retire', a.id); d.noter(now, p.name, `${a.nom} a quitté le store (déconnexion)`);
    return json(res, 200, { ok: true });
  }
  return err(res, 404, 'introuvable', `Route inconnue : ${meth} /api/agora/${propre(route, 40)}`);
}
