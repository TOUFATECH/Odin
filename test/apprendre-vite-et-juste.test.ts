// Corrections « Odin apprend de tout et répond vite » :
//  3) un fait « à vérifier » devient « confirmé » à la revérification (la confiance n'est plus gelée) ;
//  4) Noûs est nourri PAR NIVEAU : un fait Internet non confirmé n'entre jamais dans le corpus fiable ;
//  5) aucun secret n'est écrit en clair dans muninn (échange / audio / fichier) ;
//  6) le Cerveau ne reconstruit pas son index de recherche à froid quand les notes n'ont pas changé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apprendreDeTout, type DepsApprentissage } from '../src/learn/apprendre-de-tout.ts';
import { fileBornee, type FileApprentissage, type NoosDeps } from '../src/brain/nous/deps.ts';
import { Mnemosyne } from '../src/muninn/store.ts';
import { Vault } from '../src/brain/vault.ts';

const NOW = Date.UTC(2026, 10, 16, 9);

function monter(): { deps: DepsApprentissage; muninn: Mnemosyne; file: FileApprentissage } {
  const muninn = new Mnemosyne(':memory:');
  const file = fileBornee();
  const nous: NoosDeps = {
    cfg: { learning: { observe: true }, nous: { actif: true } },
    privateMode: () => muninn.privateMode,
    demo: false,
    essai: false, // on force : sinon NODE_TEST_CONTEXT tairait nourrir()
    file,
    maintenant: () => NOW,
  };
  return { deps: { memoire: muninn, nous, maintenant: () => NOW }, muninn, file };
}

test('défaut 3 — revérification : « à vérifier » monte en « confirmé » (confiance plus gelée)', () => {
  const { deps, muninn } = monter();
  const fait = { texte: 'Le cuivre recyclé se revend autour de huit le kilo.', sujet: 'cuivre', cle: 'prix' };
  // Jour 1 : une seule source → « à vérifier » (quarantaine, hors du rappel courant).
  const r1 = apprendreDeTout(deps, { sorte: 'lecture', source: 'web:prix.fr', date: NOW, maintenant: NOW, faits: [{ ...fait, verdict: { verdict: 'probable', independent: 1 } }] });
  assert.deepEqual(r1.niveaux, ['à vérifier']);
  const id = r1.souvenirs[0];
  assert.equal(muninn.getMemory(id)?.origin, 'untrusted');
  // Jour 2 : MÊME source, MÊME contenu, mais 3 groupes indépendants concordent → « confirmé », et PAS ignoré.
  const r2 = apprendreDeTout(deps, { sorte: 'lecture', source: 'web:prix.fr', date: NOW, maintenant: NOW + 3_600_000, faits: [{ ...fait, verdict: { verdict: 'confirmé', independent: 3 } }] });
  assert.equal(r2.retenus, 1, 'la montée de confiance est reprise, pas ignorée');
  assert.deepEqual(r2.niveaux, ['confirmé']);
  // Le MÊME souvenir est passé en « agent » : il sort de la quarantaine et redevient rappelable.
  assert.equal(muninn.getMemory(id)?.origin, 'agent');
  assert.ok(muninn.recall('cuivre prix', 6).some((m) => m.id === id), 'désormais rappelable');
});

test('défaut 3 — même source, même contenu, même niveau : toujours ignoré (pas de ré-absorption)', () => {
  const { deps } = monter();
  const apport = { sorte: 'lecture' as const, source: 'web:stable.fr', date: NOW, maintenant: NOW, faits: [{ texte: 'Un fait stable qui ne bouge pas.', sujet: 's', cle: 'c', verdict: { verdict: 'confirmé' as const, independent: 2 } }] };
  assert.equal(apprendreDeTout(deps, apport).retenus, 1);
  const r2 = apprendreDeTout(deps, apport);
  assert.equal(r2.retenus, 0);
  assert.equal(r2.ignores, 1);
});

test('défaut 4 — Noûs par niveau : un fait non confirmé mêlé à un confirmé n’entre jamais dans le corpus fiable', () => {
  const { deps, file } = monter();
  apprendreDeTout(deps, {
    sorte: 'lecture', source: 'web:mix.fr', date: NOW,
    faits: [
      { texte: 'Paris est la capitale de la France.', sujet: 'france', cle: 'capitale', verdict: { verdict: 'confirmé', independent: 3 } },
      { texte: 'Il pleuvra demain selon un blog personnel.', sujet: 'meteo', cle: 'demain', verdict: { verdict: 'probable', independent: 1 } },
    ],
  });
  const ex = file.prendre(10);
  // Aucun exemple fiable ne contient le fait « à vérifier ».
  for (const e of ex) {
    if (e.fiable) assert.ok(!e.texte.includes('pleuvra'), 'le fait « à vérifier » reste hors du corpus fiable');
  }
  assert.ok(ex.some((e) => e.fiable && e.texte.includes('capitale')), 'le confirmé est fiable');
  assert.ok(ex.some((e) => !e.fiable && e.texte.includes('pleuvra')), 'le non confirmé apprend seulement la langue');
});

test('défaut 5 — vie privée : un secret dans un échange n’est jamais écrit en clair dans muninn', () => {
  const { deps, muninn } = monter();
  const r = apprendreDeTout(deps, {
    sorte: 'correction', source: 'conversation:7',
    faits: [{ texte: 'Écris-moi à secret.perso@exemple.fr pour le rendez-vous.', sujet: 'proprietaire', cle: 'contact' }],
  });
  assert.equal(r.retenus, 1);
  const contenu = muninn.getMemory(r.souvenirs[0])?.content ?? '';
  assert.ok(!contenu.includes('secret.perso@exemple.fr'), 'l’e-mail n’est pas en clair');
  assert.ok(contenu.includes('[masqué]'), 'la place du secret est marquée');
});

test('défaut 6 — Cerveau : l’index de recherche n’est pas reconstruit à froid quand rien n’a changé', () => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-vite-'));
  try {
    const v = new Vault(dir);
    v.write('Serveur', { type: 'note' }, 'Le NAS répond sur le port 8080.');
    const a = v.all();
    // Rafraîchir le cache (force) quand rien n’a bougé RÉUTILISE le même tableau d’objets-notes : c’est cette
    // identité que search() teste pour NE PAS reconstruire l’index inversé entre deux demandes espacées.
    const b = v.all(true);
    assert.equal(a, b, 'tableau de notes réutilisé quand rien n’a bougé');
    // Un vrai changement renouvelle le tableau (l’index se reconstruira alors, à juste titre).
    v.write('Routeur', { type: 'note' }, 'La box et le wifi.');
    const c = v.all(true);
    assert.notEqual(c, b, 'un vrai changement renouvelle le tableau');
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); }
});
