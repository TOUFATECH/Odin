// Écho · mode « Conversation » : les routes de la page (POST, en-tête x-odin, session ouverte).
//   /api/rodd/conversation/etat   : réglages, langues, écoute, traduction, voix
//   /api/rodd/conversation/tour   : un tour de parole (le son en corps) → texte entendu et traduit
//   /api/rodd/conversation/texte  : un texte écrit ou corrigé → traduit (sans écoute)
//   /api/rodd/conversation/dire   : le son de la traduction, ou « dis-le avec la voix du navigateur »
//
// - Le son n'est pas gardé par défaut (la mémoire des tours ne garde que le texte, 2 minutes). S'il est ALLUMÉ pour la
//   conversation (archive), chaque tour est scellé avec la clé de la machine par EnregistrementConversation ; jamais en clair.
// - Rien du texte des personnes n'est écrit dans les journaux de la console.
// - Jamais de traduction inventée : un échec donne traduit '' et erreurTraduction.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Odin } from '../runtime.ts';
import type { ModCtx } from '../valhalla/types.ts';
import type { VoiceConfig } from '../voice/voice.ts';
import { valhallaOf } from '../valhalla/odin.ts';
import { tierOf } from '../providers/router.ts';
import { BCP47, estLangue, inacheve, LANGUES, nettoyer, NOMS, pasCompris, propositions, reglagesConversation, type Langue, type Qui, type Reglages } from '../valhalla/rodd/conversation.ts';
import { dire, ecouterTour, etatEcoute, etatTraduction, traduire, voixPour, type Deps } from '../valhalla/rodd/conversation-moteur.ts';
import { garderTours, historiqueDe, idValide, nouvelId } from '../valhalla/rodd/conversation-historique.ts';
import { enregistrementDe } from '../valhalla/rodd/conversation-son.ts';
import { noterConversation } from '../valhalla/rodd/conversation-memoire.ts';

export interface OptionsConversation {
  odin: Pick<Odin, 'cfg' | 'agent' | 'demo' | 'paths'>;
  voix: () => VoiceConfig;
  /** briques remplacées (essais) */
  deps?: Partial<Deps>;
  /** contexte de l'appli Écho (défaut : celui des applis démarrées) */
  ctx?: () => ModCtx | undefined;
}

const MAX_SON = 10 * 1024 * 1024, MAX_SECONDES = 60, MAX_JSON = 64 * 1024, MEMOIRE_MS = 2 * 60_000;
const json = (res: ServerResponse, code: number, corps: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(corps)); };

/** Lit le corps (au plus `max` octets) ; au-delà, le reste est lu et jeté (jusqu'à 64 Mo) pour répondre proprement. */
async function lire(req: IncomingMessage, max: number): Promise<Buffer | undefined> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > 64 * 1024 * 1024) { req.destroy(); return undefined; }
    if (n <= max) parts.push(c as Buffer);
  }
  return n > max ? undefined : Buffer.concat(parts);
}
/** Durée d'un WAV (en secondes), lue dans son en-tête ; undefined pour un autre format. */
export function dureeWav(b: Uint8Array): number | undefined {
  const s = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (s.length < 44 || s.toString('ascii', 0, 4) !== 'RIFF' || s.toString('ascii', 8, 12) !== 'WAVE') return undefined;
  let i = 12, debit = 0;
  while (i + 8 <= s.length) {
    const id = s.toString('ascii', i, i + 4), n = s.readUInt32LE(i + 4);
    if (id === 'fmt ' && i + 16 <= s.length) debit = s.readUInt32LE(i + 16);
    if (id === 'data') return debit ? Math.min(n, s.length - i - 8) / debit : undefined;
    i += 8 + n + (n % 2);
  }
  return undefined;
}

/** Ce que le serveur retient d'un tour, 2 minutes (pour « suite » et « remplace ») : le texte, jamais le son. */
interface Retenu { id: string; conv: string; qui: Qui; de: Langue; vers: Langue; brut: string; at: string; quand: number; entendu?: string; traduit?: string; moteur?: 'modele' | 'hors-ligne' | null }
const retenus = new Map<string, Retenu>();
function retenir(r: Omit<Retenu, 'quand'>): void {
  const now = Date.now(); for (const [k, x] of retenus) if (now - x.quand > MEMOIRE_MS) retenus.delete(k);
  retenus.set(r.id, { ...r, quand: now }); if (retenus.size > 200) retenus.delete(retenus.keys().next().value!);
}
const retenu = (id: string | null | undefined) => { const x = id ? retenus.get(id) : undefined; return x && Date.now() - x.quand <= MEMOIRE_MS ? x : undefined; };

