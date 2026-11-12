// Sans IA d'abord : ce qu'Odin sait faire seul n'est pas confié à une IA.
//
// Avant d'appeler un modèle, Odin regarde s'il sait traiter la demande lui-même :
//   1. ce qu'il a appris (acquis : une demande qu'une IA a déjà réglée par une action, ou par une mission
//      de quelques actions à la suite) ;
//   2. ce qu'il sait d'avance (l'heure, tes rappels, ses droits, ses économies) ;
//   3. ses actions sans IA (maison, mode, fiches, Venus, réseau, et ses applis via Huginn).
// Il ne prend la main que s'il est SÛR : une phrase simple, une seule demande, une action nette. Au
// moindre doute (demande longue, plusieurs demandes, rédaction, raisonnement, précision manquante),
// il laisse faire l'IA et dit pourquoi. Chaque action part par l'outil habituel, donc sous Heimdall.
//
// « Cerveau direct » : quand aucune IA ne répond, Odin fait le lien entre ta phrase et ce qu'il a déjà
// appris (mêmes mots, ou mots qu'il a reliés entre eux), dit comment il a réfléchi, et PROPOSE. Rien ne
// part sans ton « oui » ; après un oui, cette façon de le dire est retenue et se fera sans rien demander.

import { parseWhen } from '../cron/reminders.ts';
import { alias, describeAcquis, fold, forget, keep, linkWords, loadAcquis, loadLinks, match, nearest, soft, stepsOf, used, type Acquis, type Kv } from '../learn/acquis.ts';
import { offlineAct } from './offline-act.ts';

export type DirectRun = (name: string, input: Record<string, unknown>) => Promise<{ ok: boolean; content: string; refused?: boolean }>;
export interface DirectDeps {
  run: DirectRun;
  has: (tool: string) => boolean;
  sessionId: string;
  kv: Kv;
  now?: Date;
  /** Textes que seul l'agent sait écrire (il a la mémoire, le journal, les droits). */
  texts?: { reminders?: () => string; savings?: () => string; rights?: () => string };
  /** Un mot de passe de ce poste vient d'être donné dans la discussion (gardé à part). */
  adminSecret?: boolean;
  /** Se servir de ce qu'Odin a appris (réglage). */
  acquis?: boolean;
  /** Masque les secrets connus : une phrase qui en porte un n'est jamais retenue. */
  redact?: (t: string) => string;
}
export type Direct =
  | { done: true; text: string; why: string; tools: number; acquis?: string }
  | { done: false; why: string };

