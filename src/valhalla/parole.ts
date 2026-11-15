// La parole d'Odin : un seul moteur « que dire maintenant », le même pour tous les écrans (mascotte qui se promène,
// « Que veux-tu ? », Odin de la Discussion, clics rapides, interpellations toutes seules).
//
// Il part de ce qui est vrai maintenant, jamais d'une liste tirée au hasard :
//   - la fenêtre ouverte : une appli précise (ses chiffres, ses alertes, ses actions, ses liens), l'accueil, le Cerveau,
//     la Discussion, les Réglages… ;
//   - ce qui s'est passé : alertes pas encore vues, tâches planifiées, dernières demandes, demandes qui reviennent ;
//   - le Cerveau : la fiche de l'appli (et ce que tu y as noté), tes notes qui en parlent, ce qui est en retard ;
//   - la mémoire (Mnémosyne) : ce dont Odin se souvient sur le sujet.
// Quand on touche Odin, il explique la page pas à pas : une étape à la fois, jamais deux fois la même ; la fois
// suivante il donne l'étape d'après, ou autre chose d'utile.
//
// Jamais deux fois la même chose : un carnet garde, par personne et pendant 60 jours, tout ce qu'Odin a dit et
// proposé. Une phrase ou une proposition déjà donnée est écartée (une information qui change, par exemple la date de
// la dernière sauvegarde, est une nouvelle phrase). Sans rien de neuf et d'utile, Odin le dit une fois, puis se tait.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Vault } from '../brain/vault.ts';
import { fold } from './besoin.ts';
import { LINKS, USAGES } from './links.ts';
import type { Action, Alert, Module, View } from './types.ts';

/** Pourquoi Odin parle : on l'a touché, il interpelle tout seul, ou un clic rapide lui demande une phrase. */
export type Quand = 'toucher' | 'spontane' | 'clic';
export interface Demande {
  quand: Quand;
  /** la fenêtre ouverte : home, chat, brain, settings, apps, app, net, device, jobs… */
  vue: string;
  /** l'id de l'appli ouverte (vue « app ») */
  appli?: string;
  /** le nom de la page, en clair (« Réglages › Voix ») */
  titre?: string;
  /** le mode d'emploi de la page (pas à pas), quand l'interface le connaît (guide.js) */
  pas?: string[];
  /** comment la régler (pas à pas) */
  reglage?: string[];
  /** ce que l'écran voit et qui compte (ex. « Le salon est hors ligne ») : dit une fois tant que ça ne change pas */
  faits?: Array<{ texte: string; demander?: string; label?: string }>;
  /** petits conseils propres à la page (ex. la Discussion) : dits au plus une fois chacun */
  astuces?: string[];
  /** la personne (le carnet est tenu par personne) */
  qui?: string;
}
/** Une proposition : un bouton. Une seule de ces façons de faire. */
export interface Proposition {
  label: string;
  /** lancer une action d'une appli (l'interface demande ton accord si elle change quelque chose) */
  act?: { module: string; action: string; read: boolean; grave: boolean; input?: Record<string, unknown> };
  /** le demander à Odin (même conversation que la Discussion) */
  demander?: string;
  /** ouvrir une page (« vue:brain ») ou une appli (« app:sindri ») */
  ouvrir?: string;
  /** le mode d'emploi complet de la page, ou comment la régler */
  guide?: 'expliquer' | 'regler';
}
export interface Parole {
  /** ce qu'Odin dit ; vide : il se tait (rien de neuf) */
  texte: string;
  propositions: Proposition[];
  /** d'où vient ce qu'il dit (« appli », « alertes », « cerveau », « mémoire », « mode d'emploi »…) */
  sources: string[];
  /** l'étape du mode d'emploi donnée cette fois */
  etape?: { n: number; sur: number };
  /** il n'avait rien de neuf à dire */
  rien?: boolean;
}

