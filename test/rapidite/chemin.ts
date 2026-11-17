// Banc de rapidité : le CHEMIN D'UNE DEMANDE, de l'arrivée du message du propriétaire au premier mot puis à la réponse
// complète, avec un FAUX modèle à délai fixe (le temps du modèle est connu : tout le reste est le temps propre d'Odin).
//
//   node --disable-warning=ExperimentalWarning test/rapidite/chemin.ts [gros|petit|tout] [--court]
//
// Mesures par tour : temps avant l'appel au modèle (le « temps propre d'Odin »), premier mot affiché, réponse
// complète (envoi au canal), fin du tour ; temps processeur ; lectures et écritures disque avant le modèle et sur
// tout le tour ; temps cumulé des méthodes clés ; jalons d'Odin (res.timing). À froid : un processus neuf par mesure.
// Rien n'est modifié dans Odin : les méthodes sont enveloppées pour être chronométrées, le réseau est coupé.

process.env.ODIN_ESSAI = '1';
process.env.ODIN_NO_VOICE_INSTALL = '1';
process.env.ODIN_NO_LOCAL_BRAIN = '1';

import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chargeMachine, ecrireResultat, fermerCompte, Methodes, ms, ouvrirCompte, poserCompteur, profiler, stat, tableau, type CompteES } from './outils.ts';
import { GROS, PETIT, remplir, type Volume } from './remplir.ts';
import type { CompletionRequest, ModelResponse, Provider, AgentEvent } from '../../src/types.ts';

// ------------------------------------------------------------------------------------------------ réseau coupé
export const reseau = { tentatives: 0, adresses: [] as string[] };
const fetchOrigine = globalThis.fetch;
globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
  const url = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return fetchOrigine(entree as never, init);
  reseau.tentatives++; reseau.adresses.push(url);
  throw new Error('réseau coupé par le banc de rapidité');
}) as typeof fetch;

// ------------------------------------------------------------------------------------------------ faux modèle
/** Faux modèle : attend `premierMs`, puis écrit `morceaux` morceaux espacés de `entreMs` (par onDelta), puis rend. */
export class ModeleLent implements Provider {
  readonly name = 'modele-lent';
  readonly appels: Array<{ at: number; system: number; messages: number; outils?: number; nbOutils?: number; historique?: number }> = [];
  readonly fins: number[] = [];
  surAppel?: (req: CompletionRequest) => void;
  readonly premierMs: number; readonly morceaux: number; readonly entreMs: number;
  constructor(premierMs = 300, morceaux = 12, entreMs = 20) { this.premierMs = premierMs; this.morceaux = morceaux; this.entreMs = entreMs; }
  async complete(req: CompletionRequest): Promise<ModelResponse> {
    this.appels.push({ at: performance.now(), system: req.system.length, messages: req.messages.length, outils: JSON.stringify(req.tools ?? []).length, nbOutils: (req.tools ?? []).length, historique: req.messages.reduce((s, m) => s + String(m.content ?? '').length, 0) });
    this.surAppel?.(req);
    const dormir = (t: number) => new Promise<void>((r) => setTimeout(r, t));
    // Cite la première note que le Cerveau a donnée : la fin de tour apprend alors des liens (chemin réel).
    const note = /^- \[\[([^\]]+)\]\]/m.exec(req.system)?.[1];
    const texte = req.system.startsWith('Tu relis') ? '{"ok": true}' : `[humeur:joie] Voici ce que je sais${note ? ` d'après [[${note}]]` : ''} : la sauvegarde du serveur passe chaque nuit, et la facture est rangée dans le dossier du bureau. Rien d'autre à signaler pour l'instant.`;
    await dormir(this.premierMs);
    const pas = Math.ceil(texte.length / this.morceaux);
    for (let i = 0; i < texte.length; i += pas) { req.onDelta?.(texte.slice(i, i + pas)); await dormir(this.entreMs); }
    this.fins.push(performance.now());
    return { text: texte, toolCalls: [], usage: { inputTokens: Math.round(req.system.length / 4), outputTokens: 60 }, stopReason: 'end' };
  }
}

