// Prónoia — prévoir et pressentir. Odin estime ce qui est PROBABLE d'après ce qu'il a appris chez toi (habitudes, heures,
// enchaînements de tes demandes, rythmes des événements de la maison, tendance d'une mesure, météo relayée) ; il ne dit
// pas l'avenir. Chaque prévision montre sa confiance, sa date et ce sur quoi elle se fonde ; une prévision peu sûre est un
// « pressentiment ». Une prévision PROPOSE seulement : rien n'est jamais lancé, envoyé, acheté ni signalé de façon
// intrusive sur une simple prévision. Le taux de réussite affiché est le vrai (prévu contre arrivé).
//
// Le moteur (moteur.ts) garde tout en local, chiffré au repos, borné ; cette page le montre et le règle.
import { join } from 'node:path';
import type { Action, Kpi, ModCtx, Module, Section, TacheAppli } from '../types.ts';
import { tacheEnPause } from '../automatismes.ts';
import { brancherPronoia } from './base.ts';
import { Pronoia, coupleSource, SOURCES_DEFAUT } from './moteur.ts';
import { formuler, pourcent } from './honnete.ts';
import type { Nourrir, Preparer, Prevision, SuiteTexte } from './types.ts';

export interface OptionsPronoia {
  /** le mode privé d'Odin (rien n'est appris ni gardé) */
  prive?: () => boolean;
  /** lecture seule : recherche, rappel (voir types.ts) */
  preparer?: Preparer;
  /** l'entrée de Noûs (écart prévu/arrivé) */
  nourrir?: Nourrir;
  /** la suite d'un texte par Noûs, quand il est disponible */
  suiteNous?: SuiteTexte;
  /** (essais) une fausse horloge */
  maintenant?: () => number;
}

const s = (v: unknown) => String(v ?? '').trim();
/** Un texte long raccourci par le milieu (la page reste lisible à 390 px, même sans espace). */
export const court = (n: string, max = 60): string => (n.length > max ? `${n.slice(0, max - 20)}…${n.slice(-17)}` : n);
/** Une date en heure LOCALE, lisible. */
const local = (ms: number | undefined): string => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const ETAT: Record<Prevision['etat'], string> = { en_attente: 'en attente', realisee: 'réalisée', ratee: 'ratée', perimee: 'périmée (pas vérifiable)' };
const SORTE: Record<Prevision['sorte'], string> = { demande: 'ta demande', suite: 'suite de l\'échange', evenement: 'événement' };
const PAS_ESSAYE = 'codé et essayé contre de faux historiques ; pas encore essayé pour de vrai chez toi';
const nombre = (v: unknown): number | undefined => (v === undefined || v === '' || v === null || !Number.isFinite(Number(v)) ? undefined : Number(v));
/** Une confiance saisie en % (0..100) ou en fraction (0..1). */
const fraction = (v: unknown): number | undefined => { const n = nombre(v); return n === undefined ? undefined : Math.max(0, Math.min(1, n > 1 ? n / 100 : n)); };

/** Les moteurs ouverts, un par dossier (les greffes de la discussion et des événements le retrouvent ici). */
const moteurs = new Map<string, Pronoia>();
/** Le moteur de Prónoia d'un dossier d'Odin, s'il a démarré (undefined sinon : les greffes ne font alors rien). */
export const moteurPronoia = (home: string): Pronoia | undefined => moteurs.get(join(home, 'valhalla', 'pronoia')) ?? [...moteurs.values()].find((m) => m.magasin.home === home);
/** (essais) oublie les moteurs ouverts. */
export function oublierMoteursPronoia(): void { moteurs.clear(); }

