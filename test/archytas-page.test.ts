// La fenêtre Script (src/web/pages/archytas.js) avec un faux moteur : la page liste les scripts, en montre un (ce
// qu'il fait + son code), l'édite et le réenregistre ; et le code reste masqué pour un compte qui n'est pas le
// propriétaire. On vérifie aussi la logique pure (sans navigateur).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fauxMoteur, fauxServeur, fauxNavigateur, type ScriptDetail } from './archytas-fixtures.ts';

const src = readFileSync(new URL('../src/web/pages/archytas.js', import.meta.url), 'utf8');
function charger() {
  const nav = fauxNavigateur();
  vm.runInContext(src, vm.createContext(nav.sandbox));
  const win = nav.window as unknown as { OdinArchytas: { logique: Record<string, (x?: unknown) => unknown>; monter: (h: unknown, c?: unknown) => Record<string, (...a: unknown[]) => unknown> & { etat: Record<string, unknown> } }; OdinPages: Record<string, unknown> };
  assert.ok(win.OdinArchytas, 'window.OdinArchytas est posé');
  assert.equal(typeof win.OdinPages.archytas, 'function', 'la page est enregistrée dans OdinPages.archytas');
  return { nav, win };
}

test('archytas : la logique pure (code visible au propriétaire, masqué sinon)', () => {
  const { win } = charger();
  const L = win.OdinArchytas.logique as unknown as {
    peutEditer: (d: unknown) => boolean; apercu: (d: unknown) => { montre: boolean; genre?: string; texte?: string };
    declencheurTexte: (d: unknown) => string; etapesTexte: (e: unknown) => string; dateCourte: (t: number) => string; duree: (m: number | null) => string;
  };
  const code: ScriptDetail = { nom: 'x', mission: 'm', description: 'd', genre: 'code', version: 1, actif: true, cree: 1, modifie: 2, declencheurs: [{ genre: 'manuel' }], stat: { runs: 0, ok: 0, echecs: 0, msMoyen: 0 }, capacites: [], code: 'faire()' };
  assert.equal(L.peutEditer(code), true, 'un détail avec code appartient au propriétaire');
  assert.equal(L.apercu(code).genre, 'code');
  const masque = { ...code } as Partial<ScriptDetail>; delete masque.code;
  assert.equal(L.peutEditer(masque), false, 'sans code ni étapes : pas le propriétaire');
  assert.equal(L.apercu(masque).montre, false);
  assert.match(String(L.apercu(masque).texte), /propriétaire/);
  assert.equal(L.declencheurTexte({ genre: 'horaire', rythme: '7:00' }), 'horaire (7:00)');
  assert.match(L.etapesTexte([{ faire: 'action', module: 'maison', action: 'ouvrir' }]), /maison → ouvrir/);
  assert.equal(L.duree(1500), '1.5 s');
  assert.equal(typeof L.dateCourte(Date.now()), 'string');
});

test('archytas : la page liste les scripts, en montre un, et l\'édite (réenregistré partout)', async () => {
  const { nav, win } = charger();
  const moteur = fauxMoteur();
  const serveur = fauxServeur(moteur);
  nav.brancherServeur(serveur.fetch);
  const host = nav.make('div');
  const ctrl = win.OdinArchytas.monter(host, {});
  await ctrl.recharger();

  // La liste montre tous les noms.
  const texteHost = () => (host as unknown as { textContent: string }).textContent;
  assert.match(texteHost(), /arroser-les-plantes/, 'le nom du premier script apparaît');
  assert.match(texteHost(), /ranger-les-photos/);
  assert.match(texteHost(), /sauvegarde-du-soir/);

  // On ouvre un script : son contenu (code) et sa mission s'affichent.
  await ctrl.choisir('ranger-les-photos');
  assert.equal(ctrl.etat.proprietaire, true, 'le code reçu établit qu\'on est le propriétaire');
  assert.match(texteHost(), /ranger les photos du téléphone/, 'la mission est affichée');
  assert.match(texteHost(), /appeler\("venus", "ranger"/, 'le code est affiché au propriétaire');
  assert.match(texteHost(), /PAS une prison parfaite/, 'l\'avertissement honnête sur le code libre est présent');

  // On édite et on enregistre : la route /editer est appelée, et la nouvelle valeur est reprise.
  await ctrl.ouvrirEditeur();
  assert.equal(ctrl.etat.editeur, true);
  await ctrl.enregistrer({ mission: 'ranger les photos par mois, le soir' });
  const envoi = serveur.journal.find((x) => x.chemin === '/editer');
  assert.ok(envoi, 'un POST /editer a été envoyé');
  assert.deepEqual((envoi!.corps as { patch: { mission: string } }).patch.mission, 'ranger les photos par mois, le soir');
  assert.equal(moteur.data.find((d) => d.nom === 'ranger-les-photos')!.mission, 'ranger les photos par mois, le soir', 'le moteur a bien la nouvelle mission');
  assert.match(texteHost(), /ranger les photos par mois, le soir/, 'la page montre la mission modifiée');
  assert.equal(ctrl.etat.editeur, false, 'l\'éditeur se ferme après l\'enregistrement');
});

test('archytas : pour un compte qui n\'est pas le propriétaire, le code est masqué et « Éditer » absent', async () => {
  const { nav, win } = charger();
  const serveur = fauxServeur(fauxMoteur(), { proprietaire: false });
  nav.brancherServeur(serveur.fetch);
  const host = nav.make('div');
  const ctrl = win.OdinArchytas.monter(host, {});
  await ctrl.recharger();
  await ctrl.choisir('ranger-les-photos');
  const texteHost = (host as unknown as { textContent: string }).textContent;
  assert.equal(ctrl.etat.proprietaire, false, 'sans code servi, ce n\'est pas le propriétaire');
  assert.doesNotMatch(texteHost, /appeler\("venus"/, 'le code n\'est jamais montré');
  assert.match(texteHost, /n'est montré qu'au propriétaire/, 'un message clair remplace le code');
  assert.doesNotMatch(texteHost, /Éditer/, 'pas de bouton Éditer pour un non-propriétaire');
});
