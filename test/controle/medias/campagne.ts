// Campagne « tout ce qu'Odin reçoit » : chaque fichier fabriqué (fabriquer.ts) passe par CHAQUE porte qui existe
// aujourd'hui, dans un Odin jetable, réseau coupé :
//   - discussion : le fichier est déposé dans inbox/ comme un envoi de l'appli web, la consigne jointe (attachmentHint)
//     part au modèle ; le modèle simulé appelle l'outil que la consigne désigne (ce que ferait un vrai modèle obéissant) ;
//   - métadonnées : l'outil media_info ;
//   - applis : Théia (voir, lire_document), Syrinx (ecouter, parole, musique, sons), Champollion (lire, texte) ;
//   - texte collé : le texte dans le message lui-même, et Champollion « comprendre un texte ».
// Puis : COMPRIS (comparé à la vérité de verite.json), CONTEXTUALISÉ (retrouvable ensuite : mémoire, Brain, « retrouver »
// de Théia/Syrinx, par une phrase de tous les jours), APPRIS (file de Soul, souvenirs), et le fichier gardé ou supprimé.
//
//   node --disable-warning=ExperimentalWarning test/controle/medias/campagne.ts <dossier des fichiers> [dossier des résultats]

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { appel, ouvrir, type Session } from '../banc.ts';
import type { Verite } from './fabriquer.ts';

const SRC = resolve(process.argv[2] ?? 'medias-fabriques');
const OUT = resolve(process.argv[3] ?? join(SRC, '..'));
const verites = JSON.parse(readFileSync(join(SRC, 'verite.json'), 'utf8')) as Verite[];

interface Passage { porte: string; accepte: 'oui' | 'refus clair' | 'non'; sortie: string; ms: number }
interface Bilan { fichier: string; sorte: string; langue?: string; passages: Passage[]; compris: { trouve: string[]; manque: string[]; langueDite: boolean | null }; contexte: { question: string; trouve: string[] }; appris: { fileSoul: number; souvenirs: number; notesBrain: number }; gardeDansInbox: boolean }

const LANGUES: Record<string, RegExp> = { fr: /fran[cç]ais|french|\bfr\b/i, en: /anglais|english|\ben\b/i, ja: /japonais|japanese|\bja\b|日本語/i, ar: /arabe|arabic|\bar\b|عربي/i };
const QUESTIONS: Record<string, string> = {
  'image-facture-fr.png': 'combien je dois pour la facture ?', 'image-en.png': 'à quelle heure ouvre le magasin ?', 'image-ja.png': 'la photo de la gare de Tokyo',
  'photo-gps.jpg': 'la photo de la plage de Ngouja', 'contrat-fr.docx': 'quel est le montant du loyer ?', 'invoice-en.pdf': 'how much is the invoice?', 'budget.xlsx': 'combien pour l\'électricité ?',
  'son-la440.wav': 'le son aigu de tout à l\'heure', 'son-sonnette.wav': 'quand on a sonné à la porte', 'parole-fr.wav': 'le message vocal sur le VPN', 'parole-hesitation-fr.wav': 'le vocal où je demandais de la musique',
  'parole-en.wav': 'the voice note about the plumber', 'musique.mp3': 'la chanson Lagon bleu', 'musique.flac': 'la chanson Lagon bleu', 'musique.m4a': 'la chanson Lagon bleu', 'video-fr.mp4': 'la vidéo de Mamoudzou',
  'texte-long-fr.txt': 'ce que dit le document sur Noûs', 'texte-ja.txt': 'la réunion à Tokyo', 'texte-ar.txt': 'le colis de jeudi', 'texte-piege.txt': 'la prochaine réunion de quartier',
};

