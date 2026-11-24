// Les ouvertures de la vie privée (sa question 15, réponse b : « il ouvre chaque widget sensible un par un, par
// personne ») : le lieu où le propriétaire note « ce widget est ouvert à cette personne ».
//
// Où c'est gardé : dans les réglages de Hestia (la même base que la fenêtre elle-même), sous `ouvertures` :
//   { identifiant de la personne dans Persona : ['identifiant du widget@appli lue', …] }
// - par personne : la clé est l'identifiant de sa fiche Persona (tiré au hasard à sa création), pas son nom de
//   connexion : une personne retirée puis une autre créée avec le même nom n'hérite de rien ;
// - par widget ET par appli lue (cleOuverture) : un widget pointé ensuite sur une autre appli est de nouveau fermé ;
// - pour ce que le widget montrait ce jour-là : s'il montre ensuite autre chose de la même appli (une autre partie de
//   sa page, ses chiffres, une autre action) ou fait autre chose quand on le touche (« Régler », lot 25b), ranger la
//   fenêtre le referme ; changer son titre ne change rien ;
// - écrit par une seule action, « propriétaire seul » (ni un membre, ni une automatisation, ni une conversation
//   marquée), notée dans « qui a fait quoi » de Hestia ; aucune autre action ne touche à ce réglage ;
// - ranger la fenêtre retire les ouvertures des widgets qui n'existent plus (ou qui ne lisent plus cette appli).
// Une ouverture ne donne AUCUN droit sur l'appli : la personne doit déjà l'avoir (droitDeVoir vérifie les deux).
import type { Action, ModCtx } from '../types.ts';
import type { Layout, Widget } from '../modules/gladsheim.ts';
import { aDroit, persona, personnes, type Personne } from '../sso/etat.ts';
import { actionJournal, avecJournal } from '../vidarr/qui-a-fait.ts';
import { APPLIS_VIE_PRIVEE, applisLues, cleOuverture, sorteDe } from './index.ts';
import type { Lecteur } from './sorte.ts';

/** Au plus tant d'ouvertures gardées par personne (une fenêtre : 8 pages de 48 widgets au plus). */
const MAX_PAR_PERSONNE = 400;
const CLE = /^[0-9a-f]{8}@[a-z0-9_-]{1,40}$/;
/** L'identifiant d'une fiche Persona (des lettres et des chiffres tirés au hasard). */
const FICHE = /^[0-9a-z]{4,64}$/i;
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();

/** Le réglage tel qu'il est gardé, relu sans confiance : rien d'inconnu, rien de mal formé. */
function lire(ctx: Pick<ModCtx, 'settings'>): Map<string, string[]> {
  const o = ctx.settings.ouvertures, out = new Map<string, string[]>();
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  for (const [qui, l] of Object.entries(o as Record<string, unknown>)) {
    if (!FICHE.test(qui) || !Array.isArray(l)) continue;
    const cles = [...new Set(l.filter((x): x is string => typeof x === 'string' && CLE.test(x)))].slice(0, MAX_PAR_PERSONNE);
    if (cles.length) out.set(qui, cles);
  }
  return out;
}

/** Ce que le propriétaire a ouvert à cette personne (l'identifiant de sa fiche Persona) : des clés « widget@appli ». */
export function ouverturesDe(ctx: Pick<ModCtx, 'settings'>, personne: string): string[] {
  return lire(ctx).get(personne) ?? [];
}

/**
 * Qui regarde l'accueil, pour une personne connectée (son nom de connexion) : ses droits d'appli, relus à chaque
 * demande, et ce que le propriétaire lui a ouvert, à elle. La même règle que la donnée des widgets d'un membre
 * (widgets-api.ts, lecteurMembre). Une fiche introuvable ou inactive, Persona arrêté : rien (tout lui est fermé).
 */
export function lecteurDe(ctx: Pick<ModCtx, 'settings'>, login: string): Lecteur | undefined {
  const pc = persona(), p = pc ? personnes(pc).find((x) => x.login === login && x.active) : undefined;
  if (!pc || !p || !FICHE.test(p.id)) return undefined;
  return { qui: 'membre', ecran: 'accueil', peutLire: (appli) => aDroit(pc, p, appli), ouverts: new Set(ouverturesDe(ctx, p.id)) };
}