// ------------------------------------------------------------------------------------------------ questions
const QUESTIONS = [
  'Qu\'est-ce que j\'avais noté sur la sauvegarde du serveur et le disque de stockage ?',
  'Rappelle-moi ce qu\'on sait de la facture d\'électricité et du fournisseur.',
  'Où en est le projet de la boutique et du site internet ?',
  'Qu\'est-ce que Mariam m\'a dit pour le rendez-vous chez le médecin ?',
  'Fais-moi le point sur le budget, l\'épargne et le crédit de la maison.',
  'Quelles idées j\'avais pour les vacances et les billets d\'avion ?',
  'Que faut-il faire pour la panne de l\'imprimante du bureau ?',
  'Résume ce que je sais du routeur wifi et de la caméra du jardin.',
  'Dis-moi ce qui concerne la réparation de la toiture et le plombier.',
  'Quel est l\'état de la commande, de la livraison et du colis en retour ?',
  'Parle-moi de la réunion et de la présentation du rapport de comptabilité.',
  'Qu\'est-ce que j\'ai prévu pour l\'anniversaire et le cadeau de la famille ?',
];

// ------------------------------------------------------------------------------------------------ un Odin jetable
interface Tour {
  q: string; apresModele: number; avantModele: number; premierMot: number; reponse: number; fin: number; cpu: number;
  esAvant: { l: number; e: number }; esTour: { l: number; e: number }; esDossiers: CompteES['parDossier'];
  methodes: Record<string, { ms: number; n: number }>; jalons?: Record<string, number>; appelsModele: number; ia?: boolean; evenements: Record<string, number>;
  apresTour?: number;
  /** Ce qui part au modèle au premier appel (caractères) : la taille pèse sur le temps du vrai modèle avant son premier mot. */
  taille?: { system: number; outils: number; nbOutils: number; historique: number; messages: number };
}

