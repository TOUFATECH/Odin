// Orphée temps réel · la porte du navigateur (après la vérification de la session, comme toute l'API d'Odin).
// Le navigateur ne parle jamais au service Python : il envoie ici son micro (PCM 16 bits, 16 kHz, mono) par petits
// morceaux, et reçoit en retour, dans la réponse même du morceau qui les déclenche, les événements du service
// (soupçon, coupure, fin de tour…). Les textes provisoires arrivent aussi par un flux d'événements.
//
//   GET  /api/voice/orphee/etat                         le service : prêt, absent (et pourquoi), ses moteurs
//   POST /api/voice/orphee/session                      ouvre une conversation (réglages de Réglages → Voix)
//   POST /api/voice/orphee/audio?id=…                   un morceau de micro → les événements qu'il déclenche
//   POST /api/voice/orphee/controle?id=…                « Odin parle tel segment » / « Odin a fini »
//   GET  /api/voice/orphee/evenements?id=…              flux d'événements (textes provisoires, fin de tour…)
//   POST /api/voice/orphee/tour {id, texte?}            fin de tour : comprend (Logos pour la voix), répond, découpe en segments
//   POST /api/voice/orphee/dit {id, segment}            ce segment a été dit en entier
//   POST /api/voice/orphee/coupure {id, segment, joue_ms, duree_ms}   Odin a été coupé là
//   POST /api/voice/orphee/fin {id}                     ferme la conversation
// Sans le service (pas de Python, en panne) : `repli: true`, et la page garde la voix habituelle (maintenir pour parler).

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OdinConfig } from '../config.ts';
import { repondreProjet, projetActif } from '../muninn/projet.ts';
import { apprendreVoix, correctionDite, corrigerVoix, vocabulaire } from '../valhalla/huginn.ts';
import type { Correction } from '../valhalla/huginn-voix.ts';
import { valhallaOf } from '../valhalla/odin.ts';
import { garderAudio } from '../voice/audio-brut.ts';
import { mots, prompt } from '../voice/mots.ts';
import { orphee, type Orphee } from '../voice/orphee.ts';
import { estContinue, Fil } from '../voice/reprise.ts';
import { hear } from '../voice/voice.ts';

type Voix = OdinConfig['voice'];
export interface OptionsOrpheeApi {
  home: string; voix: () => Voix;
  /** la réponse d'Odin avec son IA (mode « auto ») ; absente : Logos seul, sans IA */
  ask?: (texte: string) => Promise<string>;
  /** le service (essais : un service lancé à part) */
  service?: () => Orphee;
  /** transcription de repli (essais : remplacée) */
  entendre?: (wav: Uint8Array, v: Voix) => Promise<string>;
}

const json = (res: ServerResponse, code: number, corps: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(corps)); };
async function lire(req: IncomingMessage, max: number): Promise<Buffer | undefined> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) return undefined; parts.push(c as Buffer); }
  return Buffer.concat(parts);
}
const lireJson = async (req: IncomingMessage) => { const b = await lire(req, 64 * 1024); try { return b?.length ? JSON.parse(b.toString('utf8')) as Record<string, unknown> : {}; } catch { return {}; } };

/** Les conversations ouvertes : le fil des réponses (reprise par segments) et les dernières corrections de Logos. */
const conversations = new Map<string, { fil: Fil; corrections: Correction[]; vu: number }>();
const ID = /^[a-f0-9]{12}$/;
const STOP_SEUL = /^(?:stop|arr[eê]te|tais[- ]toi|attends|chut|silence|odin)[ .!]*$/i;

/** La réponse d'Odin à ce qui a été dit (sans IA si « sans IA », ou à défaut d'IA) : Logos, puis le projet actif. */
async function repondre(texte: string, o: OptionsOrpheeApi, v: Voix): Promise<string> {
  const va = valhallaOf();
  if (v.brain !== 'sans-ia' && o.ask) return o.ask(texte);
  const r = va ? await va.ctx('bragi').order(texte).catch((e: Error) => ({ ok: false, text: e.message })) : { ok: false, text: 'Mes applis ne sont pas démarrées.' };
  if (r.ok !== false) return r.text;
  // Logos ne sait pas quoi faire : peut-être une question sur le projet en cours (réponse sourcée, sans IA).
  if (projetActif(o.home)) { const p = repondreProjet(texte, { home: o.home }); if (p.trouve) return p.texte; }
  return r.text;
}

