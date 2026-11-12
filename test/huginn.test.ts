// Huginn : Odin comprend une demande SANS modèle d'IA et utilise toutes ses applis.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { offlineAct } from '../src/core/offline-act.ts';
import { fill, forgetPending, minutesIn, stem, understand, type Understood } from '../src/valhalla/huginn.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';

const DOCKER = [{ ID: 'abc', Names: 'web', Image: 'nginx', State: 'running', Status: 'Up 2 hours', Ports: '', Labels: '' }, { ID: 'def', Names: 'base-de-donnees', Image: 'postgres', State: 'exited', Status: 'Exited', Ports: '', Labels: '' }].map((x) => JSON.stringify(x)).join('\n');
const NOW = new Date('2026-11-11T10:00:00');

/** Toutes les applis d'Odin, sans rien toucher sur la machine : les commandes sont notées, pas lancées. */
function world() {
  const home = mkdtempSync(join(tmpdir(), 'odin-huginn-')), ran: string[] = [], sent: string[] = [];
  let level: 'prudent' | 'equilibre' | 'autonome' | 'breaker' = 'equilibre';
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never), {
    run: async (cmd, args) => { ran.push(`${cmd} ${args.join(' ')}`); return { code: 0, out: /command -v/.test(args.join(' ')) ? '/usr/bin/x' : /^(docker|podman)$/.test(cmd) && args[0] === 'ps' ? DOCKER : '', err: '' }; },
    fetch: (async () => { throw new Error('réseau coupé'); }) as unknown as typeof fetch,
    notify: async (t) => { sent.push(t); }, autonomy: () => level, now: () => NOW,
  });
  v.ctx('himinbjorg').saveSettings({ cams: [{ name: 'Entrée', url: 'rtsp://10.0.0.5/s', motion: true, record: true, sensitivity: 2 }, { name: 'Jardin', url: 'rtsp://10.0.0.6/s', motion: true, record: true, sensitivity: 2 }] });
  v.ctx('midgard').saveSettings({ scenes: [{ name: 'Bonne nuit', steps: [] }, { name: 'Film', steps: [] }] });
  v.ctx('appareils').saveSettings({ devices: { l1: { id: 'l1', name: 'Lampe salon', kind: 'light', room: 'Salon', network: 'MQTT', state: 'OFF', stateTopic: 'a/b', commandTopic: 'a/c' } } });
  v.ctx('frigg').saveSettings({ services: [{ name: 'Coupe', minutes: 30 }, { name: 'Barbe', minutes: 15 }] });
  return { v, home, ran, sent, setLevel: (l: typeof level) => { level = l; }, end: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
const show = (u: Understood | undefined) => !u ? '—' : u.kind === 'action' ? `${u.module}.${u.action} ${JSON.stringify(u.input)}` : u.kind === 'ask' ? `? ${u.module}.${u.action} ${u.missing}` : u.kind === 'manip' ? `manip ${u.id} ${u.keep ? 'garder' : 'annuler'}` : 'dit';

test('Huginn : racines des mots, durées, réglages tirés de la phrase', () => {
  assert.equal(stem('redémarre'), stem('redémarrer')); assert.equal(stem('sauvegardes'), stem('sauvegarder')); assert.equal(stem('joue'), stem('jouer'));
  assert.notEqual(stem('mail'), stem('maillage'), 'deux mots différents ne doivent pas se confondre');
  assert.equal(minutesIn('pendant 2 heures'), 120); assert.equal(minutesIn('30 min'), 30); assert.equal(minutesIn('pour 1 jour'), 1440); assert.equal(minutesIn('rien'), undefined);
  const a = { id: 'bannir', label: 'Bannir', what: '', params: [{ key: 'ip', label: 'Adresse IP', kind: 'text' as const, required: true }, { key: 'minutes', label: 'Durée (minutes)', kind: 'number' as const }], run: () => ({ text: '' }) };
  assert.deepEqual(fill(a, 'bannis 203.0.113.9 pendant 3 heures', new Map()), { ip: '203.0.113.9', minutes: 180 });
  assert.deepEqual(fill(a, 'bannis 999.1.1.1', new Map()), {}, 'une fausse adresse IP n\'est pas prise');
});

test('Huginn : la bonne appli, la bonne action, les bons réglages (sans IA)', async () => {
  const w = world();
  const cases: Array<[string, string]> = [
    ['les alertes', 'forseti.alertes {"gravite":"moyenne"}'],
    ['état de la machine', 'eir.etat {}'],
    ['qui consomme le plus', 'eir.processus {"tri":"processeur","n":15}'],
    ['bannis 203.0.113.9 pendant 2 heures', 'garmr.bannir {"ip":"203.0.113.9","minutes":120,"raison":"à la demande"}'],
    ['débannis 203.0.113.9', 'garmr.debannir {"ip":"203.0.113.9"}'],
    ['qui est banni', 'garmr.bannis {}'],
    ['liste les conteneurs', 'naglfar.lister {}'],
    ['arrête le conteneur web', 'naglfar.arreter {"conteneur":"web"}'],
    ['arrête web', 'naglfar.arreter {"conteneur":"web"}'],
    ['redémarre le conteneur web', 'naglfar.redemarrer {"conteneur":"web"}'],
    ['montre les journaux du conteneur web', 'naglfar.journaux {"conteneur":"web"}'],
    ['liste les machines virtuelles', 'ymir.machines {}'],
    ['démarre la machine virtuelle 101', 'ymir.demarrer {"vmid":101}'],
    ['mes sauvegardes', 'sindri.plans {}'],
    ['génère un mot de passe', 'brisingamen.generer {"longueur":20,"phrase":false}'],
    ['cherche le mot de passe de netflix', 'brisingamen.chercher {"q":"netflix"}'],
    ['ajoute un accès vpn pour le téléphone de Sara', 'gjoll.ajouter {"nom":"téléphone de Sara","tout":true,"maillage":false,"fin":"","dns_odin":true}'],
    ['état du vpn', 'gjoll.appareils {}'],
    ['prends une photo de la caméra entrée', 'himinbjorg.photo {"camera":"Entrée"}'],
    ['les caméras', 'himinbjorg.cameras {}'],
    ['allume la lampe salon', 'appareils.commander {"appareil":"Lampe salon","valeur":"on"}'],
    ['mets la clim à 24 degrés', 'appareils.commander {"valeur":"24","appareil":"clim"}'],
    ['ouvre le volet du salon', 'appareils.commander {"valeur":"ouvrir","appareil":"volet du salon"}'],
    ['lance la scène bonne nuit', 'midgard.scene {"scene":"Bonne nuit"}'],
    ['dis "bonjour tout le monde"', 'bragi.dire {"texte":"bonjour tout le monde"}'],
    ['mets Inception sur la télé', 'freyja.regarder {"ou":"télé","quoi":"Inception"}'],
    ['enregistre le match de ce soir', 'freyja.enregistrer {"quoi":"match de ce soir","serie":false}'],
    ['joue du jazz', 'aegir.jouer {"quoi":"jazz","ou":"ici"}'],
    ['prends rendez-vous pour une coupe demain à 14h pour Ali 0639123456', 'frigg.reserver {"service":"Coupe","jour":"2026-11-12","heure":"14:00","nom":"Ali","contact":"0639123456","note":""}'],
    ['quels créneaux pour une coupe demain', 'frigg.creneaux {"service":"Coupe","jour":"2026-11-12"}'],
    ['quoi de neuf sur github', 'kvasir.verifier {}'],
    ['étudie le dépôt nocodb/nocodb', 'kvasir.etudier {"lien":"nocodb/nocodb"}'],
    ['analyse le fichier /tmp/x.sh', 'ullr.fichier {"chemin":"/tmp/x.sh"}'],
    // L'antivirus : toute la procédure d'utilisation (docs/antivirus-ullr.md) se dit sans IA.
    ['analyse le fichier rapport.pdf', 'ullr.fichier {"chemin":"rapport.pdf"}'],
    ['analyse le dossier /srv/www', 'ullr.analyser {"dossier":"/srv/www","exclusions":""}'],
    ['analyse mes téléchargements', 'ullr.analyser {"dossier":"téléchargements","exclusions":""}'],
    ['scanne tout', 'ullr.analyser {"dossier":"tout","exclusions":""}'],
    ['vérifie le lien https://paypa1.com/x', 'ullr.adresse {"lien":"https://paypa1.com/x"}'],
    ['vérifie ce message : Votre compte sera suspendu, cliquez ici', 'ullr.message {"texte":"Votre compte sera suspendu, cliquez ici"}'],
    ['arrête l\'analyse', 'ullr.arreter {}'],
    ['rapport antivirus', 'ullr.rapport {"rapport":""}'],
    ['les analyses', 'ullr.rapports {}'],
    ['les analyses planifiées', 'ullr.plans {}'],
    ['mets à jour les signatures', 'ullr.mettre_a_jour {"source":""}'],
    ['reviens à la version précédente des signatures', 'ullr.revenir {}'],
    ['la quarantaine', 'ullr.quarantaine {}'],
    ['les incidents', 'ullr.incidents {}'],
    ['y a-t-il une activité bizarre ?', 'ullr.incidents {}'],
    ['y a-t-il un virus sur ma machine ?', 'ullr.etat {}'],
    ['pose des sentinelles dans /home/awa/Documents', 'ullr.sentinelles {"dossier":"/home/awa/Documents"}'],
    ['les failles', 'ullr.failles {}'],
    ['isole /tmp/x.sh', 'ullr.isoler {"fichier":"/tmp/x.sh","menace":"à ta demande"}'],
    ['ajoute une exception pour /srv/projets', 'ullr.exception {"quoi":"/srv/projets"}'],
    ['importe /tmp/regles.yar', 'ullr.importer {"chemin":"/tmp/regles.yar"}'],
    ['vérifie les sauvegardes', 'sindri.verifier {}'],
    ['allume le piège ssh', 'loki.allumer {"piege":"sshid"}'],
    ['connexions en cours', 'geri.connexions {}'],
    ['processus suspects', 'skogul.analyser {}'],
    ['tue le processus 4242', 'skogul.tuer {"pid":4242}'],
    ['serveurs mcp', 'ratatoskr.serveurs {}'],
    ['cherche les modules tasmota', 'brokkr.chercher {}'],
    ['liste les appareils', 'appareils.lister {}'],
    ['cherche dans mes notes facture orange', 'saga.chercher {"q":"facture orange"}'],
    ['conformité de la machine', 'forseti.conformite {}'],
    // Une question ne lance jamais une action : seulement une lecture.
    ['quand est-ce que la sauvegarde a tourné', 'sindri.plans {}'],
    // Il manque quelque chose : Odin le demande au lieu de deviner.
    ['annule le rendez-vous de demain', '? frigg.annuler id'],
    ['éteins tout', '? appareils.commander appareil'],
  ];
  const wrong: string[] = [];
  for (const [phrase, want] of cases) { const got = show(await understand(w.v, phrase, `s:${phrase}`, NOW)); if (got !== want) wrong.push(`« ${phrase} » → ${got} (attendu ${want})`); }
  assert.deepEqual(wrong, [], `${cases.length - wrong.length}/${cases.length} demandes comprises`);
  w.end();
});

test('Huginn : il ne devine pas — les phrases de tous les jours ne déclenchent aucune appli', async () => {
  const w = world();
  const chat = ['garde ce lien https://exemple.fr/article', 'résume ce site https://exemple.fr', 'envoie un message à Awa : coucou', 'bonjour comment vas-tu', 'quelle heure est-il', 'raconte-moi une blague', 'merci beaucoup', 'quel temps fait-il demain', 'écris un mail à Paul', 'tu peux m\'expliquer la photosynthèse', 'j\'ai mal à la tête', 'quel est le prix du bitcoin', 'traduis bonjour en anglais', 'écris un poème sur la mer', 'on mange quoi ce soir', 'ma voiture est en panne', 'quelle est la capitale du Japon', 'combien font 12 fois 13', 'mon fils a de la fièvre', 'il fait chaud aujourd\'hui', 'la réunion est à 15h', 'pense à acheter du pain', 'j\'ai acheté une nouvelle lampe hier', 'le film d\'hier était super', 'fais-moi un résumé de la page wikipedia sur Mayotte', 'rappelle-moi d\'appeler le client'];
  const caught: string[] = [];
  for (const c of chat) { const u = await understand(w.v, c, `c:${c}`, NOW); if (u) caught.push(`« ${c} » → ${show(u)}`); }
  assert.deepEqual(caught, []);
  assert.equal((await understand(w.v, 'bannis 10.0.0.300', 'x', NOW))?.kind, 'say', 'adresse IP impossible : il le dit, il ne fait rien');
  w.end();
});

test('Huginn : explications, question quand il manque un réglage, réponse au message suivant', async () => {
  const w = world();
  const ex = await understand(w.v, 'à quoi sert Sindri', 'e', NOW);
  assert.equal(ex?.kind, 'say'); assert.match((ex as { text: string }).text, /Sindri[\s\S]*sauvegardes[\s\S]*Liens avec les autres applis[\s\S]*Exemples/);
  assert.match(((await understand(w.v, 'c\'est quoi un vpn', 'e', NOW)) as { text: string }).text, /Gjöll/);
  assert.match(((await understand(w.v, 'qui fait quoi', 'e', NOW)) as { text: string }).text, /Loki → Garmr/);
  // Demande en deux temps.
  const q = await understand(w.v, 'bannis une adresse', 'deux', NOW);
  assert.equal(show(q), '? garmr.bannir ip'); assert.match((q as { text: string }).text, /il me manque « Adresse IP »/);
  assert.equal(show(await understand(w.v, '203.0.113.50', 'deux', NOW)), 'garmr.bannir {"raison":"à la demande","minutes":60,"ip":"203.0.113.50"}');
  await understand(w.v, 'bannis une adresse', 'trois', NOW);
  assert.equal((await understand(w.v, 'laisse tomber', 'trois', NOW))?.kind, 'say');
  assert.equal(await understand(w.v, '203.0.113.51', 'trois', NOW), undefined, 'la demande abandonnée n\'attend plus de réponse');
  forgetPending('deux');
  w.end();
});

test('sans IA de bout en bout : Odin agit par ses applis, les actions graves demandent ton accord (Heimdall)', async () => {
  const w = world(); setValhalla(w.v);
  try {
    const calls: Array<Record<string, unknown>> = [];
    // L'outil « valhalla » tel que l'agent l'appelle : ici on joue Heimdall (accord refusé pour ce qui est grave).
    const run = async (name: string, input: Record<string, unknown>) => {
      calls.push({ name, ...input });
      if (name !== 'valhalla') return { ok: false, content: 'outil absent' };
      const { valhallaTool } = await import('../src/tools/valhalla.ts');
      if (valhallaTool.grave?.(input)) return { ok: false, content: `Action refusée : ${valhallaTool.grave(input)}` };
      return { ok: true, content: String(await valhallaTool.run(input, { sessionId: 'web:test' } as never)) };
    };
    const has = (n: string) => n === 'valhalla';
    assert.match((await offlineAct('bannis 203.0.113.9 pendant 2 heures', run, has, 's1'))!, /Garmr · Bannir une adresse\n.*203\.0\.113\.9/);
    assert.ok(w.ran.some((c) => /^nft add element inet odin garmr4 \{ 203\.0\.113\.9 timeout 7200s \}/.test(c)), 'le pare-feu a bien reçu l\'ordre');
    assert.deepEqual(calls.at(-1), { name: 'valhalla', action: 'action', appli: 'garmr', quoi: 'bannir', entree: '{"ip":"203.0.113.9","minutes":120,"raison":"à la demande"}' }, 'l\'action passe par l\'outil, donc par Heimdall');
    assert.equal(w.v.manips().length, 0, 'tu l\'as demandé toi-même : ce n\'est pas une manip d\'Odin');
    assert.match((await offlineAct('liste les conteneurs', run, has, 's1'))!, /Naglfar · Lister les conteneurs\n[\s\S]*web/);
    assert.match((await offlineAct('supprime le conteneur web', run, has, 's1'))!, /Action refusée : supprimer/i, 'action grave : jamais sans ton accord');
    assert.ok(!w.ran.some((c) => /\brm\b.*web/.test(c)), 'rien n\'a été supprimé');
    assert.match((await offlineAct('explique Garmr', run, has, 's1'))!, /Garmr[\s\S]*Bannit/);
    assert.match((await offlineAct('aide', run, has, 's1'))!, /Mes applis, sans IA aussi[\s\S]*Sécurité :[\s\S]*Garmr/);
    assert.match((await offlineAct('j\'ai besoin de protéger un serveur ouvert sur Internet', run, has, 's1'))!, /Loki|Garmr/);
    assert.equal(await offlineAct('quelle est la capitale du Japon', run, has, 's1'), undefined, 'rien de compris : rien n\'est tenté');
    // Demande en deux messages, dans la même discussion.
    assert.match((await offlineAct('débannis une adresse', run, has, 's2'))!, /il me manque « Adresse IP »/);
    assert.match((await offlineAct('203.0.113.9', run, has, 's2'))!, /Garmr · Débannir/);
  } finally { setValhalla(undefined); w.end(); }
});

test('manips : ce qu\'Odin fait seul est noté, annoncé, et se garde ou s\'annule (Breaker : il garde seul)', async () => {
  const w = world();
  // Un réflexe (Loki → Garmr) bannit un attaquant : personne ne l'a demandé.
  await w.v.ctx('loki').call('garmr', 'bannir', { ip: '203.0.113.77', raison: 'piège SSH', minutes: 1440 }, 'un pirate a tapé un mot de passe dans un piège');
  const [m] = w.v.manips();
  assert.equal(m.state, 'à décider'); assert.equal(m.by, 'réflexe'); assert.equal(m.label, 'Garmr · Bannir une adresse');
  assert.deepEqual(m.undo, { action: 'debannir', input: { ip: '203.0.113.77' }, label: 'adresse débannie' });
  assert.match(w.sent.at(-1)!, new RegExp(`🤖 Manip faite par réflexe : Garmr · Bannir une adresse.*pirate.*Réponds « garde ${m.id} » ou « annule ${m.id} »`));
  // « annule <code> » : compris sans IA, l'action inverse part.
  assert.equal(show(await understand(w.v, `annule ${m.id}`, 'm', NOW)), `manip ${m.id} annuler`);
  const r = await w.v.order(`annule ${m.id}`, 'm');
  assert.match(r.text, /↩ Annulé : Garmr · Bannir une adresse \(adresse débannie\)/);
  assert.ok(w.ran.some((c) => /^nft delete element inet odin garmr4 \{ 203\.0\.113\.77 \}/.test(c)), 'l\'adresse est vraiment débannie');
  assert.equal(w.v.manips()[0].state, 'annulée'); assert.equal(w.v.manips().length, 1, 'l\'annulation demandée par toi n\'est pas une nouvelle manip');
  // « garde » et « garde tout ».
  await w.v.act('naglfar', 'demarrer', { conteneur: 'web' }, { by: 'odin', why: 'il s\'était arrêté tout seul' });
  await w.v.act('aegir', 'radio', { nom: 'Radio Mayotte', adresse: 'https://radio.exemple/flux' });
  await w.v.act('aegir', 'jouer', { quoi: 'Radio Mayotte', ou: 'ici' }, { by: 'automatisation' });
  assert.equal(w.v.manips({ state: 'à décider' }).length, 2);
  assert.match((await w.v.order('garde tout', 'm')).text, /✓ Gardé : Naglfar[\s\S]*✓ Gardé : Ægir/);
  assert.equal(w.v.manips({ state: 'à décider' }).length, 0);
  assert.match((await w.v.order('mes manips', 'm')).text, /Naglfar · Démarrer.*gardée/);
  // Une lecture, ou ce que tu fais toi-même, n'est jamais une manip.
  const n = w.v.manips().length;
  await w.v.act('naglfar', 'lister', {}, { by: 'odin' }); await w.v.act('garmr', 'bannir', { ip: '203.0.113.78' });
  assert.equal(w.v.manips().length, n);
  // Une action grave ne part jamais d'une automatisation, quel que soit le niveau.
  assert.equal((await w.v.act('naglfar', 'supprimer', { conteneur: 'web' }, { auto: true, by: 'automatisation' })).ok, false);
  // Mode Odin Breaker : il décide seul de garder (et le dit) ; tu peux encore annuler.
  w.setLevel('breaker');
  await w.v.act('garmr', 'bannir', { ip: '203.0.113.79', minutes: 60 }, { by: 'odin', why: 'adresse malveillante' });
  const b = w.v.manips()[0];
  assert.equal(b.state, 'gardée'); assert.equal(b.decidedBy, 'Odin (mode Breaker)');
  assert.match(w.v.manipText(b), new RegExp(`Manip faite de moi-même : Garmr · Bannir une adresse.*Je la garde \\(mode Breaker\\)\\. « annule ${b.id} » pour revenir en arrière`));
  assert.equal(w.sent.filter((x) => x.startsWith('🤖')).length, 3, 'au plus 3 messages par 10 minutes : les suivants sont regroupés');
  assert.match((await w.v.decide(b.id, false)).text, /↩ Annulé/);
  // Jamais de secret dans le journal.
  await w.v.act('brisingamen', 'ajouter', { nom: 'Banque', identifiant: 'moi', mot_de_passe: 'TresSecret-1234' }, { by: 'odin' }).catch(() => undefined);
  assert.equal(JSON.stringify(w.v.manips({ limit: 500 })).includes('TresSecret-1234'), false);
  w.end();
});
