// Hydre · l'écran d'une machine virtuelle de CE PC dans le navigateur (maquette « Conteneurs et machines » validée,
// écrans 13 et 13b) : l'image en continu, le clavier et la souris, depuis le PC ou le téléphone.
//   - Tout passe par le canal de contrôle QMP qu'Hydre a déjà avec chaque VM (un socket local, dans un dossier réservé à
//     Odin) : « screendump » pour l'image, « send-key » pour le clavier, « input-send-event » pour la souris (la tablette
//     USB de la VM donne une position absolue). Aucun port n'est ouvert sur le réseau, aucun logiciel d'écran à distance :
//     l'écran est dessiné par la page d'Odin.
//   - Une « vue » s'ouvre pour une machine : un jeton tiré au hasard, rendu seulement dans les données de la réponse (la
//     page s'en sert ; l'outil de l'IA, qui ne lit que le texte, ne l'a jamais). Sans vue valable : ni image, ni touche.
//   - L'image : au plus une capture toutes les ECRAN.imageMinMs par vue ; « inchangée » si l'écran n'a pas bougé (rien
//     n'est renvoyé) ; la capture est écrite dans le dossier réservé à Odin, lue, puis effacée tout de suite. Une capture
//     ratée donne une erreur, jamais une ancienne image. Éteinte : aucune demande à la VM.
//   - Fermée (ou sans nouvelles depuis ECRAN.vueSansNouvellesMs : onglet fermé), la vue ne vaut plus rien et Odin ne garde
//     rien de l'écran (seule l'empreinte de la dernière image servait à dire « inchangée », elle part avec la vue).
//   - Au plus ECRAN.vuesMax vues : la plus ancienne laisse sa place, et sa page l'apprend (« ouverte ailleurs ») au lieu de
//     la rouvrir d'elle-même (sinon plusieurs pages se retireraient leurs vues en boucle et rempliraient le journal).
//     Une vue retirée ou oubliée laisse elle aussi sa ligne de fermeture dans « qui a fait quoi ».
//   - Le clavier : les touches physiques (KeyboardEvent.code) deviennent des codes QMP ; la disposition reste celle de la
//     VM (AZERTY, QWERTZ, japonais…), donc rien n'est supposé sur la langue. Le texte du clavier du téléphone passe par
//     le clavier américain (comme « Taper sur l'écran » de la fiche).
//   - Au propriétaire seul (ni un membre, ni une tablette, ni la clé d'accès, ni une automatisation, ni après un contenu
//     extérieur) ; l'ouverture et la fermeture (avec le compte des touches et des clics) sont notées dans « qui a fait
//     quoi », pas chaque image ni chaque touche.
//   - Sous Windows (moteur Windows d'Hydre à venir), un LXC ou un modèle : un état clair, jamais une image.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Action, ActionResult, ModCtx, Param } from '../types.ts';
import { journalDe } from '../base/journal.ts';
import { avecJournal, type Acte } from '../vidarr/qui-a-fait.ts';
import { Local, pngFromRgb, qcodes, readPpm, systemeVm, type Machine } from './local.ts';

/** Les bornes de l'écran (les essais les lisent). */
export const ECRAN = {
  /** au plus une capture toutes les 150 ms par vue (la page en demande 5 par seconde au plus) */
  imageMinMs: 150,
  /** le rythme que la page suit : écran regardé, machine en pause ou éteinte, onglet caché */
  rythme: { visible: 200, pause: 3000, cachee: 15000 },
  /** une vue sans nouvelles depuis une minute ne vaut plus rien (onglet fermé sans le dire) */
  vueSansNouvellesMs: 60_000,
  /** vues ouvertes à la fois (la plus ancienne laisse sa place) */
  vuesMax: 4,
  /** caractères par envoi du clavier du téléphone */
  texteMax: 200,
  /** envois de touches par seconde et par vue (bien au-delà d'un humain) */
  touchesParSeconde: 30,
  /** mouvements ou clics de souris par seconde et par vue */
  sourisParSeconde: 40,
  /** largeur au plus de l'image envoyée (un écran plus large est réduit) */
  largeurMax: 1280,
};
/** L'horloge des vues (les essais la remplacent). */
export const ecranHorloge = { maintenant: (): number => Date.now() };

