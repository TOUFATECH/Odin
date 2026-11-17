// Écho · mode « Conversation » : les routes de l'archive (POST, en-tête x-odin). Elles servent la copie sonore (en
// option, chiffrée), la conservation et le résumé d'une conversation. Préfixe /api/rodd/archive/.
//   /api/rodd/archive/etat            : état de l'enregistrement, taille du son, présence du résumé, plafonds
//   /api/rodd/archive/enregistrer     : allume / éteint la copie sonore de CETTE conversation (éteinte par défaut)
//   /api/rodd/archive/son (GET)       : le WAV assemblé, déchiffré, en flux (écoute et téléchargement)
//   /api/rodd/archive/resume          : fait écrire le résumé par le modèle d'Odin (jamais de faux texte) et le garde
//   /api/rodd/archive/resume-lire     : relit le résumé gardé
//   /api/rodd/archive/resume-modifier : enregistre le résumé modifié par le propriétaire
//
// Garde-fous : rien ne part dehors si « tout sur la machine » est coché (le résumé n'utilise alors qu'un modèle local) ;
// le son et le texte ne sont jamais en clair sur le disque ; le résumé est fait par le modèle, jamais inventé.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Odin } from '../runtime.ts';
import type { ModCtx } from '../valhalla/types.ts';
import { valhallaOf } from '../valhalla/odin.ts';
import { reglagesConversation, NOMS, type Reglages } from '../valhalla/rodd/conversation.ts';
import { historiqueDe, idValide } from '../valhalla/rodd/conversation-historique.ts';
import { enregistrementDe, MAX_OCTETS, MAX_SECONDES } from '../valhalla/rodd/conversation-son.ts';
import { resumeDe, resumer } from '../valhalla/rodd/conversation-resume.ts';
import { noterConversation } from '../valhalla/rodd/conversation-memoire.ts';
import { corrigerTours } from '../valhalla/rodd/conversation-correction.ts';
import { modeleDe, type OptionsConversation } from './conversation-api.ts';

export interface OptionsArchive {
  odin: OptionsConversation['odin'];
  /** contexte de l'appli Écho (défaut : celui des applis démarrées) */
  ctx?: () => ModCtx | undefined;
  /** briques remplacées (essais) : le modèle */
  modele?: ReturnType<typeof modeleDe>;
}

const MAX_JSON = 64 * 1024;
const json = (res: ServerResponse, code: number, corps: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(corps)); };

async function lireJson(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > MAX_JSON) { req.destroy(); return undefined; } parts.push(c as Buffer); }
  try { const j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') as unknown; return j && typeof j === 'object' ? j as Record<string, unknown> : {}; } catch { return {}; }
}

const AIDE = 'Configure un modèle dans Réglages → Modèle (le résumé est écrit par le modèle d\'Odin, jamais inventé).';
const AIDE_CORR = 'Configure un modèle dans Réglages → Modèle (la correction est écrite par le modèle d\'Odin, jamais inventée).';
/** Le modèle utilisable pour résumer : aucun sans modèle de langue, aucun modèle en ligne si « tout sur la machine ». */
function modeleUtilisable(modele: ReturnType<typeof modeleDe>, reglages: Pick<Reglages, 'local'>): ReturnType<typeof modeleDe> {
  if (!modele) return undefined;
  if (reglages.local && !modele.local) return undefined;
  return modele;
}

/** Les langues d'une conversation (noms français), pour le pointeur neutre de la mémoire. */
function languesDe(tours: Array<{ de: keyof typeof NOMS; vers: keyof typeof NOMS }>): string[] {
  const s = new Set<string>(); for (const t of tours) { s.add(NOMS[t.de].fr); s.add(NOMS[t.vers].fr); }
  return [...s];
}

