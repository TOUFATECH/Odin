// Cerveau de secours : quand aucun modèle d'IA n'est joignable (plus d'Internet, plus de clé, Claude,
// ChatGPT, OpenRouter et le modèle local tous en panne), Odin répond quand même avec ce qu'il sait :
// sa mémoire, ses fiches, ses conversations passées, l'état de la maison, tes rappels, ton budget.
// Il comprend aussi quelques demandes simples sans IA (rappels, réseau, heure). La question est gardée
// et il y répond pour de vrai dès qu'un modèle revient.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Mnemosyne } from '../muninn/store.ts';
import { isReminderJob, parseWhen, reminderText, whenFr } from '../cron/reminders.ts';
import { allThreads } from '../muninn/threads.ts';
import { reconnaitre } from '../langue/reconnaitre.ts';
import { comprise, langues, parlee, SANS_ESPACES, table, texte, type CleTexte } from '../langue/tables.ts';

export interface OfflineDeps { muninn: Mnemosyne; home?: string; inventory?: { list(f: { status: 'all' }): Array<{ ip: string; label: string; name: string; hostname: string; kind: string; status: string }> } }
export interface QueuedAsk { text: string; sessionId: string; channel: string; peer: string; at: number; tries: number }
export const QUEUE_KEY = 'offline-queue';

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");
const STOP = new Set('les des une un le la de du et ou en au aux pour par sur avec dans ce cette ces mes mon ma tes ton ta est sont quoi comment quel quelle quels quelles qui que tu me moi il elle on nous vous peux est-ce stp svp odin bonjour salut dis donne fais'.split(' '));
const words = (t: string) => norm(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));

// ------------------------------------------------------------------------------ ce qu'Odin ne sait pas ENCORE faire
/**
 * Les demandes de tous les jours qu'Odin ne sait pas encore faire lui-même. Sans IA, il le dit franchement et propose ce
 * qu'il sait faire de proche, au lieu de partir sur une appli sans rapport (« restaurant » → restaurer une sauvegarde).
 * UN SEUL ENDROIT : quand une fonction arrive, on retire sa ligne. Avec une IA, la demande lui est confiée (elle peut
 * chercher, ouvrir la page) et toute action engageante reste soumise à ta validation.
 * `re` (et `avec`, s'il est donné) doivent se trouver dans la demande (minuscules, sans accents) ; `sauf` l'écarte.
 * Les AUTRES langues ajoutent leurs mots par leur fichier (`pasEncoreMots` de `src/langue/langues/<code>.json`), et ce
 * qu'Odin en dit (« quoi », « proche ») est écrit dans chaque langue (`pasEncore` du même fichier) : rien ici.
 */