/** Les touches physiques (KeyboardEvent.code) et leur code QMP. */
const CODES = new Map<string, string>([
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => [`Key${c.toUpperCase()}`, c] as [string, string]),
  ...'0123456789'.split('').map((c) => [`Digit${c}`, c] as [string, string]),
  ...'0123456789'.split('').map((c) => [`Numpad${c}`, `kp_${c}`] as [string, string]),
  ...Array.from({ length: 12 }, (_, k) => [`F${k + 1}`, `f${k + 1}`] as [string, string]),
  ['Enter', 'ret'], ['Escape', 'esc'], ['Backspace', 'backspace'], ['Tab', 'tab'], ['Space', 'spc'], ['Minus', 'minus'], ['Equal', 'equal'],
  ['BracketLeft', 'bracket_left'], ['BracketRight', 'bracket_right'], ['Backslash', 'backslash'], ['Semicolon', 'semicolon'], ['Quote', 'apostrophe'],
  ['Backquote', 'grave_accent'], ['Comma', 'comma'], ['Period', 'dot'], ['Slash', 'slash'], ['IntlBackslash', 'less'], ['CapsLock', 'caps_lock'],
  ['ShiftLeft', 'shift'], ['ShiftRight', 'shift_r'], ['ControlLeft', 'ctrl'], ['ControlRight', 'ctrl_r'], ['AltLeft', 'alt'], ['AltRight', 'alt_r'],
  ['MetaLeft', 'meta_l'], ['MetaRight', 'meta_r'], ['ContextMenu', 'menu'],
  ['Insert', 'insert'], ['Delete', 'delete'], ['Home', 'home'], ['End', 'end'], ['PageUp', 'pgup'], ['PageDown', 'pgdn'],
  ['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
  ['PrintScreen', 'print'], ['ScrollLock', 'scroll_lock'], ['Pause', 'pause'], ['NumLock', 'num_lock'],
  ['NumpadAdd', 'kp_add'], ['NumpadSubtract', 'kp_subtract'], ['NumpadMultiply', 'kp_multiply'], ['NumpadDivide', 'kp_divide'], ['NumpadDecimal', 'kp_decimal'], ['NumpadEnter', 'kp_enter'],
  // Claviers japonais et brésilien : leurs touches à elles.
  ['IntlRo', 'ro'], ['IntlYen', 'yen'], ['Convert', 'henkan'], ['NonConvert', 'muhenkan'], ['KanaMode', 'katakanahiragana'],
]);
/** Le code QMP d'une touche physique (KeyboardEvent.code), ou rien pour une touche inconnue. Pur. */
export function qcodeDe(code: string): string | undefined { return CODES.get(code); }

interface Vue { jeton: string; machine: string; nom: string; ouverte: number; vu: number; derniere?: number; empreinte?: string; touches: number; clics: number; envois: number[]; mouvements: number[] }
const VUES = new Map<string, Map<string, Vue>>();
/** Les jetons des vues retirées par une plus récente (le jeton seul, pour le dire à leur page ; rien de l'écran). */
const RETIREES = new Map<string, Map<string, number>>();
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** La ligne de fermeture d'une vue qui part sans « Fermer » (retirée par une autre, ou oubliée) : « Odin seul ». */
function noterDepart(ctx: ModCtx, v: Vue, pourquoi: string): void {
  try {
    journalDe<Acte>(ctx, 'ymir_actes', 'qui-a-fait.jsonl', { garder: 5000, quand: (e) => e.t }).ajouter({ t: ctx.now().getTime(), qui: 'Odin seul', action: 'Fermer l\'écran', quoi: `machine : ${v.nom}`.slice(0, 80), ok: true, resultat: `Écran de ${v.nom} fermé : ${pourquoi} (${pluriel(v.touches, 'touche')}, ${pluriel(v.clics, 'clic')}).`.slice(0, 160) });
  } catch { /* le journal ne bloque jamais l'écran */ }
}
/** Les vues de cet Odin, sans celles restées sans nouvelles trop longtemps. */
function vues(ctx: ModCtx): Map<string, Vue> {
  let l = VUES.get(ctx.dir); if (!l) { l = new Map(); VUES.set(ctx.dir, l); }
  const now = ecranHorloge.maintenant();
  for (const [k, v] of l) if (now - v.vu > ECRAN.vueSansNouvellesMs) { l.delete(k); noterDepart(ctx, v, 'sans nouvelles de la page depuis une minute'); }
  const r = RETIREES.get(ctx.dir);
  if (r) for (const [k, t] of r) if (now - t > ECRAN.vueSansNouvellesMs) r.delete(k);
  return l;
}
/** La plus ancienne vue laisse sa place : sa page l'apprendra (« ouverte ailleurs »). */
function retirerPlusVieille(ctx: ModCtx, l: Map<string, Vue>): void {
  const v = [...l.values()].sort((a, b) => a.vu - b.vu)[0]; if (!v) return;
  l.delete(v.jeton); noterDepart(ctx, v, 'ouvert ailleurs');
  let r = RETIREES.get(ctx.dir); if (!r) { r = new Map(); RETIREES.set(ctx.dir, r); }
  r.set(v.jeton, ecranHorloge.maintenant());
  while (r.size > 32) r.delete(r.keys().next().value!);
}
/** Combien de vues sont ouvertes (essais, et ce qu'Odin garde : rien d'autre). */
export function vuesOuvertes(ctx: ModCtx): number { return vues(ctx).size; }