export async function archiveRoute(req: IncomingMessage, res: ServerResponse, url: URL, o: OptionsArchive): Promise<boolean> {
  if (!url.pathname.startsWith('/api/rodd/archive/')) return false;
  const quoi = url.pathname.slice('/api/rodd/archive/'.length);
  if (!['etat', 'enregistrer', 'son', 'resume', 'resume-lire', 'resume-modifier', 'corriger', 'corriger-garder'].includes(quoi)) { json(res, 404, { ok: false, error: 'route inconnue' }); return true; }
  const methode = quoi === 'son' ? 'GET' : 'POST';
  if (req.method !== methode) { res.writeHead(405, { allow: methode, 'cache-control': 'no-store' }); res.end(); return true; }
  // x-odin seulement pour les POST : le GET 'son' (écoute et téléchargement par le navigateur) ne peut pas poser cet
  // en-tête ; il s'appuie sur le cookie de session, déjà vérifié par le serveur avant d'arriver ici.
  if (methode === 'POST' && req.headers['x-odin'] !== '1') { json(res, 403, { ok: false, error: 'en-tête x-odin manquant' }); return true; }
  const ctx = o.ctx ? o.ctx() : valhallaOf()?.ctx('rodd');
  if (!ctx) { json(res, 503, { ok: false, error: 'Les applis ne sont pas encore démarrées : réessaie dans un instant.' }); return true; }
  const reglages = reglagesConversation(ctx.settings.conversation);
  const enr = enregistrementDe(ctx), resumes = resumeDe(ctx);

  try {
    if (quoi === 'son') {
      const conv = url.searchParams.get('conv');
      if (!idValide(conv)) { json(res, 400, { ok: false, error: 'conversation inconnue' }); return true; }
      const wav = enr.assembler(conv);
      if (!wav.length) { json(res, 404, { ok: false, error: 'aucune copie sonore pour cette conversation' }); return true; }
      res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-disposition': `attachment; filename="conversation-${conv}.wav"` });
      res.end(wav);
      return true;
    }

    const b = await lireJson(req); if (!b) { json(res, 413, { ok: false, error: 'demande trop longue' }); return true; }
    const conv = idValide(b.conv) ? b.conv : undefined;
    if (!conv) { json(res, 400, { ok: false, error: 'conversation inconnue' }); return true; }

    if (quoi === 'etat') {
      const r = resumes.lire(conv);
      json(res, 200, { ok: true, enregistre: enr.actif(conv), peutEnregistrer: true, sonOctets: enr.taille(conv), resume: { existe: resumes.existe(conv), modifie: Boolean(r?.modifie) }, limite: { secondes: MAX_SECONDES, octets: MAX_OCTETS } });
      return true;
    }
    if (quoi === 'enregistrer') {
      const actif = b.actif !== false && b.actif !== 'false' && b.actif !== 0 && b.actif !== '0' && b.actif !== undefined && b.actif !== null;
      json(res, 200, { ok: true, enregistre: enr.activer(conv, actif) });
      return true;
    }
    if (quoi === 'resume-lire') {
      const r = resumes.lire(conv);
      json(res, 200, { ok: true, texte: r?.texte ?? '', modifie: Boolean(r?.modifie) });
      return true;
    }
    if (quoi === 'resume-modifier') {
      const texte = String(b.texte ?? '').trim();
      resumes.ecrire(conv, texte, { modifie: true });
      json(res, 200, { ok: true });
      return true;
    }
    if (quoi === 'corriger') {
      // Corrige l'orthographe de la transcription gardée, chaque tour dans SA langue. On montre seulement l'avant/après ;
      // rien n'est écrit tant que le propriétaire n'a pas touché « Garder » (route corriger-garder).
      const modele = modeleUtilisable(o.modele ?? modeleDe(o.odin), reglages);
      if (!modele) { json(res, 200, { ok: false, error: reglages.local ? 'Le modèle configuré est en ligne (« tout sur la machine » est coché) : aucune correction.' : 'Aucun modèle d\'Odin n\'est configuré : pas de correction.', aide: AIDE_CORR }); return true; }
      const tours = historiqueDe(ctx).lister(500, conv);
      if (!tours.length) { json(res, 200, { ok: false, error: 'Aucune transcription gardée à corriger pour cette conversation.' }); return true; }
      const corrections = await corrigerTours(tours, modele);
      json(res, 200, { ok: true, tours: corrections, modele: modele.nom || 'modèle d\'Odin' });
      return true;
    }
    if (quoi === 'corriger-garder') {
      // Garde les corrections choisies : remplace le texte ENTENDU du tour (chiffré) et le marque « corrigé ».
      const histo = historiqueDe(ctx);
      const parId = new Map(histo.lister(500, conv).map((t) => [t.id, t]));
      const liste = Array.isArray(b.corrections) ? b.corrections as Array<{ id?: unknown; apres?: unknown }> : [];
      let n = 0;
      for (const c of liste) {
        const t = idValide(c.id) ? parId.get(c.id) : undefined; if (!t) continue;
        const apres = String(c.apres ?? '').trim(); if (!apres || apres === (t.entendu || '').trim()) continue;
        if (histo.remplacer(t.id, { qui: t.qui, de: t.de, vers: t.vers, entendu: apres, traduit: t.traduit, corrige: true })) n++;
      }
      json(res, 200, { ok: true, n });
      return true;
    }
    // quoi === 'resume' : fabrique le résumé par le modèle d'Odin.
    const modele = modeleUtilisable(o.modele ?? modeleDe(o.odin), reglages);
    if (!modele) { json(res, 200, { ok: false, error: reglages.local ? 'Le modèle configuré est en ligne (« tout sur la machine » est coché) : aucun résumé.' : 'Aucun modèle d\'Odin n\'est configuré : pas de résumé.', aide: AIDE }); return true; }
    const tours = historiqueDe(ctx).lister(500, conv);
    if (!tours.length) { json(res, 200, { ok: false, error: 'Aucune transcription gardée à résumer pour cette conversation.' }); return true; }
    const texte = await resumer(tours, modele);
    if (!texte) { json(res, 200, { ok: false, error: 'Le modèle n\'a pas pu résumer cette conversation.', aide: AIDE }); return true; }
    resumes.ecrire(conv, texte, { modifie: false });
    const dernier = tours[0]?.at ?? new Date().toISOString();
    noterConversation({ conv, titre: '', langues: languesDe(tours), nTours: tours.length, date: dernier });
    json(res, 200, { ok: true, texte, modele: modele.nom || 'modèle d\'Odin' });
    return true;
  } catch (x) {
    if (!res.headersSent) json(res, 200, { ok: false, error: `Erreur : ${(x as Error).message.slice(0, 300)}` });
    return true;
  }
}
