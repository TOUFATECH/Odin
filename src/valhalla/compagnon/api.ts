// Ce que le compagnon d'un poste demande à Odin (sur le port de l'interface, avec son jeton à lui, jamais de session) :
//   GET  /api/compagnon/consignes   ce qu'il doit faire (analyser, mettre à jour, bulles à montrer, réglages du parc)
//   POST /api/compagnon/rapport     système exact, logiciels installés, mises à jour en attente → failles et conseils
//   POST /api/compagnon/analyse     résultat d'une analyse antivirus → alertes d'Asclépios, bulle sur le poste
//   POST /api/compagnon/majs        bilan des mises à jour installées
//   GET  /api/compagnon/signatures  les empreintes d'Asclépios (32 octets chacune, triées), si elles ont changé
// Tout ce qui vient du poste est une donnée (jamais un ordre) : textes coupés, tailles limitées.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { valhallaOf } from '../odin.ts';
import { intelOf } from '../modules/ullr.ts';
import { estMalveillante } from '../modules/geri.ts';
import type { ModCtx } from '../types.ts';
import { bulle, conseils, failles, modifierFiche, posteDuJeton, type Analyse, type Appli, type Maj, type Rapport } from './compagnon.ts';
import { normaliserTelemetrie } from './telemetrie.ts';
import { ingererTelemetrie } from '../argos/endpoints.ts';
import { corrélerPoste } from '../argos/incidents-parc.ts';

const s = (v: unknown, n = 200) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
function json(res: ServerResponse, status: number, body: unknown): void { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); }
async function corps(req: IncomingMessage, max: number): Promise<Record<string, unknown> | undefined> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) return undefined; parts.push(c as Buffer); }
  try { const j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : undefined; } catch { return undefined; }
}
/** Les réglages du parc (page de Satellites). */
export function reglages(ctx?: ModCtx): { majs: 'auto' | 'demander' | 'non'; heure: number; quarantaine: boolean; analyseHeures: number } {
  const x = (ctx?.settings.compagnon as Record<string, unknown> | undefined) ?? {};
  return { majs: (['auto', 'demander', 'non'].includes(String(x.majs)) ? x.majs : 'auto') as 'auto', heure: Number.isInteger(x.heure) ? Number(x.heure) : 3, quarantaine: x.quarantaine !== false, analyseHeures: Number(x.analyseHeures) || 24 };
}
const appli = (x: unknown): Appli | undefined => { const o = x as Record<string, unknown>; return o && typeof o === 'object' && s(o.nom) ? { nom: s(o.nom, 120), version: s(o.version, 40), ...(o.editeur ? { editeur: s(o.editeur, 80) } : {}) } : undefined; };
const maj = (x: unknown): Maj | undefined => { const o = x as Record<string, unknown>; return o && typeof o === 'object' && s(o.nom) ? { nom: s(o.nom, 160), version: s(o.version, 40), nouvelle: s(o.nouvelle, 60), gestionnaire: s(o.gestionnaire, 20), securite: o.securite === true, ...(o.id ? { id: s(o.id, 120) } : {}) } : undefined; };

