// Sans IA d'abord : ce qu'Odin sait faire seul n'est pas confié à une IA.
//
// Avant d'appeler un modèle, Odin regarde s'il sait traiter la demande lui-même :
//   1. ce qu'il a appris (acquis : une demande qu'une IA a déjà réglée par une seule action) ;
//   2. ce qu'il sait d'avance (l'heure, tes rappels, ses droits, ses économies) ;
//   3. ses actions sans IA (maison, mode, fiches, Venus, réseau, et ses applis via Huginn).
// Il ne prend la main que s'il est SÛR : une phrase simple, une seule demande, une action nette. Au
// moindre doute (demande longue, plusieurs demandes, rédaction, raisonnement, précision manquante),
// il laisse faire l'IA et dit pourquoi. Chaque action part par l'outil habituel, donc sous Heimdall.

import { parseWhen } from '../cron/reminders.ts';
import { describeAcquis, fold, forget, loadAcquis, match, soft, used, type Kv } from '../learn/acquis.ts';
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
}
export type Direct =
  | { done: true; text: string; why: string; tools: number; acquis?: string }
  | { done: false; why: string };

const VERBS = 'dis|donne|envoie|fais|mets|montre|affiche|lance|ouvre|ferme|allume|eteins|cherche|trouve|verifie|ajoute|supprime|cree|note|rappelle|scanne|redemarre|arrete|bannis|bloque|sauvegarde|analyse|teste|resume|explique|ecris|previens|telecharge|installe|regarde|prepare|range|copie|deplace|renomme';
const SPLIT = new RegExp(`[;.!?]+\\s+(?=\\S)|\\s+(?:puis|ensuite|et apres|et ensuite|apres ca|apres quoi)\\s+|,?\\s+et\\s+(?=(?:${VERBS}|tu|je|j')\\b)`);
/** Rédaction, avis, raisonnement : ce qu'une action toute faite ne remplace pas. */
const THINK = /\b(pourquoi|a ton avis|qu'en penses[- ]tu|que penses[- ]tu|tu en penses quoi|conseille[- ]moi|que me conseilles|recommande[rz]?|redige[rz]?|ecrire|ecris[- ]moi|ecris (?:un|une|le|la)\b|traduis|traduire|reformule[rz]?|corrige[rz]? (?:ce|le|mon|ma) |imagine[rz]?|invente[rz]?|propose[- ]moi|resume[rz]?|synthetise[rz]?|explique[- ]moi (?:pourquoi|comment)|expliquer (?:pourquoi|comment)|aide[- ]moi a|compare[rz]?|(?:quel(?:le)?s?|que|quoi|lequel|laquelle)\s+(?:\S+\s+){0,3}(?:faire|choisir|prendre|regarder|acheter|utiliser|installer|lire|voir|manger|ecouter|mettre|dire|repondre|envoyer|vendre|commander|offrir|visiter|preferer))\b/;

/** Pourquoi cette demande a besoin d'être comprise par une IA (rien d'évident à faire seul). Pur. */
export function needsThinking(text: string): string | undefined {
  const t = text.trim(), s = fold(soft(t));
  if (/\[(?:Image|Vidéo|Audio|Document|Archive|Fichier|Photo)[^\]\n]*:/i.test(t)) return 'une pièce jointe est à regarder';
  if (/\n/.test(t)) return 'demande en plusieurs lignes';
  if (t.length > 220 || s.split(/\s+/).length > 30) return 'demande longue, à comprendre en entier';
  if (THINK.test(s)) return 'il faut rédiger, expliquer ou raisonner';
  if (s.split(SPLIT).filter((p) => p && p.trim()).length > 1) return 'plusieurs demandes en une';
  return undefined;
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
  // « As-tu besoin d'une IA pour … ? » : Odin répond sans rien faire. Vu avant la garde, car la tâche
  // nommée peut être de la rédaction (« … pour écrire un poème ? ») : c'est justement la question.
  const ask = /\n/.test(raw) || raw.length > 260 ? null : /^(?:est[- ]ce (?:que |qu')?)?(?:as[- ]tu besoin d'une ia|tu as besoin d'une ia|faut[- ]il une ia|il faut une ia|une ia est[- ]elle necessaire|y a[- ]t[- ]il besoin d'une ia|besoin d'une ia)\s+pour\s+(.{3,})$/.exec(s);
  if (ask) {
    const target = soft(raw).slice(soft(raw).length - ask[1].length);
    const p = await preview(target, d);
    return { done: true, text: p.done ? `Non : « ${target} », je sais le faire sans IA (${p.why}).` : `Oui : pour « ${target} », il faut une IA (${p.why}).`, why: 'je sais ce que je sais faire seul', tools: 0 };
  }

  const why = needsThinking(raw);
  if (why) return { done: false, why };

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
  if (d.acquis !== false) {
    const m = match(loadAcquis(d.kv), raw);
    if (m && d.has(m.a.tool)) {
      const r = await run(m.a.tool, m.input);
      d.kv.setKv(`acquis-dernier:${d.sessionId}`, m.a.id);
      if (r.ok || r.refused) {
        if (r.ok) used(d.kv, m.a.id, true, now.getTime());
        return { done: true, text: r.ok ? `${m.a.label}\n${r.content}` : r.content, why: `appris le ${new Date(m.a.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} : « ${m.a.phrase} » → ${m.a.label}`, tools, acquis: m.a.id };
      }
      // L'action apprise ne marche plus : on le note (deux échecs = oublié) et l'IA reprend la main.
      const gone = used(d.kv, m.a.id, false, now.getTime());
      return { done: false, why: `ce que j'avais appris pour cette demande ne marche plus${gone ? ' (je l\'ai oublié)' : ''}` };
    }
  }

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