export async function monter(home: string, o: { config?: 'isole' | 'reel'; modele?: ModeleLent } = {}) {
  const t0 = performance.now();
  const { createOdin } = await import('../../src/runtime.ts');
  const { Gateway } = await import('../../src/bifrost/gateway.ts');
  const { Vault } = await import('../../src/brain/vault.ts');
  const { LiensVivants } = await import('../../src/brain/liens-vivants.ts');
  const tImport = performance.now() - t0;
  const modele = o.modele ?? new ModeleLent();
  const reel = o.config === 'reel';
  const configOverride = (c: import('../../src/config.ts').OdinConfig) => ({
    ...c,
    agent: { ...c.agent, ...(reel ? {} : { review: false, verify: false }) },
    learning: { ...c.learning, observe: reel },
    journal: { ...c.journal, enabled: false }, watch: { ...c.watch, enabled: false }, continuous: { ...c.continuous, enabled: false, autoResume: false },
    quiet: { ...c.quiet, enabled: false }, veille: { enabled: false, at: '12:30' }, update: { auto: 'off' as const, everyHours: 6 }, web: { ...c.web, portsParAppli: false },
    mimir: { ...c.mimir, enabled: false },
  });
  const t1 = performance.now();
  const odin = createOdin({ home, provider: modele, approver: { approve: async () => false }, configOverride });
  const tCreation = performance.now() - t1;
  // Le canal : note l'instant de chaque événement et de l'envoi final.
  const instants: { evts: Array<{ t: number; type: string }>; envois: Array<{ t: number; text: string }> } = { evts: [], envois: [] };
  const canal = {
    name: 'web', interactive: true, async start() {}, async stop() {},
    async send(_peer: string, text: string) { instants.envois.push({ t: performance.now(), text }); },
    event(_peer: string, e: AgentEvent) { instants.evts.push({ t: performance.now(), type: e.type }); },
  };
  const gw = new Gateway(odin, { owners: { web: ['moi'] } }).add(canal as never);
  // Chronomètre de méthodes (inclusif ; une méthode appelée dans une autre compte dans les deux).
  const m = new Methodes();
  const mu = odin.muninn as unknown as object;
  for (const n of ['recall', 'lessons', 'history', 'addMessage', 'setKv', 'getKv', 'ensureSession', 'getSession', 'startMission', 'endMission', 'progressMission', 'recordRoute', 'pinned', 'interruptedMissions', 'stalledMissions', 'viderUsages', 'nearest', 'listJobs']) m.suivre(mu, n, `muninn.${n}`);
  const ag = odin.agent as unknown as object;
  for (const n of ['recallSmart', 'maybeCompact', 'statusSnapshot', 'review', 'execTool', 'run']) m.suivre(ag, n, `agent.${n}`);
  for (const n of ['all', 'search', 'find']) m.suivre(Vault.prototype, n, `vault.${n}`);
  for (const n of ['voisinage', 'apprendreDuTour', 'reposer']) m.suivre(LiensVivants.prototype, n, `liens.${n}`);
  m.suivre(odin.skills as unknown as object, 'index', 'skills.index'); m.suivre(odin.skills as unknown as object, 'list', 'skills.list');
  m.suivre(odin.tools as unknown as object, 'specs', 'tools.specs');
  // Le résultat du tour (jalons, réflexion d'après-tour) : on enveloppe run() de cette instance.
  let dernierRes: { timing?: Record<string, number>; ai?: { needed: boolean }; reflection?: Promise<unknown> } | undefined;
  const runOrigine = odin.agent.run.bind(odin.agent);
  (odin.agent as { run: typeof odin.agent.run }).run = async (t, op) => { const r = await runOrigine(t, op); dernierRes = r; return r; };

  async function dire(q: string): Promise<Tour> {
    const n0 = modele.appels.length; instants.evts.length = 0; instants.envois.length = 0; m.vider();
    let esAvant: { l: number; e: number } | undefined;
    const compte = ouvrirCompte();
    modele.surAppel = () => { if (!esAvant) esAvant = { l: compte.lectures, e: compte.ecritures }; };
    const c0 = process.cpuUsage(), t = performance.now();
    await gw.handle({ channel: 'web', peer: 'moi', name: 'moi', text: q });
    const fin = performance.now() - t, c = process.cpuUsage(c0);
    fermerCompte(); modele.surAppel = undefined;
    const premierAppel = modele.appels[n0]?.at;
    const premierDelta = instants.evts.find((e) => e.type === 'delta')?.t ?? instants.evts.find((e) => e.type === 'text')?.t;
    const evenements: Record<string, number> = {};
    for (const e of instants.evts) if (!(e.type in evenements)) evenements[e.type] = Math.round((e.t - t) * 100) / 100;
    const tour: Tour = {
      q, apresModele: modele.fins.at(-1) && instants.envois.at(-1) ? instants.envois.at(-1)!.t - modele.fins.at(-1)! : NaN, avantModele: premierAppel ? premierAppel - t : NaN, premierMot: premierDelta ? premierDelta - t : NaN, reponse: instants.envois.at(-1) ? instants.envois.at(-1)!.t - t : NaN, fin, cpu: (c.user + c.system) / 1000,
      esAvant: esAvant ?? { l: compte.lectures, e: compte.ecritures }, esTour: { l: compte.lectures, e: compte.ecritures }, esDossiers: compte.parDossier,
      methodes: m.vider(), jalons: dernierRes?.timing, appelsModele: modele.appels.length - n0, ia: dernierRes?.ai?.needed, evenements,
      taille: modele.appels[n0] ? { system: modele.appels[n0].system, outils: modele.appels[n0].outils ?? 0, nbOutils: modele.appels[n0].nbOutils ?? 0, historique: modele.appels[n0].historique ?? 0, messages: modele.appels[n0].messages } : undefined,
    };
    if (dernierRes?.reflection) { const ta = performance.now(); await dernierRes.reflection.catch(() => undefined); tour.apresTour = performance.now() - ta; }
    return tour;
  }
  return { odin, gw, modele, dire, tImport, tCreation, fermer: () => { m.defaire(); try { odin.close(); } catch { /* */ } } };
}

