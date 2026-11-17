// Tâches de tous les jours, sans IA : des demandes ordinaires du propriétaire (campagne `test/taches/`) que Logos
// envoyait vers une mauvaise appli, ou ne comprenait pas, alors que la bonne appli sait le faire.
//  - « quel temps fait-il ? » : rien ; « quelle température fait-il dehors ? » : l'état de la machine (Hygie) ;
//  - « mets à jour mes mails » : la mise à jour des signatures de l'antivirus (Asclépios), pour un simple « mets à jour » ;
//  - « améliore ma VM, donne-lui plus de mémoire » : l'état de la machine (Hygie) au lieu des ressources de la VM (Hydre) ;
//  - « cherche-moi un document qui parle de facture » : les paquets réseau (Ariane) au lieu des documents (Plume).
process.env.ODIN_ESSAI = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeOdin } from './helpers.ts';
import { allModules, startValhalla, valhallaOf } from '../src/valhalla/odin.ts';
import { understand } from '../src/valhalla/huginn.ts';

const resume = (u: Awaited<ReturnType<typeof understand>>) => !u ? 'rien' : u.kind === 'action' ? `${u.module}.${u.action}${u.doubt ? ' (doute)' : ''}` : u.kind === 'ask' ? `${u.module}.${u.action} (demande)` : u.kind;

test('tâches de tous les jours : la bonne appli, sans IA', { timeout: 120_000 }, async () => {
  const o = makeOdin([]);
  const stop = startValhalla(o, async () => {}, { modules: allModules(o) });
  try {
    const v = valhallaOf()!;
    let n = 0;
    const vu = async (phrase: string) => resume(await understand(v, phrase, `taches-${n++}`));
    // La météo, dite simplement.
    assert.equal(await vu('quel temps fait-il ?'), 'gladsheim.meteo');
    assert.equal(await vu('quelle température fait-il dehors ?'), 'gladsheim.meteo');
    assert.equal(await vu('donne-moi la météo'), 'gladsheim.meteo');
    // « Mets à jour » tout court n'est plus pris pour les signatures de l'antivirus…
    assert.doesNotMatch(await vu('mets à jour mes mails'), /^ullr\./);
    // … qui se demandent toujours en le disant.
    assert.equal(await vu('mets à jour les signatures'), 'ullr.mettre_a_jour');
    assert.equal(await vu('mets à jour l\'antivirus'), 'ullr.mettre_a_jour');
    // Plus de ressources pour une machine virtuelle : Hydre (la machine est demandée si elle n'est pas nommée).
    assert.match(await vu('améliore ma VM, donne-lui plus de mémoire'), /^ymir\.ressources_machine/);
    // Un document qui parle de quelque chose : Plume.
    assert.match(await vu('cherche-moi un document qui parle de facture'), /^snotra\.chercher/);
    assert.match(await vu('trouve le document sur l\'assurance de la voiture'), /^snotra\.chercher/);
  } finally { stop(); o.cleanup(); }
});
