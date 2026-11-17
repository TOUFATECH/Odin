// Noûs — la PRÉPARATION de l'entraînement, toujours hors du fil d'Odin (un worker de courte durée) :
//   - lire le corpus chiffré (src/brain/nous/corpus.ts) et retrouver ses textes (il est rangé en octets, sans perte) ;
//   - apprendre le VRAI découpage sur ces textes (une seule fois, avant le premier réseau : changer de découpage
//     change le sens de chaque morceau, il faudrait repartir d'un réseau neuf) ;
//   - réencoder les textes avec ce découpage et les couper en séquences de la taille du contexte ;
//   - mettre à part le BANC (environ 1 exemple sur 20, choisi par empreinte : toujours les mêmes, jamais appris),
//     qui sert de porte de qualité ;
//   - mesurer la taille de réseau que la machine peut entraîner.
// Fonctions pures exportées (les essais s'en servent en direct) ; en worker, elles répondent à un seul ordre.
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { lireTranche, empreinte } from './corpus.ts';
import { magasinDisque, scellageMachine, dossierCorpus } from './file-odin.ts';
import { filtreOublis, lireOublis, sansOublis } from './oubli.ts';
import { apprendreDecoupage, lireDecoupageSerialise, serialiserDecoupage, SPECIAUX, type DecoupageSerialise } from './decoupage.ts';
import { JETONS_ROLE, paireAjustement, prng } from './etapes.ts';
import type { Sorte } from './deps.ts';
import type { Hyper } from './tailles.ts';

const BASE = 8; // le découpage d'attente : un morceau par octet, décalé des 8 morceaux spéciaux

/** Les textes du corpus (au plus `maxOctets` en tout, les tranches les plus récentes d'abord). */
export function textesDuCorpus(home: string, o: { dir?: string; maxOctets?: number } = {}): string[] {
  return exemplesDuCorpus(home, o).map((e) => e.texte);
}

/** Un exemple relu du corpus : son texte et sa sorte (une PAIRE est de sorte « echange » : la demande, un saut de ligne,
 *  puis la réponse). */
export interface ExempleTexte { texte: string; sorte: Sorte }

/** Les exemples du corpus, avec leur sorte (au plus `maxOctets` en tout, les tranches les plus récentes d'abord). */
export function exemplesDuCorpus(home: string, o: { dir?: string; maxOctets?: number } = {}): ExempleTexte[] {
  const dir = o.dir ?? dossierCorpus(home), m = magasinDisque(dir), s = scellageMachine(home);
  // Ce qui a été oublié n'est jamais repris, même si le corpus n'a pas encore été purgé.
  const oublis = filtreOublis(lireOublis(home));
  if (!s) return [];
  const max = o.maxOctets ?? 64 * 1024 * 1024;
  const out: ExempleTexte[] = [];
  let n = 0;
  for (const nom of m.lister().reverse()) {
    for (const e of lireTranche(m.lire(nom), s)) {
      const oct = new Uint8Array(e.morceaux.length);
      let k = 0; for (let i = 0; i < e.morceaux.length; i++) { const v = e.morceaux[i] - BASE; if (v >= 0 && v < 256) oct[k++] = v; }
      const t = sansOublis(Buffer.from(oct.subarray(0, k)).toString('utf8'), e.idSouvenir, oublis) ?? '';
      if (!t.trim()) continue;
      out.push({ texte: t, sorte: e.sorte }); n += k;
      if (n >= max) return out;
    }
  }
  return out;
}

/**
 * Ce qui décide du banc pour un texte. Une PAIRE « demande → appli · action » (sa dernière ligne est une réponse de la
 * forme « Nom (id) → Action (id) ») est rangée d'après sa RÉPONSE : toutes les demandes d'une même action tombent du même
 * côté, et le banc mesure la capacité à trouver l'appli d'une demande NOUVELLE, pas la mémoire d'une réponse déjà vue.
 * Tout autre texte est rangé d'après lui-même. Indépendant de la langue (seule la forme de la réponse compte). Pur.
 */
export function cleBanc(texte: string): string {
  const lignes = String(texte ?? '').split('\n');
  const derniere = lignes[lignes.length - 1]?.trim() ?? '';
  return lignes.length >= 2 && /\([\w-]+\)\s*→\s*.+\([\w-]+\)$/u.test(derniere) ? `paire:${derniere}` : texte;
}

/** Un exemple du banc ? (environ 1 sur 20, toujours le même, d'après sa clé de banc) */
export function auBanc(texte: string): boolean {
  const e = empreinte(Int32Array.from(Buffer.from(cleBanc(texte), 'utf8')));
  let h = 0; for (let i = 0; i < e.length; i++) h = (Math.imul(h, 31) + e.charCodeAt(i)) >>> 0;
  return h % 20 === 0;
}

export interface Jeux {
  banc: Int32Array[]; entrainement: Int32Array[]; textes: number; morceaux: number;
  /** Le masque de rôles de chaque séquence d'entraînement (une paire : on n'apprend que la réponse ; sinon absent). */
  roles?: Array<Int32Array | undefined>;
}

