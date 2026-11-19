// La fusion des anciennes conversations du propriétaire dans sa conversation unique (« Les fondre en une ») : une
// copie de sécurité relue d'abord, une marque à part pour chacune (jamais un message déplacé ni réécrit), une seule
// fois, et la commande « odin conversation defondre » qui rend l'état d'avant sans toucher la copie. Le fil
// (GET /api/fil) rend exactement les mêmes messages, dans le même ordre, avant et après. Rien ne change pour un membre.
// Une mémoire d'essai dans un dossier temporaire ; un vrai démarrage d'Odin (createOdin) pour la ligne du démarrage.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Mnemosyne } from '../src/muninn/store.ts';
import { filDe } from '../src/web/fil-api.ts';
import { createOdin } from '../src/runtime.ts';
import { DOSSIER_COPIE, MARQUE_ECHEC, MARQUE_FUSION, PREFIXE_FONDUE, defondre, fondreConversations, messageEchec, type MarqueFondue, type MarqueFusion } from '../src/migrations/conversation-unique.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const neuf = () => { const d = mkdtempSync(join(tmpdir(), 'odin-fusion-')); dossiers.push(d); return d; };

/** Ajoute un message à une date choisie (la mémoire date chaque message à l'instant de l'écriture). */
function ecrire(mu: Mnemosyne, session: string, role: 'user' | 'assistant', texte: string, date: number): void {
  const vrai = Date.now; Date.now = () => date;
  try { mu.addMessage(session, { role, content: texte }); } finally { Date.now = vrai; }
}

const T0 = 1_800_000_000_000;
/** Une mémoire avec la conversation principale, deux anciennes, un membre, une messagerie, un écran, les raccourcis. */
function memoire(dir: string): Mnemosyne {
  const mu = new Mnemosyne(dir);
  for (const [id, ch] of [['web:principal', 'web'], ['web:c-ancienne1', 'web'], ['web:c-ancienne2', 'web'], ['web:membre-camille', 'web'], ['telegram:42', 'telegram'], ['web:maison', 'web'], ['web:raccourci', 'web']] as const) mu.ensureSession(id, ch, id.split(':')[1]);
  ecrire(mu, 'web:c-ancienne1', 'user', 'allume le salon', T0 + 1); ecrire(mu, 'web:c-ancienne1', 'assistant', 'fait', T0 + 2);
  ecrire(mu, 'web:c-ancienne2', 'user', 'état de la box', T0 + 3); ecrire(mu, 'web:c-ancienne2', 'assistant', 'en ligne', T0 + 4);
  ecrire(mu, 'web:principal', 'user', 'bonjour', T0 + 5); ecrire(mu, 'web:c-ancienne1', 'user', 'et la cuisine', T0 + 6);
  ecrire(mu, 'web:principal', 'assistant', 'bonjour Alex', T0 + 7);
  mu.addMessage('web:principal', { role: 'tool', content: 'sortie d\'outil', toolName: 'shell' });
  ecrire(mu, 'web:membre-camille', 'user', 'texte de camille', T0 + 8);
  ecrire(mu, 'telegram:42', 'user', 'depuis la messagerie', T0 + 9);
  ecrire(mu, 'web:maison', 'user', 'depuis l\'écran maison', T0 + 10);
  ecrire(mu, 'web:raccourci', 'user', 'depuis un raccourci', T0 + 11);
  mu.setKv('title:c-ancienne1', 'Lumières de la maison');
  return mu;
}

/** Tout ce qui compte pour « rien n'a bougé » : les fichiers des conversations, octet pour octet, et les deux fils. */
function etat(dir: string, mu: Mnemosyne) {
  const fichier = (f: string) => readFileSync(join(dir, f), 'utf8');
  return {
    messages: fichier('messages.jsonl'), sessions: fichier('sessions.jsonl'),
    filProprio: JSON.stringify(filDe(mu, { proprio: true }, { n: 200 })), filMembre: JSON.stringify(filDe(mu, { login: 'camille' }, { n: 200 })),
    kvSansMigration: JSON.stringify(Object.entries(mu.kvPrefix('')).filter(([k]) => k !== MARQUE_FUSION).sort()),
  };
}
const copies = (dir: string) => readdirSync(dir).filter((f) => f.startsWith(DOSSIER_COPIE));
const marques = (mu: Mnemosyne) => Object.keys(mu.kvPrefix(PREFIXE_FONDUE)).sort();