const FERMEE = (m?: string): ActionResult => ({ ok: false, text: `La vue de l'écran${m ? ` de ${m}` : ''} est fermée : rouvre l'écran.`, data: { etat: 'fermee' } });
const AILLEURS = (m: string): ActionResult => ({ ok: false, text: `L'écran de ${m} a été ouvert ailleurs (${ECRAN.vuesMax} écrans à la fois au plus) : rouvre-le ici si tu veux.`, data: { etat: 'ailleurs' } });
/** Sous Windows : la phrase de l'écran (la page dit la même). */
export const ECRAN_WINDOWS = 'Sous Windows, les VM de ce PC ne tournent pas encore dans Hydre : leur écran ne peut donc pas s\'afficher ici. Il s\'affiche quand Odin tourne sous Linux, où Hydre fait tourner les VM.';
const WINDOWS = (): ActionResult => ({ ok: false, text: ECRAN_WINDOWS, data: { etat: 'moteur' } });

/** La vue demandée, si elle vaut encore quelque chose pour CETTE machine ; sinon le refus. */
function laVue(ctx: ModCtx, i: Record<string, unknown>): { L: Local; m: Machine; v: Vue } | { refus: ActionResult } {
  const L = new Local(ctx), j = s(i.vue);
  let m: Machine; try { m = L.find(i.machine); } catch { return { refus: FERMEE() }; }
  const ok = /^[a-f0-9]{32}$/.test(j), v = ok ? vues(ctx).get(j) : undefined;
  if (!v && ok && RETIREES.get(ctx.dir)?.has(j)) return { refus: AILLEURS(m.nom) };
  if (!v || v.machine !== m.id) return { refus: FERMEE(m.nom) };
  return { L, m, v };
}
/** L'état de la VM pour l'écran : en marche, en pause, sinon éteinte. */
async function etatEcran(L: Local, m: Machine): Promise<'en marche' | 'en pause' | 'éteinte'> {
  const e = (await L.etat(m)).state; return e === 'en marche' || e === 'en pause' ? e : 'éteinte';
}
/** Ce qui empêche d'envoyer des touches ou la souris : en pause, éteinte. */
async function doitTourner(L: Local, m: Machine): Promise<void> {
  const e = await etatEcran(L, m);
  if (e === 'en pause') throw new Error(`${m.nom} est en pause : reprends-la d'abord`);
  if (e !== 'en marche') throw new Error(`${m.nom} est éteinte : démarre-la d'abord`);
}
/** Un envoi de plus dans la dernière seconde, s'il reste de la place. */
function place(l: number[], max: number): boolean {
  const now = ecranHorloge.maintenant(); while (l.length && now - l[0] >= 1000) l.shift();
  if (l.length >= max) return false; l.push(now); return true;
}
/** Une capture de l'écran (QMP « screendump ») : écrite dans le dossier réservé à Odin, lue, effacée tout de suite. */
async function capturer(L: Local, m: Machine): Promise<{ w: number; h: number; px: Buffer }> {
  const sock = L.qmpSock(m), f = join(dirname(sock), `${m.id}.${randomBytes(6).toString('hex')}.ppm`);
  try { await systemeVm.qmp(sock, 'screendump', { filename: f }); const { w, h, px } = readPpm(readFileSync(f)); return { w, h, px: Buffer.from(px) }; }
  finally { rmSync(f, { force: true }); }
}