export async function orpheeApi(req: IncomingMessage, res: ServerResponse, url: URL, o: OptionsOrpheeApi): Promise<boolean> {
  if (!url.pathname.startsWith('/api/voice/orphee/')) return false;
  const quoi = url.pathname.slice('/api/voice/orphee/'.length), svc = (o.service ?? orphee)(), v = o.voix();
  if (req.method === 'POST' && req.headers['x-odin'] !== '1') { json(res, 403, { error: 'en-tête x-odin manquant' }); return true; }
  for (const [k, c] of conversations) if (Date.now() - c.vu > 30 * 60_000) conversations.delete(k);

  if (req.method === 'GET' && quoi === 'etat') {
    if (!svc.pret && svc.etat !== 'absent') void svc.demarrer();
    json(res, 200, { ok: true, ...svc.resume(), repli: !svc.pret }); return true;
  }
  if (req.method === 'POST' && quoi === 'session') {
    const pret = svc.pret || await svc.demarrer();
    if (!pret) { json(res, 200, { ok: false, repli: true, error: svc.raison || `Conversation en direct indisponible (${svc.etat}).` }); return true; }
    const cfg = { sensibilite: v.listen?.sensitivity ?? 6, fin_ms: v.listen?.endSilenceMs ?? 1500, coupures: v.interrupt?.bargeIn !== false, ignorer_acquiescements: v.interrupt?.ignoreBackchannel !== false, mots_arret: v.interrupt?.stopWords ?? [], invite: prompt(mots(o.home)) };
    const r = await svc.appeler('/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cfg) }).then((x) => x.json() as Promise<{ ok: boolean; id: string; trame_ms: number; taux: number }>).catch((e: Error) => ({ ok: false, error: e.message }) as never);
    if (!r.ok || !ID.test(r.id)) { json(res, 200, { ok: false, repli: true, error: 'Le service temps réel n\'a pas ouvert la conversation : je garde la voix habituelle.' }); return true; }
    conversations.set(r.id, { fil: new Fil(v.interrupt?.keepTopicMin ?? 30), corrections: [], vu: Date.now() });
    json(res, 200, { ok: true, id: r.id, trame_ms: r.trame_ms, taux: r.taux, moteurs: svc.moteurs }); return true;
  }

  const id = url.searchParams.get('id') ?? '';
  const corps = req.method === 'POST' && quoi !== 'audio' ? await lireJson(req) : {};
  const cid = ID.test(id) ? id : String(corps.id ?? '');
  const conv = ID.test(cid) ? conversations.get(cid) : undefined;
  if (!conv) { json(res, 404, { ok: false, error: 'conversation inconnue ou terminée' }); return true; }
  conv.vu = Date.now();
  try {
    if (req.method === 'POST' && quoi === 'audio') {
      const pcm = await lire(req, 2 * 1024 * 1024); if (!pcm) { json(res, 413, { ok: false, error: 'morceau trop gros' }); return true; }
      const r = await svc.appeler(`/sessions/${cid}/audio`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: pcm });
      json(res, r.status, await r.json()); return true;
    }
    if (req.method === 'POST' && quoi === 'controle') {
      const type = String(corps.type ?? ''); if (!/^(odin_parle|odin_fin)$/.test(type)) { json(res, 400, { ok: false, error: 'contrôle inconnu' }); return true; }
      const r = await svc.appeler(`/sessions/${cid}/controle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, segment: String(corps.segment ?? '').slice(0, 60), texte: String(corps.texte ?? '').slice(0, 4000) }) });
      json(res, r.status, await r.json()); return true;
    }
    if (req.method === 'GET' && quoi === 'evenements') {
      const r = await svc.appeler(`/sessions/${cid}/evenements`);
      if (!r.ok || !r.body) { json(res, 502, { ok: false, error: 'flux indisponible' }); return true; }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      const lecteur = r.body.getReader();
      req.on('close', () => { void lecteur.cancel().catch(() => 0); });
      for (;;) { const { done, value } = await lecteur.read().catch(() => ({ done: true, value: undefined })); if (done || res.writableEnded) break; res.write(value); }
      res.end(); return true;
    }
    if (req.method === 'POST' && quoi === 'tour') {
      // Ce qui a été dit : le texte du service s'il transcrit en direct, sinon Odin transcrit lui-même l'énoncé.
      let entendu = String(corps.texte ?? '').trim().slice(0, 4000);
      let wav: Uint8Array | undefined;
      if (!entendu || v.privacy?.keepAudio) {
        const r = await svc.appeler(`/sessions/${cid}/enonce`);
        if (r.status === 200) wav = new Uint8Array(await r.arrayBuffer());
      }
      if (!entendu && wav) entendu = (o.entendre ? await o.entendre(wav, v) : (await hear(wav, 'audio/wav', v)).text).trim();
      else if (wav) garderAudio(v.privacy, wav, 'audio/wav', { texte: entendu, source: 'conversation en direct' }, o.home);
      if (!entendu) { json(res, 200, { ok: true, rien: true }); return true; }
      if (STOP_SEUL.test(entendu)) { json(res, 200, { ok: true, entendu, stop: true }); return true; }
      // « non, je voulais dire NAS » : Logos retient la correction pour la prochaine fois.
      const cd = correctionDite(entendu);
      if (cd && (cd.entendu || conv.corrections.length)) {
        const avant = cd.entendu ?? conv.corrections.at(-1)!.entendu;
        apprendreVoix(avant, cd.voulu, o.home);
        conv.corrections = [];
        const rep = conv.fil.nouvelle(entendu, `D'accord : quand j'entends « ${avant} », je comprendrai « ${cd.voulu} ».`);
        json(res, 200, { ok: true, entendu, appris: { entendu: avant, mot: cd.voulu }, reponse: { id: rep.id, segments: rep.segments.map((x) => ({ id: x.id, texte: x.texte })) } }); return true;
      }
      if (estContinue(entendu)) {
        const suite = conv.fil.continuer();
        if (!suite) { const rep = conv.fil.nouvelle(entendu, 'Je n\'ai rien en cours à reprendre.'); json(res, 200, { ok: true, entendu, reponse: { id: rep.id, segments: rep.segments.map((x) => ({ id: x.id, texte: x.texte })) } }); return true; }
        json(res, 200, { ok: true, entendu, reprise: true, reponse: { id: suite.reponse.id, segments: suite.segments } }); return true;
      }
      const va = valhallaOf();
      // Logos corrige ce qui a été mal entendu ; la phrase corrigée est ensuite comprise une seule fois (par la réponse).
      const c = corrigerVoix(entendu, vocabulaire({ modules: va?.modules() ?? [], home: o.home, prononciations: v.speech?.pronunciations }));
      conv.corrections = c.corrections;
      const texte = await repondre(c.texte, o, v);
      const rep = conv.fil.nouvelle(c.texte, `${c.doute ? `${c.doute}\n` : ''}${texte}`);
      json(res, 200, { ok: true, entendu, compris: c.texte, corrections: c.corrections, ...(c.doute ? { doute: c.doute } : {}), reponse: { id: rep.id, segments: rep.segments.map((x) => ({ id: x.id, texte: x.texte })) } }); return true;
    }
    if (req.method === 'POST' && quoi === 'dit') { conv.fil.dit(String(corps.segment ?? '')); json(res, 200, { ok: true }); return true; }
    if (req.method === 'POST' && quoi === 'coupure') { conv.fil.coupe(String(corps.segment ?? ''), Number(corps.joue_ms) || 0, Number(corps.duree_ms) || 0); json(res, 200, { ok: true }); return true; }
    if (req.method === 'POST' && quoi === 'fin') { conversations.delete(cid); await svc.appeler(`/sessions/${cid}`, { method: 'DELETE' }).catch(() => undefined); json(res, 200, { ok: true }); return true; }
  } catch (e) { json(res, 200, { ok: false, repli: !svc.pret, error: (e as Error).message.slice(0, 300) }); return true; }
  json(res, 404, { ok: false, error: 'adresse inconnue' }); return true;
}
