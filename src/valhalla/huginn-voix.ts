// Logos pour la voix — avant de comprendre une phrase dite (et mal transcrite), Logos corrige les mots qui
// SONNENT comme un mot qu'Odin connaît : « nase » → NAS, « SIO » → SEO, « ring horni » → Hringhorni.
// Comme quelqu'un qui lit une dictée imparfaite : il prend le sens le plus probable et le dit en une ligne
// quand il doute. Sans IA, sans réseau : une clé phonétique du français, un lexique, et le contexte de la phrase.
//
// Le lexique :
// - appris : ce que tu as corrigé (« non, je voulais dire NAS »), rangé avec tes mots d'Écho (valhalla/rodd/mots.json),
//   donc servi aussi à la dictée et soufflé à Whisper ;
// - les noms des applis d'Odin et leurs mots-clés techniques ;
// - quelques termes d'informatique courants (NAS, SEO, VPN, LXC…), avec les mots qui les accompagnent d'habitude ;
// - le lexique de prononciation de la voix (Réglages → Voix) lu à l'envers : ce qu'Odin prononce « Mné-mo-zine »,
//   tu peux le dire pareil.
// Un vrai mot français (« nase ») n'est remplacé que si la phrase parle du bon sujet (« mon nase est plein » : disque,
// plein → NAS) ; sinon il est laissé tel quel. Le texte reste une donnée : rien ici ne lance d'action.

import { mots, saveMots, type Mot } from '../voice/mots.ts';
import { connu, dicoFrancais, motJuste, propositions } from './snotra/orthographe.ts';
import type { Module } from './types.ts';

const plier = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'");

/**
 * Clé phonétique d'un mot français (simplifiée, à la manière de Phonex) : deux mots qui se prononcent pareil ont la
 * même clé. « nase », « NAS », « naze » → « na » ; « Hringhorni », « ring horni » → « rIgorni ». Pure.
 */
export function cle(mot: string): string {
  let x = plier(mot).replace(/[^a-z]/g, '');
  if (!x) return '';
  x = x.replace(/ph/g, 'f').replace(/qu/g, 'k').replace(/q/g, 'k').replace(/gu(?=[eiy])/g, 'g').replace(/sch|sh|ch/g, 'S').replace(/gn/g, 'N')
    .replace(/c(?=[eiy])/g, 's').replace(/ck/g, 'k').replace(/c/g, 'k').replace(/g(?=[eiy])/g, 'j').replace(/x/g, 'ks').replace(/z/g, 's')
    .replace(/w/g, 'v').replace(/y/g, 'i').replace(/h/g, '')
    .replace(/eau|au/g, 'o').replace(/ou/g, 'U').replace(/oi/g, 'va')
    .replace(/ai|ei/g, 'e').replace(/(?:er|ez|et)$/, 'e')
    .replace(/(?:ain|ein|aim|in|im|un|um)(?![aeiouU])/g, 'I').replace(/(?:an|am|en|em)(?![aeiouU])/g, 'A').replace(/(?:on|om)(?![aeiouU])/g, 'O');
  // Lettres muettes en fin de mot, puis lettres doublées.
  x = x.replace(/e$/, '').replace(/[stdpx]+$/, '').replace(/e$/, '');
  return x.replace(/(.)\1+/g, '$1') || plier(mot).replace(/[^a-z]/g, '').slice(0, 2);
}

