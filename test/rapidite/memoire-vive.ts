// Banc de rapidité : le chemin d'une question au Cerveau (notes Markdown), avec et sans la mémoire vive.
//
//   node --disable-warning=ExperimentalWarning test/rapidite/memoire-vive.ts [--tailles 300,3000,30000] [--n 30]
//
// Pour chaque taille, un Odin jetable rempli de notes inventées (test/rapidite/remplir.ts), puis :
//  1. les étapes à nu, mesurées une à une : lecture des dossiers, date et taille de chaque fichier, lecture des
//     fichiers, découpage (propriétés, liens, étiquettes) ;
//  2. le chemin réel, dans les deux modes (« ancien » : mémoire vive coupée par ODIN_MEMOIRE_VIVE=non, le chemin
//     d'avant ; « vive » : la mémoire vive), l'un juste après l'autre (même minute, même machine) :
//     - à froid : premier tour du Cerveau (lecture de tout), première recherche (index), première consultation ;
//     - à chaud : consultation tant que la liste des notes est valable ;
//     - question espacée (plus de 3 s après la précédente : le cas d'une vraie personne) ;
//     - juste après une note écrite par Odin ;
//     - une note changée sur le disque par quelqu'un d'autre (Obsidian…) : vue tout de suite ? ;
//     - la table des liens vivants juste après une note écrite ;
//     - mémoire prise (tas du processus) et mémoire réservée auprès du comptable.
// La charge du processeur et la mémoire libre sont notées au début et à la fin de chaque taille.
// Les dossiers sont jetables ; aucun n'est le vrai dossier d'Odin.

process.env.ODIN_ESSAI = '1';
process.env.ODIN_NO_VOICE_INSTALL = '1';

import { readdirSync, readFileSync, rmSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chargeMachine, ms, repeter, stat, tableau, ecrireResultat } from './outils.ts';
import { remplir, type Volume } from './remplir.ts';

const vide: Volume = { souvenirs: 0, notes: 0, liens: 0, conversations: 0, messagesParConv: 0, vecteurs: 0, dim: 128 };
const REQUETES = ['sauvegarde du serveur et disque de stockage', 'facture électricité fournisseur', 'projet boutique site internet', 'rendez-vous médecin mariam', 'budget épargne crédit maison', 'panne imprimante bureau réparation'];
const dormir = (t: number) => new Promise((x) => setTimeout(x, t));

/** Décale l'horloge d'Odin (pour jouer « une question 3,5 s plus tard » sans attendre). */
let decalage = 0;
const vraiNow = Date.now;
Date.now = () => vraiNow() + decalage;

function etapes(root: string): Record<string, number> {
  const fichiers: string[] = [];
  const t0 = performance.now();
  const walk = (d: string, p: number) => { if (p > 8) return; for (const e of readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const x = join(d, e.name); if (e.isDirectory()) walk(x, p + 1); else if (e.isFile() && extname(e.name) === '.md') fichiers.push(x); } };
  walk(root, 0);
  const t1 = performance.now();
  for (const f of fichiers) statSync(f);
  const t2 = performance.now();
  const textes = fichiers.map((f) => readFileSync(f, 'utf8'));
  const t3 = performance.now();
  return { fichiers: fichiers.length, lectureDossiersMs: t1 - t0, dateTailleMs: t2 - t1, lectureFichiersMs: t3 - t2, octets: textes.reduce((s, x) => s + x.length, 0) };
}