// ------------------------------------------------------------------------------------------------ résumé
const ETAPES: Array<[string, (t: Tour) => number]> = [
  ['temps propre d\'Odin avant le modèle', (t) => t.avantModele],
  ['premier mot affiché (modèle 300 ms compris)', (t) => t.premierMot],
  ['réponse complète envoyée', (t) => t.reponse],
  ['de la fin du modèle à l\'envoi', (t) => t.apresModele],
  ['fin du tour (handle rendu)', (t) => t.fin],
  ['processeur du tour', (t) => t.cpu],
];
function resumer(tours: Tour[]) {
  const s: Record<string, unknown> = {};
  for (const [nom, f] of ETAPES) s[nom] = stat(tours.map(f));
  // Méthodes : temps par tour.
  const noms = new Set(tours.flatMap((t) => Object.keys(t.methodes)));
  const meth: Record<string, unknown> = {};
  for (const n of noms) meth[n] = { ...stat(tours.map((t) => t.methodes[n]?.ms ?? 0)), appelsParTour: stat(tours.map((t) => t.methodes[n]?.n ?? 0)).mediane };
  const jal = new Set(tours.flatMap((t) => Object.keys(t.jalons ?? {})));
  const jalons: Record<string, unknown> = {};
  for (const n of jal) jalons[n] = stat(tours.map((t) => t.jalons?.[n] ?? 0));
  const evts = new Set(tours.flatMap((t) => Object.keys(t.evenements)));
  const evenements: Record<string, unknown> = {};
  for (const n of evts) evenements[n] = stat(tours.map((t) => t.evenements[n]).filter((x) => x !== undefined));
  return {
    etapes: s, methodes: meth, jalons, evenements,
    esAvantModele: { lectures: stat(tours.map((t) => t.esAvant.l)), ecritures: stat(tours.map((t) => t.esAvant.e)) },
    esTour: { lectures: stat(tours.map((t) => t.esTour.l)), ecritures: stat(tours.map((t) => t.esTour.e)) },
    esDossiersDernier: tours.at(-1)?.esDossiers, appelsModele: stat(tours.map((t) => t.appelsModele)), sansIA: tours.filter((t) => t.ia === false).length,
    apresTour: stat(tours.map((t) => t.apresTour ?? NaN)),
    tailleRequete: { system: stat(tours.map((t) => t.taille?.system ?? NaN)), outils: stat(tours.map((t) => t.taille?.outils ?? NaN)), nbOutils: stat(tours.map((t) => t.taille?.nbOutils ?? NaN)), historique: stat(tours.map((t) => t.taille?.historique ?? NaN)), messages: stat(tours.map((t) => t.taille?.messages ?? NaN)) },
  };
}

// ------------------------------------------------------------------------------------------------ à froid (processus neuf)
async function froidUneFois(home: string): Promise<Tour & { tImport: number; tCreation: number; tProcessus: number }> {
  const t0 = performance.now();
  const ici = fileURLToPath(import.meta.url);
  return await new Promise((ok, ko) => execFile(process.execPath, ['--disable-warning=ExperimentalWarning', ici, 'froid-enfant', home], { maxBuffer: 1 << 26, cwd: fileURLToPath(new URL('../..', import.meta.url)) }, (e, out, err) => {
    if (e) return ko(new Error(`${e.message}\n${err}`));
    const ligne = out.split('\n').find((l) => l.startsWith('RESULTAT ')); if (!ligne) return ko(new Error(`pas de résultat : ${out.slice(-500)} ${err.slice(-500)}`));
    const r = JSON.parse(ligne.slice(9)); r.tProcessus = performance.now() - t0; ok(r);
  }));
}

