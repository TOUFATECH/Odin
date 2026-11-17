// Tâches de tous les jours, SANS AUCUN MODÈLE (passage 2 de la campagne `test/taches/`) : ce que le propriétaire reçoit.
//  1. Un doute sans rapport ne lance plus d'action (« restaurant » → restaurer une sauvegarde de Phénix ; « crée-moi une VM
//     Debian » → Andromède · Suivre ; « crée un conteneur et essaie… » → Argo · Régler la mise à l'échelle).
//  2. Home Assistant ne passe plus avant une appli qui porte la demande (« éteins la VM » → Hydre, pas « Je n'arrive pas
//     à joindre Home Assistant »).
//  3. Ce qu'Odin ne sait pas encore faire est dit franchement, avec ce qu'il sait faire de proche.
//  4. Plus de texte écrit pour le modèle (enveloppe « untrusted », « Ne la retente pas… ») ; une validation dit ce
//     qu'elle fait en mots de tous les jours. Les validations restent les mêmes.
//  5. Logos : « restaurant », le « -moi » collé au verbe, « récupère l'image », la ville de la météo.
//  6. Une demande dans une autre langue n'est jamais devinée vers une appli.
process.env.ODIN_ESSAI = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrir, type Session } from './controle/banc.ts';
import { fakeEngine } from './helpers.ts';
import { useEngine } from '../src/valhalla/modules/naglfar.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { understand } from '../src/valhalla/huginn.ts';
import { resumeAppli } from '../src/tools/valhalla.ts';

const PROPRIOS = Array.from({ length: 40 }, (_, i) => `p${i}`);
async function sansModele(): Promise<Session> {
  useEngine(() => fakeEngine([{ Names: 'samba', Image: 'dperson/samba', State: 'running' }, { Names: 'web', Image: 'nginx:1.27', State: 'running' }]));
  const s = await ouvrir({ applis: true, proprietaires: PROPRIOS });
  s.o.agent.deps.offlineOnly = true;
  // Le dépôt de travail a des garde-fous en cours de modification : l'intégrité est coupée dans cet Odin jetable seulement.
  (s.o.heimdall as unknown as { integrite?: unknown }).integrite = undefined;
  return s;
}
let n = 0;
const dire = async (s: Session, phrase: string) => {
  (s.o.heimdall as unknown as { ecrituresRecentes?: number[] }).ecrituresRecentes = [];
  const v0 = s.validations.length;
  const r = await s.dire(phrase, PROPRIOS[n++ % PROPRIOS.length]);
  await new Promise((ok) => setTimeout(ok, 30));
  return { texte: r.texte, validations: s.validations.slice(v0).map((x) => x.texte) };
};