export async function bancMemoireVive(o: { tailles?: number[]; n?: number } = {}) {
  const tailles = o.tailles ?? [300, 3000, 30000];
  const N = o.n ?? 30;
  const { Vault, parseNote, extractLinks, extractTags } = await import('../../src/brain/vault.ts');
  const { consultBrain } = await import('../../src/brain/contexte.ts');
  const { liensDe } = await import('../../src/brain/liens-vivants.ts');
  const { Mnemosyne } = await import('../../src/muninn/store.ts');
  const res: Record<string, unknown> = {};
  const lignes: Array<Array<string | number>> = [];
  for (const taille of tailles) {
    const chargeDebut = await chargeMachine(1000);
    const r = remplir({ ...vide, notes: taille });
    const root = join(r.home, 'cerveau');
    const e = etapes(root);
    // Découpage seul (sur des textes déjà lus).
    const textes = readdirSync(root, { recursive: true }).map(String).filter((x) => x.endsWith('.md')).slice(0, 20_000).map((x) => readFileSync(join(root, x), 'utf8'));
    const td = performance.now(); for (const t of textes) { const { meta, body } = parseNote(t); extractLinks(body); extractTags(body, meta); } const decoupage = performance.now() - td;
    const parMode: Record<string, unknown> = {};
    for (const mode of ['ancien', 'vive'] as const) {
      if (mode === 'ancien') process.env.ODIN_MEMOIRE_VIVE = 'non'; else delete process.env.ODIN_MEMOIRE_VIVE;
      const ramasser = async () => { for (let i = 0; i < 3; i++) { (globalThis as { gc?: () => void }).gc?.(); await dormir(30); } };
      await ramasser();
      const tas0 = process.memoryUsage().heapUsed;
      const v = new Vault(root);
      const m = new Mnemosyne(join(r.home, `odin-${mode}.db`));
      const l = liensDe(m);
      const ta = performance.now(); v.all(); const froidTour = performance.now() - ta;
      const tb = performance.now(); v.search(REQUETES[0], 30); const froidIndex = performance.now() - tb;
      const tc = performance.now(); consultBrain({ vault: v }, REQUETES[1]); const froidConsult = performance.now() - tc;
      // Laisse la surveillance du dossier se poser (vérification du disque à part), comme dans Odin qui tourne.
      for (let i = 0; i < 40; i++) { const w = (v as unknown as { veille?: unknown }).veille; if (w !== undefined) break; v.all(); await dormir(100); }
      await dormir(300); v.all();
      await ramasser();
      const tas = process.memoryUsage().heapUsed - tas0;
      let k = 0;
      const chaud = await repeter(N, () => consultBrain({ vault: v }, REQUETES[k++ % REQUETES.length]));
      const espacee = await repeter(N, () => { decalage += 3500; return consultBrain({ vault: v }, REQUETES[k++ % REQUETES.length]); });
      const apresEcriture: number[] = [], liensApres: number[] = [];
      l.voisinage(v, undefined);
      for (let i = 0; i < Math.max(5, N / 3); i++) {
        v.write(`Journal/banc-${mode}-${i}`, { type: 'journal' }, `# Banc ${i}\n\nUne ligne écrite par Odin, numéro ${i}.`);
        const t1 = performance.now(); consultBrain({ vault: v }, REQUETES[i % REQUETES.length]); apresEcriture.push(performance.now() - t1);
        const t2 = performance.now(); l.voisinage(v, undefined); liensApres.push(performance.now() - t2);
      }
      // Une note changée sur le disque par quelqu'un d'autre : vue à la question suivante ?
      const vus: boolean[] = [], tempsVu: number[] = [];
      // La préparation faite pendant l'attente (après le changement, avant la question) est comptée avec la question :
      // c'est du travail du processeur pour ce changement, même s'il ne retarde pas la réponse.
      let prepa = 0;
      const vv = v as unknown as { preparer?: () => void };
      if (vv.preparer) { const p0 = vv.preparer.bind(v); vv.preparer = () => { const a = performance.now(); try { p0(); } finally { prepa += performance.now() - a; } }; }
      for (let i = 0; i < 5; i++) {
        const mot = `zorglub${mode}${i}x${taille}`;
        const f = join(root, `externe-${mode}-${i}.md`);
        prepa = 0;
        writeFileSync(f, `# Externe\n\n${mot}\n`);
        await dormir(150); // le temps que le système signale le changement (comme une vraie personne qui tape puis demande)
        const t1 = performance.now(); const trouve = v.search(mot, 5).some((x) => x.note.path === `externe-${mode}-${i}.md`); tempsVu.push(performance.now() - t1 + prepa);
        vus.push(trouve);
        unlinkSync(f); await dormir(150);
        const parti = !v.search(mot, 5).length;
        vus.push(parti);
      }
      const reserveMo = (() => { try { return (v as unknown as { reserveMo?: () => number }).reserveMo?.() ?? 0; } catch { return 0; } })();
      parMode[mode] = { froid: { tourMs: froidTour, indexMs: froidIndex, consultationMs: froidConsult }, tasMo: Math.round(tas / 1048576 * 10) / 10, reserveMo, chaud, espacee, apresEcriture: stat(apresEcriture), liensApresEcriture: stat(liensApres), changementExterieurVu: vus.every(Boolean), tempsQuestionApresChangementExterieur: stat(tempsVu) };
      lignes.push([`${taille} · ${mode} · à froid (tour + index + 1re consultation)`, ms(froidTour + froidIndex + froidConsult), '—', '—']);
      lignes.push([`${taille} · ${mode} · question à chaud`, ms(chaud.temps.mediane), ms(chaud.temps.p95), ms(chaud.cpu.mediane)]);
      lignes.push([`${taille} · ${mode} · question espacée (> 3 s)`, ms(espacee.temps.mediane), ms(espacee.temps.p95), ms(espacee.cpu.mediane)]);
      { const s = stat(apresEcriture); lignes.push([`${taille} · ${mode} · question après une note écrite`, ms(s.mediane), ms(s.p95), '—']); }
      { const s = stat(liensApres); lignes.push([`${taille} · ${mode} · liens vivants après une note écrite`, ms(s.mediane), ms(s.p95), '—']); }
      { const s = stat(tempsVu); lignes.push([`${taille} · ${mode} · question après un changement extérieur, préparation comprise (vu :${vus.every(Boolean) ? 'oui' : 'NON'})`, ms(s.mediane), ms(s.p95), '—']); }
      lignes.push([`${taille} · ${mode} · tas pris par le Cerveau (Mo) / réservé (Mo)`, `${Math.round(tas / 1048576)}`, `${reserveMo}`, '—']);
      try { (v as unknown as { arreterVeille?: () => void }).arreterVeille?.(); (v as unknown as { fermer?: () => void }).fermer?.(); } catch { /* */ }
      try { m.close(); } catch { /* */ }
    }
    delete process.env.ODIN_MEMOIRE_VIVE;
    const chargeFin = await chargeMachine(1000);
    res[taille] = { notesLues: e.fichiers, etapes: { ...e, decoupageMs: decoupage }, modes: parMode, chargeDebut, chargeFin };
    lignes.push([`${taille} · étapes à nu : dossiers ${ms(e.lectureDossiersMs)}, date+taille ${ms(e.dateTailleMs)}, lecture ${ms(e.lectureFichiersMs)}, découpage ${ms(decoupage)}`, '', '', '']);
    lignes.push([`${taille} · charge ${chargeDebut.occupation} % → ${chargeFin.occupation} % ; mémoire libre ${chargeDebut.memoireLibreGo} → ${chargeFin.memoireLibreGo} Go`, '', '', '']);
    try { rmSync(r.home, { recursive: true, force: true, maxRetries: 5 }); } catch { /* */ }
  }
  const texte = `Mémoire vive du Cerveau — ${new Date().toISOString()}\n` + tableau(['mesure', 'médiane', '95e c.', 'processeur (méd.)'], lignes) + '\n';
  return { res, texte };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2), val = (n: string) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  const tailles = val('tailles')?.split(',').map(Number).filter((x) => x > 0);
  const { res, texte } = await bancMemoireVive({ tailles, n: Number(val('n') ?? 30) });
  const nom = val('nom') ?? 'memoire-vive';
  const { SORTIE } = await import('./outils.ts');
  (await import('node:fs')).mkdirSync(join(SORTIE, 'memoire-vive'), { recursive: true });
  ecrireResultat(join('memoire-vive', nom), res, texte);
  console.log(texte);
  process.exit(0);
}