const outilDeConsigne = (hint: string): string | undefined => /image_view/.test(hint) ? 'image_view' : /video_analyze/.test(hint) ? 'video_analyze' : /audio_analyze/.test(hint) ? 'audio_analyze' : /doc_read/.test(hint) ? 'doc_read' : /media_info|fs_read/.test(hint) ? 'fs_read' : undefined;
const accepte = (t: string): Passage['accepte'] => (!t || /^\(pas de résultat\)/.test(t) ? 'non' : /VISION SIMULÉE/.test(t) ? 'non' : /^(Erreur|Échec|erreur|Refusé|Action refusée|Entrée invalide)|introuvable|inconnu|n'est pas installé|pas encore|indisponible|non pris en charge|impossible|manquant/i.test(t.slice(0, 220)) ? 'refus clair' : 'oui');
const court = (t: string, n = 400) => t.replace(/\s+/g, ' ').trim().slice(0, n);

/** Une action d'appli. `deposer` : le fichier est d'abord déposé dans l'atelier de l'appli (comme le fait sa page), puis
 *  désigné « atelier:nom » dans le champ `fichier`. */
async function appli(_s: Session, module: string, action: string, input: Record<string, unknown>, deposer?: string): Promise<string> {
  const { valhallaOf } = await import('../../../src/valhalla/odin.ts');
  const v = valhallaOf(); if (!v) return 'Erreur : applis non démarrées';
  if (deposer) {
    const d = v.module(module)?.depot?.(v.ctx(module));
    if (d) { mkdirSync(d.dossier, { recursive: true }); const nom = deposer.split(/[\\/]/).pop()!; copyFileSync(deposer, join(d.dossier, nom)); input = { ...input, fichier: d.ref(nom) }; }
  }
  try { const r = await v.act(module, action, input, { by: 'toi' } as never) as { text?: string } | string; return typeof r === 'string' ? r : String(r?.text ?? JSON.stringify(r)); }
  catch (e) { return `Erreur : ${(e as Error).message}`; }
}

async function unFichier(v: Verite): Promise<Bilan> {
  const { attachmentHint } = await import('../../../src/files/attach.ts');
  const { fileNousOdin } = await import('../../../src/brain/nous/file-odin.ts');
  const { brainOf } = await import('../../../src/tools/brain.ts');
  const inbox = `inbox/2026-11-17-08-00-00-${v.fichier}`;
  const hint = attachmentHint(inbox, '', 1024);
  const outil = outilDeConsigne(hint);
  // Le modèle simulé appelle l'outil désigné ; si l'outil demande à un modèle de VOIR l'image, il reçoit « [VISION SIMULÉE] »
  // (aucun modèle de vision sur ce poste : ce que l'image contient n'est pas mesurable par cette porte).
  const s = await ouvrir({ applis: true, proprietaires: ['moi', 'moi-plus-tard'], script: [...(outil ? [appel(outil, outil === 'video_analyze' ? { source: inbox } : { path: inbox })] : []), { text: '[VISION SIMULÉE]' }, { text: 'Voici ce que contient le fichier.' }, ...Array.from({ length: 6 }, () => ({ text: 'RÉPONSE DU MODÈLE SIMULÉ' }))] });
  const passages: Passage[] = [];
  const fileAvant = fileNousOdin.taille(), souvAvant = s.o.muninn.listMemories(5000).length;
  let notesAvant = 0; try { notesAvant = brainOf({ home: s.o.paths.home, careCfg: s.o.cfg, workspace: s.o.paths.workspace }).all().length; } catch { /* rien */ }
  try {
    mkdirSync(join(s.o.paths.workspace, 'inbox'), { recursive: true });
    const chemin = join(s.o.paths.workspace, inbox);
    copyFileSync(join(SRC, v.fichier), chemin);
    const essai = async (porte: string, f: () => Promise<string>) => { const t0 = performance.now(); let t = ''; try { t = await f(); } catch (e) { t = `Erreur : ${(e as Error).message}`; } passages.push({ porte, accepte: accepte(t), sortie: court(t, 600), ms: Math.round(performance.now() - t0) }); };
    // 1. discussion : la consigne jointe, puis l'outil qu'elle désigne
    await essai(`discussion → ${outil ?? '(aucun outil désigné)'}`, async () => { await s.dire(`Regarde ce fichier et dis-moi ce qu'il contient.\n\n${hint}`); return outil ? (s.resultatOutil(outil) ?? '(pas de résultat)') : `consigne : ${hint}`; });
    // 2. métadonnées
    if (['image', 'photo', 'son', 'parole', 'musique', 'video'].includes(v.sorte)) await essai('outil media_info', async () => { const s2 = s; const t = s2.o.tools.get('media_info'); return t ? String(await t.run({ path: inbox }, { workspace: s.o.paths.workspace, home: s.o.paths.home, isTainted: () => false } as never)) : '(pas d\'outil)'; });
    // 3. applis
    if (v.sorte === 'image' || v.sorte === 'photo') await essai('Théia · voir', () => appli(s, 'theia', 'voir', { question: 'que vois-tu et quel texte est écrit ?' }, chemin));
    if (v.sorte === 'document') await essai('Théia · lire_document', () => appli(s, 'theia', 'lire_document', {}, chemin));
    if (['son', 'parole', 'musique', 'video'].includes(v.sorte)) await essai('Syrinx · écouter', () => appli(s, 'syrinx', 'ecouter', {}, chemin));
    if (v.sorte === 'parole' || v.sorte === 'video') await essai('Syrinx · parole', () => appli(s, 'syrinx', 'parole', {}, chemin));
    if (v.sorte === 'musique') await essai('Syrinx · musique', () => appli(s, 'syrinx', 'musique', {}, chemin));
    if (v.sorte === 'son') await essai('Syrinx · sons', () => appli(s, 'syrinx', 'sons', {}, chemin));
    await essai('Champollion · lire', () => appli(s, 'champollion', 'lire', {}, chemin));
    // 4. texte collé
    if (v.sorte === 'texte') {
      const texte = readFileSync(join(SRC, v.fichier), 'utf8');
      await essai('Champollion · comprendre un texte', () => appli(s, 'champollion', 'texte', { texte }));
      await essai('texte collé dans la discussion', async () => { const r = await s.dire(texte.slice(0, 18_000)); const c = s.contexte(); return `appels modèle : ${r.appelsModele} ; texte donné au modèle en entier : ${c.includes(texte.slice(-60)) ? 'oui' : 'non'} ; marqué extérieur : ${/untrusted|non vérifié/i.test(c) ? 'oui' : 'non'}`; });
    }
    // COMPRIS : comparer à la vérité
    const tout = passages.filter((p) => p.accepte === 'oui').map((p) => p.sortie).join(' \n ');
    const attendus = [...(v.texte ?? []), ...Object.values(v.meta ?? {}).flatMap((m) => m.split(/\s*\(|,|\s+\+/)[0].trim()).filter((m) => m && m.length > 2 && !m.startsWith('(')), ...(v.dit ? v.dit.split(/[\s,?.!]+/).filter((w) => w.length > 4).slice(0, 4) : [])];
    const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const trouve = attendus.filter((a) => norm(tout).includes(norm(a))), manque = attendus.filter((a) => !trouve.includes(a));
    const langueDite = v.langue ? LANGUES[v.langue]?.test(tout) ?? null : null;
    // CONTEXTUALISÉ : une question de tous les jours, après coup
    const q = QUESTIONS[v.fichier] ?? v.fichier;
    const ctx: string[] = [];
    try { const r = s.o.muninn.recall(q, 5); if (r.length) ctx.push(`mémoire : ${court(r[0].content, 80)}`); } catch { /* rien */ }
    try { const b = brainOf({ home: s.o.paths.home, careCfg: s.o.cfg, workspace: s.o.paths.workspace }); const n = b.all().filter((x) => /Odin\/Applis/.test(x.path ?? '') === false && norm(x.body).includes(norm(attendus[0] ?? '§§'))); if (n.length) ctx.push(`Brain : ${n[0].title}`); } catch { /* rien */ }
    if (v.sorte === 'image' || v.sorte === 'photo') { const r = await appli(s, 'theia', 'retrouver', { phrase: q }); if (accepte(r) === 'oui' && r.includes(v.fichier.split('.')[0])) ctx.push(`Théia retrouver : ${court(r, 80)}`); }
    if (['son', 'parole', 'musique', 'video'].includes(v.sorte)) { const r = await appli(s, 'syrinx', 'retrouver', { phrase: q }); if (accepte(r) === 'oui' && !/aucun|rien/i.test(r.slice(0, 80))) ctx.push(`Syrinx retrouver : ${court(r, 80)}`); }
    const rq = await s.dire(q, 'moi-plus-tard'); if (rq.appelsModele === 0 && rq.texte) ctx.push(`réponse sans IA : ${court(rq.texte, 80)}`); else { const c = s.contexte(); if (attendus.some((a) => norm(c).includes(norm(a)))) ctx.push('le contexte donné au modèle contient ce qui avait été lu'); }
    let notesApres = notesAvant; try { notesApres = brainOf({ home: s.o.paths.home, careCfg: s.o.cfg, workspace: s.o.paths.workspace }).all().length; } catch { /* rien */ }
    return {
      fichier: v.fichier, sorte: v.sorte, langue: v.langue, passages,
      compris: { trouve, manque, langueDite },
      contexte: { question: q, trouve: ctx },
      appris: { fileSoul: fileNousOdin.taille() - fileAvant, souvenirs: s.o.muninn.listMemories(5000).length - souvAvant, notesBrain: notesApres - notesAvant },
      gardeDansInbox: existsSync(chemin),
    };
  } finally { s.fermer(); }
}

const res: Bilan[] = [];
const log = console.log, err = console.error;
for (const v of verites.filter((x) => !x.absent)) {
  console.log = () => {}; console.error = () => {};
  const b: Bilan = await unFichier(v).catch((e): Bilan => ({ fichier: v.fichier, sorte: v.sorte, langue: v.langue, passages: [{ porte: 'tout', accepte: 'non' as const, sortie: `Erreur du banc : ${(e as Error).message}`, ms: 0 }], compris: { trouve: [], manque: [], langueDite: null }, contexte: { question: '', trouve: [] }, appris: { fileSoul: 0, souvenirs: 0, notesBrain: 0 }, gardeDansInbox: true }));
  console.log = log; console.error = err;
  res.push(b);
  log(`\n■ ${b.fichier} (${b.sorte}${b.langue ? `, ${b.langue}` : ''}) — compris ${b.compris.trouve.length}/${b.compris.trouve.length + b.compris.manque.length}${b.compris.langueDite === null ? '' : `, langue dite : ${b.compris.langueDite ? 'oui' : 'non'}`} ; retrouvé : ${b.contexte.trouve.length ? 'oui' : 'non'} ; file Soul +${b.appris.fileSoul}, souvenirs +${b.appris.souvenirs}, notes +${b.appris.notesBrain} ; gardé dans inbox : ${b.gardeDansInbox ? 'oui' : 'non'}`);
  for (const p of b.passages) log(`   ${p.accepte === 'oui' ? '✓' : p.accepte === 'refus clair' ? '⊘' : '✗'} ${p.porte.padEnd(34)} ${String(p.ms).padStart(6)} ms  ${p.sortie.slice(0, 200)}`);
  if (b.compris.manque.length) log(`   manque : ${b.compris.manque.join(' · ')}`);
}
mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/:/g, '-').slice(0, 19);
writeFileSync(join(OUT, `campagne-${stamp}.json`), JSON.stringify({ date: new Date().toISOString(), fichiers: res }, null, 1));
log(`\nRésultats : ${join(OUT, `campagne-${stamp}.json`)}`);
process.exit(0);