async function enfantFroid(home: string): Promise<void> {
  const tDebut = performance.now();
  poserCompteur(home);
  const o = await monter(home);
  const tour = await o.dire(QUESTIONS[0]);
  process.stdout.write(`RESULTAT ${JSON.stringify({ ...tour, tImport: o.tImport, tCreation: o.tCreation, tPret: performance.now() - tDebut })}\n`);
  o.fermer();
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------ programme
export async function cheminDemande(o: { volumes?: Array<['gros' | 'petit', Volume]>; tours?: number; froids?: number; espaces?: number; profil?: boolean } = {}) {
  const volumes = o.volumes ?? [['gros', GROS], ['petit', PETIT]];
  const res: Record<string, unknown> = {};
  let texte = '';
  for (const [nom, vol] of volumes) {
    const charge0 = await chargeMachine(1000);
    const t0 = performance.now();
    const r = remplir(vol);
    const tRemplir = performance.now() - t0;
    poserCompteur(r.home);
    // À froid : un processus neuf par mesure (premier message après le démarrage).
    const froids: Array<Awaited<ReturnType<typeof froidUneFois>>> = [];
    for (let i = 0; i < (o.froids ?? 5); i++) froids.push(await froidUneFois(r.home));
    // À chaud : enchaîné (messages collés) puis espacé (> 3 s : le cache du coffre est passé).
    const od = await monter(r.home);
    for (let i = 0; i < 3; i++) await od.dire(QUESTIONS[(i + 5) % QUESTIONS.length]);
    const enchaine: Tour[] = [];
    for (let i = 0; i < (o.tours ?? 30); i++) enchaine.push(await od.dire(QUESTIONS[i % QUESTIONS.length]));
    const espace: Tour[] = [];
    for (let i = 0; i < (o.espaces ?? 12); i++) { await new Promise((x) => setTimeout(x, 3100)); espace.push(await od.dire(QUESTIONS[i % QUESTIONS.length])); }
    // Profil processeur sur quelques tours espacés (fonctions libres non chronométrables autrement).
    let profil: unknown;
    if (o.profil !== false) {
      const noms = ['handle', 'runTurn', 'repondre', 'turn', 'tryDirect', 'consultBrain', 'brainBlock', 'buildSystemPrompt', 'rappelParAssociation', 'propager', 'voisinage', 'statique', 'all', 'search', 'find', 'recall', 'lessons', 'recallSmart', 'apprendreDeLAgent', 'apprendreDuTour', 'guessMood', 'history', 'repairHistory', 'featuresPrompt', 'features', 'relevantSkills', 'scriptsIndex', 'listScripts', 'userBrief', 'rightsSummary', 'pendingSecretHint', 'statusSnapshot', 'openElsewhere', 'allThreads', 'syncQuotidien', 'recordTask', 'withSources', 'polishReply', 'accorder', 'specs', 'index', 'keywords', 'appsFor', 'recordRoute', 'setKv', 'addMessage', 'write', 'compact', 'appendFileSync', 'writeFileSync', 'readFileSync', 'statSync', 'readdirSync', 'indiceIA', 'recordAsk', 'noterDemandeOdin', 'iaLine', 'decisionsFooter', 'extractSecret', 'resolveShortcut', 'modeFromText', 'taskCategory', 'redact', 'syncMemoryFiles', 'construire', 'candidats', 'candidates'];
      const p = await profiler(async () => { for (let i = 0; i < 8; i++) { await new Promise((x) => setTimeout(x, 3100)); await od.dire(QUESTIONS[(i + 3) % QUESTIONS.length]); } }, noms);
      profil = { toursProfiles: 8, inclusifParTourMs: Object.fromEntries(Object.entries(p.inclusif).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round((v / 8) * 100) / 100])), propreTop: p.propre.slice(0, 25), totalEchantillonneMs: p.totalMs };
    }
    const charge1 = await chargeMachine(1000);
    od.fermer();
    const sf = resumer(froids), se = resumer(enchaine), ss = resumer(espace);
    res[nom] = { volume: vol, tRemplirMs: Math.round(tRemplir), memoireOctets: r.fichiers.memoireOctets, chargeAvant: charge0, chargeApres: charge1, froid: { ...sf, demarrage: { import: stat(froids.map((f) => f.tImport)), creation: stat(froids.map((f) => f.tCreation)), processusComplet: stat(froids.map((f) => f.tProcessus)) } }, chaudEnchaine: se, chaudEspace: ss, profil, reseau: { ...reseau } };
    texte += `\n=== Volume ${nom} : ${vol.souvenirs} souvenirs, ${vol.notes} notes, ${vol.liens} liens, ${vol.conversations} conversations ===\n`;
    texte += `Charge machine : ${charge0.occupation} % avant, ${charge1.occupation} % après (8 fils).\n`;
    texte += `Démarrage à froid : import ${ms(stat(froids.map((f) => f.tImport)).mediane)}, création d'Odin ${ms(stat(froids.map((f) => f.tCreation)).mediane)}, processus jusqu'à la réponse ${ms(stat(froids.map((f) => f.tProcessus)).mediane)}.\n`;
    const lig = (lbl: string, s: ReturnType<typeof resumer>) => ETAPES.map(([n]) => { const x = s.etapes[n] as ReturnType<typeof stat>; return [lbl, n, ms(x.mediane), ms(x.p95), x.n]; });
    texte += tableau(['cas', 'étape', 'médiane', '95e c.', 'n'], [...lig('froid', sf), ...lig('chaud enchaîné', se), ...lig('chaud espacé', ss)]) + '\n';
    texte += `E/S avant le modèle (médiane) : froid ${(sf.esAvantModele.lectures as ReturnType<typeof stat>).mediane} lectures / ${(sf.esAvantModele.ecritures as ReturnType<typeof stat>).mediane} écritures ; chaud enchaîné ${(se.esAvantModele.lectures as ReturnType<typeof stat>).mediane} / ${(se.esAvantModele.ecritures as ReturnType<typeof stat>).mediane} ; chaud espacé ${(ss.esAvantModele.lectures as ReturnType<typeof stat>).mediane} / ${(ss.esAvantModele.ecritures as ReturnType<typeof stat>).mediane}.\n`;
    texte += `E/S sur tout le tour (chaud espacé, médiane) : ${(ss.esTour.lectures as ReturnType<typeof stat>).mediane} lectures / ${(ss.esTour.ecritures as ReturnType<typeof stat>).mediane} écritures.\n`;
    { const tq = ss.tailleRequete; texte += `Requête au modèle (1er appel, chaud espacé, médiane) : consigne système ${tq.system.mediane} car., ${tq.nbOutils.mediane} outils décrits en ${tq.outils.mediane} car., historique ${tq.historique.mediane} car. en ${tq.messages.mediane} messages.\n`; }
    texte += `Méthodes (chaud espacé, médiane par tour) :\n${tableau(['méthode', 'médiane', '95e c.', 'appels/tour'], Object.entries(ss.methodes).sort((a, b) => (b[1] as { mediane: number }).mediane - (a[1] as { mediane: number }).mediane).slice(0, 25).map(([k, v]) => { const x = v as ReturnType<typeof stat> & { appelsParTour: number }; return [k, ms(x.mediane), ms(x.p95), x.appelsParTour]; }))}\n`;
    if (profil) texte += `Profil (inclusif par tour, ms) : ${JSON.stringify((profil as { inclusifParTourMs: unknown }).inclusifParTourMs)}\n`;
    try { rmSync(r.home, { recursive: true, force: true, maxRetries: 5 }); } catch { /* Windows */ }
  }
  return { res, texte };
}

if (process.argv[2] === 'froid-enfant') {
  await enfantFroid(process.argv[3]);
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const quoi = process.argv[2] ?? 'tout', court = process.argv.includes('--court');
  const volumes: Array<['gros' | 'petit', Volume]> = quoi === 'gros' ? [['gros', GROS]] : quoi === 'petit' ? [['petit', PETIT]] : [['gros', GROS], ['petit', PETIT]];
  const { res, texte } = await cheminDemande({ volumes, ...(court ? { tours: 6, froids: 2, espaces: 3, profil: false } : {}) });
  ecrireResultat(`chemin-${quoi}${court ? '-court' : ''}`, res, texte);
  console.log(texte);
  process.exit(0);
}