test('sans modèle : franchise, bonne appli, présentation propre, validations gardées', { timeout: 120_000 }, async () => {
  const s = await sansModele();
  try {
    // 1 et 3. Réserver : franchise, aucune action de sauvegarde proposée.
    let r = await dire(s, 'fais-moi une réservation au restaurant pour samedi soir');
    assert.match(r.texte, /Je ne sais pas encore réserver/); assert.doesNotMatch(r.texte, /Phénix|Restaurer/); assert.equal(r.validations.length, 0);
    r = await dire(s, 'réserve-moi une table pour deux demain à 20h');
    assert.match(r.texte, /Je ne sais pas encore réserver/); assert.doesNotMatch(r.texte, /Alexandrie/);
    r = await dire(s, 'crée un conteneur et essaie cette appli : https://github.com/exemple/appli-inconnue');
    assert.match(r.texte, /Je ne sais pas encore essayer un dépôt GitHub/); assert.equal(r.validations.length, 0);
    r = await dire(s, 'mets ma VM en attente');
    assert.match(r.texte, /Je ne sais pas encore mettre une machine virtuelle en pause/);
    r = await dire(s, 'crée une GPO qui bloque les clés USB sur les postes');
    assert.match(r.texte, /Je ne sais pas encore créer ni changer une GPO/); assert.doesNotMatch(r.texte, /Argos/);
    // 1. Un doute sans rapport n'est plus tenté : « commande-moi des piles » ne montre plus les appareils de la maison.
    r = await dire(s, 'code-moi un site web pour mon salon de coiffure');
    assert.doesNotMatch(r.texte, /Arachné/); assert.match(r.texte, /je n'ai rien fait/);
    // 2. La VM, pas Home Assistant ; la question de Logos sort.
    r = await dire(s, 'éteins la VM');
    assert.doesNotMatch(r.texte, /Home Assistant/); assert.match(r.texte, /Hydre/);
    r = await dire(s, 'éteins le serveur Samba');
    assert.doesNotMatch(r.texte, /Home Assistant/);
    // 4. Plus d'enveloppe pour le modèle, plus de consigne pour le modèle ; la validation parle comme on parle.
    r = await dire(s, 'lis-moi le document contrat.pdf');
    // (L'enveloppe « untrusted » reste dans ce qui est rangé — relecture, constat 3 — : la retirer à l'affichage seulement.)
    assert.ok((r.texte.match(/ · Lire un (?:document|fichier)/g)?.length ?? 0) <= 1, r.texte);
    r = await dire(s, 'convertis-moi ce document en PDF : rapport.docx');
    assert.equal(r.validations.length, 1, 'la conversion demande toujours ta validation');
    // (Le texte lisible de la validation — `resumeAppli` — attend d'être branché sur l'affichage : le résumé TECHNIQUE reste
    // celui que lit Mímir ; voir `taches-relecture.test.ts`.)
    assert.match(resumeAppli({ action: 'action', appli: 'dvalinn', quoi: 'convertir', entree: JSON.stringify({ fichier: 'rapport.docx', format: 'pdf' }) }), /Alchimie · Convertir un fichier \(.*rapport\.docx.*pdf/);
    assert.doesNotMatch(r.texte, /Ne la retente pas|propose une alternative/); assert.match(r.texte, /Je ne l'ai pas fait/);
    // Une action engageante garde sa validation.
    r = await dire(s, 'arrête le conteneur samba');
    assert.equal(r.validations.length, 1);
    // « corrige ça : … » : la relecture de Plume ajoutée pour un modèle n'empêche plus de le faire sans IA.
    r = await dire(s, 'corrige ça : je sui aller a la plage hier');
    assert.match(r.texte, /Plume · Corriger un texte/); assert.match(r.texte, /Je sui aller a la plage hier/);
    // Une action qui change quelque chose sur une chose inconnue n'est pas proposée : il dit ce qui lui manque.
    r = await dire(s, 'lance des tests de fonctionnement dans le conteneur web');
    assert.equal(r.validations.length, 0); assert.match(r.texte, /je n'ai rien fait/i);
    // 6. Une autre langue (passage 3 : celles qu'Odin comprend sont traitées dans `taches-langues.test.ts`) : une langue
    // reconnue qu'il ne comprend pas encore n'est jamais devinée, et c'est dit en français et en anglais.
    r = await dire(s, 'tafuta habari za leo');
    assert.match(r.texte, /I need a language model/); assert.equal(r.validations.length, 0);
    r = await dire(s, 'pause my VM');
    assert.match(r.texte, /^I can't pause a virtual machine yet/); assert.equal(r.validations.length, 0);
  } finally { s.fermer(); }
});

test('Logos : restaurant, « -moi », « récupère l\'image », la ville de la météo', { timeout: 120_000 }, async () => {
  const s = await sansModele();
  try {
    const v = valhallaOf()!;
    const vu = async (p: string) => { const u = await understand(v, p, `logos-${n++}`); return !u ? 'rien' : u.kind === 'action' ? `${u.module}.${u.action} ${JSON.stringify(u.input)}${u.doubt ? ' (doute)' : ''}` : u.kind === 'ask' ? `${u.module}.${u.action} (demande)` : u.kind; };
    assert.doesNotMatch(await vu('fais-moi une réservation au restaurant pour samedi soir'), /^sindri\.restaurer/);
    assert.match(await vu('crée-moi une VM'), /^ymir\.creer_machine/);
    assert.match(await vu('cherche-moi un document qui parle de facture'), /^snotra\.chercher \{"q":"facture"\}/);
    assert.match(await vu('récupère l\'image nginx'), /^naglfar\.tirer/);
    assert.match(await vu('quel temps fera-t-il demain à Paris ?'), /^gladsheim\.meteo \{"ville":"Paris"\}$/);
    assert.match(await vu('corrige ça : je sui aller a la plage hier'), /^snotra\.corriger \{.*"texte":"je sui aller a la plage hier"/);
    // Les demandes qui marchaient marchent toujours.
    assert.match(await vu('restaure la sauvegarde d\'hier'), /^sindri\./);
    assert.match(await vu('la météo'), /^gladsheim\.meteo \{"ville":""\}$/);
  } finally { s.fermer(); }
});
