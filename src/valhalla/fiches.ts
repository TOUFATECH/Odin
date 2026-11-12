// Les fiches d'Odin dans le Cerveau : une note par appli (à quoi elle sert, ce qu'elle fait, comment lui
// parler, ses liens avec les autres), la carte des liens, et le mode de fonctionnement d'Odin.
// Elles sont écrites à partir de la description des applis, JAMAIS de leurs réglages : aucune adresse,
// aucun mot de passe, aucun nom d'appareil n'y figure. Odin les tient à jour ; ce que tu écris sous
// « Mes notes » est conservé.

import { commandOf } from './commands.ts';
import type { Vault } from '../brain/vault.ts';
import { examples } from './huginn.ts';
import { LINKS, USAGES } from './links.ts';
import type { Action, Module } from './types.ts';

const DIR = 'Odin', APPS = `${DIR}/Applis`, MINE = '## Mes notes';
export interface Sheet { path: string; tags: string[]; body: string }

const kindOf = (a: Action) => [a.read ? 'lecture' : 'action', a.grave ? 'grave : demande ton accord' : '', a.undo ? 'annulable' : ''].filter(Boolean).join(', ');
/** Un texte de description ne doit pas créer de faux lien dans le Cerveau (« reliées par [[liens]] »). */
const plain = (x: string) => x.replace(/\[\[([^\]]*)\]\]/g, '« $1 » entre doubles crochets');
const FAMILY: Record<string, string> = { Données: 'ce que tu sais et ce que tu ranges', Machines: 'ce qui tourne', Accès: 'qui entre, et par où', Sécurité: 'ce qui protège', Maison: 'la maison et les écrans' };

/** La fiche d'une appli. Seulement ce que le code dit d'elle : rien de ce que tu y as réglé. */
export function appSheet(m: Module, all: Module[]): Sheet {
  const name = (id: string) => all.find((x) => x.id === id)?.name ?? id, link = (id: string) => `[[${name(id)}]]`;
  const out = LINKS.filter((l) => l.from === m.id && l.to !== m.id), inc = LINKS.filter((l) => l.to === m.id && l.from !== m.id), self = LINKS.filter((l) => l.from === m.id && l.to === m.id);
  const usages = USAGES.filter((u) => u.chain.includes(m.id));
  const body = [
    `# ${m.name}`,
    `> ${plain(m.what)}`,
    `Famille : **${m.family}** (${FAMILY[m.family] ?? ''}). Fiche tenue à jour par Odin. Voir aussi [[Les applis d'Odin]] et [[Liens entre les applis]].`,
    '## Ce qu\'elle fait', ...m.does.map((d) => `- ${plain(d)}`),
    ...(m.modes?.length ? ['## Ses modes', ...m.modes.map((x) => `- ${x}`)] : []),
    '## Comment lui parler',
    'Ces demandes sont comprises **sans IA** (Huginn). Avec une IA connectée, tu peux le dire comme tu veux.',
    ...examples(m).slice(0, 8).map((e) => `- « ${e} »`),
    '## Ses actions',
    ...m.actions.map((a) => `- **${a.label}** — ${plain(a.what)} *(${kindOf(a)})*`),
    '## Ses commandes', 'En invite de commande sur la machine d\'Odin (voir [[Commandes]]) :', ...m.actions.map((a) => `- \`${commandOf(m, a).example}\` — ${a.label}`),
    ...(inc.length || out.length || self.length ? ['## Ses liens avec les autres applis', 'Tous ces liens sont automatiques : il n\'y a rien à activer.',
      ...inc.map((l) => `- ${link(l.from)} → ${m.name} : quand ${l.when}, ${l.does}.`),
      ...out.map((l) => `- ${m.name} → ${link(l.to)} : quand ${l.when}, ${l.does}.`),
      ...self.map((l) => `- ${m.name} se soigne : quand ${l.when}, ${l.does}.`)] : []),
    ...(usages.length ? ['## Dans quels cas', ...usages.map((u) => `- Pour **${u.need}** : ${u.chain.map((c) => (c === m.id ? m.name : link(c))).join(' → ')}. ${u.why.charAt(0).toUpperCase()}${u.why.slice(1)}`)] : []),
    ...(m.from.length ? ['## D\'où vient l\'idée', `Elle reprend les fonctions utiles de : ${m.from.join(', ')}. Odin suit leurs nouveautés (${link('kvasir')}).`] : []),
  ].join('\n\n').replace(/\n\n- /g, '\n- ');
  return { path: `${APPS}/${m.name}`, tags: ['odin', 'appli', m.family.toLowerCase()], body };
}

