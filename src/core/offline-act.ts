// Odin sans IA : quand aucun modèle n'est joignable (plus d'Internet, plus de crédit), Odin AGIT
// quand même sur les demandes courantes, avec ses outils locaux et sans rien deviner :
//   maison (Home Assistant, sur le réseau local) : allumer, éteindre, ouvrir, fermer, température ;
//   son mode (bonne nuit, je conduis, en réunion) ; fiches (note que…, cherche dans mes notes) ;
//   Venus (mets … sur la télé, qu'est-ce qui passe) ; réseau (scanne le réseau).
// Chaque action passe par Heimdall exactement comme si un modèle l'avait demandée : mêmes règles,
// mêmes validations. Ce qui n'est pas compris clairement n'est PAS tenté (le cerveau de secours
// répond alors avec la mémoire et garde la question pour plus tard).

import { forgetPending, helpText, understand } from '../valhalla/huginn.ts';
import { chatCommand } from '../valhalla/modules/naglfar.ts';
import { valhallaOf } from '../valhalla/odin.ts';

export type RunTool = (name: string, input: Record<string, unknown>) => Promise<{ ok: boolean; content: string }>;

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** Type d'appareil nommé → domaine Home Assistant. */
const KIND: Array<[RegExp, string]> = [
  [/\b(lumieres?|lampes?|eclairages?|spots?|plafonniers?|guirlandes?)\b/, 'light'],
  [/\b(prises?|interrupteurs?)\b/, 'switch'],
  [/\b(clim|climatisation|climatiseur|chauffage|radiateur|thermostat)\b/, 'climate'],
  [/\b(volets?|stores?|rideaux?|portail|garage)\b/, 'cover'],
  [/\b(ventilateurs?|ventilo)\b/, 'fan'],
  [/\b(tele|television|tv|enceinte|musique)\b/, 'media_player'],
];
const FILLER = /\b(la|le|les|l'|du|de|des|d'|dans|en|au|aux|a|un|une|mon|ma|mes|tout|toute|toutes|tous|stp|svp|s'il te plait|merci|odin|moi|maintenant|vite|piece|chambre de)\b/g;
const DOMAINS_OK = new Set(['light', 'switch', 'climate', 'cover', 'fan', 'media_player', 'scene', 'script']);

/** Analyse une commande maison (pur, testable). */
export function parseHome(text: string): { service: string; domain?: string; place: string; all: boolean; temperature?: number } | undefined {
  const s = norm(text);
  const temp = /\b(clim|climatisation|chauffage|thermostat|temperature)\b.*?\b(\d{2})(?:[.,]\d)?\s*(°|degres?|c\b)?/.exec(s) ?? /\b(mets|regle|monte|baisse)\b.*?\b(\d{2})\s*(°|degres?)\b/.exec(s);
  if (temp && Number(temp[2]) >= 10 && Number(temp[2]) <= 32) {
    const place = s.replace(temp[0], ' ').replace(/\b(mets|regle|monte|baisse|a)\b/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
    return { service: 'set_temperature', domain: 'climate', place, all: false, temperature: Number(temp[2]) };
  }
  const v = /^(?:peux[- ]tu |tu peux |est-ce que tu peux )?(allume|allumer|active|activer|eteins|eteindre|eteint|coupe|couper|desactive|ouvre|ouvrir|ferme|fermer|lance|lancer)\b\s*(.*)$/.exec(s);
  if (!v) return undefined;
  const verb = v[1], rest = v[2];
  const service = /^(allum|activ|lanc)/.test(verb) ? 'turn_on' : /^(etein|coup|desactiv)/.test(verb) ? 'turn_off' : /^ouvr/.test(verb) ? 'open_cover' : 'close_cover';
  let domain = KIND.find(([re]) => re.test(rest))?.[1];
  if (service.endsWith('cover')) domain = 'cover';
  if (!domain && /^(tout|toutes|tous|partout|toute la maison)$/.test(rest.trim())) domain = 'light';
  if (!domain && !rest.trim()) return undefined;
  const all = /\b(tout|toutes|tous|partout|toute la maison)\b/.test(rest);
  let place = rest;
  for (const [re] of KIND) place = place.replace(re, ' ');
  place = place.replace(FILLER, ' ').replace(/[^a-z0-9 _-]/g, ' ').replace(/\s+/g, ' ').trim();
  return { service, domain, place, all };
}

/** Lignes « entity_id · nom · état » renvoyées par ha_states → entités. */
export function parseStates(out: string): Array<{ id: string; name: string; state: string }> {
  return out.split('\n').map((l) => l.split(' · ')).filter((p) => p.length >= 3 && /^[a-z_]+\.[a-z0-9_]+$/.test(p[0].trim())).map((p) => ({ id: p[0].trim(), name: p[1].trim(), state: p.slice(2).join(' · ').trim() }));
}

const HELP = `Sans IA, je sais quand même :
- la maison : « allume la lumière du salon », « éteins tout », « ferme les volets », « mets la clim à 24 » ;
- tes rappels : « rappelle-moi demain 9h de … », « mes rappels » ;
- ton mode : « bonne nuit », « je conduis », « je suis en réunion », « je suis dispo » ;
- tes fiches : « note que … », « cherche dans mes notes … » ;
- Venus : « mets TF1 sur la télé », « qu'est-ce qui passe ce soir » ;
- le réseau : « scanne le réseau », « qui est à la maison », « le NAS est-il en ligne » ;
- mes applis : « j'ai besoin de sauvegarder mes photos », « les alertes », « état de la machine », « qui fait quoi » ;
- l'heure, la date, et ce que je sais déjà (mémoire, fiches, conversations).`;

/**
 * Exécute une demande courante sans modèle. Renvoie le texte de la réponse, ou undefined si la
 * demande n'est pas comprise avec certitude (rien n'est alors tenté).
 */
export interface ActOptions {
  /** Une IA est disponible : ne prendre la main que si la demande est comprise entièrement et sans doute (sinon rien, et on dit pourquoi). */
  strict?: boolean;
  /** Ce qui a été reconnu, en clair (« Maison », « Sirènes · Bannir une adresse »). */
  label?: (l: string) => void;
  /** Pourquoi Odin ne prend pas la main (mode strict). */
  miss?: (why: string) => void;
}
export async function offlineAct(text: string, run: RunTool, has: (tool: string) => boolean, sessionId = 'principal', o: ActOptions = {}): Promise<string | undefined> {
  const s = norm(text), strict = Boolean(o.strict);
  const few = s.split(' ').length <= 7; // une phrase courte : pas un récit où le mot apparaît par hasard
  // Pour plus tard, pour une durée ou sous condition (« dans 30 minutes », « à 18h », « jusqu'à 15h », « quand je rentre ») :
  // une action immédiate serait fausse. Avec une IA sous la main, c'est elle qui programme.
  const timed = /\b(?:dans (?:\d+|une?|deux|trois|quelques)|a \d{1,2}\s?h|vers \d{1,2}|jusqu'a|pendant|demain|ce soir|cette nuit|tout a l'heure|plus tard|quand|lorsque|des que|si (?:je|tu|il|elle|on|le|la|les|quelqu)|apres|avant)\b/.test(s);

  // Les commandes de conteneurs écrites comme dans un terminal (« run -d -p 8080:80 nginx », « ps », « logs web ») :
  // le moteur d'Odin, par Argo ; lancer, supprimer et exec demandent ton accord.
  const ct = has('valhalla') ? chatCommand(text) : undefined;
  if (ct) { o.label?.('Conteneurs'); return (await run('valhalla', { action: 'action', appli: 'naglfar', quoi: 'commande', entree: JSON.stringify({ ligne: ct }) })).content; }

  if (strict ? /^(?:aide|help|\?|que (?:peux|sais)[- ]tu faire|tu sais faire quoi)\s*\??$/.test(s) : /^(aide|help|\?)$|que (peux|sais)[- ]tu faire|tu sais faire quoi/.test(s)) { o.label?.('Aide'); const v = valhallaOf(); return v && has('valhalla') ? `${HELP}\n\nMes applis, sans IA aussi (dis « explique <appli> » pour le détail) :\n${helpText(v)}` : HELP; }

  // Mode du moment
  const mode = /\bbonne nuit\b|\bje (vais )?(me coucher|dormir)\b/.test(s) ? 'sommeil' : /\bje (conduis|suis au volant|prends la route)\b/.test(s) ? 'conduite'
    : /\bje suis en reunion\b|\ben reunion\b/.test(s) ? 'reunion' : /\bje suis (de retour|dispo|disponible|rentre)\b|\bfin de (la )?reunion\b/.test(s) ? 'disponible' : '';
  // Avec une IA sous la main : seulement la phrase toute simple (« bonne nuit », « je conduis »), pas « lance la scène bonne nuit ».
  const plainMode = /^(?:odin[\s,]+)?(?:bonne nuit|je (?:vais )?(?:me coucher|dormir)|je (?:conduis|suis au volant|prends la route)|(?:je suis )?en reunion|je suis (?:de retour|dispo|disponible|rentre)|fin de (?:la )?reunion)(?: tout le monde)?$/.test(s.replace(/[\s.!?]+$/, ''));
  if (mode && has('mode_set') && (!strict || (plainMode && !timed))) {
    o.label?.('Mode du moment');
    const r = await run('mode_set', { mode });
    return r.ok ? `${{ sommeil: '🌙 Bonne nuit. ', conduite: '🚗 Bonne route. ', reunion: '🤫 ', disponible: '👋 ' }[mode]}${r.content}` : r.content;
  }

  // Maison (Home Assistant fonctionne sur le réseau local, sans Internet)
  // Home Assistant ne connaît pas tout : « lance une analyse antivirus » ou « allume la lampe du salon »
  // (appareil d'Odin) ne sont pas pour lui. S'il ne répond pas ou ne trouve rien, mes applis ont la parole,
  // et son message ne sert que si elles n'ont rien de sûr non plus.
  let homeSay = '', homeMiss = '';
  const h = has('ha_call') && has('ha_states') ? parseHome(text) : undefined;
  if (h && strict && timed) homeMiss = 'c\'est pour plus tard ou sous condition : à programmer';
  else if (h) home: {
    o.label?.('Maison');
    if (h.all && h.domain && ['light', 'switch', 'fan', 'media_player'].includes(h.domain) && !h.place) {
      const r = await run('ha_call', { domain: h.domain, service: h.service, entity_id: 'all' });
      return r.ok ? `✓ ${h.service === 'turn_on' ? 'Allumé' : 'Éteint'} : tout (${h.domain === 'light' ? 'lumières' : h.domain}).` : r.content;
    }
    const look = await run('ha_states', { search: h.place.split(' ').filter((w) => w.length >= 3).slice(-1)[0] ?? '', ...(h.domain ? { domain: h.domain } : {}) });
    if (!look.ok) { homeMiss = 'Home Assistant ne répond pas'; homeSay = `Je n'arrive pas à joindre Home Assistant : ${look.content.slice(0, 200)}`; break home; }
    const words = h.place.split(' ').filter((w) => w.length >= 3);
    let found = parseStates(look.content).filter((e) => DOMAINS_OK.has(e.id.split('.')[0]));
    if (words.length) found = found.filter((e) => words.every((w) => norm(`${e.id} ${e.name}`).includes(w)));
    if (!h.domain) found = found.filter((e) => ['light', 'switch', 'fan', 'cover', 'media_player'].includes(e.id.split('.')[0]));
    // Avec une IA sous la main, un nom que je ne retrouve pas tel quel lui est confié (elle sait rapprocher).
    // Avec une IA sous la main : sans nom de pièce ni d'appareil, plusieurs appareils du même genre = à préciser, pas « tous ».
    if (strict && (found.length > 6 || (!words.length && !h.all && found.length > 1))) { o.miss?.('plusieurs appareils de la maison correspondent'); return undefined; }
    if (!found.length) { homeMiss = `je ne retrouve pas « ${h.place || 'cet appareil'} » tel quel dans la maison`; homeSay = `Je ne trouve pas « ${h.place || 'cet appareil'} » dans la maison. Dis-le avec le nom affiché dans Home Assistant (ex. « allume la lumière du salon »).`; break home; }
    if (found.length > 6) return `Plusieurs appareils correspondent (${found.slice(0, 6).map((e) => e.name || e.id).join(', ')}…) : précise lequel.`;
    const domain = found[0].id.split('.')[0];
    const same = found.filter((e) => e.id.startsWith(`${domain}.`));
    const service = domain === 'cover' && h.service === 'turn_on' ? 'open_cover' : domain === 'cover' && h.service === 'turn_off' ? 'close_cover' : h.service;
    const r = await run('ha_call', { domain, service, entity_id: same.map((e) => e.id).join(','), ...(h.temperature ? { data: JSON.stringify({ temperature: h.temperature }) } : {}) });
    if (!r.ok) return r.content;
    const names = same.map((e) => e.name || e.id).join(', ');
    return h.temperature ? `✓ ${names} : ${h.temperature} °C.` : `✓ ${names} : ${{ turn_on: 'allumé', turn_off: 'éteint', open_cover: 'ouvert', close_cover: 'fermé' }[service] ?? service}.`;
  }

  // Fiches
  const note = /^(?:note|notes|retiens|garde en memoire|garde une fiche)\s*(?:que|ceci|:)?\s+(.{3,})$/i.exec(text.trim());
  const plainNote = /^notes?\s*(?:que\s+|ceci\s*:?\s+|:\s*)\S/i.test(text.trim()) && !/\b(mot de passe|mdp|code|pin|cle|clef|secret|token|jeton|identifiant)\b/.test(s);
  if (note && has('note_save') && (!strict || plainNote)) {
    o.label?.('Fiche');
    const content = note[1].trim(), title = content.split(/\s+/).slice(0, 6).join(' ').replace(/[^\p{L}\p{N} '-]/gu, '').slice(0, 60) || 'note';
    const r = await run('note_save', { title, content });
    return r.ok ? `📝 Noté (fiche « ${title} »).` : r.content;
  }
  const find = /\b(cherche|retrouve|trouve)\b.*\b(notes?|fiches?)\b\s*(?:sur|pour|a propos de|:)?\s*(.*)$/.exec(s);
  if (find && has('note_find') && (!strict || /^(?:cherche|retrouve|trouve)\b/.test(s))) { o.label?.('Fiches'); const r = await run('note_find', { query: find[3].trim() }); return r.content; }

  // Venus (serveur multimédia local)
  if (has('venus')) {
    if (strict ? /^(?:qu'est[- ]ce qui passe|(?:c'est quoi|quel est) le programme|il y a quoi|y a quoi|quoi)\b.{0,30}\b(?:tele|tv|television|ce soir)\b.{0,20}$|^(?:le )?programme (?:tele|tv|de ce soir)\b.{0,20}$/.test(s) && s.split(' ').length <= 12 : /qu'est[- ]ce qui passe|programme (tele|tv|de ce soir)|quoi a la tele|ce soir a la tele/.test(s)) { o.label?.('Venus'); const r = await run('venus', { action: 'programme', quoi: '' }); return r.content; }
    const play = /^(?:mets|lance|met)\s+(.+?)\s+(?:sur|a)\s+(?:la |le )?(tele|television|tv|ecran|salon)\b/.exec(s);
    if (play) { o.label?.('Venus'); const r = await run('venus', { action: 'regarder', quoi: play[1], ou: play[2] === 'salon' ? 'salon' : '' }); return r.content; }
  }

  // Réseau local
  if (/\b(scanne|balaye|scan)\b.*\breseau\b/.test(s) && has('net_scan') && (!strict || few)) { o.label?.('Réseau'); const r = await run('net_scan', {}); return r.content.slice(0, 1500); }

  // Les applis d'Odin, sans IA : Logos comprend la demande (appli, action, réglages), pose une question
  // s'il manque quelque chose, et chaque action part par l'outil « valhalla », donc sous Heimdall.
  const vh = valhallaOf();
  if (vh && has('valhalla')) {
    if (/^(mes |les )?applis?$|\bliste (des|les) applis\b/.test(s)) { o.label?.('Applis'); return (await run('valhalla', { action: 'lister' })).content; }
    if ((strict ? /^(?:avec |c'est )?(?:quelle appli|quel outil)\b/.test(s) : /\b(j'ai besoin|besoin d'|quelle appli|quel outil|comment je fais pour|comment faire pour)\b/.test(s)) && (vh.find(text)[0]?.score ?? 0) >= 2) { o.label?.('Conseil d\'appli'); return (await run('valhalla', { action: 'conseiller', besoin: text })).content; }
    const u = await understand(vh, text, sessionId).catch(() => undefined);
    // Avec une IA sous la main : une précision manquante ou une hésitation, c'est pour elle (elle a le contexte).
    if (strict && u?.kind === 'ask') { forgetPending(sessionId); o.miss?.(`il me manquait une précision (${u.missing}) pour ${vh.module(u.module)?.name ?? u.module}`); return undefined; }
    if (strict && u?.kind === 'say' && u.unsure) { o.miss?.('je ne suis pas sûr que tu parles d\'une de mes applis'); return undefined; }
    // (Le détail du doute n'est dit que s'il porte sur une demande qui était bien pour cette appli ; sinon la demande n'avait rien à voir.)
    if (strict && u?.kind === 'action' && u.doubt) { o.miss?.(u.near ? u.doubt : 'aucune de mes actions ne correspond clairement'); return undefined; }
    // La maison n'a pas su (plus haut) : mes applis ne prennent le relais que pour une action nette.
    if (homeSay && !(u?.kind === 'action' && !u.doubt)) { if (strict) { o.miss?.(homeMiss); return undefined; } o.label?.('Maison'); return homeSay; }
    if (u?.kind === 'say' || u?.kind === 'ask') { o.label?.('Mes applis'); return u.text; }
    if (u?.kind === 'manip') { o.label?.('Manips'); return (await run('valhalla', { action: 'manip', appli: u.id, quoi: u.keep ? 'garder' : 'annuler' })).content; }
    if (u?.kind === 'action') { o.label?.(u.label); const r = await run('valhalla', { action: 'action', appli: u.module, quoi: u.action, entree: JSON.stringify(u.input) }); return `${u.label}\n${r.content}`; }
  }

  // Une demande pour la maison que personne n'a su traiter : on le dit (ou on laisse l'IA chercher).
  if (homeSay) { if (strict) { o.miss?.(homeMiss); return undefined; } o.label?.('Maison'); return homeSay; }
  if (strict && homeMiss) o.miss?.(homeMiss);
  return undefined;
}