test('la fusion : copie relue d\'abord, une marque par ancienne conversation, aucun message déplacé, le fil identique', () => {
  const dir = neuf(), mu = memoire(dir);
  const avant = etat(dir, mu);
  const r = fondreConversations({ mu, maintenant: () => T0 + 100 });
  assert.equal(r.fait, true);
  assert.deepEqual([r.sessions, r.messages], [2, 5]);
  assert.deepEqual(marques(mu), ['web:c-ancienne1', 'web:c-ancienne2'], 'ni la principale, ni un membre, ni une messagerie, ni un écran, ni les raccourcis');
  const m1 = JSON.parse(mu.getKv(`${PREFIXE_FONDUE}web:c-ancienne1`)!) as MarqueFondue;
  assert.deepEqual([m1.titre, m1.debut, m1.messages], ['Lumières de la maison', T0 + 1, 3], 'le titre renommé et la date du premier message');
  const apres = etat(dir, mu);
  assert.equal(apres.messages, avant.messages, 'aucun message touché sur le disque');
  assert.equal(apres.sessions, avant.sessions, 'aucune session touchée sur le disque');
  assert.equal(apres.filProprio, avant.filProprio, 'le fil du propriétaire : les mêmes messages, dans le même ordre');
  assert.equal(apres.filMembre, avant.filMembre, 'rien ne change pour un membre');
  // La copie : tous les fichiers de la mémoire, tels quels.
  assert.deepEqual(copies(dir), [`${DOSSIER_COPIE}-${new Date(T0 + 100).toISOString().slice(0, 10)}`]);
  const marque = JSON.parse(mu.getKv(MARQUE_FUSION)!) as MarqueFusion;
  assert.equal(marque.etat, 'fondue'); assert.equal(marque.copie, copies(dir)[0]);
  assert.equal(readFileSync(join(dir, marque.copie!, 'messages.jsonl'), 'utf8'), avant.messages, 'la copie des messages, octet pour octet');
  // Une mémoire rouverte (redémarrage) lit la même chose.
  const relue = new Mnemosyne(dir);
  assert.equal(JSON.stringify(filDe(relue, { proprio: true }, { n: 200 })), avant.filProprio);
});

test('une seule fois : un deuxième démarrage ne refait rien (ni copie, ni marque)', () => {
  const dir = neuf(), mu = memoire(dir);
  fondreConversations({ mu });
  const avant = { ...etat(dir, mu), marque: mu.getKv(MARQUE_FUSION) };
  ecrire(mu, 'web:c-tardive', 'user', 'ouverte par une vieille page', T0 + 50);
  const r = fondreConversations({ mu });
  assert.deepEqual([r.fait, r.raison], [false, 'deja']);
  assert.equal(copies(dir).length, 1, 'pas de deuxième copie');
  assert.equal(mu.getKv(MARQUE_FUSION), avant.marque);
  assert.deepEqual(marques(mu), ['web:c-ancienne1', 'web:c-ancienne2'], 'rien de plus marqué');
});

test('défaire rend l\'état d\'avant, sans toucher la copie ; et la fusion ne revient pas toute seule', () => {
  const dir = neuf(), mu = memoire(dir);
  const avant = etat(dir, mu);
  fondreConversations({ mu });
  const copie = copies(dir)[0], contenuCopie = readdirSync(join(dir, copie)).map((f) => readFileSync(join(dir, copie, f), 'utf8'));
  const d = defondre(mu);
  assert.deepEqual([d.fait, d.sessions, d.copie], [true, 2, copie]);
  assert.deepEqual(marques(mu), [], 'les marques « fondue » retirées');
  assert.deepEqual(etat(dir, mu), avant, 'messages, sessions, fils et réglages : comme avant la fusion');
  assert.equal((JSON.parse(mu.getKv(MARQUE_FUSION)!) as MarqueFusion).etat, 'defondue', 'gardé pour ne pas refondre au démarrage suivant');
  assert.deepEqual(readdirSync(join(dir, copie)).map((f) => readFileSync(join(dir, copie, f), 'utf8')), contenuCopie, 'la copie intacte');
  assert.equal(fondreConversations({ mu }).raison, 'deja', 'pas de nouvelle fusion au démarrage suivant');
  assert.deepEqual(marques(mu), []);
  assert.equal(defondre(mu).raison, 'deja-defondue');
  assert.equal(defondre(new Mnemosyne(neuf())).raison, 'pas-fondue');
});

test('copie ratée (disque plein) : rien ne change, Odin le dit une fois, et réessaie au démarrage suivant', () => {
  const dir = neuf(), mu = memoire(dir);
  const avant = etat(dir, mu);
  const plein = () => { throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); };
  const r = fondreConversations({ mu, langue: 'en', copier: plein });
  assert.deepEqual([r.fait, r.raison], [false, 'copie']);
  assert.deepEqual(marques(mu), []); assert.equal(mu.getKv(MARQUE_FUSION), undefined);
  const apres = etat(dir, mu);
  assert.equal(apres.messages, avant.messages); assert.equal(apres.sessions, avant.sessions);
  assert.equal(apres.filProprio, avant.filProprio); assert.equal(apres.filMembre, avant.filMembre);
  assert.deepEqual(copies(dir), [], 'la copie incomplète retirée');
  assert.deepEqual(JSON.parse(mu.getKv('deferred')!), [messageEchec('en')], 'dit une fois, dans la langue du propriétaire');
  fondreConversations({ mu, langue: 'en', copier: plein });
  assert.deepEqual(JSON.parse(mu.getKv('deferred')!), [messageEchec('en')], 'pas redit au démarrage suivant');
  // Le disque a de la place : la fusion se fait, la marque d'échec part.
  assert.equal(fondreConversations({ mu }).fait, true);
  assert.equal(mu.getKv(MARQUE_ECHEC), undefined);
  assert.equal(etat(dir, mu).filProprio, avant.filProprio);
});