/** La liste des applis, par famille. */
export function indexSheet(all: Module[]): Sheet {
  const fams = [...new Set(all.map((m) => m.family))];
  return { path: `${DIR}/Les applis d'Odin`, tags: ['odin'], body: [
    '# Les applis d\'Odin',
    `Odin réunit ${all.length} applis. Chacune a sa fiche. Elles travaillent ensemble : voir [[Liens entre les applis]] et [[Comment fonctionne Odin]].`,
    ...fams.flatMap((f) => [`## ${f} — ${FAMILY[f] ?? ''}`, all.filter((m) => m.family === f).map((m) => `- [[${m.name}]] — ${plain(m.what)}`).join('\n')]),
    '## Pour quel besoin',
    USAGES.map((u) => `- **${u.need}** : ${u.chain.map((c) => `[[${all.find((m) => m.id === c)?.name ?? c}]]`).join(' → ')}`).join('\n'),
  ].join('\n\n') };
}

/** Tous les liens entre applis, par genre. */
export function linksSheet(all: Module[]): Sheet {
  const n = (id: string) => `[[${all.find((m) => m.id === id)?.name ?? id}]]`, known = (id: string) => all.some((m) => m.id === id);
  const links = LINKS.filter((l) => known(l.from) && known(l.to));
  const part = (kind: string, title: string, intro: string) => { const l = links.filter((x) => x.kind === kind); return l.length ? [`## ${title}`, intro, l.map((x) => `- ${n(x.from)} → ${n(x.to)} : quand ${x.when}, ${x.does}.`).join('\n')] : []; };
  return { path: `${DIR}/Liens entre les applis`, tags: ['odin'], body: [
    '# Liens entre les applis',
    `${links.length} liens relient les applis d'Odin. Tous sont automatiques : rien à activer. Chacun est vérifié par un test.`,
    ...part('réflexe', 'Réflexes', 'Une appli en déclenche une autre. Ce qu\'Odin fait ainsi est noté dans ses manips : tu peux garder ou annuler.'),
    ...part('soin', 'Soins', 'Odin répare tout seul, au plus une fois par heure pour la même chose. Au niveau « Me demander », il propose seulement.'),
    ...part('donnée', 'Données', 'Une appli alimente l\'autre en continu.'),
    'Voir aussi [[Les applis d\'Odin]] et [[Comment fonctionne Odin]].',
  ].join('\n\n') };
}