/** Les applis de la vie privée que lit ce widget (aucune : il n'y a rien à ouvrir). */
export function applisPrivees(w: Pick<Widget, 'kind' | 'module'>): string[] {
  const sorte = sorteDe(w.kind);
  return sorte ? applisLues(w, sorte).filter((a) => APPLIS_VIE_PRIVEE.includes(a)) : [];
}

/**
 * Ce qu'un widget montre et fait (pas son titre, ni sa taille) : sa sorte, son appli, sa partie de page, son action, et
 * ce qu'il fait quand on le touche (lot 25b : une action ou une adresse changée, et la personne ne recevrait plus ce
 * que le propriétaire lui avait ouvert).
 */
const montre = (w: Widget) => JSON.stringify([w.kind, w.module ?? '', w.section ?? '', w.action ?? '', w.input ?? {}, w.toucher ?? null]);

/**
 * Les ouvertures qui valent encore pour cette fenêtre : celles d'un widget qui existe toujours ET qui lit toujours
 * cette appli de la vie privée. Le reste est retiré (un identifiant de widget réutilisé n'hérite de rien). Avec
 * `avant` (la fenêtre rangée jusque-là) : un widget qui ne montre plus la même chose perd aussi ses ouvertures (la
 * personne ne reçoit que ce que le propriétaire lui avait ouvert). Pur.
 */
export function ouverturesGardees(ctx: Pick<ModCtx, 'settings'>, l: Layout, avant?: Layout): Record<string, string[]> {
  const jadis = avant ? new Map(avant.pages.flatMap((p) => p.widgets).map((w) => [w.id, montre(w)])) : undefined;
  const valides = new Set(l.pages.flatMap((p) => p.widgets).filter((w) => !jadis || jadis.get(w.id) === montre(w)).flatMap((w) => applisPrivees(w).map((a) => cleOuverture(w, a))));
  const out: Record<string, string[]> = Object.create(null);
  for (const [qui, cles] of lire(ctx)) { const g = cles.filter((c) => valides.has(c)); if (g.length) out[qui] = g; }
  return out;
}

const titreDe = (w: Widget) => w.label || w.section || w.action || w.kind;
/** Les personnes à qui un widget peut être ouvert : les fiches actives de Persona, sauf le propriétaire. */
function autres(): { ctx: ModCtx; l: Personne[] } {
  const ctx = persona(); if (!ctx) throw new Error('Persona ne tourne pas : les personnes ne sont pas connues.');
  return { ctx, l: personnes(ctx).filter((p) => p.active && !p.proprio) };
}

/**
 * Les deux actions de Hestia, et « qui a fait quoi ». `fenetre` : la fenêtre RANGÉE (jamais celle que l'écran est en
 * train de modifier) ; `nomAppli` : le nom d'une appli, pour les phrases.
 */
