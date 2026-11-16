// Archytas — « gardé de partout » : un script est relié à la mémoire, au Cerveau et à Noûs, mais JAMAIS son
// code ni un secret (résumé masqué). La suppression nettoie la mémoire et la note du Cerveau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lienDepuis, masquer, type MuninnRef, type VaultRef, type NoosRef } from '../src/valhalla/archytas/liens.ts';
import type { ScriptDetail } from '../src/valhalla/archytas/scripts.ts';

const detail = (): ScriptDetail => ({
  nom: 'Sauver mes photos', mission: 'copier les photos vers le NAS, mot de passe: hunter2', description: 'contacte a@b.com au 06 12 34 56 78',
  genre: 'code', code: 'const SECRET = "sk-ABCDEF0123456789"; fetch("http://exfiltrer");',
  version: 1, actif: true, cree: Date.UTC(2026, 10, 16), modifie: Date.UTC(2026, 10, 16),
  declencheurs: [{ genre: 'evenement', module: 'camera', type: 'photo' }], stat: { runs: 3, ok: 2, echecs: 1, msMoyen: 12 }, capacites: [],
});

test('masquer : e-mail, téléphone, IBAN, carte, jeton, mot de passe', () => {
  const t = masquer('écris à a@b.com au 06 12 34 56 78, mot de passe: hunter2, jeton sk-ABCDEF0123456789');
  assert.doesNotMatch(t, /a@b\.com/);
  assert.doesNotMatch(t, /hunter2/);
  assert.doesNotMatch(t, /sk-ABCDEF/);
  assert.doesNotMatch(t, /06 12 34 56 78/);
});

test('enregistrer : la mémoire et le Cerveau reçoivent un résumé masqué, JAMAIS le code ni un secret', () => {
  const souvenirs: Array<{ content: string; subject?: string }> = [];
  const notes: Array<{ path: string; body: string; meta: Record<string, unknown> }> = [];
  const aliments: string[] = [];
  const muninn: MuninnRef = { remember: (content, _o, _k, _t, meta) => { souvenirs.push({ content, subject: meta.subject }); return { id: 1 }; } };
  const vault: VaultRef = { write: (path, meta, body) => { notes.push({ path, body, meta }); return path; }, trash: () => '' };
  const noos: NoosRef = { nourrir: (x) => aliments.push(x.texte) };

  const lien = lienDepuis({ home: '/tmp/x', muninn, vault, noos, nomAppli: (id) => (id === 'camera' ? 'Himinbjörg' : id) });
  lien.enregistrer(detail());

  const toutTexte = JSON.stringify(souvenirs) + JSON.stringify(notes) + JSON.stringify(aliments);
  assert.doesNotMatch(toutTexte, /sk-ABCDEF/, 'le code ne fuite nulle part');
  assert.doesNotMatch(toutTexte, /fetch\(/, 'le code ne fuite nulle part');
  assert.doesNotMatch(toutTexte, /hunter2/, 'le mot de passe est masqué');
  assert.doesNotMatch(toutTexte, /a@b\.com/, 'l\'e-mail est masqué');

  // La mémoire a bien un souvenir du script (sujet « script:<nom> »).
  assert.equal(souvenirs.length, 1);
  assert.equal(souvenirs[0].subject, 'script:Sauver mes photos');
  assert.match(souvenirs[0].content, /Archytas/);
  // La note du Cerveau relie la fiche de l'appli utilisée (par son nom affiché), jamais le code.
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, /\[\[Himinbjörg\]\]/);
  assert.doesNotMatch(notes[0].body, /SECRET|fetch/);
});

test('oublier : la mémoire et la note du Cerveau sont nettoyées', () => {
  const oublies: string[] = [];
  const corbeille: string[] = [];
  const muninn: MuninnRef = { remember: () => ({ id: 1 }), oublierSujet: (subject) => { oublies.push(subject); return 1; } };
  const vault: VaultRef = { write: () => '', trash: (path) => { corbeille.push(path); return path; } };

  const lien = lienDepuis({ home: '/tmp/x', muninn, vault });
  lien.oublier('Sauver mes photos');

  assert.deepEqual(oublies, ['script:Sauver mes photos']);
  assert.equal(corbeille.length, 1);
  assert.match(corbeille[0], /Archytas\/Sauver mes photos/);
});

test('sans deps : le lien est un no-op sûr (ne lève jamais)', () => {
  const lien = lienDepuis();
  assert.doesNotThrow(() => { lien.enregistrer(detail()); lien.oublier('x'); });
});