/** Distance d'édition (Levenshtein) entre deux clés courtes. Pure. */
export function ecart(a: string, b: string): number {
  if (a === b) return 0;
  const p = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = p[0]; p[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = p[j]; p[j] = Math.min(p[j] + 1, p[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return p[b.length];
}

export type Source = 'appris' | 'appli' | 'technique' | 'prononciation';
export interface Terme { mot: string; source: Source; /** mots qui accompagnent ce terme d'habitude (le contexte qui le rend probable) */ contexte?: string[]; /** autres façons de le dire (« Mné-mo-zine ») */ dits?: string[]; /** ce qu'on a déjà entendu à sa place */ entendus?: string[] }
export interface Correction { entendu: string; mot: string; sur: 'appris' | 'prononciation' | 'contexte' | 'proche'; certitude: number }

/** Termes d'informatique courants, souvent mal transcrits, et ce qui les accompagne. */
export const TECHNIQUES: Terme[] = [
  { mot: 'NAS', source: 'technique', contexte: ['disque', 'disques', 'stockage', 'sauvegarde', 'sauvegardes', 'plein', 'pleine', 'partage', 'partages', 'fichiers', 'serveur', 'synology', 'raid', 'monte', 'copie'] },
  { mot: 'SEO', source: 'technique', contexte: ['site', 'sites', 'referencement', 'google', 'page', 'pages', 'web', 'mots-cles', 'classement', 'arachne'] },
  { mot: 'VPN', source: 'technique', contexte: ['connexion', 'tunnel', 'wireguard', 'exterieur', 'acces', 'vortex'] },
  { mot: 'LXC', source: 'technique', contexte: ['conteneur', 'conteneurs', 'proxmox', 'machine', 'hydre'] },
  { mot: 'DNS', source: 'technique', contexte: ['domaine', 'nom', 'adresse', 'resolution', 'serveur'] },
  { mot: 'SSH', source: 'technique', contexte: ['connexion', 'terminal', 'serveur', 'cle', 'machine', 'poste'] },
  { mot: 'Proxmox', source: 'technique', contexte: ['machine', 'machines', 'virtuelle', 'virtuelles', 'serveur', 'vm'] },
  { mot: 'Docker', source: 'technique', contexte: ['conteneur', 'conteneurs', 'image', 'images', 'pile'] },
  { mot: 'Wi-Fi', source: 'technique', contexte: ['reseau', 'mot', 'passe', 'box', 'borne', 'connexion'] },
  { mot: 'RAID', source: 'technique', contexte: ['disque', 'disques', 'grappe', 'nas'] },
  { mot: 'VM', source: 'technique', contexte: ['machine', 'virtuelle', 'proxmox', 'demarre', 'arrete'] },
];

/** Le vocabulaire de Logos pour la voix : appris, applis, technique, prononciations. */
export function vocabulaire(o: { modules?: Module[]; home?: string; prononciations?: Record<string, string>; appris?: Mot[] } = {}): Terme[] {
  const out: Terme[] = [];
  for (const m of o.appris ?? mots(o.home)) out.push({ mot: m.mot, source: 'appris', entendus: m.entendus });
  for (const m of o.modules ?? []) {
    out.push({ mot: m.name, source: 'appli', contexte: m.words.map(plier).filter((w) => w.length >= 4).slice(0, 20) });
    // Les mots-clés « techniques » d'une appli (un seul mot, 4 lettres au moins, pas un mot français courant).
    for (const w of m.words) if (/^[\p{L}\p{N}-]{4,}$/u.test(w) && !motFrancais(w) && !francaisSansAccents(w)) out.push({ mot: w, source: 'appli', contexte: [plier(m.name), ...m.words.map(plier).filter((x) => x !== plier(w) && x.length >= 4).slice(0, 12)] });
  }
  out.push(...TECHNIQUES);
  for (const [mot, dit] of Object.entries(o.prononciations ?? {})) if (mot.trim() && dit.trim()) out.push({ mot: mot.trim(), source: 'prononciation', dits: [dit] });
  return out;
}

let dico: ((w: string) => boolean) | undefined;
/** Un vrai mot français (dictionnaire de Plume) ? */
export function motFrancais(w: string): boolean {
  if (!dico) { try { const d = dicoFrancais(); dico = (x) => connu(d, x) || connu(d, x.toLowerCase()) || motJuste(d, x); } catch { dico = () => false; } }
  return dico(w);
}

/** Le même mot, au pluriel, à l'accent ou à la terminaison près (« iso » / « isos », « récupère » / « recuperer »). Pur. */
export function memeMot(a: string, b: string): boolean {
  const x = plier(a).replace(/[^a-z0-9]/g, ''), y = plier(b).replace(/[^a-z0-9]/g, '');
  if (x === y) return true;
  if (/^[A-Z0-9-]{2,6}$/.test(a.trim()) || /^[A-Z0-9-]{2,6}$/.test(b.trim())) return false; // un sigle : « NAS » n'est pas « nase »
  const [c, l] = x.length <= y.length ? [x, y] : [y, x];
  return c.length >= 3 && l.startsWith(c) && l.length - c.length <= 3;
}

/** Un mot français écrit sans ses accents (« depot », « recuperer », « etat ») ? */
function francaisSansAccents(w: string): boolean {
  try { const d = dicoFrancais(), f = plier(w); return propositions(d, w.toLowerCase(), 5).some((p) => plier(p.mot) === f); } catch { return false; }
}

interface Jeton { brut: string; debut: number; fin: number }
const jetons = (t: string): Jeton[] => [...t.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)].map((m) => ({ brut: m[0], debut: m.index!, fin: m.index! + m[0].length }));
const COURANTS = new Set('le la les un une des de du et ou est en a au aux ce cet cette ces mon ma mes ton ta tes son sa ses il elle on nous vous je tu pas plus que qui quoi dans sur pour par avec sans oui non ok tout tous bien fait faire mets lance ouvre ferme regarde montre dis donne'.split(' '));

/**
 * Corrige les mots mal transcrits d'une phrase dite. Rend le texte corrigé, ce qui a changé, et une ligne à dire
 * quand Odin doute (« J'ai compris NAS (j'ai entendu « nase ») »). Pure si `estMot` est fourni.
 */
export function corrigerVoix(texte: string, termes: Terme[], o: { estMot?: (w: string) => boolean } = {}): { texte: string; corrections: Correction[]; doute?: string } {
  const estMot = o.estMot ?? motFrancais;
  const js = jetons(texte), contexte = new Set(js.map((j) => plier(j.brut)));
  const parCle = new Map<string, Array<{ t: Terme; via: 'mot' | 'dit' | 'entendu' }>>();
  const ajoute = (k: string, t: Terme, via: 'mot' | 'dit' | 'entendu') => { if (k.length < 2) return; const l = parCle.get(k) ?? []; l.push({ t, via }); parCle.set(k, l); };
  for (const t of termes) { ajoute(cle(t.mot), t, 'mot'); for (const d of t.dits ?? []) ajoute(cle(d), t, 'dit'); for (const e of t.entendus ?? []) ajoute(cle(e), t, 'entendu'); }
  const corrections: Correction[] = [], rempl: Array<{ debut: number; fin: number; mot: string }> = [];
  const appuye = (t: Terme) => (t.contexte ?? []).some((c) => contexte.has(c) || [...contexte].some((w) => w.length >= 5 && c.length >= 5 && w.slice(0, 5) === c.slice(0, 5)));
  for (let i = 0; i < js.length; i++) {
    let fait = false;
    // Groupes de 3, 2, puis 1 mot (« ring horni » → Hringhorni).
    for (let n = Math.min(3, js.length - i); n >= 1 && !fait; n--) {
      const groupe = js.slice(i, i + n), entendu = texte.slice(groupe[0].debut, groupe[n - 1].fin);
      if (n === 1 && (COURANTS.has(plier(entendu)) || entendu.length < 2)) continue;
      if (n > 1 && groupe.every((g) => COURANTS.has(plier(g.brut)))) continue;
      const k = cle(groupe.map((g) => g.brut).join('')); // « mné mo zine » se dit comme « Mnémosyne »
      if (k.length < 2) continue;
      let choix: { t: Terme; sur: Correction['sur']; certitude: number } | undefined;
      for (const { t, via } of parCle.get(k) ?? []) {
        if (memeMot(t.mot, entendu)) { choix = undefined; break; } // déjà bien écrit (au pluriel ou à la terminaison près)
        const vraiMot = n === 1 && estMot(entendu);
        const c = via === 'entendu' || t.source === 'appris' ? { t, sur: 'appris' as const, certitude: 0.95 }
          : via === 'dit' ? { t, sur: 'prononciation' as const, certitude: 0.9 }
            : !vraiMot ? (appuye(t) ? { t, sur: 'prononciation' as const, certitude: 0.9 } : k.length > 2 ? { t, sur: 'prononciation' as const, certitude: 0.75 } : undefined) // une clé de deux sons (« na ») ne suffit pas sans contexte
              : appuye(t) ? { t, sur: 'contexte' as const, certitude: 0.7 } : undefined;
        if (c && (!choix || c.certitude > choix.certitude)) choix = c;
      }
      // Rien d'identique : une clé très proche (une lettre d'écart) pour un mot qui n'existe pas en français.
      if (!choix && n === 1 && k.length >= 3 && !estMot(entendu)) {
        for (const [kk, l] of parCle) {
          if (Math.abs(kk.length - k.length) > 1 || ecart(kk, k) !== 1) continue;
          // Seulement vers un terme « rare » (sigle, nom propre, mot appris) : jamais vers un simple mot-clé d'appli.
          for (const { t } of l) { if (t.source === 'appli' && !/[A-Z0-9]/.test(t.mot)) continue; if (memeMot(t.mot, entendu)) continue; const c = { t, sur: 'proche' as const, certitude: appuye(t) ? 0.75 : 0.6 }; if (c.certitude >= 0.6 && (!choix || c.certitude > choix.certitude)) choix = c; }
        }
        if (choix && !appuye(choix.t) && !/^[A-Z0-9]{2,6}$/.test(entendu)) choix = undefined; // trop hasardeux sans contexte
      }
      if (choix) {
        corrections.push({ entendu, mot: choix.t.mot, sur: choix.sur, certitude: choix.certitude });
        rempl.push({ debut: groupe[0].debut, fin: groupe[n - 1].fin, mot: choix.t.mot });
        i += n - 1; fait = true;
      }
    }
  }
  let out = '', last = 0;
  for (const r of rempl) { out += texte.slice(last, r.debut) + r.mot; last = r.fin; }
  out += texte.slice(last);
  const doutes = corrections.filter((c) => c.certitude < 0.8);
  return { texte: out, corrections, ...(doutes.length ? { doute: `J'ai compris ${doutes.map((c) => `« ${c.mot} » (j'ai entendu « ${c.entendu} »)`).join(', ')} : dis « non, je voulais dire … » sinon.` } : {}) };
}

/** « non, je voulais dire NAS », « pas nase, NAS », « j'ai dit SEO » : une correction de ce qu'Odin a compris. Pure. */
export function correctionDite(texte: string): { voulu: string; entendu?: string } | undefined {
  const t = texte.trim().replace(/[.!?]+$/, '');
  const m = /^(?:non\s*[,!.]?\s*)?(?:je voulais dire|j'ai dit|je disais|c'est|c'était|on dit)\s+[«"“]?\s*(.{2,60}?)\s*[»"”]?$/i.exec(t)
    ?? /^(?:non\s*[,!.]?\s*)?pas\s+[«"“]?(.{2,40}?)[»"”]?\s*[,:]\s*(?:mais\s+)?[«"“]?(.{2,40}?)[»"”]?$/i.exec(t);
  if (!m) return undefined;
  return m.length > 2 && m[2] ? { entendu: m[1].trim(), voulu: m[2].trim() } : { voulu: m[1].trim() };
}

/** Retient que `entendu` voulait dire `voulu` (lexique appris, partagé avec Écho et soufflé à Whisper). */
export function apprendreVoix(entendu: string, voulu: string, home?: string): boolean {
  const e = entendu.trim().slice(0, 60), v = voulu.trim().slice(0, 80);
  if (!e || !v || plier(e) === plier(v)) return false;
  const l = mots(home), m = l.find((x) => x.mot === v);
  if (m) { if (m.entendus.some((x) => plier(x) === plier(e))) return false; m.entendus.push(e); m.entendus = m.entendus.slice(-20); }
  else l.push({ mot: v, entendus: [e], appris: true });
  saveMots(l, home);
  return true;
}