export function actionsOuvertures(fenetre: (ctx: ModCtx) => Layout, nomAppli: (ctx: ModCtx, id: string) => string): Action[] {
  const widgetDe = (ctx: ModCtx, id: unknown): { w: Widget; applis: string[] } => {
    const w = fenetre(ctx).pages.flatMap((p) => p.widgets).find((x) => x.id === s(id));
    if (!w || !ctx.settings.fenetre) throw new Error('Ce widget n\'est pas rangé dans ta fenêtre : appuie d\'abord sur « Terminé ».');
    const applis = applisPrivees(w);
    if (!applis.length) throw new Error('Ce widget ne lit aucune appli de la vie privée : il n\'y a rien à ouvrir.');
    return { w, applis };
  };
  const ouvrir: Action = {
    id: 'ouvrir_widget', label: 'Ouvrir un widget à une personne', quick: false, proprietaireSeul: true,
    what: 'Un widget qui lit une appli de la vie privée reste fermé aux autres : tu l\'ouvres ici à une personne précise, ou tu le refermes. Cela n\'ouvre que ce widget, et seulement si la personne a déjà le droit sur l\'appli',
    params: [{ key: 'widget', label: 'Widget (son identifiant)', kind: 'text', required: true }, { key: 'personne', label: 'Personne (son nom de connexion)', kind: 'text', required: true }, { key: 'ouvert', label: 'Ouvert', kind: 'select', options: ['oui', 'non'], required: true }],
    run: (ctx, i) => {
      const { w, applis } = widgetDe(ctx, i.widget), { ctx: pc, l } = autres(), nom = s(i.personne).toLowerCase(), o = s(i.ouvert);
      if (o !== 'oui' && o !== 'non') throw new Error('« Ouvert » : oui ou non.');
      const p = l.find((x) => x.login.toLowerCase() === nom);
      if (!p || !FICHE.test(p.id)) throw new Error('Cette personne n\'a pas de compte actif (ou c\'est toi : tu vois déjà tout).');
      const tout = ouverturesGardees(ctx, fenetre(ctx)), cles = applis.map((a) => cleOuverture(w, a));
      // Une fiche retirée de Persona : ce qui lui était ouvert part avec elle.
      const fiches = new Set(personnes(pc).map((x) => x.id)); for (const k of Object.keys(tout)) if (!fiches.has(k)) delete tout[k];
      const siennes = (tout[p.id] ?? []).filter((c) => !cles.includes(c));
      if (o === 'oui') siennes.push(...cles);
      if (siennes.length > MAX_PAR_PERSONNE) throw new Error('Trop de widgets ouverts à cette personne : referme-en d\'abord.');
      if (siennes.length) tout[p.id] = siennes; else delete tout[p.id];
      ctx.saveSettings({ ouvertures: tout });
      const quoi = `« ${titreDe(w)} » (${applis.map((a) => nomAppli(ctx, a)).join(', ')})`;
      return { text: o === 'oui' ? `✓ ${quoi} est ouvert à ${p.name}.` : `✓ ${quoi} est refermé pour ${p.name}.`, data: { widget: w.id, personne: p.login, ouvert: o === 'oui' } };
    },
  };
  const liste: Action = {
    // Une lecture, mais pas marquée « read » : elle nomme les personnes, elle est au propriétaire seul.
    id: 'ouvertures_widget', label: 'À qui un widget est ouvert', quick: false, quiet: true, proprietaireSeul: true,
    what: 'Pour un widget qui lit une appli de la vie privée : chaque personne, et s\'il lui est ouvert',
    params: [{ key: 'widget', label: 'Widget (son identifiant)', kind: 'text', required: true }],
    run: (ctx, i) => {
      const { w, applis } = widgetDe(ctx, i.widget), { ctx: pc, l } = autres(), tout = ouverturesGardees(ctx, fenetre(ctx));
      const gens = l.map((p) => ({ login: p.login, name: p.name, ouvert: applis.every((a) => (tout[p.id] ?? []).includes(cleOuverture(w, a))), droit: applis.every((a) => aDroit(pc, p, a)) }));
      const noms = applis.map((a) => nomAppli(ctx, a));
      return { text: gens.length ? [`« ${titreDe(w)} » (${noms.join(', ')}) :`, ...gens.map((g) => `- ${g.name} : ${g.ouvert ? 'ouvert' : 'fermé'}${g.droit ? '' : ` (n'a pas le droit sur ${noms.join(', ')})`}`)].join('\n') : 'Personne d\'autre que toi n\'a de compte.', data: { widget: w.id, titre: titreDe(w), applis: applis.map((a, k) => ({ id: a, name: noms[k] })), personnes: gens } };
    },
  };
  // « Qui a fait quoi » de Hestia : lisible par sa page (« Autres actions »). Ses mots nomment l'appli (« hestia qui a
  // fait quoi ») : dits seuls, « qui a fait quoi » et « journal des changements » restent à Sphinx et à Vortex.
  return [...avecJournal('gladsheim_actes', [ouvrir]), liste, { ...actionJournal('gladsheim_actes', 'Hestia'), words: ['hestia qui a fait quoi'] }];
}