/** Ce que le moteur consulte. Tout est facultatif sauf les applis : il fait avec ce qu'il a. */
export interface ParoleDeps {
  modules(): Module[];
  /** la page d'une appli (ses chiffres) */
  view?(id: string): Promise<View | undefined> | View | undefined;
  /** les alertes (les plus récentes d'abord) */
  alerts?(o: { module?: string; limit?: number }): Alert[];
  /** le Cerveau */
  vault?(): Vault | undefined;
  /** les souvenirs qui touchent un sujet (Mnémosyne), sans les compter comme utilisés */
  souvenirs?(sujet: string, n: number): Array<{ content: string }>;
  /** les dernières demandes faites à Odin (la plus récente d'abord) */
  demandes?(): string[];
  /** les demandes qui reviennent souvent */
  habitudes?(): Array<{ text: string; count: number }>;
  /** les tâches planifiées */
  taches?(): Array<{ prompt: string; next_run: number; enabled: number }>;
  now?(): number;
}

/** Ce qui a déjà été dit, gardé 60 jours. */
export const DUREE = 60 * 86_400_000;
const PAR_PERSONNE = 4000;

/** Le carnet d'Odin : ce qu'il a déjà dit et proposé, par personne. Gardé dans un fichier (écrit d'un bloc). */
export class Carnet {
  private gens: Record<string, Record<string, number>> = {};
  private file?: string;
  constructor(file?: string) {
    this.file = file;
    if (!file) return;
    try { const d = JSON.parse(readFileSync(file, 'utf8')) as { gens?: Record<string, Record<string, number>> }; if (d && typeof d.gens === 'object') this.gens = d.gens; } catch { /* premier lancement */ }
  }
  private de(qui: string): Record<string, number> { return (this.gens[qui] ??= {}); }
  deja(qui: string, cle: string, now: number): boolean { const at = this.gens[qui]?.[cle]; return at !== undefined && now - at < DUREE; }
  noter(qui: string, cles: string[], now: number): void {
    const p = this.de(qui);
    for (const c of cles) p[c] = now;
    // Le ménage : ce qui a passé la durée, puis les plus anciens au-delà de la limite.
    for (const [k, at] of Object.entries(p)) if (now - at >= DUREE) delete p[k];
    const ks = Object.entries(p);
    if (ks.length > PAR_PERSONNE) for (const [k] of ks.sort((a, b) => a[1] - b[1]).slice(0, ks.length - PAR_PERSONNE)) delete p[k];
    if (!this.file) return;
    try { mkdirSync(dirname(this.file), { recursive: true }); const tmp = `${this.file}.tmp`; writeFileSync(tmp, JSON.stringify({ gens: this.gens })); renameSync(tmp, this.file); } catch { /* disque plein : il retiendra en mémoire */ }
  }
  /** Tout oublier pour une personne (ou tout le monde). */
  oublier(qui?: string): void { if (qui) delete this.gens[qui]; else this.gens = {}; if (this.file) try { writeFileSync(this.file, JSON.stringify({ gens: this.gens })); } catch { /* */ } }
  taille(qui: string): number { return Object.keys(this.gens[qui] ?? {}).length; }
}

/** Une chose qu'Odin pourrait dire. `poids` : plus c'est haut, plus c'est utile maintenant. */
interface Candidat { cle: string; texte: string; poids: number; sorte: 'alerte' | 'fait' | 'etape' | 'cerveau' | 'memoire' | 'lien' | 'astuce'; source: string; props?: Proposition[]; etape?: { n: number; sur: number } }