/** Réencode les textes et les coupe en séquences (début de texte marqué) ; banc à part, entraînement tiré à la graine. */
export function preparerJeux(textes: Array<string | ExempleTexte>, dec: DecoupageSerialise, o: { contexte: number; graine: number; maxSequences?: number; maxBanc?: number }): Jeux {
  const d = lireDecoupageSerialise(dec);
  const banc: Int32Array[] = [], tout: Array<{ s: Int32Array; r?: Int32Array }> = [];
  let morceaux = 0, avecRoles = false;
  for (const x of textes) {
    const t = typeof x === 'string' ? x : x.texte, sorte = typeof x === 'string' ? undefined : x.sorte;
    const coupe = sorte === 'echange' ? t.indexOf('\n') : -1;
    if (coupe > 0 && coupe < t.length - 1) {
      // Une PAIRE : la forme d'usage [USER] demande [ASSISTANT] réponse [EOS], et on n'apprend que la réponse. Jamais
      // coupée en morceaux (le réseau garde la FIN d'une paire trop longue : la réponse).
      const p = paireAjustement(d.encoder(t.slice(0, coupe)), d.encoder(t.slice(coupe + 1)), JETONS_ROLE);
      morceaux += p.entree.length;
      if (auBanc(t)) banc.push(p.entree); else { tout.push({ s: p.entree, r: p.roles }); avecRoles = true; }
      continue;
    }
    const ids = d.encoder(t);
    const seq = new Int32Array(ids.length + 2); seq[0] = SPECIAUX.BOS; seq.set(ids, 1); seq[seq.length - 1] = SPECIAUX.EOS;
    morceaux += seq.length;
    const auB = auBanc(t);
    for (let i = 0; i < seq.length - 1; i += o.contexte) { const c = seq.slice(i, Math.min(seq.length, i + o.contexte)); if (c.length >= 2) { if (auB) banc.push(c); else tout.push({ s: c }); } }
  }
  const r = prng(o.graine);
  // tirage sans remise (Fisher-Yates partiel) : une séance ne voit qu'une part bornée du corpus, différente à chaque fois
  const max = Math.min(tout.length, o.maxSequences ?? 4096);
  for (let i = 0; i < max; i++) { const j = i + Math.floor(r() * (tout.length - i)); const x = tout[i]; tout[i] = tout[j]; tout[j] = x; }
  const pris = tout.slice(0, max);
  return { banc: banc.slice(0, o.maxBanc ?? 64), entrainement: pris.map((x) => x.s), ...(avecRoles ? { roles: pris.map((x) => x.r) } : {}), textes: textes.length, morceaux };
}

/** Le découpage appris sur les textes (vocabulaire du gabarit). */
export function decoupageDe(textes: string[], vocab: number, graine: number): DecoupageSerialise {
  return serialiserDecoupage(apprendreDecoupage(textes, vocab, graine));
}

// ----------------------------------------------------------------------------------------------------------------
// En worker : un ordre, une réponse, puis le worker s'arrête.
type Ordre =
  | { type: 'decoupage'; home: string; dir?: string; vocab: number; graine: number; maxOctets?: number }
  | { type: 'jeux'; home: string; dir?: string; dec: DecoupageSerialise; contexte: number; graine: number; maxSequences?: number; maxOctets?: number }
  | { type: 'taille' };

if (!isMainThread && parentPort && (workerData as { role?: string } | undefined)?.role === 'preparation') {
  const o = (workerData as { ordre: Ordre }).ordre;
  void (async () => {
    try {
      if (o.type === 'decoupage') {
        const textes = textesDuCorpus(o.home, { dir: o.dir, maxOctets: o.maxOctets ?? 8 * 1024 * 1024 });
        parentPort!.postMessage({ ok: true, valeur: { dec: decoupageDe(textes, o.vocab, o.graine), textes: textes.length } });
      } else if (o.type === 'jeux') {
        const textes = exemplesDuCorpus(o.home, { dir: o.dir, maxOctets: o.maxOctets });
        parentPort!.postMessage({ ok: true, valeur: preparerJeux(textes, o.dec, { contexte: o.contexte, graine: o.graine, maxSequences: o.maxSequences }) });
      } else {
        const { mesurerEtChoisir } = await import('./tailles.ts');
        parentPort!.postMessage({ ok: true, valeur: await mesurerEtChoisir() });
      }
    } catch (e) { parentPort!.postMessage({ ok: false, erreur: String((e as Error)?.message ?? e) }); }
  })();
}

/** Lance un ordre de préparation dans un worker à part (le fil d'Odin ne calcule rien). */
export function enFond<T>(ordre: Ordre, delaiMs = 15 * 60_000): Promise<T> {
  return new Promise<T>((ok, ko) => {
    const w = new Worker(new URL(import.meta.url), { name: 'noos-preparation', workerData: { role: 'preparation', ordre }, resourceLimits: { maxOldGenerationSizeMb: 1024 } });
    const t = setTimeout(() => { void w.terminate(); ko(new Error('préparation trop longue')); }, delaiMs);
    t.unref();
    w.once('message', (m: { ok: boolean; valeur?: T; erreur?: string }) => { clearTimeout(t); void w.terminate(); if (m.ok) ok(m.valeur as T); else ko(new Error(m.erreur)); });
    w.once('error', (e) => { clearTimeout(t); ko(e); });
  });
}
export type { Hyper };
