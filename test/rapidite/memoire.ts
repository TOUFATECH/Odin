// Banc de rapidité : la MÉMOIRE et les LIENS VIVANTS, mesurés seuls (sans tour d'agent).
//
//   node --disable-warning=ExperimentalWarning test/rapidite/memoire.ts [--court]
//
// 1. Rappel par les mots (BM25) et leçons, sur 500 / 5 000 / 50 000 souvenirs ; temps de relecture au démarrage.
// 2. Recherche par le sens (cosinus) sur 500 / 5 000 / 50 000 vecteurs de 128 nombres : premier appel (décodage) et suivants.
// 3. Plongement de Soul (Noûs) par souvenir : un réseau neuf des gabarits petit / moyen, même calcul qu'un réseau entraîné.
// 4. Liens vivants avec 200 notes + 2 000 liens puis 2 000 notes + 20 000 liens : table des voisins (statique),
//    consultation du Cerveau avec et sans liens (la propagation est dedans), renforcement d'après-tour, nuit (consolidation).
// Les dossiers sont jetables ; aucun n'est le vrai dossier d'Odin.

process.env.ODIN_ESSAI = '1';
process.env.ODIN_NO_VOICE_INSTALL = '1';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chargeMachine, compterES, ecrireResultat, ms, poserCompteur, repeter, stat, tableau } from './outils.ts';
import { hasard, remplir, type Volume } from './remplir.ts';

const vide: Volume = { souvenirs: 0, notes: 0, liens: 0, conversations: 0, messagesParConv: 0, vecteurs: 0, dim: 128 };
const REQUETES = ['sauvegarde du serveur et disque de stockage', 'facture électricité fournisseur', 'projet boutique site internet', 'rendez-vous médecin mariam', 'budget épargne crédit maison', 'panne imprimante bureau réparation'];

