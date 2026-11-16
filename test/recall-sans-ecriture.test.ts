// Lot B « répondre vite » : recall() ne doit plus écrire sur le disque pendant la réponse. L'usage des
// souvenirs (uses / last_used_at) est mis de côté et rangé en UN bloc en fin de tour (viderUsages). lessons()
// ne doit plus passer par recall() : plus d'écritures ni de fraîcheur/oubli faussés par une simple lecture.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Mnemosyne } from '../src/muninn/store.ts';

const lignes = (dir: string) => { try { return readFileSync(join(dir, 'memories.jsonl'), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };

function neuf(): { m: Mnemosyne; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'odin-recall-'));
  // Un dossier qui finit par un nom simple : la mémoire va dans <dir>/memoire/.
  const m = new Mnemosyne(join(dir, 'base'));
  return { m, dir: join(dir, 'base'), cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }) };
}

test('recall() n\'écrit RIEN sur le chemin de réponse ; l\'usage est rangé en un bloc par viderUsages', () => {
  const { m, dir, cleanup } = neuf();
  try {
    for (let i = 0; i < 8; i++) m.remember(`le serveur de fichiers répond sur le port ${8000 + i}`, 'owner', 'fact', 'serveur reseau');
    const avant = lignes(dir);
    // Plusieurs rappels d'affilée (comme plusieurs lectures dans un tour) : AUCUN ajout au fichier.
    for (let k = 0; k < 5; k++) { const r = m.recall('serveur fichiers port', 6); assert.ok(r.length > 0, 'le rappel trouve des souvenirs'); }
    assert.equal(lignes(dir), avant, 'recall() n\'ajoute aucune ligne au fichier de la mémoire');

    // Fin de tour : un seul bloc écrit, et chaque souvenir touché n'est écrit qu'une fois (pas 5 fois).
    const touches = m.viderUsages();
    assert.ok(touches > 0 && touches <= 6, `viderUsages touche les souvenirs rappelés une seule fois (${touches})`);
    const apres = lignes(dir);
    assert.ok(apres > avant, 'viderUsages écrit bien l\'usage en fin de tour');
    assert.ok(apres - avant <= touches, 'une ligne par souvenir touché au plus, pas une par rappel');

    // Les compteurs d'usage ont bien monté (une fois par souvenir, pas cinq).
    const rows = m.listMemories(50).filter((x) => x.content.includes('serveur de fichiers'));
    assert.ok(rows.some((x) => x.uses >= 1), 'uses a été incrémenté');
    assert.ok(rows.every((x) => x.uses <= 5), 'uses n\'a pas été gonflé plus que le nombre de rappels');

    // viderUsages sans rien en attente ne fait rien.
    assert.equal(m.viderUsages(), 0, 'viderUsages à vide ne touche rien');
    assert.equal(lignes(dir), apres, 'et n\'écrit rien');
  } finally { cleanup(); }
});

test('lessons() ne passe plus par recall() : aucune écriture, et il trouve bien les leçons', () => {
  const { m, dir, cleanup } = neuf();
  try {
    m.remember('ne jamais redémarrer le NAS en pleine sauvegarde', 'owner', 'lesson', 'nas sauvegarde');
    m.remember('penser à vérifier l\'onduleur avant une coupure', 'owner', 'lesson', 'onduleur');
    m.remember('le chat s\'appelle Pixel', 'owner', 'fact', 'chat');
    const avant = lignes(dir);
    const l = m.lessons('redémarrer nas sauvegarde', 6);
    assert.equal(lignes(dir), avant, 'lessons() n\'écrit rien (plus d\'appel à recall)');
    assert.ok(l.some((x) => x.content.includes('NAS')), 'la leçon pertinente est trouvée');
    assert.ok(l.every((x) => x.kind === 'lesson'), 'seules des leçons sont rendues');
    // Et viderUsages n'a rien à faire (lessons ne met aucun usage de côté).
    assert.equal(m.viderUsages(), 0, 'lessons ne met aucun usage de côté');
  } finally { cleanup(); }
});