const VERBS = 'dis|donne|envoie|fais|mets|montre|affiche|lance|ouvre|ferme|allume|eteins|cherche|trouve|verifie|ajoute|supprime|cree|note|rappelle|scanne|redemarre|arrete|bannis|bloque|sauvegarde|analyse|teste|resume|explique|ecris|previens|telecharge|installe|regarde|prepare|range|copie|deplace|renomme';
const SPLIT = new RegExp(`[;.!?]+\\s+(?=\\S)|\\s+(?:puis|ensuite|et apres|et ensuite|apres ca|apres quoi)\\s+|,?\\s+et\\s+(?=(?:${VERBS}|tu|je|j')\\b)`);
/** Rédaction, avis, raisonnement : ce qu'une action toute faite ne remplace pas. */
const THINK = /\b(pourquoi|a ton avis|qu'en penses[- ]tu|que penses[- ]tu|tu en penses quoi|conseille[- ]moi|que me conseilles|recommande[rz]?|redige[rz]?|ecrire|ecris[- ]moi|ecris (?:un|une|le|la)\b|traduis|traduire|reformule[rz]?|corrige[rz]? (?:ce|le|mon|ma) |imagine[rz]?|invente[rz]?|propose[- ]moi|resume[rz]?|synthetise[rz]?|explique[- ]moi (?:pourquoi|comment)|expliquer (?:pourquoi|comment)|aide[- ]moi a|compare[rz]?|(?:quel(?:le)?s?|que|quoi|lequel|laquelle)\s+(?:\S+\s+){0,3}(?:faire|choisir|prendre|regarder|acheter|utiliser|installer|lire|voir|manger|ecouter|mettre|dire|repondre|envoyer|vendre|commander|offrir|visiter|preferer))\b/;

/** Plusieurs demandes dans la même phrase : une IA, sauf si c'est une mission qu'Odin a déjà apprise telle quelle. */
export const MANY = 'plusieurs demandes en une';
/** Pourquoi cette demande a besoin d'être comprise par une IA (rien d'évident à faire seul). Pur. */
export function needsThinking(text: string): string | undefined {
  const t = text.trim(), s = fold(soft(t));
  if (/\[(?:Image|Vidéo|Audio|Document|Archive|Fichier|Photo)[^\]\n]*:/i.test(t)) return 'une pièce jointe est à regarder';
  if (/\n/.test(t)) return 'demande en plusieurs lignes';
  if (t.length > 220 || s.split(/\s+/).length > 30) return 'demande longue, à comprendre en entier';
  if (THINK.test(s)) return 'il faut rédiger, expliquer ou raisonner';
  if (s.split(SPLIT).filter((p) => p && p.trim()).length > 1) return MANY;
  return undefined;
}

// ---------------- Cerveau direct : proposer ce qui ressemble, rejouer une mission ----------------

const PROPOSAL = (session: string) => `acquis-propose:${session}`;
const YES = /^(?:oui|ouais|ouep|yes|ok|okay|d'accord|dac|vas[- ]y|fais[- ]le|go|c'est ca|exactement|oui[ ,]+(?:fais[- ]le|vas[- ]y|c'est ca|merci|stp))$/;
const NO = /^(?:non|nan|nope|no|pas ca|non merci|laisse|laisse tomber|annule|surtout pas|ne fais rien|non[ ,]+(?:pas ca|laisse|merci|surtout pas))$/;
/** Une proposition du Cerveau direct attend-elle ton oui ou ton non dans cette discussion ? (Dix minutes, pas plus.) */
export function pendingProposal(kv: Kv, sessionId: string, now = Date.now()): { id: string; phrase: string; at: number } | undefined {
  try { const p = JSON.parse(kv.getKv(PROPOSAL(sessionId)) || 'null') as { id: string; phrase: string; at: number } | null; return p && now - p.at < 600_000 ? p : undefined; } catch { return undefined; }
}
const day = (at: number) => new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

/**
 * Aucune IA ne répond : Odin cherche dans ce qu'il a appris la demande la plus proche, dit comment il a fait le
 * lien, et la propose. Rend le texte de la proposition (et la garde en attente de ton oui), ou rien.
 */
export function proposeNear(text: string, d: Pick<DirectDeps, 'kv' | 'sessionId' | 'has' | 'now'>): string | undefined {
  const raw = text.trim(), why = needsThinking(raw);
  if (why && why !== MANY) return undefined;
  const list = loadAcquis(d.kv).filter((a) => stepsOf(a).every((s) => d.has(s.tool)));
  const n = nearest(list, raw, loadLinks(d.kv));
  if (!n) return undefined;
  d.kv.setKv(PROPOSAL(d.sessionId), JSON.stringify({ id: n.a.id, phrase: soft(raw), at: (d.now ?? new Date()).getTime() }));
  const how = [
    ...n.via.map((v) => `pour moi, « ${v.said} » veut dire « ${v.known} » (je les ai déjà reliés)`),
    ...(n.unsaid.length ? [`tu n'as pas dit « ${n.unsaid.join(' », « ')} »`] : []),
  ];
  const steps = stepsOf(n.a);
  return [
    'Aucune IA ne me répond, alors j\'ai cherché dans ce que j\'ai déjà appris.',
    `Ta demande ressemble à « ${n.a.phrase} » (appris le ${day(n.a.at)})${how.length ? ` : ${how.join(' ; ')}` : ''}.`,
    steps.length > 1 ? `Ce que je ferais :\n${steps.map((s, k) => `${k + 1}. ${s.label}`).join('\n')}` : `Ce que je ferais : ${n.a.label}.`,
    'Je le fais ? Réponds oui ou non.',
  ].join('\n');
}

const two = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;

/**
 * Tente la demande sans IA. `done: true` : c'est fait (texte de la réponse, et pourquoi sans IA).
 * `done: false` : une IA est nécessaire, avec la raison à dire au propriétaire.
 */
export async function tryDirect(text: string, d: DirectDeps): Promise<Direct> {
  const raw = text.trim(), now = d.now ?? new Date();
  let tools = 0;
  const run: DirectRun = async (name, input) => { tools++; return d.run(name, input); };

  // Un mot de passe de ce poste vient d'être donné : devenir administrateur, sans le montrer à une IA.
  if (d.adminSecret && d.has('admin_enable') && /secret:dernier/.test(raw)) {
    const r = await run('admin_enable', {});
    return { done: true, text: r.content, why: 'mot de passe de ce poste reçu : je m\'en occupe moi-même, aucune IA ne le voit', tools };
  }

  const s = fold(soft(raw));
  /** Rejoue un acquis (une action, ou une mission dans l'ordre). L'action passe par l'outil : Heimdall décide comme d'habitude. */
  let whole = false; // la dernière mission rejouée est allée au bout
  const replay = async (a: Acquis, steps: Array<{ tool: string; input: Record<string, unknown>; label: string }>, because: string): Promise<Direct> => {
    whole = false;
    d.kv.setKv(`acquis-dernier:${d.sessionId}`, a.id);
    const many = steps.length > 1, parts: string[] = [];
    // « 1/2 · … » et non « 1. … » : une ligne qui commence par « 1. » serait affichée comme une liste, renumérotée.
    const head = (k: number) => `${k + 1}/${steps.length} · ${steps[k].label}`;
    for (let k = 0; k < steps.length; k++) {
      const r = await run(steps[k].tool, steps[k].input);
      if (r.ok) { parts.push(many ? `${head(k)}\n${r.content}` : `${a.label}\n${r.content}`); continue; }
      const stopped = many ? `\n\nJe me suis arrêté là : ${k} action${k > 1 ? 's' : ''} sur ${steps.length} faite${k > 1 ? 's' : ''}.` : '';
      // Refusé (par toi, ou par une règle) : la réponse est le refus, et ce que j'ai appris reste.
      if (r.refused) return { done: true, text: `${[...parts, many ? `${head(k)}\n${r.content}` : r.content].join('\n\n')}${stopped}`, why: because, tools, acquis: a.id };
      // L'action apprise ne marche plus : on le note (deux échecs = oublié). Rien de fait encore : l'IA reprend la main.
      const gone = used(d.kv, a.id, false, now.getTime());
      if (k === 0) return { done: false, why: `ce que j'avais appris pour cette demande ne marche plus${gone ? ' (je l\'ai oublié)' : ''}` };
      return { done: true, text: `${[...parts, `${head(k)}\n${r.content}`].join('\n\n')}${stopped}${gone ? '\nCette mission a échoué deux fois : je l\'ai oubliée, je repasserai par une IA.' : ''}`, why: because, tools, acquis: a.id };
    }
    used(d.kv, a.id, true, now.getTime()); whole = true;
    return { done: true, text: parts.join('\n\n'), why: because, tools, acquis: a.id };
  };
  const learned = async (): Promise<Direct | undefined> => {
    if (d.acquis === false) return undefined;
    const m = match(loadAcquis(d.kv), raw);
    if (!m || !m.steps.every((x) => d.has(x.tool))) return undefined;
    return replay(m.a, m.steps, `appris le ${day(m.a.at)} : « ${m.a.phrase} » → ${m.a.label}`);
  };

  // Cerveau direct : ta réponse (oui / non) à ce que je viens de proposer. Tout autre message efface la proposition.
  const prop = d.acquis === false ? undefined : pendingProposal(d.kv, d.sessionId, now.getTime());
  if (prop) {
    d.kv.setKv(PROPOSAL(d.sessionId), '');
    if (NO.test(s)) return { done: true, text: 'D\'accord, je ne fais rien.', why: 'tu as dit non à ma proposition', tools };
    if (YES.test(s)) {
      const a = loadAcquis(d.kv).find((x) => x.id === prop.id);
      if (!a || !stepsOf(a).every((x) => d.has(x.tool))) return { done: true, text: 'Je ne retrouve plus ce que je t\'avais proposé. Redis-moi ta demande.', why: 'proposition périmée', tools };
      const r = await replay(a, stepsOf(a).map((x) => ({ tool: x.tool, label: x.label, input: (x.input ?? {}) as Record<string, unknown> })), `lien fait avec « ${a.phrase} » (appris le ${day(a.at)}), confirmé par toi`);
      // Ton oui vaut leçon, si tout est allé au bout : cette façon de le dire est retenue (et le mot qui changeait, s'il n'y en a qu'un, est relié).
      const fresh = r.done && whole && (!d.redact || d.redact(prop.phrase) === prop.phrase) ? alias(a, prop.phrase, now.getTime()) : undefined;
      if (!fresh || !r.done) return r;
      const kept = keep(d.kv, fresh); linkWords(d.kv, a, kept, now.getTime()); d.kv.setKv(`acquis-dernier:${d.sessionId}`, kept.id);
      return { ...r, text: `${r.text}\n\nC'est retenu : « ${kept.phrase} » se fera maintenant sans rien demander.`, acquis: kept.id };
    }
  }

  // « As-tu besoin d'une IA pour … ? » : Odin répond sans rien faire. Vu avant la garde, car la tâche
  // nommée peut être de la rédaction (« … pour écrire un poème ? ») : c'est justement la question.
  const ask = /\n/.test(raw) || raw.length > 260 ? null : /^(?:est[- ]ce (?:que |qu')?)?(?:as[- ]tu besoin d'une ia|tu as besoin d'une ia|faut[- ]il une ia|il faut une ia|une ia est[- ]elle necessaire|y a[- ]t[- ]il besoin d'une ia|besoin d'une ia)\s+pour\s+(.{3,})$/.exec(s);
  if (ask) {
    const target = soft(raw).slice(soft(raw).length - ask[1].length);
    const p = await preview(target, d);
    return { done: true, text: p.done ? `Non : « ${target} », je sais le faire sans IA (${p.why}).` : `Oui : pour « ${target} », il faut une IA (${p.why}).`, why: 'je sais ce que je sais faire seul', tools: 0 };
  }

  const why = needsThinking(raw);
  // Plusieurs demandes en une : une IA, sauf si c'est mot pour mot une mission que j'ai déjà apprise.
  if (why) return (why === MANY ? await learned() : undefined) ?? { done: false, why };

  // Ce que j'ai appris : le voir, l'oublier.
  if (/^(?:ce que tu as appris|qu'as[- ]tu appris|tes acquis|mes acquis|les acquis|ce que tu sais faire sans ia)(?: a faire)?(?: sans ia)?$/.test(s)) return { done: true, text: describeAcquis(loadAcquis(d.kv)), why: 'liste tenue par moi', tools };
  const fg = /^(?:oublie|desapprends|efface|supprime)\s+(?:l'acquis\s+|l'|le raccourci\s+)?(a[a-z0-9]{5,8}|tous les acquis|tout ce que tu as appris|ce que tu viens d'apprendre|le dernier acquis|ce dernier acquis|cet acquis)$/.exec(s);
  if (fg) {
    const all = /^tou/.test(fg[1]), id = all ? 'tout' : /^a[a-z0-9]{5,8}$/.test(fg[1]) ? fg[1] : (d.kv.getKv(`acquis-dernier:${d.sessionId}`) ?? '');
    if (!id) return { done: true, text: 'Je n\'ai rien appris ni utilisé d\'appris dans cette discussion. Dis « ce que tu as appris » pour voir la liste.', why: 'liste tenue par moi', tools };
    const n = forget(d.kv, id);
    return { done: true, text: n ? (all ? `C'est oublié : ${n} acquis effacé${n > 1 ? 's' : ''}. Je repasserai par une IA pour ces demandes.` : `C'est oublié (${id}). La prochaine fois, je repasserai par une IA pour cette demande.`) : `Je ne trouve pas l'acquis « ${id} ». Dis « ce que tu as appris » pour voir la liste.`, why: 'liste tenue par moi', tools };
  }

  // Ce que je sais d'avance.
  if (/^(?:quelle heure(?: est[- ]il)?|il est quelle heure|on est quel jour|quel jour (?:on est|sommes[- ]nous)|quelle date(?: on est| sommes[- ]nous)?|c'est quel jour)(?: aujourd'hui)?$/.test(s)) {
    return { done: true, text: `Il est ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, ${now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`, why: 'l\'heure, je la connais', tools };
  }
  if (d.texts?.reminders && /^(?:mes rappels|quels sont mes rappels|liste (?:de )?mes rappels|mes prochains rappels)$/.test(s)) return { done: true, text: d.texts.reminders(), why: 'tes rappels sont dans ma mémoire', tools };
  if (d.texts?.rights && /^(?:mes droits|tes droits|es[- ]tu administrateur|tu es administrateur|as[- ]tu les droits(?: administrateur| admin)?|droits (?:admin|administrateur))$/.test(s)) return { done: true, text: d.texts.rights(), why: 'mes droits, je les lis sur la machine', tools };
  if (d.texts?.savings && /^(?:mes economies|economies(?: d'ia| ia)?|combien (?:j'ai|ai[- ]je|on a|tu m'as fait) economise|combien (?:m'a|m'ont) coute (?:l'ia|les ia)|bilan (?:des economies|ia|des ia)|ce que tu fais sans ia)$/.test(s)) return { done: true, text: d.texts.savings(), why: 'calcul fait sur mon journal', tools };
  // Odin lui-même : se redémarrer, se mettre à jour, dire où il en est, se régler. (Chaque action passe par l'outil, donc par Heimdall.)
  if (d.has('self_restart') && /^(?:redemarre|relance|reboote)(?:[- ]toi| odin|[- ]toi odin)(?: maintenant)?$|^(?:tu peux |peux[- ]tu )?(?:te |vous )(?:redemarrer|relancer)(?: maintenant)?$|^redemarrage d'odin$/.test(s)) {
    const r = await run('self_restart', {});
    return { done: true, text: r.content, why: 'me redémarrer, je sais le faire seul', tools };
  }
  if (d.has('update_apply') && /^(?:mets[- ]toi a jour|mets a jour odin|mets odin a jour|fais (?:la|ta) mise a jour|installe (?:la|ta) (?:mise a jour|nouvelle version)|lance (?:la|ta) mise a jour)(?: maintenant)?$/.test(s)) {
    const r = await run('update_apply', {});
    return { done: true, text: r.content, why: 'me mettre à jour, je sais le faire seul', tools };
  }
  if (d.has('update_check') && /^(?:(?:y a[- ]t[- ]il|il y a|as[- ]tu) une (?:nouvelle version|mise a jour)|es[- ]tu a jour|tu es a jour|verifie (?:les|tes) mises a jour|quelle (?:est ta )?version(?: as[- ]tu| es[- ]tu)?|ta version)$/.test(s)) {
    const r = await run('update_check', {});
    return { done: true, text: r.content, why: 'ma version, je la lis moi-même', tools };
  }
  if (d.has('settings_get') && /^(?:tes reglages|mes reglages|(?:montre|affiche|liste)(?:[- ]moi)? (?:tes|mes|les) reglages|comment es[- ]tu regle|quels sont tes reglages)$/.test(s)) {
    const r = await run('settings_get', {});
    return { done: true, text: r.content, why: 'mes réglages, je les lis moi-même', tools };
  }
  const auto = d.has('settings_set') ? /^(?:passe|mets[- ]toi|repasse|reste|sois) (?:en |sur )?(?:mode |autonomie )?(prudent|equilibre|autonome|breaker|odin breaker)$|^autonomie (prudent|prudente|equilibre|equilibree|autonome|breaker)$/.exec(s) : null;
  if (auto) {
    const r = await run('settings_set', { reglage: 'autonomie', valeur: (auto[1] ?? auto[2]).replace(/^odin /, '') });
    return { done: true, text: r.content, why: 'mon autonomie, je la règle moi-même (avec ton accord quand elle monte)', tools };
  }
  const rem = /^rappelle[- ]moi\s+(?:de\s+|d')?(.{3,})$/i.exec(soft(raw));
  if (rem && d.has('reminder_set') && !/\b(tous les|toutes les|chaque|en semaine)\b/.test(s)) {
    const when = parseWhen(rem[1], now);
    if (when && when.getTime() > now.getTime()) {
      // Le texte du rappel = la phrase sans ses mots de date et d'heure.
      const what = rem[1].replace(/(^|\s)(?:à|a|vers|pour)\s+(?=\d{1,2}\s*h)/gi, '$1')
        .replace(/(^|\s)(?:demain|apr[eè]s[- ]demain|ce soir|ce matin|ce midi|cet apr[eè]s-midi|dans \S+ \S+|(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?: prochain)?|\d{1,2}\s*h\s*(?:\d{2})?|le \d{1,2}(?: (?:janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre))?)(?=\s|$)/gi, '$1')
        .replace(/^\s*(?:de |d')/i, '').replace(/\s+/g, ' ').trim();
      if (what.length >= 2) {
        const r = await run('reminder_set', { at: stamp(when), text: what });
        return { done: true, text: r.content, why: 'un rappel : je sais le programmer seul', tools };
      }
    }
  }

  // Ce que j'ai appris d'une IA : la même demande (ou la même avec une autre valeur) part sans elle.
  const known = await learned();
  if (known) return known;

  // Ce que je sais faire sans IA : maison, mode, fiches, Venus, réseau, et mes applis.
  let label = '', miss = '';
  const out = await offlineAct(raw, async (name, input) => { const r = await run(name, input); return { ok: r.ok, content: r.content }; }, d.has, d.sessionId, { strict: true, label: (l) => { label = l; }, miss: (m) => { miss = m; } }).catch(() => undefined);
  if (out) return { done: true, text: out, why: label ? `action reconnue : ${label}` : 'action reconnue', tools };
  return { done: false, why: miss || 'aucune de mes actions ne correspond clairement' };
}

/** Même question, sans rien faire : les lectures sont permises, tout le reste est seulement noté. */
const READS = new Set(['ha_states', 'note_find']);
export async function preview(text: string, d: DirectDeps): Promise<Direct> {
  let first = '';
  const dry: DirectDeps = { ...d, adminSecret: false, texts: { reminders: () => '', savings: () => '', rights: () => '' }, kv: { getKv: (k) => d.kv.getKv(k), setKv: () => {} }, run: async (name, input) => (READS.has(name) ? d.run(name, input) : (first ||= name, { ok: true, content: '' })) };
  const r = await tryDirect(text, dry);
  return r.done ? { ...r, why: r.why || first } : r;
}