const h = (x: string) => createHash('sha1').update(x).digest('hex').slice(0, 16);
/** La même phrase, même écrite un peu autrement (casse, accents, ponctuation). */
const norme = (t: string) => fold(t).replace(/[^a-z0-9]+/g, ' ').trim();
const clePhrase = (t: string) => `p:${h(norme(t))}`;
const cleProp = (p: Proposition) => `o:${h(norme(`${p.label}|${p.act ? `${p.act.module}.${p.act.action}` : ''}|${p.demander ?? ''}|${p.ouvrir ?? ''}|${p.guide ?? ''}`))}`;
const net = (t: string) => String(t ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const court = (t: string, n = 180) => { const s = net(t); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const RANG: Record<string, number> = { critique: 4, haute: 3, moyenne: 2, info: 1 };
const CONF = /régl|config|ajout|branch|reli|activ|clé|jeton|connect|seuil|niveau|planifi|surveill|param|compte|autoris|liste blanche|règle/i;
const LANCER = /maintenant|lancer|lance|analyser|analyse|scanner|vérifier|verifier|sauvegarder|mettre à jour|actualiser|chercher|tester|relever/i;
const PAGES: Record<string, string> = { home: 'l\'accueil', chat: 'la Discussion', brain: 'le Cerveau', settings: 'les Réglages', apps: 'les Applis', net: 'la Maison', device: 'cet appareil', flows: 'les Automatisations', runes: 'Papyrus', missions: 'l\'Activité', skills: 'les Compétences', jobs: 'les Tâches planifiées', audit: 'les Décisions' };

const sansReglage = (a: Action) => !(a.params ?? []).some((p) => p.required);
/** Une action en bouton : lancée directement si elle n'a rien à remplir, sinon demandée à Odin (il choisit les réglages). */
function propAction(m: Module, a: Action): Proposition {
  return sansReglage(a) ? { label: a.label, act: { module: m.id, action: a.id, read: Boolean(a.read), grave: Boolean(a.grave) } } : { label: a.label, demander: `${a.label} dans ${m.name}` };
}
/** L'action à proposer après un chiffre « dernière fois » : celle qui relance la chose (« Sauvegarder maintenant »). */
function actionPrincipale(m: Module): Action | undefined {
  const ok = m.actions.filter((a) => !a.grave && !CONF.test(`${a.id} ${a.label}`));
  return ok.find((a) => !a.read && LANCER.test(a.label)) ?? ok.find((a) => LANCER.test(a.label)) ?? ok.find((a) => !a.read);
}

/** Le mode d'emploi d'une appli, pas à pas (ce que sa page permet, dans l'ordre). */
export function etapesAppli(m: Module): string[] {
  const acts = m.actions;
  const rapides = acts.filter((a) => a.quick !== false && sansReglage(a));
  const formes = acts.filter((a) => !rapides.includes(a) && !(!a.read && CONF.test(`${a.id} ${a.label} ${a.what}`)));
  const regl = acts.filter((a) => !a.read && CONF.test(`${a.id} ${a.label} ${a.what}`));
  const out = [`${m.name} : ${net(m.what)}`];
  if (rapides.length) out.push(`En haut de sa page, les boutons rapides : ${rapides.slice(0, 5).map((a) => `« ${a.label} »`).join(', ')}. Un bouton qui change quelque chose te demande ton accord avant.`);
  for (const a of formes.slice(0, 5)) out.push(`« ${a.label} » : ${net(a.what)}${(a.params ?? []).length ? ` Tu remplis : ${(a.params ?? []).map((p) => p.label.split(' (')[0]).slice(0, 4).join(', ')}.` : ''}${a.grave ? ' Je te demande confirmation avant.' : ''}`);
  if (regl.length) out.push(`Pour la régler : ${regl.slice(0, 4).map((a) => `« ${a.label} »`).join(', ')}.`);
  const ex = acts.find((a) => a.read) ?? acts[0];
  if (ex) out.push(`Tu peux aussi me le demander simplement, par exemple : « ${ex.label.toLowerCase()} dans ${m.name} ».`);
  return out;
}

export class ParoleOdin {
  readonly carnet: Carnet;
  private deps: ParoleDeps;
  constructor(deps: ParoleDeps, file?: string) { this.deps = deps; this.carnet = new Carnet(file); }
  private now(): number { return this.deps.now?.() ?? Date.now(); }

  /** Ce qu'Odin dit maintenant, pour cette personne et cette fenêtre. Note ce qu'il dit dans le carnet. */
  async parler(d: Demande): Promise<Parole> {
    const qui = String(d.qui || 'proprietaire').slice(0, 60), now = this.now();
    const vue = String(d.vue || 'home').slice(0, 40);
    const m = vue === 'app' && d.appli ? this.deps.modules().find((x) => x.id === d.appli) : undefined;
    const page = m ? `app:${m.id}` : vue;
    const titre = m ? m.name : net(d.titre ?? '') || PAGES[vue] || 'cette page';
    const tous = await this.candidats(d, vue, m, page, titre);
    const neuf = (c: Candidat) => !this.carnet.deja(qui, c.cle, now) && !this.carnet.deja(qui, clePhrase(c.texte), now);
    const libres = tous.filter(neuf);
    const dits: Candidat[] = [];
    if (d.quand === 'toucher') {
      // Une nouvelle importante de la page (alerte, chiffre qui a bougé), puis l'étape suivante du mode d'emploi.
      const info = libres.filter((c) => c.sorte === 'alerte' || c.sorte === 'fait' || (c.sorte !== 'etape' && c.poids >= 45)).sort((a, b) => b.poids - a.poids)[0];
      const etape = libres.find((c) => c.sorte === 'etape');
      if (info) dits.push(info);
      if (etape) dits.push(etape);
      if (!dits.length) { const autre = libres.filter((c) => c.sorte !== 'etape').sort((a, b) => b.poids - a.poids)[0]; if (autre) dits.push(autre); }
    } else {
      // Tout seul (ou un clic rapide) : seulement ce qui est neuf et utile ; jamais le mode d'emploi.
      const seuil = d.quand === 'spontane' ? 1 : 0;
      const c = libres.filter((x) => x.sorte !== 'etape' && x.poids >= seuil).sort((a, b) => b.poids - a.poids)[0];
      if (c) dits.push(c);
    }
    // Les propositions : celles des choses dites, puis celles de la page ; jamais une déjà faite.
    const props: Proposition[] = [], vues = new Set<string>();
    const ajoute = (p: Proposition) => { const k = cleProp(p); if (props.length >= 3 || vues.has(k) || this.carnet.deja(qui, k, now)) return; vues.add(k); props.push(p); };
    for (const c of dits) for (const p of c.props ?? []) ajoute(p);
    if (d.quand === 'toucher') for (const p of this.propsDePage(d, vue, m, page)) ajoute(p);
    if (!dits.length) {
      // Rien de neuf : il le dit une fois par page, puis il se tait.
      const rien = { cle: `rien:${page}`, texte: `Je t'ai dit l'essentiel sur ${titre}. Dis-moi ce que tu veux y faire, je m'en occupe.` };
      if (d.quand === 'toucher' && !this.carnet.deja(qui, rien.cle, now)) {
        this.carnet.noter(qui, [rien.cle, ...props.map(cleProp)], now);
        return { texte: rien.texte, propositions: props, sources: [], rien: true };
      }
      if (props.length) this.carnet.noter(qui, props.map(cleProp), now);
      return { texte: '', propositions: props, sources: [], rien: true };
    }
    this.carnet.noter(qui, [...dits.flatMap((c) => [c.cle, clePhrase(c.texte)]), ...props.map(cleProp)], now);
    const etape = dits.find((c) => c.etape)?.etape;
    return { texte: dits.map((c) => c.texte).join('\n'), propositions: props, sources: [...new Set(dits.map((c) => c.source))], ...(etape ? { etape } : {}) };
  }

  /** Les boutons utiles sur la page (une fois chacun) : ses actions, puis le mode d'emploi complet. */
  private propsDePage(d: Demande, vue: string, m: Module | undefined, page: string): Proposition[] {
    const out: Proposition[] = [];
    if (m) {
      const rapides = m.actions.filter((a) => a.quick !== false && !a.grave && sansReglage(a));
      for (const a of [...rapides.filter((a) => a.read), ...rapides.filter((a) => !a.read)].slice(0, 6)) out.push(propAction(m, a));
    }
    out.push({ label: 'Tout le mode d\'emploi', guide: 'expliquer' });
    if (d.reglage?.length || m) out.push({ label: 'Comment la régler', guide: 'regler' });
    void vue; void page;
    return out;
  }

  /** Tout ce qu'Odin pourrait dire ici, du plus important au moins important. */
  private async candidats(d: Demande, vue: string, m: Module | undefined, page: string, titre: string): Promise<Candidat[]> {
    const out: Candidat[] = [];
    const D = this.deps, now = this.now();
    const alertes = (o: { module?: string; limit?: number }) => { try { return (D.alerts?.(o) ?? []).filter((a) => !a.ack); } catch { return []; } };
    const coffre = (() => { try { return D.vault?.(); } catch { return undefined; } })();

    // 1. Les alertes pas encore vues : celles de l'appli ouverte, ou toutes depuis l'accueil.
    const lesAlertes = m ? alertes({ module: m.id, limit: 20 }) : ['home', 'apps'].includes(vue) ? alertes({ limit: 40 }) : [];
    for (const a of lesAlertes.sort((x, y) => (RANG[y.level] ?? 0) - (RANG[x.level] ?? 0)).slice(0, 6)) {
      const qui = m ? '' : `${D.modules().find((x) => x.id === a.module)?.name ?? a.module} : `;
      const props: Proposition[] = [];
      const mod = D.modules().find((x) => x.id === (a.fix?.module ?? a.module)), act = a.fix && mod?.actions.find((x) => x.id === a.fix!.action);
      if (mod && act && a.fix) props.push(sansReglage(act) || a.fix.input ? { label: a.fix.label, act: { module: mod.id, action: act.id, read: Boolean(act.read), grave: Boolean(act.grave), ...(a.fix.input ? { input: a.fix.input } : {}) } } : propAction(mod, act));
      props.push({ label: 'Que faire ?', demander: `Que dois-je faire pour cette alerte de ${D.modules().find((x) => x.id === a.module)?.name ?? a.module} : ${a.title} ?` });
      if (!m) props.push({ label: `Ouvrir ${D.modules().find((x) => x.id === a.module)?.name ?? a.module}`, ouvrir: `app:${a.module}` });
      out.push({ cle: `alerte:${a.id}:${a.count}`, texte: `${a.level === 'critique' || a.level === 'haute' ? 'Attention, ' : ''}${qui}${court(a.title, 140)}.${a.steps?.[0] ? ` ${court(a.steps[0], 140)}` : ''}`, poids: 70 + (RANG[a.level] ?? 0) * 5, sorte: 'alerte', source: 'alertes', props });
    }

    // 2. L'appli ouverte : ses chiffres (une valeur qui change est une nouvelle phrase).
    if (m && D.view) {
      let v: View | undefined; try { v = await D.view(m.id); } catch { v = undefined; }
      const principale = actionPrincipale(m);
      for (const k of v?.kpis ?? []) {
        const val = net(k.value); if (!val) continue;
        const mauvais = k.tone === 'attention' || k.tone === 'mauvais';
        const derniere = /derni|dernier/i.test(k.label);
        if (!mauvais && !derniere) continue;
        const vide = /^[—–-]$|^jamais$|^0$/i.test(val);
        const texte = derniere
          ? `Dans ${m.name}, « ${k.label} » : ${vide ? 'rien pour l\'instant' : val}.${principale ? ` Veux-tu « ${principale.label} » maintenant ?` : ''}`
          : `Dans ${m.name}, « ${k.label} » demande ton attention : ${val}${k.hint ? ` (${court(k.hint, 80)})` : ''}.`;
        out.push({ cle: `kpi:${m.id}:${k.label}:${val}`, texte, poids: mauvais && !(/^0$/.test(val)) ? 62 : 55, sorte: 'fait', source: 'appli', props: principale ? [propAction(m, principale)] : [] });
      }
    }

    // 3. Le mode d'emploi de la page, pas à pas (l'appli : depuis son code ; une page : depuis l'interface).
    const pas = (m ? etapesAppli(m) : (d.pas ?? []).map(net).filter(Boolean)).slice(0, 12);
    const regl = (d.reglage ?? []).map(net).filter(Boolean).slice(0, 8);
    const etapes = [...pas, ...regl.map((r) => `Pour régler ${titre} : ${r}`)];
    etapes.forEach((t, i) => out.push({ cle: `etape:${page}:${h(norme(t))}`, texte: `${etapes.length > 1 ? `Étape ${i + 1} sur ${etapes.length} : ` : ''}${t}`, poids: 30 - i * 0.1, sorte: 'etape', source: 'mode d\'emploi', etape: { n: i + 1, sur: etapes.length } }));

    // 4. Le Cerveau.
    if (coffre) {
      try {
        if (m) {
          // Ce que tu as noté toi-même sur la fiche de l'appli.
          const fiche = coffre.find(`Odin/Applis/${m.name}`);
          const mine = fiche ? (fiche.body.split('## Mes notes')[1] ?? '').replace(/_Écris ici[^_]*_/g, '').trim() : '';
          if (mine) out.push({ cle: `fiche:${m.id}:${h(mine)}`, texte: `Dans tes notes sur ${m.name} : « ${court(mine, 200)} »`, poids: 50, sorte: 'cerveau', source: 'cerveau' });
          // Tes notes qui en parlent (hors fiches d'Odin, hors notes pas fiables).
          for (const r of coffre.search(m.name, 6).filter((r) => !r.note.path.startsWith('Odin/') && r.note.meta.type !== 'capture' && r.note.meta.fiable !== false).slice(0, 3)) {
            out.push({ cle: `note:${r.note.path}:${r.note.mtime}`, texte: `Ta note « ${r.note.title} » parle de ${m.name} : ${court(r.snippet, 150)}`, poids: 45, sorte: 'cerveau', source: 'cerveau', props: [{ label: `Résume « ${court(r.note.title, 30)} »`, demander: `Résume ma note « ${r.note.title} » et dis-moi ce que je peux en faire dans ${m.name}.` }] });
          }
        }
        if (['home', 'brain', 'jobs'].includes(vue)) {
          for (const a of coffre.attention(now).slice(0, 5)) {
            const quoi = a.kind === 'retard' ? `est en retard (échéance ${a.when})` : a.kind === 'bientôt' ? `arrive bientôt (${a.when})` : `est à l'arrêt depuis le ${a.when}`;
            out.push({ cle: `attention:${a.path}:${a.kind}:${a.when ?? ''}`, texte: `Dans ton Cerveau, « ${a.title} » ${quoi}.`, poids: a.kind === 'retard' ? 65 : 55, sorte: 'fait', source: 'cerveau', props: [{ label: 'On s\'en occupe', demander: `Aide-moi à avancer sur « ${a.title} » (${a.kind}).` }] });
          }
        }
        if (vue === 'brain') {
          const st = coffre.stats();
          out.push({ cle: `cerveau:stats:${st.notes}:${st.updatedToday}`, texte: `Ton Cerveau compte ${st.notes} note${st.notes > 1 ? 's' : ''} et ${st.links} lien${st.links > 1 ? 's' : ''}${st.updatedToday ? `, dont ${st.updatedToday} touchée${st.updatedToday > 1 ? 's' : ''} aujourd'hui` : ''}.`, poids: 25, sorte: 'cerveau', source: 'cerveau' });
        }
      } catch { /* Cerveau illisible : il fait sans */ }
    }
    // Les liens de l'appli avec les autres (ils sont aussi dans sa fiche du Cerveau).
    if (m) {
      const nom = (id: string) => D.modules().find((x) => x.id === id)?.name ?? id;
      for (const l of LINKS.filter((l) => (l.from === m.id || l.to === m.id) && l.from !== l.to).slice(0, 6)) {
        out.push({ cle: `lien:${l.from}>${l.to}:${h(l.when)}`, texte: `${m.name} travaille avec ${nom(l.from === m.id ? l.to : l.from)} : quand ${net(l.when)}, ${net(l.does)}.`, poids: 20, sorte: 'lien', source: 'cerveau' });
      }
      for (const u of USAGES.filter((u) => u.chain.includes(m.id)).slice(0, 3)) {
        out.push({ cle: `usage:${m.id}:${h(u.need)}`, texte: `Pour ${net(u.need)} : ${u.chain.map(nom).join(' → ')}. ${net(u.why)}`, poids: 18, sorte: 'lien', source: 'cerveau' });
      }
    }

    // 5. La mémoire.
    try {
      if (m) for (const s of D.souvenirs?.(m.name, 3) ?? []) out.push({ cle: `souvenir:${h(s.content)}`, texte: `Je me souviens : ${court(s.content, 180)}`, poids: 35, sorte: 'memoire', source: 'mémoire' });
      if (['chat', 'home', 'jobs'].includes(vue)) {
        for (const x of (D.habitudes?.() ?? []).slice(0, 3)) {
          out.push({ cle: `habitude:${h(norme(x.text))}:${x.count}`, texte: `Tu m'as demandé ${x.count} fois « ${court(x.text, 90)} ». Veux-tu que j'en fasse une tâche planifiée ?`, poids: 50, sorte: 'memoire', source: 'mémoire', props: [{ label: 'Planifie-la', demander: `Fais une tâche planifiée qui revient au bon rythme pour : ${x.text}` }] });
        }
      }
      if (vue === 'chat') {
        const der = (D.demandes?.() ?? [])[0];
        if (der) out.push({ cle: `demande:${h(norme(der))}`, texte: `Ta dernière demande : « ${court(der, 110)} ». On continue là-dessus ?`, poids: 30, sorte: 'memoire', source: 'mémoire', props: [{ label: 'Va plus loin', demander: `Reprends ma dernière demande (« ${court(der, 160)} ») : quelle est la prochaine étape utile ? Fais-la.` }] });
      }
      if (['jobs', 'home'].includes(vue)) {
        const t = (D.taches?.() ?? []).filter((x) => x.enabled && x.next_run > now).sort((a, b) => a.next_run - b.next_run)[0];
        if (t) { const quand = new Date(t.next_run); out.push({ cle: `tache:${h(t.prompt)}:${t.next_run}`, texte: `Prochaine tâche planifiée : « ${court(t.prompt, 90)} », le ${quand.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à ${quand.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`, poids: 28, sorte: 'fait', source: 'tâches' }); }
      }
    } catch { /* mémoire indisponible */ }

    // Ce que l'écran voit (appareil tombé…) : une nouvelle, au même rang qu'un chiffre de l'appli.
    for (const f of (d.faits ?? []).slice(0, 6)) {
      const t = court(f.texte, 200);
      if (t) out.push({ cle: `vu:${page}:${h(norme(t))}`, texte: t, poids: 58, sorte: 'fait', source: 'écran', props: f.demander ? [{ label: court(f.label || 'Occupe-t\'en', 40), demander: court(f.demander, 400) }] : [] });
    }

    // 6. Les conseils propres à la page (en dernier, une fois chacun).
    for (const a of (d.astuces ?? []).map(net).filter(Boolean).slice(0, 20)) out.push({ cle: `astuce:${h(norme(a))}`, texte: a, poids: 10, sorte: 'astuce', source: 'conseil' });
    return out;
  }
}

let courant: ParoleOdin | undefined;
/** Le moteur de parole d'Odin (posé au démarrage des applis). */
export const paroleOf = () => courant;
export const setParole = (p: ParoleOdin | undefined) => { courant = p; };
