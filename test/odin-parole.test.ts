// Ce que dit la mascotte (src/valhalla/parole.ts) : jamais deux fois la même chose, toujours en rapport avec la
// fenêtre ouverte, nourri par l'appli, le Cerveau et la mémoire.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Vault } from '../src/brain/vault.ts';
import { ParoleOdin, type Demande, type Parole, type ParoleDeps } from '../src/valhalla/parole.ts';
import type { Alert, Module, View } from '../src/valhalla/types.ts';

const mod = (m: Partial<Module> & { id: string; name: string }) => ({ family: 'Machines', what: '', does: [], from: [], actions: [], view: () => ({ sections: [] }), ...m }) as unknown as Module;

function monde(dir: string) {
  let derniere = '2026-11-14 22:00';
  const phenix = mod({ id: 'sindri', name: 'Phénix', what: 'Sauvegarde tes dossiers, chiffrés, et les restaure.', actions: [
    { id: 'plans', label: 'Plans de sauvegarde', what: 'Ce qui est sauvegardé, où et quand', read: true, run: () => ({ text: '' }) },
    { id: 'sauvegarder', label: 'Sauvegarder maintenant', what: 'Lance un plan tout de suite', params: [{ key: 'plan', label: 'Plan', kind: 'text', required: true }], run: () => ({ text: '' }) },
    { id: 'verifier', label: 'Vérifier', what: 'Relit le dernier instantané', read: true, run: () => ({ text: '' }) },
    { id: 'creer', label: 'Nouveau plan', what: 'Quoi, où, quand', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }], run: () => ({ text: '' }) },
  ] as Module['actions'] });
  const cerbere = mod({ id: 'garmr', name: 'Cerbère', family: 'Sécurité', what: 'Bannit les adresses qui attaquent tes services.', actions: [
    { id: 'bannis', label: 'Adresses bannies', what: 'La liste des bannis', read: true, run: () => ({ text: '' }) },
    { id: 'bannir', label: 'Bannir', what: 'Bannit une adresse', params: [{ key: 'ip', label: 'Adresse', kind: 'text', required: true }], run: () => ({ text: '' }) },
  ] as Module['actions'] });
  const vault = new Vault(join(dir, 'cerveau'));
  vault.write('Odin/Applis/Phénix', { type: 'fiche' }, '# Phénix\n\n> Sauvegardes.\n\n## Mes notes\n\nLe disque USB bleu sert aux sauvegardes du dimanche.\n');
  vault.create('Disque du bureau', 'note', 'Penser à brancher le disque pour Phénix avant de partir en vacances.');
  const appels = { vault: 0, souvenirs: [] as string[] };
  const alertes: Alert[] = [{ id: 'a1', at: '2026-11-15T08:00:00Z', module: 'garmr', level: 'haute', title: 'Une adresse tape des mots de passe sur SSH', count: 3, steps: ['Regarde la liste des bannis.'] }];
  const deps: ParoleDeps = {
    modules: () => [phenix, cerbere],
    view: (id): View | undefined => (id === 'sindri' ? { sections: [], kpis: [{ label: 'Plans', value: '2' }, { label: 'Dernière réussie', value: derniere }] } : { sections: [] }),
    alerts: (o) => alertes.filter((a) => !o.module || a.module === o.module),
    vault: () => { appels.vault++; return vault; },
    souvenirs: (q) => { appels.souvenirs.push(q); return q === 'Phénix' ? [{ content: 'Le propriétaire veut ses sauvegardes la nuit, jamais le jour.' }] : []; },
    demandes: () => ['Fais-moi le point du réseau'],
    habitudes: () => [{ text: 'Vérifie les sauvegardes', count: 4 }],
    now: () => Date.parse('2026-11-15T10:00:00Z'),
  };
  return { deps, appels, setDerniere: (v: string) => { derniere = v; } };
}

const PAGES: Record<string, Pick<Demande, 'vue' | 'pas' | 'reglage' | 'titre'>> = {
  home: { vue: 'home', titre: 'Aujourd\'hui', pas: ['Ta journée d\'un coup d\'œil.', 'Lis « À faire maintenant » de haut en bas.', 'Les tuiles mènent à leur page.'] },
  settings: { vue: 'settings', titre: 'Réglages', pas: ['Mon modèle, ma voix, mon autonomie.', 'Les rubriques sont à gauche.'], reglage: ['Commence par le Modèle.'] },
  chat: { vue: 'chat', titre: 'Discussion', pas: ['Ici tu me parles.', 'Écris ta demande et appuie sur Entrée.'] },
  brain: { vue: 'brain', titre: 'Cerveau', pas: ['Ton deuxième cerveau.', '« Nouvelle note » ou capture rapide.'] },
};
const cleProp = (p: Parole['propositions'][number]) => JSON.stringify([p.label, p.act?.module, p.act?.action, p.demander, p.ouvrir, p.guide]);