test('copie différente de l\'original (relue, tronquée) : rien ne change', () => {
  const dir = neuf(), mu = memoire(dir);
  const avant = etat(dir, mu);
  const tronquer = (de: string, vers: string) => { const t = readFileSync(de, 'utf8'); writeFileSync(vers, t.slice(0, Math.floor(t.length / 2))); };
  assert.equal(fondreConversations({ mu, copier: tronquer }).raison, 'copie');
  assert.deepEqual(marques(mu), []); assert.equal(mu.getKv(MARQUE_FUSION), undefined);
  assert.equal(etat(dir, mu).messages, avant.messages);
  assert.deepEqual(copies(dir), []);
  // Copie de la même taille mais un message perdu (ligne remplacée) : vu à la relecture.
  const perdre = (de: string, vers: string) => {
    const t = readFileSync(de, 'utf8');
    writeFileSync(vers, de.endsWith('messages.jsonl') ? t.split('\n').map((l) => (l.includes('allume le salon') ? ' '.repeat(l.length) : l)).join('\n') : t);
  };
  assert.equal(fondreConversations({ mu, copier: perdre }).raison, 'copie');
  assert.deepEqual(marques(mu), []); assert.deepEqual(copies(dir), []);
});

test('rien à fondre : la marque seule, aucune copie ; les raccourcis du téléphone seulement si le réglage est activé', () => {
  const dir = neuf(), mu = new Mnemosyne(dir);
  ecrire(mu, 'web:principal', 'user', 'bonjour', T0);
  assert.equal(fondreConversations({ mu }).raison, 'rien');
  assert.equal((JSON.parse(mu.getKv(MARQUE_FUSION)!) as MarqueFusion).etat, 'rien');
  assert.deepEqual(copies(dir), []);
  const dir2 = neuf(), mu2 = memoire(dir2);
  fondreConversations({ mu: mu2, inclureRaccourci: true });
  assert.deepEqual(marques(mu2), ['web:c-ancienne1', 'web:c-ancienne2', 'web:raccourci'], 'le réglage prévu (désactivé par défaut)');
});

test('défaire quand il n\'y avait rien à fondre : rien à défaire, la marque reste « rien »', () => {
  const dir = neuf(), mu = new Mnemosyne(dir);
  ecrire(mu, 'web:principal', 'user', 'bonjour', T0);
  fondreConversations({ mu });
  const marque = mu.getKv(MARQUE_FUSION);
  const d = defondre(mu);
  assert.deepEqual([d.fait, d.raison, d.sessions], [false, 'pas-fondue', 0]);
  assert.equal(mu.getKv(MARQUE_FUSION), marque, 'la marque « rien » inchangée');
});

test('au démarrage d\'Odin : fondu au premier, rien au second ; « odin conversation defondre » rend l\'état d\'avant', () => {
  const home = neuf();
  { const mu = memoire(join(home, 'memoire')); void mu; }
  const o1 = createOdin({ home });
  const avant = etat(join(home, 'memoire'), o1.muninn);
  assert.deepEqual(marques(o1.muninn), ['web:c-ancienne1', 'web:c-ancienne2'], 'fondu au démarrage');
  o1.close();
  const o2 = createOdin({ home });
  assert.equal(copies(join(home, 'memoire')).length, 1, 'le second démarrage ne refait pas la copie');
  const second = etat(join(home, 'memoire'), o2.muninn);
  assert.deepEqual([second.messages, second.filProprio, second.filMembre], [avant.messages, avant.filProprio, avant.filMembre]);
  assert.deepEqual(marques(o2.muninn), ['web:c-ancienne1', 'web:c-ancienne2']);
  o2.close();
  const cli = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(import.meta.dirname, '..', 'src', 'cli', 'main.ts'), 'conversation', 'defondre'], { env: { ...process.env, ODIN_HOME: home }, encoding: 'utf8', timeout: 90_000 });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /2/);
  const relue = new Mnemosyne(join(home, 'memoire'));
  assert.deepEqual(marques(relue), [], 'marques retirées par la commande');
  assert.equal((JSON.parse(relue.getKv(MARQUE_FUSION)!) as MarqueFusion).etat, 'defondue');
  assert.ok(existsSync(join(home, 'memoire', copies(join(home, 'memoire'))[0], 'messages.jsonl')), 'la copie reste');
});