export async function bancMemoire(o: { court?: boolean } = {}) {
  const N = o.court ? 10 : 40;
  const res: Record<string, unknown> = { charge: await chargeMachine(1000) };
  const lignes: Array<Array<string | number>> = [];
  const { Mnemosyne } = await import('../../src/muninn/store.ts');

  // ---------------------------------------------------------------- 1 et 2 : rappel par les mots, par le sens
  const rappel: Record<string, unknown> = {};
  for (const n of o.court ? [500, 5000] : [500, 5000, 50000]) {
    const r = remplir({ ...vide, souvenirs: n, vecteurs: n, dim: 128, conversations: Math.round(n / 25), messagesParConv: 20 }, { modeleVecteurs: 'noos-v1' });
    poserCompteur(r.home);
    const t0 = performance.now();
    const { r: m, es } = await compterES(() => new Mnemosyne(join(r.home, 'odin.db')));
    const tCharge = performance.now() - t0;
    let k = 0;
    const mots = await repeter(N, () => m.recall(REQUETES[k++ % REQUETES.length], 6));
    const lecons = await repeter(N, () => m.lessons(REQUETES[k++ % REQUETES.length], 6));
    const messages = await repeter(N, () => m.searchMessages(REQUETES[k++ % REQUETES.length], 8));
    const rnd = hasard(7); const q = new Float32Array(128); for (let i = 0; i < 128; i++) q[i] = rnd() * 2 - 1;
    const t1 = performance.now(); m.nearest('noos-v1', q, 6); const premierSens = performance.now() - t1;
    const sens = await repeter(N, () => m.nearest('noos-v1', q, 6), 0);
    const usages = await compterES(() => m.viderUsages());
    rappel[n] = { chargementMs: Math.round(tCharge), lecturesAuChargement: es.lectures, motsBM25: mots, lecons, rechercheConversations: messages, sensPremierAppelMs: Math.round(premierSens * 100) / 100, sens, viderUsages: { ecritures: usages.es.ecritures, souvenirsTouches: usages.r } };
    lignes.push([`rappel par les mots (${n})`, ms(mots.temps.mediane), ms(mots.temps.p95), ms(mots.cpu.mediane)]);
    lignes.push([`leçons (${n})`, ms(lecons.temps.mediane), ms(lecons.temps.p95), ms(lecons.cpu.mediane)]);
    lignes.push([`recherche dans les conversations (${n / 25 * 20} messages)`, ms(messages.temps.mediane), ms(messages.temps.p95), ms(messages.cpu.mediane)]);
    lignes.push([`sens, 1er appel avec décodage (${n} vecteurs)`, ms(premierSens), '—', '—']);
    lignes.push([`sens, appels suivants (${n} vecteurs)`, ms(sens.temps.mediane), ms(sens.temps.p95), ms(sens.cpu.mediane)]);
    lignes.push([`relecture au démarrage (${n} souvenirs + vecteurs)`, ms(tCharge), '—', '—']);
    try { rmSync(r.home, { recursive: true, force: true }); } catch { /* */ }
  }
  res.rappel = rappel;

  // ---------------------------------------------------------------- 3 : plongement de Soul
  const soul: Record<string, unknown> = {};
  try {
    const { nouvelEntraineur, gabarit, apprendreDecoupage } = await import('../../src/brain/nous/moteur.ts');
    for (const taille of ['petit', 'moyen'] as const) {
      const h = gabarit(taille), d = apprendreDecoupage(REQUETES, h.vocab, 1);
      const home = mkdtempSync(join(tmpdir(), 'odin-rapidite-soul-'));
      const e = nouvelEntraineur(h, d, 1, home);
      const t0 = performance.now(); await e.plonger('chauffe'); const premier = performance.now() - t0;
      let k = 0;
      const court = await repeter(N, () => e.plonger(REQUETES[k++ % REQUETES.length]), 2);
      const long = await repeter(Math.max(5, N / 4), () => e.plonger(`${REQUETES.join(' ')} ${REQUETES.join(' ')} ${REQUETES.join(' ')}`.slice(0, 600)), 1);
      // Débit : 50 souvenirs plongés à la suite (ce que fait la mémoire quand Noûs change de version).
      const t1 = performance.now(); for (let i = 0; i < 50; i++) await e.plonger(`${REQUETES[i % 6]} numéro ${i}`); const lot = performance.now() - t1;
      // Odin commence à répondre pendant un entraînement : combien de temps la séance met-elle à rendre le processeur ?
      const arrets: number[] = [];
      for (let k2 = 0; k2 < 3; k2++) {
        const ids = (i: number) => { const a = new Int32Array(h.contexte); for (let j = 0; j < a.length; j++) a[j] = (i * 7 + j * 13) % h.vocab; return a; };
        const lots = Array.from({ length: 400 }, (_, i) => ({ entrees: [ids(i), ids(i + 1)] }));
        const ctrl = new AbortController();
        const s = e.seance(lots, { dureeMs: 60_000, fils: 2, signal: ctrl.signal, graine: 1 });
        await new Promise((x) => setTimeout(x, 1500));
        const ta = performance.now(); ctrl.abort(); await s.catch(() => undefined); arrets.push(performance.now() - ta);
      }
      await e.arreter();
      soul[taille] = { arretEntrainementMs: stat(arrets), poids: h.poids, premierAppelMs: Math.round(premier), demandeCourte: court, souvenirLong600car: long, parSouvenirEnLotMs: Math.round((lot / 50) * 100) / 100 };
      lignes.push([`Soul ${taille} : plongement d'une demande courte`, ms(court.temps.mediane), ms(court.temps.p95), ms(court.cpu.mediane)]);
      lignes.push([`Soul ${taille} : plongement d'un souvenir de 600 car.`, ms(long.temps.mediane), ms(long.temps.p95), ms(long.cpu.mediane)]);
      lignes.push([`Soul ${taille} : 1er appel (démarrage du fil de calcul)`, ms(premier), '—', '—']);
      { const s = stat(arrets); lignes.push([`Soul ${taille} : arrêt d'une séance d'entraînement (2 fils) quand Odin répond`, ms(s.mediane), ms(s.max), '—']); }
      try { rmSync(home, { recursive: true, force: true }); } catch { /* */ }
    }
  } catch (e) { soul.erreur = (e as Error).message; }
  res.soul = soul;

  // ---------------------------------------------------------------- 4 : liens vivants
  const liens: Record<string, unknown> = {};
  const { Vault } = await import('../../src/brain/vault.ts');
  const { consultBrain } = await import('../../src/brain/contexte.ts');
  const { liensDe, apprendreDeLAgent } = await import('../../src/brain/liens-vivants.ts');
  for (const [notes, nl] of [[200, 2000], [2000, 20000]] as const) {
    const r = remplir({ ...vide, souvenirs: 500, notes, liens: nl });
    poserCompteur(r.home);
    const m = new Mnemosyne(join(r.home, 'odin.db'));
    const v = new Vault(join(r.home, 'cerveau'));
    const l = liensDe(m);
    // Première lecture du coffre (démarrage) puis table des voisins, mesurées séparément.
    const tp = performance.now(); const { es: esPremiere } = await compterES(() => v.all(true)); const tPremiere = performance.now() - tp;
    const t0 = performance.now(); const { es: esStat } = await compterES(() => l.voisinage(v, undefined)); const tStat = performance.now() - t0;
    let k = 0;
    const sans = await repeter(N, () => consultBrain({ vault: v }, REQUETES[k++ % REQUETES.length]));
    const avec = await repeter(N, () => consultBrain({ vault: v, liens: l, souvenirs: [1, 2, 3] }, REQUETES[k++ % REQUETES.length]));
    // Où part le temps d'une consultation (profil processeur sur 20 consultations).
    const { profiler } = await import('./outils.ts');
    const prof = await profiler(async () => { for (let i = 0; i < 20; i++) consultBrain({ vault: v, liens: l, souvenirs: [1, 2, 3] }, REQUETES[i % REQUETES.length]); }, ['consultBrain', 'search', 'all', 'candidats', 'snippetOf', 'hits', 'rappelParAssociation', 'propager', 'voisinage', 'statique', 'find', 'keywords']);
    // Le coffre relu (cache de 3 s passé) : ce que paie une demande espacée de plus de 3 s.
    const relu = await repeter(Math.max(5, N / 4), () => v.all(true), 1);
    const { es: esRelu } = await compterES(() => v.all(true));
    const c = consultBrain({ vault: v, liens: l, souvenirs: [1, 2, 3] }, REQUETES[0]);
    const texte = `D'après ${c.notes.slice(0, 2).map((x) => `[[${x.title}]]`).join(' et ')}, c'est réglé.`;
    const renf = await repeter(N, () => apprendreDeLAgent(m, { consult: c, texte, turnLog: [], souvenirs: [1, 2, 3], demande: REQUETES[0], vault: v, apps: undefined }, Date.now()), 1);
    const { es: esRenf } = await compterES(() => apprendreDeLAgent(m, { consult: c, texte, turnLog: [], souvenirs: [1, 2, 3], demande: REQUETES[0], vault: v, apps: undefined }, Date.now() + 7_200_000));
    // Odin écrit une note (journal, Quotidien…) : le coffre est invalidé ; la consultation suivante paie la relecture
    // complète des notes ET la reconstruction de la table des voisins.
    const apresEcriture: number[] = [];
    for (let i = 0; i < Math.max(3, N / 8); i++) {
      v.write(`Journal/banc-${i}`, { type: 'journal' }, `# Banc ${i}\n\nUne ligne écrite par Odin.`);
      const ta = performance.now(); consultBrain({ vault: v, liens: l, souvenirs: [1, 2, 3] }, REQUETES[i % REQUETES.length]); apresEcriture.push(performance.now() - ta);
    }
    const tn = performance.now(); const { r: bilan, es: esNuit } = await compterES(() => l.nuitSiBesoin(Date.now(), { vault: v, apps: undefined, force: true })); const tNuit = performance.now() - tn;
    liens[`${notes}notes-${nl}liens`] = { profilConsultation20: { inclusif: prof.inclusif, propre: prof.propre.slice(0, 12) }, premiereLectureCoffreMs: Math.round(tPremiere), lecturesPremiereLecture: esPremiere.lectures, consultationApresEcritureNote: stat(apresEcriture), tableVoisinsMs: Math.round(tStat * 100) / 100, lecturesTableVoisins: esStat.lectures, consultationSansLiens: sans, consultationAvecLiens: avec, relectureCoffre: relu, lecturesRelectureCoffre: esRelu.lectures, renforcement: renf, ecrituresRenforcement: esRenf.ecritures, nuit: { ms: Math.round(tNuit), ecritures: esNuit.ecritures, octets: esNuit.octetsEcrits, bilan }, influx: c.influx?.length ?? 0 };
    lignes.push([`Cerveau sans liens (${notes} notes)`, ms(sans.temps.mediane), ms(sans.temps.p95), ms(sans.cpu.mediane)]);
    lignes.push([`Cerveau avec liens + propagation (${notes} notes, ${nl} liens)`, ms(avec.temps.mediane), ms(avec.temps.p95), ms(avec.cpu.mediane)]);
    lignes.push([`première lecture du coffre (${notes} notes, ${esPremiere.lectures} lectures)`, ms(tPremiere), '—', '—']);
    lignes.push([`table des voisins, 1re fois (${nl} liens, coffre déjà lu)`, ms(tStat), '—', '—']);
    { const s = stat(apresEcriture); lignes.push([`consultation juste après l'écriture d'une note (${notes} notes, ${nl} liens)`, ms(s.mediane), ms(s.p95), '—']); }
    lignes.push([`relecture du coffre après 3 s (${notes} notes, ${esRelu.lectures} lectures)`, ms(relu.temps.mediane), ms(relu.temps.p95), ms(relu.cpu.mediane)]);
    lignes.push([`renforcement d'après-tour (${nl} liens)`, ms(renf.temps.mediane), ms(renf.temps.p95), ms(renf.cpu.mediane)]);
    lignes.push([`nuit / consolidation (${nl} liens, ${esNuit.ecritures} écritures)`, ms(tNuit), '—', '—']);
    try { rmSync(r.home, { recursive: true, force: true }); } catch { /* */ }
  }
  res.liens = liens;
  res.chargeFin = await chargeMachine(1000);
  const texte = `Mémoire et liens vivants — charge machine ${(res.charge as { occupation: number }).occupation} % au début, ${(res.chargeFin as { occupation: number }).occupation} % à la fin.\n` + tableau(['mesure', 'médiane', '95e c.', 'processeur (méd.)'], lignes) + '\n';
  return { res, texte };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const court = process.argv.includes('--court');
  const { res, texte } = await bancMemoire({ court });
  ecrireResultat(`memoire${court ? '-court' : ''}`, res, texte);
  console.log(texte);
  process.exit(0);
}
