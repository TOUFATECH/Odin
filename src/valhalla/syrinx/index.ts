// Syrinx — l'oreille d'Odin : la parole, la musique et les sons de la maison, compris sur ta machine, sans aucun serveur
// ni modèle en ligne. Cette page sert à ESSAYER : on lui donne un son ou une musique, elle dit ce qu'elle entend avec sa
// confiance et le temps MESURÉ, et on peut la corriger. Tant que le modèle de sons ouvert n'a pas tourné ici, elle le dit
// (« codé, pas encore essayé sur du vrai modèle ») et n'affiche aucune confiance de sons.
//
// Le calcul (lire le son, entendre sans modèle, modèle de sons) vit dans src/audio et se charge par import tardif
// (bande-son.ts). La transcription réutilise la voix LOCALE d'Odin, SEULEMENT si elle est déjà installée : Syrinx n'installe
// rien tout seul, n'envoie jamais un son à un service de transcription en ligne et ne garde pas l'audio brut. Le résumé par
// le modèle de texte d'Odin (qui peut être en ligne) est éteint par défaut et jamais fait en mode privé. En mode privé, on
// analyse et on montre, mais on ne range RIEN, et le son déposé est effacé juste après l'écoute.
import { existsSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Action, ActionResult, Kpi, ModCtx, Module, Section, TacheAppli } from '../types.ts';
import type { OdinConfig } from '../../config.ts';
import type { AnalyseSon, Demander, Ecouter, EmpreinteSon, ModeleSons, OptionsAnalyse } from '../../audio/contrat.ts';
import { tacheEnPause } from '../automatismes.ts';
import { brancherSyrinx } from './base.ts';
import { codeErreur, ecouteurLocal, modeleSonsLocal, oreille, oublierModeleSons, texteErreur, type Oreille } from './bande-son.ts';
import { comprendreSon, fois, horloge, ligneDeTemps, NOM_ETAPE, quandLocal, rapportSon, texteLigne, texteMesure, texteModeleAbsent, type SensSon } from './ligne-de-temps.ts';
import { ajouterCorrection, ajouterMesures, enteteDe, lireContenu, lireCorrections, lireEmpreinte, lireMesures, listerSons, medianeMesures, purger, rangerAnalyse, shaFichierFlux, trouverParShaFichier } from './magasin.ts';
import { prototypeProche, retrouverParPhrase, retrouverParSon, type Trouve } from './memoire-sons.ts';
import { ecouterClip, HONNETE_MATERIEL } from './cameras.ts';

export { oreilleEssai } from './bande-son.ts';

export interface OptionsSyrinx { voice?: OdinConfig['voice']; modele?: () => Promise<ModeleSons | undefined>; ecouter?: Ecouter | null; demander?: Demander | null }

type Quoi = 'tout' | 'parole' | 'musique' | 'sons';
const s = (v: unknown) => String(v ?? '').trim();
const pct = (x: number) => Math.round(Math.max(0, Math.min(1, Number(x) || 0)) * 100);
/** Un nom long raccourci par le milieu (la page reste lisible à 390 px, même sans espace dans le nom). */
const court = (n: string, max = 48): string => (n.length > max ? `${n.slice(0, max - 18)}…${n.slice(-15)}` : n);
const vrai = (v: unknown): boolean => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
const PAS_PRETE = 'l\'oreille n\'est pas encore prête sur cette machine (le calcul du son n\'est pas installé)';
const PAROLE_ABSENTE = 'la transcription locale n\'est pas installée sur ce poste (Réglages → Voix)';
const MODELE_ABSENT = 'modèle de sons : pas téléchargé (22 Mo, Apache-2.0)';
const MODELE_PAS_ESSAYE = 'codé, pas encore essayé sur du vrai modèle';
const GRAVE_TELECHARGER = 'télécharger 22 Mo (licence Apache-2.0) depuis le dépôt public de modèles';
const ANNONCE = { titre: 'Odin entend maintenant le son, la musique et les bruits, sur ta machine (Syrinx).', detail: 'Rien ne part en ligne ; l\'écoute des caméras reste éteinte tant que tu ne l\'allumes pas.' };

/** Le dernier son entendu, gardé EN MÉMOIRE pour la page (même en mode privé, rien n'est rangé). */
interface Dernier { id?: string; nom: string; quand: string; analyse: AnalyseSon; sens: SensSon; appris?: { libelle: string; cos: number } }
const derniers = new Map<string, Dernier>();

/** La liste des caméras écoutées, telle que réglée (noms séparés par des virgules, 50 au plus). */
const listeCameras = (v: unknown): string[] => [...new Set(s(v).split(',').map((x) => x.trim().slice(0, 120)).filter(Boolean))].slice(0, 50);
const joursDe = (v: unknown): number => Math.max(1, Math.min(3650, Math.round(Number(v) || 30)));