/** Le modèle d'Odin pour traduire : aucun en mode démo (jamais de faux texte). */
export function modeleDe(odin: OptionsConversation['odin']): Deps['modele'] {
  if (odin.demo) return undefined;
  const p = odin.cfg.providers ?? [];
  return { demander: (s, u, sig) => odin.agent.ask(s, u, 800, sig), local: p.length > 0 && p.every((x) => tierOf(x) === 'local'), nom: p[0]?.model ?? '' };
}

/** Dès qu'une conversation est gardée (premier tour conservé), un POINTEUR NEUTRE entre dans la mémoire d'Odin — sans
 * attendre le résumé — pour qu'elle reste retrouvable (« retrouve ma conversation avec le livreur japonais de mardi »).
 * Le détail (texte, résumé) reste chiffré dans la base de l'appli ; la mémoire ne reçoit que titre, langues et date. */
function noterSiNouvelle(histo: ReturnType<typeof historiqueDe>, conv: string, reglages: Reglages, at: string): void {
  if (histo.compte(conv) === 1) noterConversation({ conv, titre: '', langues: [NOMS[reglages.moi].fr, NOMS[reglages.lui].fr], nTours: 1, date: at });
}

export async function conversationRoute(req: IncomingMessage, res: ServerResponse, url: URL, o: OptionsConversation): Promise<boolean> {
  if (!url.pathname.startsWith('/api/rodd/conversation/')) return false;
  const quoi = url.pathname.slice('/api/rodd/conversation/'.length);
  if (!['etat', 'tour', 'texte', 'dire'].includes(quoi)) { json(res, 404, { ok: false, error: 'route inconnue' }); return true; }
  if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' }); res.end(); return true; }
  if (req.headers['x-odin'] !== '1') { json(res, 403, { ok: false, error: 'en-tête x-odin manquant' }); return true; }
  const ctx = o.ctx ? o.ctx() : valhallaOf()?.ctx('rodd');
  if (!ctx) { json(res, 503, { ok: false, error: 'Les applis ne sont pas encore démarrées : réessaie dans un instant.' }); return true; }
  const reglages = reglagesConversation(ctx.settings.conversation), v = o.voix();
  const deps: Deps = { modele: modeleDe(o.odin), ...o.deps };
  try {
    if (quoi === 'etat') { json(res, 200, await etat(reglages, v, deps)); return true; }
    if (quoi === 'dire') {
      const b = await lireJson(req); if (!b) { json(res, 413, { ok: false, error: 'demande trop longue' }); return true; }
      const langue = b.langue, texte = String(b.texte ?? '').trim();
      if (!estLangue(langue)) { json(res, 400, { ok: false, error: 'langue inconnue (fr, en ou ja)' }); return true; }
      if (!texte) { json(res, 400, { ok: false, error: 'rien à dire' }); return true; }
      const d = await dire(texte, langue, v, reglages, deps);
      if ('data' in d) { res.writeHead(200, { 'content-type': d.mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(Buffer.from(d.data)); }
      else json(res, 200, { ok: true, ...d });
      return true;
    }
    const histo = garderTours(reglages, v.privacy?.privateMode || o.odin.cfg.voice?.privacy?.privateMode) ? historiqueDe(ctx) : undefined;
    if (quoi === 'texte') {
      const b = await lireJson(req); if (!b) { json(res, 413, { ok: false, error: 'texte trop long', code: 'trop-long' }); return true; }
      const conv = idValide(b.conv) ? b.conv : nouvelId(), qui: Qui = b.qui === 'lui' ? 'lui' : 'moi', brut = String(b.texte ?? '').trim().slice(0, 2000);
      if (!brut) { json(res, 400, { ok: false, error: 'aucun texte', code: 'vide' }); return true; }
      const de = qui === 'moi' ? reglages.moi : reglages.lui, vers = qui === 'moi' ? reglages.lui : reglages.moi;
      const remplace = idValide(b.remplace) ? b.remplace : undefined;
      const entendu = nettoyer(brut, de) || brut;
      const t0 = Date.now(), tr = await traduire(entendu, de, vers, reglages, deps, undefined, qui), ms = { ecoute: 0, traduction: Date.now() - t0 };
      const id = remplace ?? nouvelId(), at = new Date().toISOString();
      if (histo && tr.texte) { const c = { qui, de, vers, entendu, traduit: tr.texte, ...(remplace ? { corrige: true } : {}) }; if (!remplace || !histo.remplacer(remplace, c)) histo.ajouter({ ...c, id, conv, at }); noterSiNouvelle(histo, conv, reglages, at); }
      retenir({ id, conv, qui, de, vers, brut: entendu, at, entendu, traduit: tr.texte, moteur: tr.texte ? tr.moteur : null });
      json(res, 200, tour({ id, conv, qui, de, vers, entendu, brut, tr, ms }));
      return true;
    }
    // quoi === 'tour' : le son d'un tour de parole.
    const conv = idValide(url.searchParams.get('conv')) ? url.searchParams.get('conv')! : nouvelId();
    const prec = retenu(url.searchParams.get('suite'));
    const q = url.searchParams.get('qui'), quiDemande: Qui | 'auto' = prec ? prec.qui : q === 'moi' || q === 'lui' ? q : 'auto';
    const attendu: Qui = url.searchParams.get('attendu') === 'lui' ? 'lui' : 'moi';
    if (Number(req.headers['content-length'] ?? 0) > 64 * 1024 * 1024) { json(res, 413, { ok: false, error: 'enregistrement trop long (10 Mo et 60 s au plus)', code: 'trop-long' }); req.destroy(); return true; }
    const son = await lire(req, MAX_SON);
    if (!son) { json(res, 413, { ok: false, error: 'enregistrement trop long (10 Mo et 60 s au plus)', code: 'trop-long' }); return true; }
    if (!son.length) { json(res, 400, { ok: false, error: 'enregistrement vide', code: 'vide' }); return true; }
    if ((dureeWav(son) ?? 0) > MAX_SECONDES + 1) { json(res, 413, { ok: false, error: 'enregistrement trop long (60 s au plus) : coupe en plusieurs tours', code: 'trop-long' }); return true; }
    const t0 = Date.now();
    let e;
    try { e = await ecouterTour({ audio: new Uint8Array(son.buffer, son.byteOffset, son.byteLength), mime: String(req.headers['content-type'] ?? 'audio/wav').slice(0, 60), qui: quiDemande, attendu, moi: reglages.moi, lui: reglages.lui }, v, reglages, deps); } catch (x) { json(res, 200, { ok: false, error: `Je n'ai pas pu écouter : ${(x as Error).message.slice(0, 300)}`, code: 'ecoute' }); return true; }
    const ecoute = Date.now() - t0;
    const qui = e.qui, de = e.de ?? (qui === 'moi' ? reglages.moi : reglages.lui), vers = qui === 'moi' ? reglages.lui : reglages.moi;
    if (prec && e.rien) {
      // Le dernier morceau d'un tour (« suite ») n'est qu'un souffle ou un bruit : le tour d'avant reste tel quel.
      json(res, 200, { ok: true, id: prec.id, conv: prec.conv, qui: prec.qui, de: prec.de, vers: prec.vers, entendu: prec.entendu ?? nettoyer(prec.brut, prec.de), brut: prec.brut, traduit: prec.traduit ?? '', moteur: prec.traduit ? prec.moteur ?? null : null, ms: { ecoute, traduction: 0 }, inchange: true });
      return true;
    }
    if (e.rien || e.horsPaire) {
      // Rien de compris (ou langue hors de la paire) : on le dit, on ne traduit pas. Une « suite » vide garde le tour d'avant.
      const id = prec?.id ?? nouvelId();
      json(res, 200, { ok: true, id, conv, qui, de, vers, entendu: e.entendu, brut: e.brut, traduit: '', moteur: null, ms: { ecoute, traduction: 0 }, ...(e.rien ? { rien: true, message: e.message } : {}), ...(e.incertain ? { incertain: true } : {}), ...(e.horsPaire ? { horsPaire: e.horsPaire } : {}) });
      return true;
    }
    const brut = prec ? `${prec.brut} ${e.brut}`.trim() : e.brut, entendu = prec ? nettoyer(brut, de) : e.entendu;
    const t1 = Date.now(), tr = await traduire(entendu, de, vers, reglages, deps, undefined, qui), traduction = Date.now() - t1;
    const id = prec?.id ?? nouvelId(), at = new Date().toISOString();
    // Copie sonore (seulement si le propriétaire l'a allumée pour cette conversation, et jamais en mode privé) : le son
    // scellé avec la clé de la machine. En mode privé, rien n'est gardé — ni le texte, ni le son.
    const prive = Boolean(v.privacy?.privateMode || o.odin.cfg.voice?.privacy?.privateMode);
    const enr = enregistrementDe(ctx); if (enr.actif(conv) && !prive) { try { enr.ajouter(conv, id, son); } catch { /* copie sonore indisponible : le reste marche */ } }
    if (histo && tr.texte) { const c = { qui, de, vers, entendu, traduit: tr.texte }; if (!prec || !histo.remplacer(id, c)) histo.ajouter({ ...c, id, conv, at }); noterSiNouvelle(histo, conv, reglages, at); }
    retenir({ id, conv, qui, de, vers, brut, at, entendu, traduit: tr.texte, moteur: tr.texte ? tr.moteur : null });
    json(res, 200, tour({ id, conv, qui, de, vers, entendu, brut, tr, ms: { ecoute, traduction }, incertain: e.incertain }));
  } catch (x) {
    if (!res.headersSent) json(res, 200, { ok: false, error: `Erreur : ${(x as Error).message.slice(0, 300)}`, code: 'traduction' });
  }
  return true;
}

async function lireJson(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const b = await lire(req, MAX_JSON); if (!b) return undefined;
  try { const j = JSON.parse(b.toString('utf8') || '{}') as unknown; return j && typeof j === 'object' ? j as Record<string, unknown> : {}; } catch { return {}; }
}

function tour(t: { id: string; conv: string; qui: Qui; de: Langue; vers: Langue; entendu: string; brut: string; tr: Awaited<ReturnType<typeof traduire>>; ms: { ecoute: number; traduction: number }; incertain?: boolean }): Record<string, unknown> {
  return {
    ok: true, id: t.id, conv: t.conv, qui: t.qui, de: t.de, vers: t.vers, entendu: t.entendu, brut: t.brut, traduit: t.tr.texte, moteur: t.tr.texte ? t.tr.moteur : null, ms: t.ms,
    ...(t.tr.rien ? { rien: true, message: pasCompris(t.de, t.qui) } : {}),
    ...(t.incertain ? { incertain: true } : {}),
    ...(inacheve(t.entendu, t.de) ? { inacheve: true } : {}),
    ...(t.tr.verifier ? { verifier: t.tr.verifier } : {}),
    ...(!t.tr.texte && t.tr.erreur ? { erreurTraduction: `${t.tr.erreur}${t.tr.aide ? ` ${t.tr.aide}` : ''}` } : {}),
  };
}

async function etat(reglages: Reglages, v: VoiceConfig, deps: Deps): Promise<Record<string, unknown>> {
  const voix: Record<string, string> = {};
  for (const l of LANGUES) voix[l] = await voixPour(l, v, reglages, deps, { telecharger: false });
  return {
    ok: true, reglages,
    langues: LANGUES.map((code) => ({ code, nom: NOMS[code].fr, nomLocal: NOMS[code].local, propose: propositions(code), bcp47: BCP47[code] })),
    ecoute: etatEcoute(v, reglages, deps),
    traduction: await etatTraduction(reglages, deps),
    voix, local: reglages.local,
    // La reconnaissance du navigateur envoie le son au service du navigateur : jamais avec « tout sur la machine »,
    // ni avec « 100 % local » de la voix (le son suit toujours ce réglage).
    navigateurEcoute: !reglages.local && !v.localOnly,
  };
}