/** Les modes de fonctionnement d'Odin (rien de propre à ton installation). */
export function howSheet(all: Module[]): Sheet {
  const has = (id: string) => all.some((m) => m.id === id), n = (id: string) => `[[${all.find((m) => m.id === id)?.name ?? id}]]`;
  return { path: `${DIR}/Comment fonctionne Odin`, tags: ['odin'], body: [
    '# Comment fonctionne Odin',
    'Odin est un agent personnel : il tourne chez toi, il agit sur ta machine et ton réseau, et il te rend compte.',
    '## Avec ou sans IA',
    '- **Sans IA connectée**, Odin comprend quand même les demandes qui visent ses applis : c\'est le rôle de Huginn, un moteur à règles. « arrête le conteneur web », « bannis 203.0.113.9 », « analyse mes téléchargements », « les alertes ». Il ne devine pas : s\'il n\'est pas sûr, il ne fait rien ; s\'il manque un réglage, il le demande.\n- **Avec une IA**, tu parles librement, et Odin enchaîne plusieurs applis pour un même but. L\'IA passe par les mêmes actions et les mêmes garde-fous.\n- **Ce qu\'une IA a réglé une fois, Odin le retient** (son « Cerveau direct ») : la même demande, ou la même avec une autre valeur, se refait ensuite sans IA. Quand aucune IA ne répond, il fait le lien avec ce qu\'il a appris et te demande avant d\'agir. Tout est rangé dans le Cerveau, rubrique Quotidien.',
    '## Les quatre niveaux d\'autonomie',
    '- **Me demander** : Odin propose, tu décides.\n- **Équilibré** : il fait seul ce qui est simple et annulable, et te prévient.\n- **Autonome** : il enchaîne davantage, toujours en te prévenant.\n- **Odin Breaker** : il agit seul et garde ses manips ; les actions graves restent soumises à ton accord.',
    '## Les manips : garder ou annuler',
    'Chaque chose qu\'Odin fait sans que tu l\'aies demandée est une **manip** : elle est notée, tu es prévenu, et tu réponds « garde » ou « annule ». Annuler lance l\'action inverse (débannir, redémarrer, remettre un fichier à sa place). En mode Odin Breaker, Odin garde seul, et tu peux encore annuler.',
    '## Ce qui ne change jamais',
    '- Les commandes destructrices sont interdites.\n- Une action grave (supprimer, ouvrir un accès, éteindre une machine) demande toujours ton accord, et ne part jamais d\'une automatisation.\n- Ce qui vient d\'un mail, d\'une page web ou d\'un document est une donnée, jamais un ordre.\n- Les mots de passe et les clés restent dans le coffre : ils ne sont ni affichés, ni écrits dans ces fiches.\n- Odin ne contourne ni captcha ni connexion.',
    '## Les applis et leurs liens',
    `Les applis sont rangées en familles (voir [[Les applis d'Odin]]) et reliées entre elles (voir [[Liens entre les applis]]). ${has('forseti') ? `Toutes les alertes arrivent dans un seul fil (${n('forseti')}).` : ''} ${has('ullr') ? `${n('ullr')} relie les signaux de toutes les applis pour reconnaître une attaque.` : ''} ${has('saga') ? `Ce que tu confies à Odin est rangé ici, dans le Cerveau (${n('saga')}).` : ''}`.trim(),
    '## Où est quoi',
    '- **Discussion** : tu parles à Odin (interface web, Telegram, voix).\n- **Applis** : une page par appli, avec ses indicateurs, ses tableaux et ses boutons.\n- **Cerveau** : tes notes, le graphe, et ces fiches.\n- **Automatisations** (Draupnir) : « quand ceci arrive, fais cela », entre plusieurs applis.\n- **Réglages** : le modèle d\'IA, les accès, ton compte, le niveau d\'autonomie.',
  ].join('\n\n') };
}

/** Toutes les fiches. */
export function sheets(all: Module[]): Sheet[] { return [indexSheet(all), linksSheet(all), howSheet(all), ...all.map((m) => appSheet(m, all))]; }

/**
 * Écrit les fiches dans le Cerveau. Une fiche n'est réécrite que si son contenu a changé ; la partie
 * « Mes notes » (ce que tu y as ajouté) est toujours gardée. Renvoie le nombre de fiches écrites.
 */
export function syncSheets(vault: Vault, all: Module[]): { written: number; total: number } {
  let written = 0; const list = sheets(all);
  for (const s of list) {
    const old = vault.read(s.path), cut = old ? old.body.indexOf(MINE) : -1;
    const mine = cut >= 0 ? old!.body.slice(cut + MINE.length).trim() : '', generated = (cut >= 0 ? old!.body.slice(0, cut) : old?.body ?? '').trim();
    // Une note du même nom que tu aurais écrite toi-même n'est jamais écrasée.
    if (old && old.meta['tenue par'] !== 'Odin') continue;
    if (old && generated === s.body.trim()) continue;
    vault.write(s.path, { type: 'fiche', tags: s.tags, 'tenue par': 'Odin', ...(old?.meta['créé'] ? { créé: old.meta['créé'] } : {}) }, `${s.body.trim()}\n\n${MINE}\n\n${mine || '_Écris ici ce que tu veux retenir : Odin ne touche pas à cette partie._'}\n`, { quiet: true });
    written++;
  }
  return { written, total: list.length };
}