/** Résout un fichier déposé dans l'atelier (jamais hors de ce dossier : on ne garde que le nom de base). */
function fichierAtelier(ctx: ModCtx, ref: string): string {
  const nom = basename(s(ref).replace(/^atelier:/, '').replace(/\\/g, '/'));
  if (!nom || nom === '.' || nom === '..') throw new Error('nom de fichier vide');
  return join(ctx.dir, 'atelier', nom);
}

export function syrinx(o: () => OptionsSyrinx): Module {
  const prive = () => o().voice?.privacy?.privateMode === true;
  const dossierPoids = (ctx: ModCtx) => join(ctx.dir, 'poids');

  /**
   * La transcription : celle donnée (essais), sinon la transcription LOCALE si elle est DÉJÀ installée sur ce poste ; sinon
   * null avec la raison. Jamais le service en ligne (localOnly forcé), jamais l'audio brut gardé, jamais d'installation.
   */
  async function ecouteur(): Promise<{ ecouter: Ecouter | null; raison?: string }> {
    const x = o();
    if (x.ecouter !== undefined) return { ecouter: x.ecouter, raison: x.ecouter ? undefined : PAROLE_ABSENTE };
    const ec = await ecouteurLocal(x.voice);
    return ec ? { ecouter: ec } : { ecouter: null, raison: PAROLE_ABSENTE };
  }
  /** Le modèle de texte d'Odin (peut être en ligne) : seulement si le propriétaire l'a allumé, jamais en mode privé. */
  const demandeur = (ctx: ModCtx): Demander | null => {
    if (prive()) return null;
    const x = o(); if (x.demander !== undefined) return x.demander;
    return ctx.ask && vrai(ctx.settings.resumeModele) ? (sys, u) => ctx.ask!(`${sys}\n\n${u}`) : null;
  };
  const modele = async (ctx: ModCtx): Promise<ModeleSons | undefined> => {
    const x = o(); if (x.modele) { try { const m = await x.modele(); return m?.pret ? m : undefined; } catch { return undefined; } }
    return modeleSonsLocal(dossierPoids(ctx));
  };

  /** L'analyse rangée suffit-elle pour cette demande ? (sinon on réécoute : modèle ou parole devenus prêts) */
  const suffit = (a: AnalyseSon, quoi: Quoi, modelePret: boolean, parolePrete: boolean) =>
    !((quoi === 'tout' || quoi === 'sons' || quoi === 'musique') && a.sons.etat !== 'fait' && modelePret)
    && !((quoi === 'tout' || quoi === 'parole') && a.parole.etat !== 'faite' && parolePrete);

  async function analyser(ctx: ModCtx, ref: string, quoi: Quoi): Promise<ActionResult> {
    const f = fichierAtelier(ctx, ref);
    if (!existsSync(f) || !statSync(f).isFile()) throw new Error(`son introuvable : ${basename(f)}`);
    try { return await analyserFichier(ctx, f, quoi); }
    finally {
      // Mode privé : le son déposé ne reste pas dans l'atelier (rien n'est gardé, pas même le fichier brut).
      if (prive()) try { rmSync(f, { force: true }); } catch { /* déjà parti */ }
    }
  }

  async function analyserFichier(ctx: ModCtx, f: string, quoi: Quoi): Promise<ActionResult> {
    const nom = court(basename(f));
    const or = await oreille(); if (!or) return { ok: false, text: `${nom} : ${PAS_PRETE}.`, data: { pret: false } };
    const st = statSync(f), sha = await shaFichierFlux(f);
    const m = quoi === 'parole' ? undefined : await modele(ctx);
    const ec = quoi === 'tout' || quoi === 'parole' ? await ecouteur() : { ecouter: null, raison: undefined };
    const demander = demandeur(ctx);
    // Déjà entendu ? (même fichier, au SHA-256 près) : on rend l'analyse rangée, sans recalculer.
    const deja = trouverParShaFichier(ctx.dir, sha), contenuDeja = deja ? lireContenu(ctx.home, deja) : undefined;
    if (deja && contenuDeja && suffit(contenuDeja.analyse, quoi, Boolean(m), Boolean(ec.ecouter))) {
      const sens = contenuDeja.sens ?? await comprendreSon(contenuDeja.analyse, null);
      derniers.set(ctx.dir, { id: deja.id, nom: basename(f), quand: deja.quand, analyse: contenuDeja.analyse, sens });
      return { text: `${nom} · déjà entendu le ${quandLocal(deja.quand)} (rien n'a été recalculé)\n\n${rapportSon(contenuDeja.analyse, sens, { quoi })}`, data: { id: deja.id, deja: true } };
    }
    // Le modèle absent reste « pas prêt » (undefined → texte honnête « pas téléchargé ») ; seule la parole ne le demande pas.
    const opts: OptionsAnalyse = { modele: quoi === 'parole' ? null : m, ecouter: ec.ecouter, demander, sonsSeuls: quoi === 'sons', avecEmpreinte: true, dossierTemp: join(ctx.dir, 'tmp') };
    let r;
    try { r = await or.analyserSon({ fichier: f }, opts); } catch (e) { return { ok: false, text: `${nom} : ${texteErreur(e)}`, data: { erreur: codeErreur(e) ?? 'autre' } }; }
    const analyse = r.analyse;
    if (analyse.parole.etat === 'pas_prete' && ec.raison) analyse.parole.raison = ec.raison;
    const sens = await comprendreSon(analyse, demander);
    // Ressemble à un son déjà entendu ? (comparé AVANT de ranger celui-ci)
    const proches = retrouverParSon(ctx.dir, ctx.home, { plongement: analyse.sons.plongement, empreinte: r.empreinte }, or.voterEmpreinte, 3);
    const appris = prototypeProche(ctx.dir, ctx.home, analyse.sons.plongement);
    const range = rangerAnalyse(ctx, ctx.home, { sourceRef: `atelier:${basename(f)}`, shaFichier: sha, taille: st.size, mtime: Math.round(st.mtimeMs), analyse, sens, empreinte: r.empreinte, prive: prive(), quand: ctx.now() });
    ajouterMesures(ctx.dir, analyse.mesures, prive(), ctx.now());
    const id = range.range ? range.valeur : undefined;
    derniers.set(ctx.dir, { id, nom: basename(f), quand: ctx.now().toISOString(), analyse, sens, appris: appris ? { libelle: appris.libelle, cos: appris.cos } : undefined });
    const tete = [
      `${nom}${id ? ` · rangé (${id})` : ''}`,
      range.range ? '' : `${range.raison} ; le son déposé est effacé de l'atelier`,
      proches.length ? `ressemble à un son déjà entendu le ${quandLocal(proches[0].quand)} (${court(proches[0].sourceRef)}, ${proches[0].pourquoi})` : '',
      appris ? `appris chez toi : ${appris.libelle} (ressemblance ${pct(appris.cos)} %)` : '',
    ].filter(Boolean).join('\n');
    return { text: `${tete}\n\n${rapportSon(analyse, sens, { quoi })}`, data: { id, prive: prive(), tempo: analyse.musique.tempo?.bpm, tonalite: analyse.musique.tonalite?.nom, sons: analyse.sons.etat }, ok: true };
  }

  const param = { key: 'fichier', label: 'Son (atelier:nom)', kind: 'text' as const, required: true, depot: {} };
  const ecouterA: Action = {
    id: 'ecouter', label: 'Écouter un son', read: true, external: true,
    what: 'Tout ce qu\'Odin entend dans un son ou une musique : parole, musique (tempo, tonalité, structure), sons reconnus, avec la confiance et le temps mesuré ; le son reste sur ta machine',
    words: ['syrinx', 'qu entends tu', 'ecoute ce son', 'analyse ce son'], params: [param],
    run: (ctx, i) => analyser(ctx, s(i.fichier), 'tout'),
  };
  const sonsA: Action = {
    id: 'sons', label: 'Reconnaître les sons', read: true, external: true,
    what: 'Les sons du quotidien reconnus (sonnette, alarme, aboiement, verre cassé, pleurs…) par le modèle de sons ouvert, avec la probabilité et le seuil',
    words: ['quel est ce bruit', 'reconnais ce bruit'], params: [param],
    run: (ctx, i) => analyser(ctx, s(i.fichier), 'sons'),
  };
  const musiqueA: Action = {
    id: 'musique', label: 'Analyser une musique', read: true, external: true,
    what: 'Tempo, tonalité, structure (refrain probable, estimation), instruments et ambiance, sans la parole',
    words: ['analyse la musique', 'tempo', 'tonalite'], params: [param],
    run: (ctx, i) => analyser(ctx, s(i.fichier), 'musique'),
  };
  const paroleA: Action = {
    id: 'parole', label: 'Écouter la parole', read: true, external: true,
    what: 'Ce qui est dit (transcription locale), la langue et les tours de parole (voix 1, voix 2 : estimation, personne n\'est reconnu par sa voix)',
    words: ['qui parle dans ce son'], params: [param],
    run: (ctx, i) => analyser(ctx, s(i.fichier), 'parole'),
  };

  const retrouverA: Action = {
    id: 'retrouver', label: 'Retrouver un son', read: true,
    what: 'Retrouve un son ou une musique déjà entendus, par une phrase (« l\'aboiement de la semaine dernière ») ou par un autre son',
    words: ['retrouve le son', 'syrinx retrouve'],
    params: [{ key: 'phrase', label: 'Phrase', kind: 'text' }, { key: 'fichier', label: 'Ou un son (atelier:nom)', kind: 'text', depot: {} }],
    async run(ctx, i) {
      const phrase = s(i.phrase), ref = s(i.fichier);
      if (!phrase && !ref) throw new Error('donne une phrase ou un son');
      let res: Trouve[] = [];
      if (phrase) res = retrouverParPhrase(ctx.dir, ctx.home, phrase, 8);
      else {
        const f = fichierAtelier(ctx, ref);
        if (!existsSync(f)) throw new Error(`son introuvable : ${basename(f)}`);
        const or = await oreille(); if (!or) return { ok: false, text: PAS_PRETE };
        const deja = trouverParShaFichier(ctx.dir, await shaFichierFlux(f));
        let plongement: number[] | undefined, empreinte: EmpreinteSon | undefined;
        if (deja) { plongement = lireContenu(ctx.home, deja)?.analyse.sons.plongement; empreinte = lireEmpreinte(ctx.dir, deja.id); }
        else {
          try { const r = await or.analyserSon({ fichier: f }, { modele: await modele(ctx), ecouter: null, demander: null, sonsSeuls: true, avecEmpreinte: true }); plongement = r.analyse.sons.plongement; empreinte = r.empreinte; }
          catch (e) { return { ok: false, text: texteErreur(e) }; }
        }
        res = retrouverParSon(ctx.dir, ctx.home, { plongement, empreinte }, or.voterEmpreinte, 8);
        if (deja && !res.some((x) => x.id === deja.id)) res.unshift({ id: deja.id, quand: deja.quand, sourceRef: deja.sourceRef, score: 1, pourquoi: 'le même fichier' });
      }
      const note = phrase ? '\n(recherche par les mots des étiquettes, du résumé et du sujet ; la recherche par le sens d\'une phrase n\'est pas encore branchée)' : '';
      return { text: res.length ? res.map((r) => `${quandLocal(r.quand)} · ${court(r.sourceRef)} · ${r.id} · ${pct(r.score)} % (${r.pourquoi})`).join('\n') + note : `Rien trouvé.${note}`, data: { resultats: res } };
    },
  };

  const corrigerA: Action = {
    id: 'corriger', label: 'Corriger ce qu\'Odin entend', read: false,
    what: 'Dire le bon mot (« c\'est la sonnette ») pour un son entendu : Syrinx s\'en sert sur place comme exemple appris',
    words: ['syrinx corrige'],
    params: [{ key: 'analyse', label: 'Son (identifiant)', kind: 'text', required: true }, { key: 'libelle', label: 'Le bon mot', kind: 'text', required: true }, { key: 'debut', label: 'Début (s, facultatif)', kind: 'number' }, { key: 'fin', label: 'Fin (s, facultatif)', kind: 'number' }],
    run(ctx, i) {
      const id = s(i.analyse).toLowerCase(), libelle = s(i.libelle).slice(0, 120);
      if (!id || !libelle) throw new Error('son et bon mot requis');
      if (prive()) return { text: 'Mode privé : la correction n\'est pas rangée (rien n\'est gardé).', data: { range: false } };
      const e = enteteDe(ctx.dir, id); if (!e) throw new Error(`son inconnu : ${id}`);
      const a = lireContenu(ctx.home, e)?.analyse;
      const debut = i.debut === undefined || i.debut === '' ? undefined : Number(i.debut), fin = i.fin === undefined || i.fin === '' ? undefined : Number(i.fin);
      const cle = a?.sons.etiquettes.find((x) => x.libelle.toLowerCase() === libelle.toLowerCase())?.cle;
      const r = ajouterCorrection(ctx.dir, ctx.home, { quand: ctx.now().toISOString(), analyse: id, libelle, cle, debut: Number.isFinite(debut) ? debut : undefined, fin: Number.isFinite(fin) ? fin : undefined, plongement: a?.sons.plongement }, false);
      return { text: r.range ? `C'est noté : ${id} → « ${libelle} »${a?.sons.plongement?.length ? ' ; Syrinx s\'en servira comme exemple appris chez toi' : ' (pas de plongement : le modèle de sons n\'avait pas tourné)'}.` : r.raison, data: { range: r.range } };
    },
  };

  const telechargerA: Action = {
    id: 'telecharger_modele', label: 'Télécharger le modèle de sons',
    what: 'Télécharge une fois le modèle de sons ouvert (22 Mo, licence Apache-2.0), vérifie son empreinte, et note sa licence à côté',
    grave: () => GRAVE_TELECHARGER,
    async run(ctx) {
      const or = await oreille(); if (!or) return { ok: false, text: PAS_PRETE };
      const r = await or.telechargerModeleSons({ dossier: dossierPoids(ctx), fetch: ctx.fetch });
      oublierModeleSons(dossierPoids(ctx));
      return { ok: r.ok, text: r.texte };
    },
  };

  const mesurerA: Action = {
    id: 'mesurer', label: 'Mesurer la vitesse', read: true,
    what: 'Écoute un son fabriqué de 60 s (clics à 120 BPM, aucun son privé) et mesure le temps de chaque étape sur cette machine',
    words: ['syrinx mesure'],
    async run(ctx) {
      const or = await oreille(); if (!or) return { ok: false, text: PAS_PRETE };
      const m = await modele(ctx);
      let r;
      try { r = await or.analyserSon({ octets: or.sonFabrique('clics120', 60), nom: 'mesure.wav' }, { modele: m, ecouter: null, demander: null, avecEmpreinte: true }); }
      catch (e) { return { ok: false, text: texteErreur(e) }; }
      const g = ajouterMesures(ctx.dir, r.analyse.mesures, prive(), ctx.now());
      return { text: `Son fabriqué de 60 s · ${r.analyse.mesures.map(texteMesure).join(' · ')}${m ? '' : `\n(${MODELE_ABSENT} : l'étape du modèle n'est pas mesurée)`}${g.range ? '' : `\n${g.raison}`}`, data: { mesures: r.analyse.mesures, tempo: r.analyse.musique.tempo?.bpm } };
    },
  };

  // Pas grave : la purge n'efface que ce que la durée de conservation choisie par le propriétaire dit d'effacer ; c'est
  // BAISSER cette durée qui demande son accord (régler, plus bas).
  const purgerA: Action = {
    id: 'purger', label: 'Oublier les vieux sons',
    what: 'Efface les sons, analyses, empreintes et corrections plus vieux que la durée de conservation (30 jours par défaut)',
    run(ctx) {
      const jours = Math.max(1, Number(ctx.settings.conserverJours ?? 30) || 30);
      const r = purger(ctx, jours, ctx.now());
      ctx.saveSettings({ dernierePurge: ctx.now().toISOString() });
      return { text: `Oubliés : ${r.sons} son(s) analysé(s), ${r.atelier} fichier(s) déposé(s), ${r.corrections} correction(s) (plus de ${jours} jours).`, data: r };
    },
  };

  const reglerA: Action = {
    id: 'regler', label: 'Régler Syrinx',
    what: 'Les caméras écoutées (éteint par défaut), la durée de conservation, l\'anti-rafale des alertes, le résumé par le modèle de texte d\'Odin (éteint par défaut)',
    params: [{ key: 'cameras', label: 'Caméras écoutées (noms séparés par des virgules, vide = aucune)', kind: 'text' }, { key: 'conserverJours', label: 'Garder les sons (jours)', kind: 'number' }, { key: 'antiRafaleMin', label: 'Pas deux alertes d\'une caméra en moins de (min)', kind: 'number' }, { key: 'resumeModele', label: 'Résumer avec le modèle de texte d\'Odin (peut être en ligne)', kind: 'boolean' }],
    // Tout ce qui ÉTEINT une protection ou fait sortir des données demande l'accord du propriétaire (jamais d'une automatisation).
    grave: (i, ctx) => {
      const r: string[] = [];
      const avant = (ctx?.settings.camerasEcoutees as string[] | undefined) ?? [];
      if (i.cameras !== undefined) {
        const liste = listeCameras(i.cameras);
        const neuves = liste.filter((x) => !avant.includes(x)), retirees = avant.filter((x) => !liste.includes(x));
        if (neuves.length) r.push(`allumer l'écoute des sons sur ${neuves.map((x) => court(x, 40)).join(', ')} (le micro de la caméra sera écouté à chaque clip)`);
        if (retirees.length) r.push(`éteindre l'écoute des sons sur ${retirees.map((x) => court(x, 40)).join(', ')} (plus d'alerte de bruit pour ces caméras)`);
      }
      const jours = Number(ctx?.settings.conserverJours ?? 30) || 30;
      if (i.conserverJours !== undefined && i.conserverJours !== '' && joursDe(i.conserverJours) < jours) r.push(`garder les sons ${joursDe(i.conserverJours)} jour(s) au lieu de ${jours} : la purge effacera les plus vieux`);
      if (i.antiRafaleMin !== undefined && i.antiRafaleMin !== '' && Math.round(Number(i.antiRafaleMin) || 0) > Number(ctx?.settings.antiRafaleMin ?? 10)) r.push('espacer davantage les alertes de bruit des caméras');
      if (i.resumeModele !== undefined && vrai(i.resumeModele) && !vrai(ctx?.settings.resumeModele)) r.push('laisser le modèle de texte d\'Odin résumer ce qu\'Odin entend : la transcription lui est envoyée, et il peut être en ligne selon tes réglages');
      return r.length ? r.join(' ; ') : undefined;
    },
    run(ctx, i) {
      const p: Record<string, unknown> = {};
      if (i.cameras !== undefined) p.camerasEcoutees = listeCameras(i.cameras);
      if (i.conserverJours !== undefined && i.conserverJours !== '') p.conserverJours = joursDe(i.conserverJours);
      if (i.antiRafaleMin !== undefined && i.antiRafaleMin !== '') p.antiRafaleMin = Math.max(0, Math.min(1440, Math.round(Number(i.antiRafaleMin) || 0)));
      if (i.resumeModele !== undefined && i.resumeModele !== '') p.resumeModele = vrai(i.resumeModele);
      ctx.saveSettings(p);
      return { text: `Réglé : ${Object.entries(p).map(([k, v]) => `${k} = ${Array.isArray(v) ? (v.join(', ') || 'aucune') : String(v)}`).join(' ; ') || 'rien changé'}.`, data: p };
    },
  };

  // Pas « read » : l'écoute d'un clip range son analyse et peut lever une alerte.
  const clipA: Action = {
    id: 'ecouter_clip', label: 'Écouter le son d\'un clip de caméra', quiet: true, quick: false,
    what: `Appelé par le réflexe de Cyclope : écoute seulement les sons d'un clip (verre cassé, alarme, pleurs, aboiement) si cette caméra est écoutée ; rien n'est transcrit — ${HONNETE_MATERIEL}`,
    params: [{ key: 'camera', label: 'Caméra', kind: 'text', required: true }, { key: 'fichier', label: 'Clip', kind: 'text', required: true }],
    run: (ctx, i) => ecouterClip(ctx, i, prive()),
  };

  const tachePurge: TacheAppli = {
    id: 'purger', nom: 'Oublier les vieux sons', quoi: 'efface chaque nuit les sons, analyses, empreintes et corrections plus vieux que la durée de conservation',
    rythme: () => ({ genre: 'jour', heure: '03:40' }),
    lancer: { action: 'purger' },
    dernier: (ctx) => (typeof ctx.settings.dernierePurge === 'string' ? { at: ctx.settings.dernierePurge, ok: true } : undefined),
  };

  return {
    id: 'syrinx', name: 'Syrinx', family: 'Données',
    what: 'L\'oreille d\'Odin : la parole, la musique et les sons de la maison, compris sur ta machine.',
    does: [
      'lit un son (WAV directement, les autres formats par l\'outil média local) et en tire la forme d\'onde et le spectre',
      'entend sans modèle : silence ou son, volume, tempo, tonalité, structure (refrain probable, estimation), changements',
      'reconnaît un son déjà entendu par son empreinte, pour ne jamais l\'analyser deux fois',
      'reconnaît les sons du quotidien (sonnette, alarme, aboiement, verre cassé, pleurs…) par un modèle de sons ouvert, téléchargé une fois avec ton accord',
      'transcrit la parole avec la transcription locale d\'Odin si elle est prête, dit la langue et sépare les tours de parole (personne n\'est reconnu par sa voix)',
      'réunit parole, musique et sons sur une ligne de temps, avec un résumé, les moments marquants et l\'ambiance',
      'retrouve un son par une phrase ou par un autre son ; on peut la corriger, elle apprend sur place',
      'le son reste sur ta machine (transcription locale seulement) ; le résumé par le modèle de texte d\'Odin, qui peut être en ligne, est éteint par défaut ; l\'écoute des caméras est éteinte par défaut ; en mode privé rien n\'est gardé, pas même le son déposé',
    ],
    // Les logiciels équivalents ne sont nommés QUE dans « Alternative à » (SIMILAIRES de names.ts), jamais ici.
    from: [], upstream: [],
    words: ['syrinx', 'qu entends tu', 'ecoute ce son', 'analyse ce son', 'analyse la musique', 'quel est ce bruit', 'reconnais ce bruit', 'tempo', 'tonalite'],
    depot: (ctx) => ({ dossier: join(ctx.dir, 'atelier'), ref: (nom) => `atelier:${nom}` }),
    actions: [ecouterA, sonsA, musiqueA, paroleA, retrouverA, corrigerA, telechargerA, mesurerA, purgerA, reglerA, clipA],
    async start(ctx) {
      brancherSyrinx(ctx.dir); // pose la base SYRINX_ODIN (sinon elle n'est jamais créée)
      // Les fichiers de travail (parole en WAV) sont effacés après chaque écoute ; après un arrêt brutal, on les efface ici.
      try { rmSync(join(ctx.dir, 'tmp'), { recursive: true, force: true }); } catch { /* rien à effacer */ }
      if (ctx.settings.annonce !== 'v1') {
        ctx.alert({ level: 'info', title: ANNONCE.titre, detail: ANNONCE.detail, key: 'syrinx:annonce' });
        ctx.saveSettings({ annonce: 'v1' });
      }
    },
    // La purge de nuit : passe une fois par jour après 03:40 (sauf si la tâche est en pause dans Talos).
    watch: {
      every: 3600,
      run(ctx) {
        const now = ctx.now(), jour = now.toISOString().slice(0, 10), dernier = s(ctx.settings.dernierePurge).slice(0, 10);
        if (dernier === jour || now.getHours() * 60 + now.getMinutes() < 3 * 60 + 40 || tacheEnPause('syrinx', 'purger')) return;
        purgerA.run(ctx, {});
      },
    },
    taches: () => [tachePurge],
    async view(ctx) {
      const or = await oreille();
      const etat = or ? (() => { try { return or.etatModeleSons(dossierPoids(ctx)); } catch { return undefined; } })() : undefined;
      const ec = await ecouteur();
      const total = medianeMesures(ctx.dir, 'total'), mesures = lireMesures(ctx.dir);
      const sons = listerSons(ctx.dir).length, d = derniers.get(ctx.dir), corrections = lireCorrections(ctx.dir, ctx.home);
      const modeleTexte = !or ? PAS_PRETE : !etat?.present ? MODELE_ABSENT : !etat.aTourne ? `modèle de sons présent : ${MODELE_PAS_ESSAYE}` : `modèle de sons : a tourné le ${quandLocal(s(etat.quand))}${etat.mesure ? ` (${texteMesure(etat.mesure)})` : ''}`;
      const resume = vrai(ctx.settings.resumeModele) && !prive();
      const kpis: Kpi[] = [
        { label: 'Modèle de sons', value: !or ? 'pas prêt' : !etat?.present ? 'pas téléchargé' : !etat.aTourne ? 'pas encore essayé' : 'a tourné', tone: etat?.aTourne ? 'bon' : 'attention', hint: modeleTexte },
        { label: 'Parole', value: ec.ecouter ? 'prête' : 'pas prête', tone: ec.ecouter ? 'bon' : 'neutre', hint: ec.ecouter ? 'transcription locale prête sur ce poste' : 'parole : pas prête sur ce poste' },
        { label: 'Vitesse mesurée', value: total ? `${fois(total.xTempsReel)} temps réel` : 'pas mesurée', hint: total ? `médiane de ${total.n} passe(s) : ${Math.round(total.ms)} ms` : 'lance « Mesurer la vitesse »' },
        { label: 'Sons rangés', value: String(sons), hint: prive() ? 'mode privé : rien n\'est rangé' : `gardés ${Number(ctx.settings.conserverJours ?? 30)} jours` },
      ];
      const ecouter: Section[] = [
        { kind: 'depot', title: 'Écouter un son ou une musique', action: 'ecouter', champ: 'fichier', texte: 'Dépose un son ou une musique', aide: `WAV lu par Odin seul ; les autres formats passent par l'outil média local. Le son reste sur ta machine${resume ? ' ; le résumé passe par le modèle de texte d\'Odin' : ''}.` },
        { kind: 'actions', title: 'L\'oreille sur cette machine', boutons: [{ action: 'mesurer', label: 'Mesurer la vitesse', primary: true }, { action: 'telecharger_modele', label: 'Télécharger le modèle de sons' }], aide: modeleTexte },
        { kind: 'log', title: 'État honnête', lines: [
          modeleTexte,
          ec.ecouter ? 'parole : transcription locale prête sur ce poste' : `parole : pas prête sur ce poste (${ec.raison ?? PAROLE_ABSENTE})`,
          `caméras : ${HONNETE_MATERIEL}`,
          mesures.length ? `vitesse mesurée ici (médiane des ${Math.min(50, new Set(mesures.map((m) => m.quand)).size)} dernières passes) : ${(['decodage', 'spectre', 'sans_modele', 'empreinte', 'modele_sons', 'parole', 'total'] as const).map((e) => { const m = medianeMesures(ctx.dir, e); return m ? texteMesure({ etape: e, ms: m.ms, xTempsReel: m.xTempsReel }) : ''; }).filter(Boolean).join(' · ')}` : 'vitesse : pas encore mesurée sur cette machine',
          'pendant l\'analyse, le modèle de sons calcule sur le fil du serveur : Odin rend la main entre chaque bloc, mais peut répondre un peu plus lentement',
        ] },
        { kind: 'text', title: 'Vie privée', tone: 'neutre', text: `Le son est calculé sur ta machine ; la parole n'est transcrite que par la transcription locale (jamais un service en ligne, l'audio brut n'est pas gardé). ${resume ? 'Le résumé et le sujet des paroles passent par le modèle de texte d\'Odin, qui peut être en ligne selon tes réglages.' : 'Le résumé par le modèle de texte d\'Odin est éteint : rien ne part en ligne.'} Les analyses, empreintes et corrections rangées sont chiffrées ; le son déposé reste tel quel dans l'atelier ${Number(ctx.settings.conserverJours ?? 30)} jours, puis il est oublié. En mode privé, rien n'est rangé et le son déposé est effacé juste après l'écoute. Personne n'est reconnu par sa voix (voix 1, voix 2 : estimation). L'écoute des caméras est éteinte tant que tu ne l'allumes pas.` },
      ];
      const resultat: Section[] = [];
      if (!d) resultat.push({ kind: 'text', title: 'Dernier son', text: 'Dépose un son dans l\'onglet Écoute.', onglet: 'Entendu' });
      else {
        const a = d.analyse, n = a.onde.length;
        // Des journaux (retours à la ligne gardés, hauteur bornée) ; le nom du fichier dans le texte, raccourci, jamais en titre.
        resultat.push({ kind: 'log', title: 'Dernier son', onglet: 'Entendu', lines: [
          court(d.nom), d.id ? `rangé (${d.id})` : prive() ? 'mode privé : rien n\'est rangé' : 'pas rangé', ...(d.appris ? [`appris chez toi : ${d.appris.libelle}`] : []), '',
          ...rapportSon(a, d.sens).split('\n'),
        ] });
        resultat.push({ kind: 'courbe', title: 'Forme d\'onde', onglet: 'Entendu', labels: a.onde.map((_, k) => horloge((k * a.duree) / Math.max(1, n))), series: [{ name: 'crête', tone: 'neutre', points: a.onde.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 100)) }], unit: '%', empty: 'son vide' });
        // Un tableau, pas des barres : une probabilité brute de 61 % ne doit pas remplir une barre comme une certitude.
        if (a.sons.etat === 'fait') resultat.push({ kind: 'table', title: 'Sons reconnus (probabilité brute)', onglet: 'Entendu', columns: ['Son', 'Probabilité brute', 'Seuil', 'Au-dessus ?'], rows: [...a.sons.etiquettes].sort((x, y) => y.p - x.p).slice(0, 12).map((e) => ({ cells: [e.libelle, `${pct(e.p)} %`, `${pct(e.seuil)} %`, e.p >= e.seuil ? 'oui' : 'non'], tone: e.p >= e.seuil ? 'bon' as const : undefined })), empty: 'rien au-dessus du bruit' });
        else resultat.push({ kind: 'text', title: 'Sons reconnus', onglet: 'Entendu', text: texteModeleAbsent(a.sons.raison) });
        const ev = ligneDeTemps(a);
        resultat.push({ kind: 'log', title: 'Ligne de temps', onglet: 'Entendu', lines: ev.length ? [...texteLigne(ev.slice(0, 80)).split('\n'), ...(a.sons.etat === 'fait' ? ['(courbe par pas moins calibrée que le score global)'] : [])] : ['rien de reconnu'] });
        resultat.push({ kind: 'table', title: 'Temps mesuré par étape', onglet: 'Entendu', columns: ['Étape', 'ms', '× temps réel'], rows: a.mesures.map((m) => ({ cells: [NOM_ETAPE[m.etape] ?? m.etape, String(Math.round(m.ms)), m.xTempsReel ? fois(m.xTempsReel) : '—'] })), empty: 'pas mesuré' });
        if (d.id) resultat.push({ kind: 'form', title: 'Corriger ce qu\'Odin entend', onglet: 'Entendu', action: 'corriger', submit: 'Corriger', params: [{ key: 'analyse', label: 'Son', kind: 'text', required: true, default: d.id }, { key: 'libelle', label: 'Le bon mot', kind: 'text', required: true }, { key: 'debut', label: 'Début (s)', kind: 'number' }, { key: 'fin', label: 'Fin (s)', kind: 'number' }] });
      }
      const retrouver: Section[] = [
        { kind: 'form', title: 'Retrouver un son par une phrase', onglet: 'Trouver', action: 'retrouver', submit: 'Retrouver', params: [{ key: 'phrase', label: 'Phrase', kind: 'text', required: true }], aide: 'Par les mots des étiquettes, du résumé et du sujet. La recherche par le sens d\'une phrase n\'est pas encore branchée.' },
        { kind: 'depot', title: 'Retrouver par un son', onglet: 'Trouver', action: 'retrouver', champ: 'fichier', texte: 'Dépose un son à comparer' },
        { kind: 'table', title: 'Dernières corrections', onglet: 'Trouver', columns: ['Quand', 'Son', 'Le bon mot'], rows: corrections.slice(0, 20).map((c) => ({ cells: [quandLocal(c.quand), c.analyse, c.libelle] })), empty: 'Aucune correction pour l\'instant.' },
      ];
      const cams = (ctx.settings.camerasEcoutees as string[] | undefined) ?? [];
      const reglages: Section[] = [
        { kind: 'form', title: 'Réglages', onglet: 'Réglages', action: 'regler', submit: 'Enregistrer', params: [
          { key: 'cameras', label: 'Caméras écoutées (noms séparés par des virgules ; vide = aucune)', kind: 'text', default: cams.join(', ') },
          { key: 'conserverJours', label: 'Garder les sons (jours)', kind: 'number', default: Number(ctx.settings.conserverJours ?? 30) },
          { key: 'antiRafaleMin', label: 'Pas deux alertes d\'une caméra en moins de (min)', kind: 'number', default: Number(ctx.settings.antiRafaleMin ?? 10) },
          { key: 'resumeModele', label: 'Résumer avec le modèle de texte d\'Odin (peut être en ligne ; jamais en mode privé)', kind: 'boolean', default: vrai(ctx.settings.resumeModele) },
        ], aide: `Écoute des caméras : ${cams.length ? `allumée sur ${cams.length} caméra(s) (${cams.slice(0, 3).map((x) => court(x, 28)).join(', ')}${cams.length > 3 ? '…' : ''})` : 'éteinte'} — ${HONNETE_MATERIEL}. Seuls les sons sont écoutés, jamais la parole.` },
        { kind: 'actions', title: 'Ménage', onglet: 'Réglages', boutons: [{ action: 'purger', label: 'Oublier les vieux sons maintenant' }] },
      ];
      return {
        subtitle: `${modeleTexte} · ${ec.ecouter ? 'parole prête' : 'parole : pas prête sur ce poste'} · ${sons} son(s) rangé(s)`,
        kpis, onglets: ['Écoute', 'Entendu', 'Trouver', 'Réglages'],
        sections: [...ecouter, ...resultat, ...retrouver, ...reglages],
      };
    },
  };
}

/** (essais) oublie le dernier son montré. */
export function oublierDerniers(): void { derniers.clear(); }
export type { Oreille };