export const PAS_ENCORE: ReadonlyArray<{ id: string; re: RegExp; avec?: RegExp; sauf?: RegExp }> = [
  { id: 'reserver', re: /\b(?:reserv\w*|book(?:ing)?|reserva\w*|buch\w*)\b|\bplace au cinema\b|\bprendre une place\b/, sauf: /\b(?:rendez-vous|rdv|creneaux?|prestations?)\b|\bpage (?:publique )?de reservation\b/ },
  { id: 'changer-billet', re: /\b(?:rembours\w*|refund|vip|premiere classe|first class|upgrade|surclass\w*)\b|\b(?:modifi\w*|modification|annul\w*|change\w*|cancel\w*)\b.{0,30}\b(?:reservations?|booking|vols?|billets?|hotel)\b/, sauf: /\b(?:rendez-vous|rdv)\b/ },
  { id: 'billet', re: /\b(?:billets? d'avion|billets? de train|billets? pour|tickets?|flight|plane ticket)\b|\b(?:avion|train|vols?)\b.{0,25}\b(?:billet|reserv\w*|prix|horaires?|pas cher|moins cher|rapide)\b|\b(?:billet|reserv\w*|prix|horaires?|prends?[- ]moi|achete\w*)\b.{0,25}\b(?:avion|train|vols?)\b/, sauf: /\b(?:camera|film|chanson|musique|morceau|joue|lance)\b/ },
  { id: 'comparer', re: /\b(?:compar\w*|comparatif)\b.{0,30}\bprix\b|\bcompare prices\b|\bmoins chers?\b|\bcheapest\b/ },
  { id: 'acheter', re: /\b(?:achete\w*|acheter|commande[- ]moi|buy|purchase|compra\w*|kauf\w*)\b|\ba livrer\b/, sauf: /^(?:note|notes|retiens|ajoute|liste)\b|\bliste de courses\b/ },
  { id: 'postuler', re: /\b(?:postul\w*|candidat\w*|apply for|job application)\b/ },
  { id: 'newsletter', re: /\b(?:desabonn\w*|abonne[- ](?:toi|moi)|newsletters?|unsubscribe|subscribe)\b/ },
  { id: 'mails', re: /\b(?:lis|lire|trie|trier|filtre|filtrer|reponds?|repondre|envoie|envoyer|supprime|supprimer|efface|vois|regarde|releve|mets a jour)\b.{0,40}\b(?:mails?|e-?mails?|courriels?|spams?)\b|\b(?:mails?|e-?mails?|courriels?|spams?)\b.{0,20}\b(?:non lus|recus|en attente)\b|\benvoie (?:un )?(?:message|sms|texto)\b|\bsend a (?:text|message)\b|\btext my\b/, sauf: /\b(?:arnaque|phishing|hamecon\w*|scam|mot de passe|conteneur|port|serveur|bannis)\b|\bverifie (?:ce|cet|le)\b/ },
  { id: 'gpo', re: /\b(?:gpo|strategies? de groupe|group policy)\b/ },
  { id: 'github-essai', re: /github\.com\/\S+/, avec: /\b(?:conteneur|container|teste?|essaie|test|lance|installe)\b/ },
  { id: 'llm', re: /\b(?:llm|modeles? de langue|language model)\b/, avec: /\b(?:lance|serv\w*|heberg\w*|deploie|installe|run|host)\b/ },
];
/**
 * La demande telle que tu l'as dite : sans les précisions qu'Odin ajoute pour un modèle (la relecture de Plume, la langue
 * de la voix). Sans IA, elles empêchaient de comprendre « corrige ça : … ».
 */
export function sansPrecisions(text: string): string { return text.replace(/\n\n\[(?:Plume, le correcteur d'Odin|Précision d'Odin)[\s\S]*$/, ''); }

/** Une demande qu'Odin ne sait pas encore faire (voir PAS_ENCORE). Un rappel ou une note qui en parle n'en est pas une. */
export function pasEncore(text: string): { id: string } | undefined {
  const s = norm(text).replace(/\s+/g, ' ');
  if (/^(?:odin[\s,]+)?(?:rappelle[- ]moi|note(?:s)? (?:que|ceci)|retiens)\b/.test(s)) return undefined;
  const p = PAS_ENCORE.find((x) => x.re.test(s) && (!x.avec || x.avec.test(s)) && !x.sauf?.test(s));
  if (p) return { id: p.id };
  // Les mots des autres langues : une expression au mot près ; une écriture sans espaces, dans la phrase.
  for (const t of langues().values()) for (const [id, mots] of Object.entries(t.pasEncoreMots)) {
    if (PAS_ENCORE.find((x) => x.id === id)?.sauf?.test(s)) continue;
    if (mots.some((w) => dansLaPhrase(s, norm(w)))) return { id };
  }
  return undefined;
}
/** Une expression dans une phrase déjà mise en minuscules : au mot près, ou dedans pour une écriture sans espaces. */
function dansLaPhrase(s: string, n: string): boolean {
  if (!n) return false;
  if (SANS_ESPACES.test(n)) return s.includes(n);
  const e = n.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${e}(?=[^\\p{L}\\p{N}]|$)`, 'u').test(s);
}

// ------------------------------------------------------------------------------ la langue de la demande
/**
 * La langue d'une demande, par le reconnaisseur d'Odin (`src/langue/reconnaitre.ts`) : son code quand elle est SÛRE,
 * sinon `undefined` (jamais « français » par défaut : c'est l'appelant qui choisit sa langue de repli).
 */
export function langueDe(text: string): string | undefined { return reconnaitre(sansPrecisions(text)).langue; }
/**
 * « fr » quand Logos peut s'en occuper (le français, une langue dont il a les tournures, ou une langue incertaine : il
 * essaie, et son doute est jugé ensuite) ; « autre » quand la demande est dans une langue reconnue qu'il ne comprend pas
 * encore : elle n'est jamais devinée vers une appli.
 */
export function langueProbable(text: string): 'fr' | 'autre' {
  const l = langueDe(text);
  if (l) return comprise(l) ? 'fr' : 'autre';
  // Pas sûre, mais aucune lettre latine et une langue que Logos ne comprend pas (l'arabe, entre ses dialectes) : jamais devinée.
  const t = sansPrecisions(text), r = reconnaitre(t);
  return r.hypothese && !/[a-z]/i.test(t) && !comprise(r.hypothese) ? 'autre' : 'fr';
}
/** La langue dans laquelle répondre sans modèle : celle de la demande si Odin la parle, sinon le français. */
export function langueReponse(text: string): string { const l = langueDe(text); return l && parlee(l) ? l : 'fr'; }
/**
 * Un texte dans la langue de la demande. Une langue reconnue qu'Odin ne parle pas encore : en français ET en anglais (la
 * langue la plus partagée), jamais seulement en français.
 */
export function dire(text: string, cle: CleTexte, vars: Record<string, string> = {}): string {
  const l = langueDe(text);
  if ((l && l !== 'fr' && !parlee(l)) || (!l && langueProbable(text) === 'autre')) return `${texte('fr', cle, vars)}\n${texte('en', cle, vars)}`;
  return texte(langueReponse(text), cle, vars);
}
/** « Je ne sais pas encore … » dans la langue de la demande (en français si cette langue n'a pas encore ce texte). */
export function direPasEncore(text: string, id: string): string {
  const une = (code: string) => {
    const c = table(code)?.pasEncore[id] ? code : 'fr', x = table(c)?.pasEncore[id];
    return x ? texte(c, 'pasEncore', { quoi: x.quoi, proche: x.proche }) : texte(code, 'rienCompris');
  };
  const reconnue = langueDe(text);
  return reconnue && reconnue !== 'fr' && !parlee(reconnue) ? `${une('fr')}\n\n${une('en')}` : une(langueReponse(text));
}

/** Garde la question pour y répondre quand un modèle revient. */
export function queueAsk(kv: Pick<Mnemosyne, 'getKv' | 'setKv'>, q: Omit<QueuedAsk, 'tries'>): void {
  let l: QueuedAsk[] = []; try { l = JSON.parse(kv.getKv(QUEUE_KEY) ?? '[]') as QueuedAsk[]; } catch { /* vide */ }
  if (l.some((x) => x.text === q.text && x.sessionId === q.sessionId)) return;
  l.push({ ...q, tries: 0 }); kv.setKv(QUEUE_KEY, JSON.stringify(l.slice(-20)));
}

/** Réponse sans modèle. */
export function offlineAnswer(d: OfflineDeps, text: string, ctx: { channel: string; peer: string }, now = new Date()): { text: string; handled: boolean } {
  text = sansPrecisions(text);
  const s = norm(text), parts: string[] = [];
  let handled = false;
  // 0. Ce que je ne sais pas encore faire : je le dis franchement, dans la langue de la demande, avec ce que je sais faire.
  const pe = pasEncore(text);
  // (La question est gardée : avec une IA, elle saura peut-être chercher, ouvrir la page, préparer.)
  if (pe) return { handled: false, text: direPasEncore(text, pe.id) };
  // Une langue reconnue que Logos ne comprend pas encore : jamais devinée (dit en français et en anglais).
  if (langueProbable(text) === 'autre') { const r = reconnaitre(sansPrecisions(text)); return { handled: false, text: dire(text, 'pasCetteLangue', { nom: r.langue ? (r.nom ?? r.langue) : `probablement ${r.nom ?? r.hypothese ?? '?'}` }) }; }
  // L'heure, dans les autres langues connues (le français est traité juste après).
  const l = langueReponse(text);
  if ([...langues().values()].some((t) => t.code !== 'fr' && t.heure.some((h) => s.includes(norm(h)))) && (handled = true)) parts.push(texte(l, 'heure', { heure: now.toLocaleTimeString(l, { hour: '2-digit', minute: '2-digit' }), date: now.toLocaleDateString(l, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }));
  // 1. Demandes comprises sans IA
  if (/\b(quelle heure|on est quel jour|quelle date|quel jour)\b/.test(s) && (handled = true)) parts.push(`Il est ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, ${now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`);
  const rem = /\brappelle[- ]moi\b(?: de| d')?\s*(.+)/i.exec(text);
  if (rem) {
    const when = parseWhen(rem[1], now);
    if (when && when.getTime() > now.getTime()) {
      const what = rem[1].replace(/\b(demain|apres[- ]demain|ce soir|ce matin|dans \S+ \S+|(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)( prochain)?|a \d{1,2}\s*h(\d{2})?|\d{1,2}\s*h(\d{2})?|le \d{1,2}( \w+)?)\b/gi, '').replace(/\s+/g, ' ').trim() || rem[1];
      d.muninn.addJob({ id: `rem_${now.getTime().toString(36)}`, cron: '@reminder', prompt: what.slice(0, 500), channel: ctx.channel, peer: ctx.peer, next_run: when.getTime(), tainted: 0 });
      parts.push(`🔔 C'est noté : je te rappelle « ${what} » ${whenFr(when)}.`); handled = true;
    } else parts.push('Je n\'ai pas compris quand te le rappeler (essaie « demain 9h » ou « dans 20 min »).');
  }
  if (/\b(mes rappels|rappels|qu'est-ce que j'ai (aujourd'hui|demain)|mon programme)\b/.test(s) && !rem) {
    const l = d.muninn.listJobs().filter(isReminderJob).sort((a, b) => a.next_run - b.next_run).slice(0, 8);
    handled = true;
    parts.push(l.length ? `Tes rappels :\n${l.map((j) => `- ${whenFr(new Date(j.next_run))} : ${reminderText(j)}`).join('\n')}` : 'Tu n\'as aucun rappel en attente.');
  }
  // (Un ordre sur une machine — « crée une machine », « mets à jour toutes les machines » — n'est pas une question sur le réseau.)
  if (/\b(reseau|appareils?|machines? (?:en ligne|allumees?|connectees?)|qui est (a la maison|la)|connectes?|en ligne)\b/.test(s) && !/^(?:odin[\s,]+)?(?:cree|mets|eteins|demarre|installe|supprime|arrete|ameliore|redemarre|lance|partage)\b/.test(s) && d.inventory) {
    const devs = d.inventory.list({ status: 'all' }), on = devs.filter((x) => x.status === 'online');
    const phones = on.filter((x) => /phone|telephone|iphone|android|pixel|galaxy/i.test(`${x.kind} ${x.name} ${x.hostname} ${x.label}`));
    parts.push(`D'après mon dernier relevé du réseau, ${on.length} appareils sur ${devs.length} sont en ligne.${phones.length ? ` Côté téléphones, je vois : ${phones.map((x) => x.label || x.name || x.hostname || x.ip).join(', ')}.` : ''}`);
  }
  // 2. Ce que je sais (mémoire, fiches, conversations passées)
  const known: string[] = [];
  try { for (const m of d.muninn.recall(text, 5)) if (m.origin !== 'untrusted') known.push(`- ${m.content.replace(/\s+/g, ' ').slice(0, 300)}`); } catch { /* mémoire indisponible */ }
  const ws = words(text);
  if (ws.length) {
    for (const t of allThreads(d.muninn).filter((x) => !x.tainted)) {
      const hay = norm(`${t.title} ${t.goal} ${t.state} ${t.facts.join(' ')}`);
      if (ws.filter((w) => hay.includes(w)).length >= Math.min(2, ws.length)) known.push(`- (conversation du ${new Date(t.updated).toLocaleDateString('fr-FR')}) ${t.state.slice(0, 250)}${t.facts.length ? ` — ${t.facts.slice(-3).join(' ; ')}` : ''}`);
      if (known.length >= 8) break;
    }
    const nd = d.home ? join(d.home, 'notes') : '';
    if (nd && existsSync(nd)) for (const f of readdirSync(nd).filter((x) => x.endsWith('.md'))) {
      const body = readFileSync(join(nd, f), 'utf8');
      if (ws.filter((w) => norm(body).includes(w)).length >= Math.min(2, ws.length)) known.push(`- (fiche ${f.replace(/\.md$/, '')}) ${body.replace(/^#.*\n/, '').replace(/\s+/g, ' ').slice(0, 400)}`);
    }
  }
  if (known.length && !rem) parts.push(`Voici ce que je sais à ce sujet :\n${[...new Set(known)].slice(0, 8).join('\n')}`);
  // Rien de compris ni de connu : je le dis tel quel, sans faire semblant.
  const rien = !parts.length;
  if (rien) parts.push(dire(text, 'rienCompris'));
  return { handled, text: `${parts.join('\n\n')}\n\n🔌 ${handled ? dire(text, 'faitSansIA') : rien ? dire(text, 'garde') : 'Aucune IA ne me répond en ce moment, alors je te dis ce que j\'ai en mémoire. Je garde ta question et j\'y reviens pour de vrai dès qu\'une IA répond.'}` };
}