const machine: Param = { key: 'machine', label: 'Machine (nom ou adresse)', kind: 'text', required: true };
// Le jeton est déclaré « secret » : jamais recopié dans un journal.
const vue: Param = { key: 'vue', label: 'Vue de l\'écran (donnée à la page)', kind: 'password', required: true };
const commun = { proprietaireSeul: true, quick: false, quiet: true } as const;

/** Les actions de l'écran (ouvrir, image, touches, souris, fermer). */
export function ecranActions(): Action[] {
  const notees: Action[] = [
    { id: 'ecran_ouvrir', label: 'Ouvrir l\'écran', what: 'Ouvre l\'écran d\'une VM de ce PC dans la page (image en continu, clavier, souris)', ...commun, params: [machine], run: async (ctx, i) => {
      const L = new Local(ctx), m = L.find(i.machine);
      if (m.genre !== 'vm') return { ok: false, text: `${m.nom} est un LXC : un LXC n'a pas d'écran, sa console est dans sa fiche (Machines).`, data: { etat: 'lxc' } };
      if (m.estModele) return { ok: false, text: `${m.nom} est un modèle : il ne démarre pas, il n'a pas d'écran.`, data: { etat: 'modele' } };
      if (systemeVm.plateforme() === 'win32') return WINDOWS();
      const l = vues(ctx), now = ecranHorloge.maintenant();
      while (l.size >= ECRAN.vuesMax) retirerPlusVieille(ctx, l);
      const v: Vue = { jeton: randomBytes(16).toString('hex'), machine: m.id, nom: m.nom, ouverte: now, vu: now, touches: 0, clics: 0, envois: [], mouvements: [] };
      l.set(v.jeton, v);
      const etat = await etatEcran(L, m);
      return { text: `Écran de ${m.nom} ouvert (${etat}).`, data: { vue: v.jeton, machine: { id: m.id, nom: m.nom }, etat, rythme: ECRAN.rythme } };
    } },
    { id: 'ecran_fermer', label: 'Fermer l\'écran', what: 'Ferme la vue de l\'écran : elle ne vaut plus rien, et Odin ne garde rien de l\'écran', ...commun, params: [machine, vue], run: (ctx, i) => {
      const r = laVue(ctx, i); if ('refus' in r) return { text: `Écran déjà fermé.` };
      vues(ctx).delete(r.v.jeton);
      return { text: `Écran de ${r.m.nom} fermé (${pluriel(r.v.touches, 'touche')}, ${pluriel(r.v.clics, 'clic')}).`, data: { touches: r.v.touches, clics: r.v.clics } };
    } },
  ];
  const libres: Action[] = [
    { id: 'ecran_image', label: 'Image de l\'écran', what: 'La dernière image de l\'écran d\'une VM ouverte dans la page', ...commun, params: [machine, vue, { key: 'tout', label: 'Renvoyer l\'image même inchangée', kind: 'boolean', default: false }], run: async (ctx, i) => {
      const r = laVue(ctx, i); if ('refus' in r) return r.refus;
      const { L, m, v } = r, now = ecranHorloge.maintenant();
      v.vu = now;
      if (systemeVm.plateforme() === 'win32') return WINDOWS();
      if (v.derniere !== undefined && now - v.derniere < ECRAN.imageMinMs) return { text: 'Trop tôt pour une nouvelle image.', data: { attendre: ECRAN.imageMinMs - (now - v.derniere) } };
      // Posé avant d'attendre la VM : deux demandes au même instant ne font pas deux captures.
      v.derniere = now;
      const etat = await etatEcran(L, m);
      if (etat === 'éteinte') { delete v.empreinte; return { text: `${m.nom} est éteinte.`, data: { etat } }; }
      let c: { w: number; h: number; px: Buffer };
      try { c = await capturer(L, m); } catch (e) { delete v.empreinte; return { ok: false, text: `${m.nom} : écran illisible (${(e as Error).message.slice(0, 160)}).`, data: { etat: 'illisible' } }; }
      const empreinte = createHash('sha256').update(c.px).digest('hex');
      if (empreinte === v.empreinte && i.tout !== true && i.tout !== 'true') return { text: 'Écran inchangé.', data: { inchange: true, etat } };
      v.empreinte = empreinte;
      return { text: `Écran de ${m.nom} (${c.w} × ${c.h}).`, data: { png: pngFromRgb(c.w, c.h, c.px, ECRAN.largeurMax).toString('base64'), largeur: c.w, hauteur: c.h, etat } };
    } },
    { id: 'ecran_touches', label: 'Touches à l\'écran', what: 'Envoie une touche (ou une combinaison, ex. Ctrl+Alt+Suppr) ou du texte à l\'écran d\'une VM ouverte dans la page', ...commun,
      params: [machine, vue, { key: 'touches', label: 'Touches ensemble (codes des touches, ex. ControlLeft,AltLeft,Delete)', kind: 'text', default: '' }, { key: 'texte', label: 'Texte (clavier américain)', kind: 'text', default: '' }], run: async (ctx, i) => {
        const r = laVue(ctx, i); if ('refus' in r) return r.refus;
        const { L, m, v } = r; v.vu = ecranHorloge.maintenant();
        if (systemeVm.plateforme() === 'win32') return WINDOWS();
        const suite: string[][] = [], codes = s(i.touches).split(',').map((x) => x.trim()).filter(Boolean), texte = s(i.texte);
        if (codes.length > 5) throw new Error('trop de touches ensemble (5 au plus)');
        if (new Set(codes).size !== codes.length) throw new Error('la même touche deux fois dans une combinaison');
        if (codes.length) suite.push(codes.map((c) => { const q = qcodeDe(c); if (!q) throw new Error(`touche inconnue : « ${c.slice(0, 30)} »`); return q; }));
        if (texte.length > ECRAN.texteMax) throw new Error(`texte trop long (${ECRAN.texteMax} caractères au plus par envoi)`);
        if (texte) suite.push(...qcodes(texte));
        if (!suite.length) throw new Error('aucune touche à envoyer');
        await doitTourner(L, m);
        if (!place(v.envois, ECRAN.touchesParSeconde)) return { ok: false, text: 'Touches envoyées trop vite : attends un instant.' };
        const sock = L.qmpSock(m);
        for (const keys of suite) await systemeVm.qmp(sock, 'send-key', { keys: keys.map((k) => ({ type: 'qcode', data: k })) });
        v.touches += suite.length;
        return { text: `⌨ ${pluriel(suite.length, 'touche')} envoyée${suite.length > 1 ? 's' : ''} à ${m.nom}.`, data: { touches: suite.length } };
      } },
    { id: 'ecran_souris', label: 'Souris sur l\'écran', what: 'Place la souris (x et y de 0 à 1 sur l\'écran) et clique, sur l\'écran d\'une VM ouverte dans la page', ...commun,
      params: [machine, vue, { key: 'x', label: 'Position x (0 à 1)', kind: 'number', required: true }, { key: 'y', label: 'Position y (0 à 1)', kind: 'number', required: true }, { key: 'bouton', label: 'Clic', kind: 'select', options: ['', 'gauche', 'droit', 'milieu'], default: '' }], run: async (ctx, i) => {
        const r = laVue(ctx, i); if ('refus' in r) return r.refus;
        const { L, m, v } = r; v.vu = ecranHorloge.maintenant();
        if (systemeVm.plateforme() === 'win32') return WINDOWS();
        const num = (x: unknown) => (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '') ? Number(x) : Number.NaN);
        const x = num(i.x), y = num(i.y);
        if (![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('position hors de l\'écran (x et y vont de 0 à 1)');
        const b = s(i.bouton), bouton = b === '' ? undefined : ({ gauche: 'left', droit: 'right', milieu: 'middle' } as Record<string, string>)[b];
        if (b !== '' && (!bouton || !Object.hasOwn({ gauche: 1, droit: 1, milieu: 1 }, b))) throw new Error('bouton inconnu (gauche, droit, milieu)');
        await doitTourner(L, m);
        if (!place(v.mouvements, ECRAN.sourisParSeconde)) return { ok: false, text: 'Souris trop rapide : attends un instant.' };
        const sock = L.qmpSock(m), abs = (axis: 'x' | 'y', n: number) => ({ type: 'abs', data: { axis, value: Math.round(n * 32767) } });
        await systemeVm.qmp(sock, 'input-send-event', { events: [abs('x', x), abs('y', y), ...(bouton ? [{ type: 'btn', data: { down: true, button: bouton } }] : [])] });
        if (bouton) { await systemeVm.qmp(sock, 'input-send-event', { events: [{ type: 'btn', data: { down: false, button: bouton } }] }); v.clics++; }
        return { text: bouton ? `Clic ${b} sur l'écran de ${m.nom}.` : 'Souris placée.', data: { clic: Boolean(bouton) } };
      } },
  ];
  return [...avecJournal('ymir_actes', notees), ...libres];
}