test('parole : jamais deux fois la même chose ni la même proposition, sur 50 demandes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-parole-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { deps } = monde(dir);
  const p = new ParoleOdin(deps, join(dir, 'parole.json'));
  const vues: Demande[] = [{ quand: 'toucher', vue: 'app', appli: 'sindri' }, { quand: 'toucher', vue: 'app', appli: 'garmr' }, { quand: 'toucher', ...PAGES.home }, { quand: 'toucher', ...PAGES.settings }, { quand: 'spontane', ...PAGES.chat, astuces: ['Tu peux me parler au micro.'] }, { quand: 'clic', ...PAGES.brain }];
  const dits = new Set<string>(), props = new Set<string>();
  let silences = 0;
  for (let i = 0; i < 50; i++) {
    const r = await p.parler(vues[i % vues.length]);
    for (const ligne of r.texte.split('\n').filter(Boolean)) { assert.ok(!dits.has(ligne), `répété : ${ligne}`); dits.add(ligne); }
    for (const x of r.propositions) { const k = cleProp(x); assert.ok(!props.has(k), `proposition répétée : ${x.label}`); props.add(k); }
    if (!r.texte) silences++;
  }
  assert.ok(dits.size >= 20, `il a dit des choses utiles (${dits.size})`);
  assert.ok(silences > 0, 'quand il n\'a plus rien de neuf, il se tait');
  // Le carnet est gardé : un nouvel Odin (redémarrage) ne répète pas non plus.
  const q = new ParoleOdin(deps, join(dir, 'parole.json'));
  for (const v of vues) { const r = await q.parler(v); for (const ligne of r.texte.split('\n').filter(Boolean)) assert.ok(!dits.has(ligne), `répété après redémarrage : ${ligne}`); }
});

test('parole : chaque fenêtre a ses propres phrases et propositions', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-parole-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { deps } = monde(dir);
  const p = new ParoleOdin(deps);
  const home = await p.parler({ quand: 'toucher', ...PAGES.home });
  const reglages = await p.parler({ quand: 'toucher', ...PAGES.settings });
  const cerbere = await p.parler({ quand: 'toucher', vue: 'app', appli: 'garmr' });
  assert.notEqual(home.texte, reglages.texte);
  assert.match(home.texte, /Cerbère/, 'à l\'accueil : l\'alerte en cours, avec le nom de l\'appli');
  assert.match(home.texte, /Ta journée/, 'puis la première étape de la page');
  assert.match(reglages.texte, /Étape 1 sur \d+ : Mon modèle/);
  assert.ok(home.propositions.some((x) => x.ouvrir === 'app:garmr'), 'à l\'accueil : ouvrir l\'appli qui alerte');
  assert.ok(cerbere.propositions.some((x) => x.act?.module === 'garmr'), 'dans Cerbère : ses propres actions');
  assert.ok(!reglages.propositions.some((x) => x.act), 'dans les Réglages : pas d\'action d\'une appli');
  // La fois suivante sur la même page : l'étape d'après, pas la même.
  const encore = await p.parler({ quand: 'toucher', ...PAGES.settings });
  assert.match(encore.texte, /Étape 2 sur/);
});

test('parole : dans une appli précise, Odin parle de cette appli (ex. Phénix et sa dernière sauvegarde)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-parole-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { deps, setDerniere } = monde(dir);
  const p = new ParoleOdin(deps);
  const r = await p.parler({ quand: 'toucher', vue: 'app', appli: 'sindri' });
  assert.match(r.texte, /Phénix/);
  assert.match(r.texte, /Dernière réussie » : 2026-11-14 22:00\. Veux-tu « Sauvegarder maintenant »/);
  assert.ok(r.propositions.some((x) => /Sauvegarder maintenant/.test(x.label)), 'il propose de lancer une sauvegarde');
  assert.ok(!/Cerbère/.test(r.texte), 'rien sur une autre appli');
  // Une nouvelle sauvegarde : la nouvelle date est une nouvelle phrase ; l'ancienne ne revient pas.
  setDerniere('2026-11-15 09:30');
  const r2 = await p.parler({ quand: 'clic', vue: 'app', appli: 'sindri' });
  assert.match(r2.texte, /2026-11-15 09:30/);
  const r3 = await p.parler({ quand: 'clic', vue: 'app', appli: 'sindri' });
  assert.doesNotMatch(r3.texte, /2026-11-1[45]/);
});

test('parole : le Cerveau et la mémoire sont consultés', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-parole-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { deps, appels } = monde(dir);
  const p = new ParoleOdin(deps);
  const tout: string[] = [];
  for (let i = 0; i < 6; i++) tout.push((await p.parler({ quand: 'toucher', vue: 'app', appli: 'sindri' })).texte);
  const texte = tout.join('\n');
  assert.ok(appels.vault > 0, 'le Cerveau est ouvert');
  assert.ok(appels.souvenirs.includes('Phénix'), 'la mémoire est interrogée sur l\'appli ouverte');
  assert.match(texte, /Dans tes notes sur Phénix : « Le disque USB bleu/, 'ce que tu as noté sur la fiche de l\'appli');
  assert.match(texte, /Ta note « Disque du bureau » parle de Phénix/, 'tes notes qui parlent de l\'appli');
  assert.match(texte, /Je me souviens : Le propriétaire veut ses sauvegardes la nuit/);
  // Dans la Discussion : ce qui revient souvent dans tes demandes.
  const chat = await p.parler({ quand: 'spontane', ...PAGES.chat });
  assert.match(chat.texte, /Vérifie les sauvegardes/);
  assert.ok(chat.propositions.some((x) => /planifi/i.test(x.demander ?? '')));
});

test('parole : sans rien de neuf, il le dit une seule fois puis se tait', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-parole-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = new ParoleOdin({ modules: () => [] });
  const page: Demande = { quand: 'toucher', vue: 'missions', titre: 'Activité', pas: ['Ce que je fais.'] };
  assert.match((await p.parler(page)).texte, /Ce que je fais/);
  const une = await p.parler(page);
  assert.match(une.texte, /l'essentiel sur Activité/);
  for (let i = 0; i < 5; i++) assert.equal((await p.parler(page)).texte, '', 'puis il se tait');
  assert.equal((await p.parler({ quand: 'spontane', vue: 'missions' })).texte, '', 'tout seul : rien à dire, il ne dit rien');
});