export interface OptionsCompagnon { home: string; echec(): void }
/** Rend true si la requête est servie ici. */
export async function compagnonRoute(req: IncomingMessage, res: ServerResponse, url: URL, o: OptionsCompagnon): Promise<boolean> {
  const quoi = /^\/api\/compagnon\/(consignes|rapport|analyse|majs|signatures|telemetrie)$/.exec(url.pathname)?.[1]; if (!quoi) return false;
  const jeton = /^Bearer\s+([a-f0-9]{64})$/i.exec(s(req.headers.authorization, 200))?.[1] ?? '', p = posteDuJeton(o.home, jeton.toLowerCase());
  if (!p) { o.echec(); json(res, 401, { ok: false, message: 'Compagnon inconnu d\'Odin (retiré ou réinstallé ?) : réinstalle-le depuis Satellites.' }); return true; }
  const v = valhallaOf(), hermod = v?.module('hermod') ? v.ctx('hermod') : undefined, ullr = v?.module('ullr') ? v.ctx('ullr') : undefined, r = reglages(hermod), now = Date.now();
  const lire = (req.method ?? 'GET') === 'GET';
  if (lire !== (quoi === 'consignes' || quoi === 'signatures')) { json(res, 405, { ok: false, message: 'Méthode refusée.' }); return true; }

  if (quoi === 'signatures') {
    const intel = ullr ? intelOf(ullr) : undefined, version = String(intel?.current() ?? 0);
    if (!intel || s(url.searchParams.get('version')) === version) { res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-odin-version': version, 'x-odin-empreinte': createHash('sha256').update('').digest('hex'), 'cache-control': 'no-store' }); res.end(); return true; }
    const b = Buffer.from(intel.hashList().join(''), 'hex');
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-odin-version': version, 'x-odin-empreinte': createHash('sha256').update(b).digest('hex'), 'content-length': String(b.length), 'cache-control': 'no-store' }); res.end(b);
    modifierFiche(o.home, p.poste, (f) => { f.vu = now; }); return true;
  }
  if (quoi === 'consignes') {
    let sortir: Record<string, unknown> = {};
    modifierFiche(o.home, p.poste, (f) => {
      sortir = { ok: true, poste: p.poste, bulles: f.consignes.bulles, analyser: Boolean(f.consignes.analyser), appliquer_majs: Boolean(f.consignes.appliquer_majs), rapport: Boolean(f.consignes.rapport) || !f.rapport, telemetrie: Boolean(f.consignes.telemetrie), reponses: f.consignes.reponses ?? [], majs: r.majs, majs_heure: r.heure, quarantaine: r.quarantaine, analyse_tous: r.analyseHeures * 3600, rapport_tous: 6 * 3600, telemetrie_tous: 5 * 60, pause: 60 };
      f.vu = now; f.consignes = { bulles: [] };
    });
    json(res, 200, sortir); return true;
  }
  const b = await corps(req, 4 * 1024 * 1024); if (!b) { json(res, 400, { ok: false, message: 'JSON illisible ou trop gros.' }); return true; }
  if (quoi === 'rapport') {
    const rap: Rapport = { t: now, version: s(b.version, 20), systeme: Object.fromEntries(Object.entries((b.systeme as Record<string, unknown>) ?? {}).slice(0, 20).map(([k, x]) => [s(k, 30), typeof x === 'number' ? x : s(x, 120)])),
      applis: (Array.isArray(b.applis) ? b.applis : []).slice(0, 5000).map(appli).filter((x): x is Appli => Boolean(x)), majs: (Array.isArray(b.majs) ? b.majs : []).slice(0, 2000).map(maj).filter((x): x is Maj => Boolean(x)),
      gestionnaires: (Array.isArray(b.gestionnaires) ? b.gestionnaires : []).slice(0, 5).map((x) => s(x, 20)), redemarrage: b.redemarrage === true, quarantaine: Number(b.quarantaine) || 0, mode: s(b.mode, 20),
      ...(b.analyse && typeof b.analyse === 'object' ? { analyse: b.analyse as Record<string, unknown> } : {}) };
    const fs = failles(rap.applis, ullr ? intelOf(ullr).kev() : [], rap.majs, { now });
    const f = modifierFiche(o.home, p.poste, (x) => { x.rapport = rap; x.failles = fs; x.vu = now; x.consignes.rapport = false; for (const c of conseils(rap, fs, { majsAuto: r.majs === 'auto', heure: r.heure })) bulle(x, c, now); });
    const ouvertes = fs.filter((x) => x.majDispo);
    if (hermod && ouvertes.length) hermod.alert({ level: ouvertes.some((x) => x.rancon) ? 'haute' : 'moyenne', title: `${p.poste} : ${ouvertes.length} faille(s) exploitée(s) avec correctif en attente`, detail: ouvertes.slice(0, 6).map((x) => `${x.cve} · ${x.logiciel} ${x.version} → ${x.majDispo}${x.rancon ? ' · rançongiciels' : ''}`).join('\n'), key: `compagnon-failles-${p.poste}`, steps: ['Laisse le compagnon installer les mises à jour (cette nuit, ou « Mettre à jour maintenant »).', 'Redémarre le poste si on te le demande.'], fix: { action: 'compagnon_majs', label: 'Mettre à jour maintenant', input: { poste: p.poste } } });
    if (hermod && Number(rap.systeme.disque) >= 90) hermod.alert({ level: 'moyenne', title: `Disque de ${p.poste} presque plein (${rap.systeme.disque} %)`, key: `compagnon-disque-${p.poste}` });
    hermod?.emit('compagnon_rapport', { poste: p.poste, majs: rap.majs?.length ?? 0, failles: fs.length });
    json(res, 200, { ok: true, bulles: f.consignes.bulles.filter((x) => x.t === now), failles: fs.length }); return true;
  }
  if (quoi === 'analyse') {
    const dets = (Array.isArray(b.detections) ? b.detections : []).slice(0, 500).map((x) => { const d = x as Record<string, unknown>; return { fichier: s(d.fichier, 400), sha256: /^[a-f0-9]{64}$/.test(s(d.sha256, 64)) ? s(d.sha256, 64) : '', quoi: s(d.quoi, 120), ecarte: d.ecarte === true }; }).filter((d) => d.fichier);
    const a: Analyse = { t: now, fichiers: Number(b.fichiers) || 0, illisibles: Number(b.illisibles) || 0, duree: Number(b.duree) || 0, detections: dets, signatures: Number(b.signatures) || 0 };
    modifierFiche(o.home, p.poste, (f) => {
      f.analyse = a; f.vu = now; f.consignes.analyser = false; f.detections = [...(f.detections ?? []), ...dets.map((d) => ({ ...d, t: now }))].slice(-200);
      for (const d of dets) bulle(f, { niveau: 'haute', titre: d.ecarte ? 'Fichier dangereux mis à l\'écart' : 'Fichier dangereux trouvé', texte: `${d.fichier.split(/[\\/]/).pop()} : ${d.quoi}. ${d.ecarte ? 'Je l\'ai mis à l\'écart : il ne peut plus rien faire.' : 'Ne l\'ouvre pas ; je préviens ton administrateur.'}` }, now);
    });
    const qui = ullr ?? hermod;
    if (qui && dets.length) {
      qui.alert({ level: dets.some((d) => !d.ecarte) ? 'critique' : 'haute', title: `Asclépios : ${dets.length} fichier(s) dangereux sur ${p.poste}`, detail: dets.slice(0, 10).map((d) => `${d.ecarte ? 'mis à l\'écart' : 'TOUJOURS EN PLACE'} · ${d.fichier} · ${d.quoi}`).join('\n'), key: `compagnon-analyse-${p.poste}-${Math.floor(now / 3600_000)}`, steps: ['Demande à la personne du poste ce qu\'elle a ouvert ou téléchargé.', 'Lance une nouvelle analyse du poste après nettoyage.'] });
      qui.emit('compagnon_detection', { poste: p.poste, n: dets.length, fichiers: dets.map((d) => d.fichier).slice(0, 10) });
    }
    json(res, 200, { ok: true }); return true;
  }
  if (quoi === 'telemetrie') {
    // La télémétrie EDR d'un poste pour Argos : processus, connexions sortantes, persistance. C'est une donnée, jamais
    // un ordre. Argos la range (dernière + chronologie) et en tire des incidents par poste (même moteur qu'Asclépios).
    const t = normaliserTelemetrie(p.poste, b, now);
    const { nouveaux } = ingererTelemetrie(o.home, t);
    const argos = v?.module('argos') ? v.ctx('argos') : undefined;
    // Les connexions sortantes du poste sont comparées aux listes d'adresses malveillantes de Méduse (FireHOL, Feodo) :
    // sans cela, un poste qui parle à son serveur de commande (C2) ne lèverait aucun incident.
    const geriCtx = v?.module('geri') ? v.ctx('geri') : undefined;
    const malveillante = geriCtx ? estMalveillante(geriCtx) : undefined;
    const { annonces } = corrélerPoste(o.home, t, (id) => v?.module(id)?.name ?? id, { malveillante });
    for (const inc of annonces) (argos ?? hermod)?.alert({ level: inc.level, title: `${p.poste} : ${inc.title}`, detail: inc.signals.slice(-6).map((x) => x.text).join('\n'), key: `argos-${p.poste}-${inc.id}` });
    json(res, 200, { ok: true, evenements: nouveaux.length, incidents: annonces.length }); return true;
  }
  // majs
  const bilan = (Array.isArray(b.bilan) ? b.bilan : []).slice(0, 10).map((x) => { const d = x as Record<string, unknown>; return { gestionnaire: s(d.gestionnaire, 20), ok: d.ok === true, fin: s(d.fin, 400) }; });
  modifierFiche(o.home, p.poste, (f) => {
    f.majs = { t: now, bilan, redemarrage: b.redemarrage === true }; f.vu = now; f.consignes.appliquer_majs = false; f.consignes.rapport = true;
    bulle(f, bilan.every((x) => x.ok) ? { niveau: 'info', titre: 'Mises à jour installées', texte: `Ton ordinateur est à jour (${bilan.map((x) => x.gestionnaire).join(', ') || 'rien à faire'}).` } : { niveau: 'attention', titre: 'Mises à jour', texte: 'Certaines mises à jour n\'ont pas pu s\'installer : ton administrateur est prévenu.' }, now);
    if (b.redemarrage === true) bulle(f, { niveau: 'attention', cle: 'redemarrage', titre: 'Redémarrage conseillé', texte: 'Redémarre l\'ordinateur pour finir les mises à jour (enregistre ton travail avant).' }, now);
  });
  if (hermod && bilan.some((x) => !x.ok)) hermod.alert({ level: 'moyenne', title: `${p.poste} : mises à jour en échec`, detail: bilan.filter((x) => !x.ok).map((x) => `${x.gestionnaire} : ${x.fin.slice(-200)}`).join('\n'), key: `compagnon-majs-${p.poste}` });
  json(res, 200, { ok: true }); return true;
}