export function pronoia(o: () => OptionsPronoia = () => ({})): Module {
  const prive = () => { try { return o().prive?.() === true; } catch { return true; } };
  function moteur(ctx: ModCtx): Pronoia {
    let m = moteurs.get(ctx.dir);
    if (!m) {
      const x = o();
      m = new Pronoia({ home: ctx.home, dir: ctx.dir, maintenant: x.maintenant ?? (() => ctx.now().getTime()), prive, preparer: x.preparer, nourrir: x.nourrir, suiteNous: x.suiteNous });
      moteurs.set(ctx.dir, m);
    }
    return m;
  }

  const bilanA: Action = {
    id: 'bilan', label: 'Taux de réussite', read: true,
    what: 'Le bilan prévu contre arrivé : le vrai taux de réussite, par sorte et par tranche de confiance, et le temps gagné mesuré',
    words: ['pronoia bilan', 'taux de reussite des previsions', 'tes previsions sont justes'],
    run(ctx) { const b = moteur(ctx).bilan(); return { text: b.texte, data: { taux: b.taux, realisees: b.realisees, ratees: b.ratees, perimees: b.perimees, enAttente: b.enAttente } }; },
  };
  const previsionsA: Action = {
    id: 'previsions', label: 'Prévisions en cours', read: true,
    what: 'Ce qu\'Odin a anticipé et qui n\'est pas encore jugé, avec la confiance, la date et les sources de chaque prévision',
    words: ['pronoia previsions', 'qu as tu prevu', 'tes pressentiments'],
    run(ctx) {
      const m = moteur(ctx); m.cloturer();
      const l = m.previsions().filter((p) => p.etat === 'en_attente').sort((a, b) => (a.attendu ?? a.echeance) - (b.attendu ?? b.echeance));
      const n = ctx.now().getTime();
      return { text: l.length ? l.slice(0, 30).map((p) => formuler(p, m.reglages, n)).join('\n') : 'Aucune prévision en attente.', data: { nombre: l.length } };
    },
  };
  const jugeesA: Action = {
    id: 'jugees', label: 'Ce qui s\'est réalisé ou non', read: true,
    what: 'Les dernières prévisions jugées : réalisées, ratées, ou périmées faute de pouvoir les vérifier',
    words: ['pronoia realise', 'qu est ce qui s est realise'],
    run(ctx) {
      const l = moteur(ctx).previsions().filter((p) => p.etat !== 'en_attente').sort((a, b) => (b.resolue ?? 0) - (a.resolue ?? 0)).slice(0, 30);
      return { text: l.length ? l.map((p) => `${local(p.resolue)} · ${ETAT[p.etat]} · ${court(p.quoi)} (confiance ${pourcent(p.confiance)} %)${typeof p.ecartMin === 'number' ? ` · écart ${p.ecartMin >= 0 ? '+' : ''}${p.ecartMin} min` : ''}`).join('\n') : 'Aucune prévision jugée pour l\'instant.', data: { nombre: l.length } };
    },
  };
  const prevoirA: Action = {
    id: 'prevoir', label: 'Prévoir maintenant',
    what: 'Estime ce qui va probablement arriver (rythmes de la maison, tendances, météo relayée) ; propose seulement',
    words: ['pronoia prevois', 'qu est ce qui va arriver'],
    run(ctx) {
      const m = moteur(ctx);
      if (!m.actif) return { text: 'L\'anticipation est coupée : rien n\'est prévu.', data: { nombre: 0 } };
      if (prive()) return { text: 'Mode privé : rien n\'est prévu ni gardé.', data: { nombre: 0 } };
      const l = m.prevoirEvenements();
      return { text: l.length ? l.slice(0, 20).map((p) => p.texte).join('\n') : 'Rien de probable à annoncer pour l\'instant (pas assez d\'événements appris).', data: { nombre: l.length } };
    },
  };
  // Couper est une protection : un clic, jamais grave.
  const couperA: Action = {
    id: 'couper', label: 'Couper l\'anticipation',
    what: 'Plus aucune anticipation : rien n\'est appris, prévu, préparé ni proposé ; les préparations en cours s\'arrêtent',
    words: ['pronoia coupe', 'arrete d anticiper', 'coupe l anticipation'],
    run(ctx) { moteur(ctx).couper(); return { text: 'Anticipation coupée : Odin n\'apprend plus tes habitudes et ne prévoit plus rien. Ce qui est déjà appris reste, effaçable.', data: { actif: false } }; },
  };
  // Rallumer, c'est recommencer à apprendre tes habitudes : une protection s'éteint → accord du propriétaire.
  const allumerA: Action = {
    id: 'allumer', label: 'Rallumer l\'anticipation',
    what: 'Odin recommence à apprendre tes habitudes pour anticiper (en local, chiffré, jamais en mode privé)',
    grave: (_i, ctx) => (ctx && moteurs.get(ctx.dir)?.actif === false ? 'rallumer l\'anticipation : Odin recommencera à apprendre tes habitudes et celles de la maison' : undefined),
    run(ctx) { moteur(ctx).allumer(); return { text: 'Anticipation rallumée.', data: { actif: true } }; },
  };
  const reglerA: Action = {
    id: 'regler', label: 'Régler Prónoia',
    what: 'Le seuil sous lequel une prévision est un pressentiment, le seuil pour proposer de prévenir, et la durée de garde',
    params: [
      { key: 'seuilPressentiment', label: 'Pressentiment sous (%)', kind: 'number' },
      { key: 'seuilPrevenir', label: 'Proposer de prévenir à partir de (%)', kind: 'number' },
      { key: 'gardeJours', label: 'Garder (jours)', kind: 'number' },
    ],
    // Tout ce qui affaiblit une protection ou efface des données demande l'accord du propriétaire.
    grave: (i, ctx) => {
      const r = ctx ? moteur(ctx).reglages : undefined; if (!r) return undefined;
      const out: string[] = [];
      const sp = fraction(i.seuilPressentiment), pv = fraction(i.seuilPrevenir), g = nombre(i.gardeJours);
      if (sp !== undefined && sp < r.seuilPressentiment) out.push(`baisser le seuil des pressentiments à ${pourcent(sp)} % : des prévisions moins sûres seront présentées comme des prévisions`);
      if (pv !== undefined && pv < r.seuilPrevenir) out.push(`proposer de prévenir dès ${pourcent(pv)} % de confiance : plus de signalements`);
      if (g !== undefined && Math.floor(g) < r.gardeJours) out.push(`garder ${Math.max(1, Math.floor(g))} jour(s) au lieu de ${r.gardeJours} : la purge effacera ce qui est plus vieux`);
      if (g !== undefined && Math.floor(g) > r.gardeJours) out.push(`garder tes habitudes ${Math.floor(g)} jours au lieu de ${r.gardeJours}`);
      return out.length ? out.join(' ; ') : undefined;
    },
    run(ctx, i) {
      const r = moteur(ctx).regler({ seuilPressentiment: fraction(i.seuilPressentiment), seuilPrevenir: fraction(i.seuilPrevenir), gardeJours: nombre(i.gardeJours) });
      return { text: `Réglé : pressentiment sous ${pourcent(r.seuilPressentiment)} %, prévenir à partir de ${pourcent(r.seuilPrevenir)} %, garde ${r.gardeJours} jour(s).`, data: { ...r } };
    },
  };
  // Pas grave : la purge n'efface que ce que la durée de garde choisie dit d'effacer.
  const purgerA: Action = {
    id: 'purger', label: 'Oublier le plus vieux',
    what: 'Efface les demandes, événements et prévisions plus vieux que la durée de garde (60 jours par défaut)',
    run(ctx) { const m = moteur(ctx); const n = m.purger(); ctx.saveSettings({ dernierePurge: ctx.now().toISOString() }); return { text: `Oublié : ${n} élément(s) plus vieux que ${m.reglages.gardeJours} jour(s).`, data: { retires: n } }; },
  };
  const effacerA: Action = {
    id: 'effacer', label: 'Tout effacer',
    what: 'Efface tout ce que Prónoia a appris et prévu (demandes, événements, prévisions, bilan) ; les réglages restent',
    grave: () => 'effacer tout ce que Prónoia a appris et prévu (habitudes, événements, prévisions et bilan), sans retour possible',
    run(ctx) { moteur(ctx).effacerTout(); return { text: 'Tout est effacé : Prónoia repart de zéro.', data: { efface: true } }; },
  };

  // Ouvrir une source d'événements de plus = apprendre les habitudes d'une appli de plus : accord du propriétaire.
  const ouvrirSourceA: Action = {
    id: 'ouvrir_source', label: "Apprendre d'une source de plus",
    what: "Prónoia apprend aussi d'un couple « appli/type » (ex. appareils/etat) en plus de la maison et des machines",
    params: [{ key: 'source', label: 'Source (appli/type)', kind: 'text', required: true }],
    grave: (i) => { const c = coupleSource(i.source); return c && !SOURCES_DEFAUT.includes(c) ? `apprendre aussi des événements « ${c} » : Prónoia pourra en déduire des habitudes (y compris d'une personne si cette source en parle)` : undefined; },
    run(ctx, i) { const c = moteur(ctx).ouvrirSource(s(i.source)); return { text: `Prónoia apprend aussi de « ${c} ».`, data: { source: c } }; },
  };
  // Fermer une source : une protection, un clic.
  const fermerSourceA: Action = {
    id: 'fermer_source', label: "Ne plus apprendre d'une source",
    what: 'Referme un couple « appli/type » ouvert par toi (ceux de la maison et des machines restent)',
    params: [{ key: 'source', label: 'Source (appli/type)', kind: 'text', required: true }],
    run(ctx, i) { const ok = moteur(ctx).fermerSource(s(i.source)); return { text: ok ? 'Source refermée.' : "Cette source n'était pas ouverte (celles de la maison et des machines restent).", ok }; },
  };

  const tachePurge: TacheAppli = {
    id: 'purger', nom: 'Oublier le plus vieux', quoi: 'efface chaque nuit ce qui dépasse la durée de garde de Prónoia',
    rythme: () => ({ genre: 'jour', heure: '03:50' }),
    lancer: { action: 'purger' },
    dernier: (ctx) => (typeof ctx.settings.dernierePurge === 'string' ? { at: ctx.settings.dernierePurge, ok: true } : undefined),
  };

  return {
    id: 'pronoia', name: 'Prónoia', family: 'Données',
    what: 'Prévoir et pressentir : Odin estime ce qui est probable d\'après ce qu\'il a appris chez toi, avec sa confiance, et le dit honnêtement.',
    does: [
      'devine ta prochaine demande (heure, jour, enchaînements) et prépare d\'avance la réponse probable en lecture seule, pour répondre plus vite ; le temps gagné est mesuré',
      'devine les questions qui suivront un échange et les tient prêtes',
      'estime ce qui va probablement arriver dans la maison (rythmes des événements des applis, tendance d\'une mesure vers un seuil, météo relayée) et ne propose de prévenir que si c\'est utile',
      'chaque prévision montre sa confiance, sa date et ce sur quoi elle se fonde ; une prévision peu sûre est un « pressentiment »',
      'mesure son vrai taux de réussite (prévu contre arrivé) et sa justesse par tranche de confiance ; l\'écart sert à Noûs pour apprendre',
      'propose seulement : aucune action, aucun envoi, aucun achat, aucune alerte intrusive sur une simple prévision',
      'jamais de suivi d\'une autre personne ; tout reste chez toi, chiffré, coupable d\'un clic et effaçable ; rien en mode privé',
    ],
    // Les logiciels équivalents ne sont nommés QUE dans « Alternative à » (SIMILAIRES de names.ts), jamais ici.
    from: [], upstream: [],
    words: ['pronoia', 'prónoia', 'previsions', 'pressentiment', 'anticipation', 'qu est ce qui va arriver'],
    actions: [bilanA, previsionsA, jugeesA, prevoirA, couperA, allumerA, reglerA, purgerA, effacerA, ouvrirSourceA, fermerSourceA],
    start(ctx) {
      const m = moteur(ctx);
      brancherPronoia(ctx.dir, (miroir) => m.magasin.brancherMiroir(miroir)); // pose la base PRONOIA_ODIN
      // Fichier illisible (abîmé ou posé en clair) : Prónoia est repartie COUPÉE ; le propriétaire est prévenu.
      if (m.magasin.illisible) ctx.alert({ level: 'moyenne', title: 'Prónoia est coupée par prudence', detail: m.magasin.illisible, key: 'pronoia:illisible' });
    },
    // Chaque heure : juger ce qui est échu ; la purge une fois par jour après 03:50 (sauf tâche en pause dans Talos).
    watch: {
      every: 3600,
      run(ctx) {
        const m = moteur(ctx); m.cloturer();
        const now = ctx.now(), jour = now.toISOString().slice(0, 10), dernier = s(ctx.settings.dernierePurge).slice(0, 10);
        if (dernier === jour || now.getHours() * 60 + now.getMinutes() < 3 * 60 + 50 || tacheEnPause('pronoia', 'purger')) return;
        purgerA.run(ctx, {});
      },
    },
    taches: () => [tachePurge],
    view(ctx) {
      const m = moteur(ctx), r = m.reglages, n = ctx.now().getTime();
      const b = m.bilan();
      const toutes = m.previsions();
      const attente = toutes.filter((p) => p.etat === 'en_attente').sort((a, x) => (a.attendu ?? a.echeance) - (x.attendu ?? x.echeance));
      const jugees = toutes.filter((p) => p.etat !== 'en_attente').sort((a, x) => (x.resolue ?? 0) - (a.resolue ?? 0));
      const enPrive = prive();
      const etat = !m.actif ? 'anticipation coupée' : enPrive ? 'mode privé : rien n\'est appris' : 'anticipation allumée';
      const kpis: Kpi[] = [
        { label: 'Anticipation', value: m.actif ? (enPrive ? 'en pause (privé)' : 'allumée') : 'coupée', tone: m.actif ? 'bon' : 'neutre', hint: etat },
        { label: 'Taux de réussite', value: b.taux === undefined ? 'pas encore jugé' : `${Math.floor(b.taux * 1000) / 10} %`, tone: 'neutre', hint: b.taux === undefined ? 'aucune prévision jugée : pas de taux à montrer' : `${b.realisees} réalisée(s) sur ${b.realisees + b.ratees} jugée(s) ; ${b.perimees} périmée(s) hors du taux` },
        { label: 'En attente', value: String(attente.length), hint: 'prévisions pas encore jugées' },
        { label: 'Temps évité', value: b.preparation.servies ? `${Math.round(b.preparation.gagneMs)} ms` : 'pas encore', hint: b.preparation.servies ? `estimation : temps de préparation évité ; ${b.preparation.servies} réponse(s) préparée(s) servie(s) sur ${b.preparation.servies + b.preparation.manquees} demande(s)` : 'aucune réponse préparée servie pour l\'instant' },
      ];
      const honnete = `Prónoia ne prédit pas l'avenir : ce sont des estimations statistiques faites dans Odin (fréquences, heures, enchaînements, rythmes, tendance), posées sur ce qu'Odin a appris chez toi. Sous ${pourcent(r.seuilPressentiment)} % de confiance, c'est un « pressentiment ». Une prévision propose seulement : rien n'est lancé, envoyé ni acheté sur une prévision. Jamais de suivi d'une autre personne ; tout reste chez toi, chiffré. État : ${PAS_ESSAYE}.`;
      const prevSections: Section[] = [
        { kind: 'text', title: 'Ce que fait Prónoia', tone: 'neutre', text: honnete, onglet: 'Prévisions' },
        { kind: 'log', title: 'Prévisions en cours', onglet: 'Prévisions', lines: attente.length ? attente.slice(0, 30).map((p) => court(formuler(p, r, n), 400)) : [m.actif ? 'Aucune prévision en attente.' : 'Anticipation coupée : rien n\'est prévu.'] },
        { kind: 'actions', title: 'Anticipation', onglet: 'Prévisions', boutons: [m.actif ? { action: 'couper', label: 'Couper l\'anticipation', primary: true } : { action: 'allumer', label: 'Rallumer l\'anticipation', primary: true }, { action: 'prevoir', label: 'Prévoir maintenant' }] },
      ];
      const bilanSections: Section[] = [
        { kind: 'table', title: 'Ce qui s\'est réalisé ou non', onglet: 'Bilan', columns: ['Jugée le', 'Sorte', 'Prévu', 'Confiance', 'État', 'Écart'], rows: jugees.slice(0, 30).map((p) => ({ cells: [local(p.resolue), SORTE[p.sorte], court(p.quoi), `${pourcent(p.confiance)} %`, ETAT[p.etat], typeof p.ecartMin === 'number' ? `${p.ecartMin >= 0 ? '+' : ''}${p.ecartMin} min` : '—'], tone: p.etat === 'realisee' ? 'bon' as const : p.etat === 'ratee' ? 'attention' as const : undefined })), empty: 'Aucune prévision jugée pour l\'instant.' },
        // Un tableau, pas des barres : annoncé et observé côte à côte, avec le nombre de prévisions jugées.
        { kind: 'table', title: 'Justesse par tranche de confiance', onglet: 'Bilan', columns: ['Confiance annoncée', 'Moyenne annoncée', 'Réalisée (observé)', 'Jugées'], rows: b.tranches.map((t) => ({ cells: [`${Math.round(t.de * 100)} à ${Math.round(t.a * 100)} %`, `${pourcent(t.annoncee)} %`, `${Math.floor(t.observee! * 1000) / 10} %`, String(t.jugees)] })), empty: 'Pas encore de prévision jugée.' },
        { kind: 'log', title: 'Bilan', onglet: 'Bilan', lines: b.texte.split('\n') },
      ];
      const reglages: Section[] = [
        { kind: 'form', title: 'Réglages', onglet: 'Réglages', action: 'regler', submit: 'Enregistrer', params: [
          { key: 'seuilPressentiment', label: 'Pressentiment sous (%)', kind: 'number', default: pourcent(r.seuilPressentiment) },
          { key: 'seuilPrevenir', label: 'Proposer de prévenir à partir de (%)', kind: 'number', default: pourcent(r.seuilPrevenir) },
          { key: 'gardeJours', label: 'Garder (jours)', kind: 'number', default: r.gardeJours },
        ], aide: 'Baisser un seuil ou changer la durée de garde demande ton accord.' },
        // Ce que Prónoia apprend : un tableau (source, d'où, combien d'événements gardés), pas de barres.
        { kind: 'table', title: 'Ce que Prónoia apprend', onglet: 'Réglages', columns: ['Source', 'Origine', 'Gardés'], rows: m.sources().map((x) => { const [a, t] = x.source.split('/'); const nb = m.magasin.etat.evenements.filter((e) => e.appli === a && (e.type === t || (x.source === 'eir/mesure' && e.type === 'disque_occupe'))).length; return { cells: [`${a} / ${t}`, x.ouverte ? 'ouverte par toi' : 'par défaut', String(nb)], tone: x.ouverte ? 'attention' as const : undefined, ...(x.ouverte ? { actions: [{ action: 'fermer_source', label: 'Ne plus apprendre', input: { source: x.source } }] } : {}) }; }), empty: 'Aucune source.' },
        { kind: 'form', title: "Apprendre d'une source de plus", onglet: 'Réglages', action: 'ouvrir_source', submit: 'Ouvrir', params: [{ key: 'source', label: 'Source (appli/type)', kind: 'text', required: true }], aide: `Par défaut (« par défaut » ci-dessus), Prónoia n'apprend que de la maison et des machines. Les caméras, le VPN, les connexions, les nouveaux appareils, les réservations, les recherches et les ordres à la voix ne sont pas appris : ils diraient quand quelqu'un arrive. Ouvrir une source demande ton accord.${m.evenementsLaisses ? ` (${m.evenementsLaisses} événement(s) d'une rafale laissé(s).)` : ''}` },
        { kind: 'actions', title: 'Ménage', onglet: 'Réglages', boutons: [{ action: 'purger', label: 'Oublier le plus vieux maintenant' }, { action: 'effacer', label: 'Tout effacer' }] },
      ];
      return {
        subtitle: `${etat} · ${attente.length} prévision(s) en attente · ${b.taux === undefined ? 'pas encore de taux de réussite' : `réussite mesurée ${Math.floor(b.taux * 1000) / 10} %`}`,
        kpis, onglets: ['Prévisions', 'Bilan', 'Réglages'],
        sections: [...prevSections, ...bilanSections, ...reglages],
      };
    },
  };
}
