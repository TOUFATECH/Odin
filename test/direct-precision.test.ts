// Sans IA d'abord, avec TOUTES les applis d'Odin : la précision avant tout.
//
// Odin ne prend la main sans IA que s'il est sûr. Ce banc tient deux promesses :
//  1. ce qui demande de comprendre, rédiger ou chercher part vers une IA, même quand la phrase emploie
//     les mots d'une appli (« sauvegarde cette idée », « analyse les ventes », « mets à jour Odin ») ;
//  2. ce qu'Odin sait faire seul est bien fait seul, par la bonne appli, y compris toutes les phrases
//     d'exemple que les applis affichent dans leur aide.
// Rien n'est lancé pour de vrai : on regarde seulement quelle action partirait.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { tryDirect, type DirectDeps } from '../src/core/direct.ts';
import { examples, forgetPending, stem } from '../src/valhalla/huginn.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { useEngine } from '../src/valhalla/modules/naglfar.ts';
import { fakeEngine } from './helpers.ts';

const DOCKER = [{ ID: 'abc', Names: 'web', Image: 'nginx', State: 'running', Status: 'Up 2 hours', Ports: '', Labels: '' }, { ID: 'def', Names: 'base-de-donnees', Image: 'postgres', State: 'exited', Status: 'Exited', Ports: '', Labels: '' }].map((x) => JSON.stringify(x)).join('\n');
const NOW = new Date('2026-11-11T10:00:00');
const TOOLS = ['valhalla', 'mode_set', 'reminder_set', 'note_save', 'note_find', 'venus', 'net_scan', 'ha_call', 'ha_states', 'admin_enable', 'self_restart', 'update_apply', 'update_check', 'settings_get', 'settings_set'];

/** Toutes les applis d'Odin, sans rien toucher sur la machine. */
function world() {
  const home = mkdtempSync(join(tmpdir(), 'odin-precision-'));
  useEngine(() => fakeEngine(String(DOCKER).split('\n').filter(Boolean).map((l) => JSON.parse(l))));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never), {
    run: async (cmd, args) => ({ code: 0, out: /command -v/.test(args.join(' ')) ? '/usr/bin/x' : /^(docker|podman)$/.test(cmd) && args[0] === 'ps' ? DOCKER : '', err: '' }),
    fetch: (async () => { throw new Error('réseau coupé'); }) as unknown as typeof fetch,
    notify: async () => {}, autonomy: () => 'equilibre', now: () => NOW,
  });
  v.ctx('himinbjorg').saveSettings({ cams: [{ name: 'Entrée', url: 'rtsp://10.0.0.5/s', motion: true, record: true, sensitivity: 2 }, { name: 'Jardin', url: 'rtsp://10.0.0.6/s', motion: true, record: true, sensitivity: 2 }] });
  v.ctx('midgard').saveSettings({ scenes: [{ name: 'Bonne nuit', steps: [] }, { name: 'Film', steps: [] }] });
  v.ctx('appareils').saveSettings({ devices: { l1: { id: 'l1', name: 'Lampe salon', kind: 'light', room: 'Salon', network: 'MQTT', state: 'OFF', stateTopic: 'a/b', commandTopic: 'a/c' } } });
  v.ctx('frigg').saveSettings({ services: [{ name: 'Coupe', minutes: 30 }, { name: 'Barbe', minutes: 15 }] });
  setValhalla(v);
  const store = new Map<string, string>();
  /** La demande telle que l'agent la tente sans IA ; `calls` : les actions qui partiraient (les lectures de la maison à part). */
  const ask = async (text: string): Promise<{ done: boolean; why: string; calls: string[] }> => {
    const calls: string[] = [];
    const d: DirectDeps = {
      sessionId: `s-${Math.random()}`, now: NOW, has: (t) => TOOLS.includes(t), kv: { getKv: (k) => store.get(k), setKv: (k, val) => { store.set(k, val); } },
      texts: { reminders: () => 'rappels', savings: () => 'économies', rights: () => 'droits' },
      run: async (name, input) => {
        // Home Assistant n'est pas branché sur ce banc : ses lectures échouent, comme sur une installation neuve.
        if (/^ha_/.test(name)) return { ok: false, content: 'Home Assistant n\'est pas configuré' };
        calls.push(name === 'valhalla' ? `${String(input.appli ?? '')}.${String(input.quoi ?? input.action ?? '')} ${String(input.entree ?? input.besoin ?? '')}`.trim() : `${name} ${JSON.stringify(input)}`);
        return { ok: true, content: 'fait' };
      },
    };
    const r = await tryDirect(text, d); forgetPending(d.sessionId);
    return { done: r.done, why: r.why, calls };
  };
  return { v, ask, end: () => { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

/** Doit partir vers une IA (rien d'évident à faire seul). */
const IA = [
  'Trouve-moi une idée de cadeau pour ma mère', 'Quel temps fera-t-il demain à Mamoudzou ?', 'Combien coûte un iPhone 16 à Mayotte ?',
  'Peux-tu me dire comment sécuriser mon serveur ?', 'Qu\'est-ce que tu penses de mon site ?', 'Fais-moi un devis pour un site vitrine',
  'Prépare une réponse au client qui se plaint du retard', 'C\'est quoi la différence entre Docker et Podman ?', 'Donne-moi les nouvelles du jour',
  'Cherche sur internet le prix d\'un Starlink', 'Mon site est lent, tu peux regarder ?', 'Aide-moi à préparer ma réunion de demain',
  'Quelle est la capitale du Japon ?', 'Raconte-moi une blague', 'Bonjour Odin, ça va ?', 'Merci', 'Salut',
  'J\'ai un client qui veut un site e-commerce, tu en penses quoi ?', 'Calcule la marge sur un iPhone acheté 900 euros',
  'Regarde mes mails et dis-moi ce qui est urgent', 'Envoie un mail à Karim pour lui dire que je serai en retard', 'Programme une vidéo TikTok pour demain',
  'Comment je fais pour changer le mot de passe du wifi ?', 'Qui a gagné le match hier ?', 'Traduis bonjour en shimaoré',
  'Rappelle-moi de payer la facture', 'Mets à jour le site de O\'QG Barber', 'Analyse les ventes du mois', 'Analyse ce contrat et dis-moi les risques',
  'Trouve un nom pour ma nouvelle appli', 'Cherche un hôtel à Paris pour la semaine prochaine', 'Donne-moi une recette avec du poulet',
  'Vérifie l\'orthographe de ce texte', 'Fais le point sur mes projets en cours', 'Quels sont les avantages de Supabase ?',
  'Dis-moi ce que je dois faire aujourd\'hui', 'Planifie ma semaine', 'Qu\'est-ce que je peux vendre en plus des iPhone ?',
  'Trouve les concurrents de mon salon de coiffure', 'Crée une affiche pour la promo de décembre', 'Sauvegarde cette idée pour plus tard : une appli de covoiturage',
  'Ouvre le site de la préfecture', 'Télécharge la dernière version de Node', 'Installe WordPress sur le serveur',
  'Répare le site, il affiche une erreur 500', 'Pourquoi le conteneur web redémarre tout le temps ?', 'Montre-moi comment on bannit une adresse',
  'Est-ce que ma mère a appelé ?', 'Rédige un message pour la famille', 'Ajoute du lait à la liste de courses et préviens Fatima',
  'Je cherche un cadeau pour mon fils', 'Ma femme veut une idée de sortie ce week-end', 'Lance la musique que j\'aime bien',
  'Regarde si le colis est arrivé', 'Trouve la facture du mois dernier', 'Note le rendez-vous chez le médecin et rappelle-le moi la veille',
  'Bloque les arnaques sur mon téléphone', 'Mets-moi une alarme dans dix minutes pour les pâtes', 'Quel est le meilleur antivirus ?',
  'Surveille le prix du billet pour Paris', 'Vérifie que tout va bien', 'Fais ce qu\'il faut pour que le site soit plus rapide',
  // Avec les mots des applis, mais pour autre chose.
  'La caméra du jardin ne marche plus', 'Quel serveur choisir pour héberger un site ?', 'Le conteneur web consomme trop, que faire ?',
  'Mon mot de passe wifi ne marche plus', 'J\'ai un rendez-vous chez le dentiste demain à 10h', 'Ajoute un rendez-vous chez le dentiste demain à 10h',
  'Quel film regarder ce soir ?', 'Y a-t-il un antivirus sur mon téléphone ?', 'Mon site a été piraté, que faire ?', 'Envoie le rapport antivirus à Karim',
  'Note pour plus tard : rappeler le client', 'Combien de clients j\'ai ?', 'Crée une automatisation qui m\'envoie la météo chaque matin',
  'Ajoute Karim comme client', 'Bloque Facebook', 'Coupe internet aux enfants', 'Éteins la télé du salon dans 30 minutes', 'Allume le chauffage à 18h',
  'Ouvre le site de la préfecture', 'Lance le build du site', 'Active le mode sombre', 'Ferme la session de Karim', 'Je suis en réunion jusqu\'à 15h',
  'Sauvegarde le site avant la mise à jour', 'Combien coûte un serveur chez OVH ?', 'Supprime les vieux fichiers du serveur', 'Redémarre le serveur de la boutique',
  'Arrête de m\'envoyer des alertes', 'Les alertes de la semaine dernière en résumé', 'Montre-moi les ventes de la boutique', 'Liste mes clients qui n\'ont pas payé',
  'Vérifie le site de mon concurrent', 'Vérifie si mon site est bien référencé', 'Cherche le mot de passe du wifi et envoie-le à Sara', 'Génère une image pour Instagram',
  'Génère un devis', 'Scanne ce document', 'Analyse la vidéo que je t\'ai envoyée', 'Mets à jour le serveur', 'Mets à jour mes applis', 'Installe la dernière version',
  'Quelle est la température à Mamoudzou ?', 'La machine à laver a fini ?', 'Il reste combien de place sur mon téléphone ?', 'Mon ordinateur rame, tu peux faire quelque chose ?',
  'Dis à Karim que j\'arrive', 'Annonce la promo sur Instagram', 'Joue le rôle d\'un client mécontent', 'Enregistre cette conversation', 'Enregistre ce contact : Karim 0639123456',
  'Regarde la vidéo et dis-moi ce que tu en penses', 'Qui est connecté sur mon site ?', 'Connecte-toi à mon compte Vercel', 'Déploie mon appli sur un serveur',
  'Le film d\'hier était super', 'Bonjour comment vas-tu', 'Il fait chaud aujourd\'hui', 'On mange quoi ce soir ?', 'Tu connais une bonne série ?', 'C\'est quoi un VPN ?',
  'Ça sert à quoi un pare-feu ?', 'Explique-moi Docker', 'Fais une sauvegarde de mon téléphone', 'Trouve le fichier du devis Kana',
];
/** Odin sait le faire seul : [phrase, la dernière action qui part] (vide : il répond de lui-même). */
const SEUL: Array<[string, RegExp]> = [
  ['Quelle heure est-il ?', /^$/], ['mes rappels', /^$/], ['es-tu administrateur ?', /^$/], ['mes économies', /^$/],
  ['rappelle-moi demain à 9h de payer la facture EDM', /^reminder_set/], ['liste les conteneurs', /^naglfar\./], ['redémarre le conteneur web', /^naglfar\.redemarrer.*web/],
  ['bannis 203.0.113.9 pendant 2 heures', /^garmr\.bannir.*203\.0\.113\.9/], ['mes sauvegardes', /^\w+\./], ['lance une analyse antivirus', /^ullr\./],
  ['montre les caméras', /^himinbjorg\./], ['mes manips', /^$/], ['explique Garmr', /^$/], ['mes applis', /^\.lister|^valhalla|lister/],
  ['je conduis', /^mode_set.*conduite/], ['bonne nuit', /^mode_set.*sommeil|^midgard\./], ['scanne le réseau', /^net_scan/],
  ['note que la clim du bureau est en panne', /^note_save/], ['cherche dans mes fiches clim', /^note_find/], ['qu\'est-ce qui passe à la télé ce soir ?', /^venus/],
  ['état du pare-feu', /^\w+\./], ['les adresses bannies', /^garmr\./], ['arrête le conteneur web', /^naglfar\.arreter.*web/],
  ['processus gourmands', /^eir\.processus/], ['fiches des applis', /^saga\.fiches/], ['appareils vpn', /^gjoll\.appareils/], ['qui est banni ?', /^garmr\.bannis/],
  ['déploie le site', /^idunn\.deployer/], ['vérifie les sauvegardes', /^sindri\.verifier/], ['les alertes', /^forseti\.alertes/], ['état de la machine', /^eir\.etat/],
  ['mets à jour les signatures', /^ullr\.mettre_a_jour/], ['la quarantaine', /^ullr\.quarantaine/], ['génère un mot de passe', /^brisingamen\.generer/],
  ['allume la lampe salon', /^appareils\.commander.*Lampe salon/], ['lance la scène bonne nuit', /^midgard\.scene.*Bonne nuit/], ['les caméras', /^himinbjorg\.cameras/],
  ['débannis 203.0.113.9', /^garmr\.debannir.*203\.0\.113\.9/], ['tue le processus 4242', /^skogul\.tuer.*4242/], ['cherche dans mes notes facture orange', /^saga\.chercher.*facture orange|^note_find/],
  ['rappelle-moi dans 2 heures de sortir le linge', /^reminder_set/], ['je suis en réunion', /^mode_set.*reunion/], ['mes enregistrements', /^freyja\.enregistrements/],
  ['vérifie le lien https://paypa1.com/x', /^ullr\.adresse.*paypa1/], ['analyse le fichier /tmp/x.sh', /^ullr\.fichier.*x\.sh/], ['ce que tu as appris', /^$/], ['redémarre-toi', /^self_restart/], ['Mets à jour Odin', /^update_apply/], ['es-tu à jour ?', /^update_check/], ['passe en prudent', /^settings_set.*prudent/], ['tes réglages', /^settings_get/], ['as-tu besoin d\'une IA pour écrire un poème ?', /^$/],
];


test('sans IA d\'abord : rien de ce qui demande une IA n\'est pris par erreur, même avec les mots d\'une appli', async () => {
  const w = world();
  try {
    const wrong: string[] = [];
    for (const t of IA) { const r = await w.ask(t); if (r.done) wrong.push(`« ${t} » → ${r.calls.join(' ; ') || '(réponse directe)'} · ${r.why}`); }
    assert.deepEqual(wrong, [], `${IA.length - wrong.length}/${IA.length} bien laissées à l'IA`);
    // La raison donnée au propriétaire (« IA nécessaire : … ») n'est jamais vide.
    for (const t of IA.slice(0, 20)) assert.ok((await w.ask(t)).why.length > 5, t);
  } finally { w.end(); }
});

test('sans IA d\'abord : ce qu\'Odin sait faire seul est fait seul, par la bonne action', async () => {
  const w = world();
  try {
    const miss: string[] = [];
    for (const [t, re] of SEUL) { const r = await w.ask(t); if (!(r.done && re.test(r.calls.at(-1) ?? ''))) miss.push(`« ${t} » → ${r.done ? r.calls.join(' ; ') || '(rien)' : `laissé à l'IA : ${r.why}`}`); }
    assert.deepEqual(miss, [], `${SEUL.length - miss.length}/${SEUL.length} faites sans IA`);
  } finally { w.end(); }
});

test('sans IA d\'abord : chaque phrase d\'exemple affichée par une appli marche telle quelle, par cette appli', async () => {
  const w = world();
  try {
    const bad: string[] = []; let n = 0;
    for (const m of w.v.modules()) {
      const ex = examples(m);
      assert.ok(ex.length >= 1, `${m.name} : au moins un exemple`);
      for (const e of ex) {
        if (/</.test(e)) continue; // un réglage à donner (« <conteneur> ») : la phrase est un modèle
        n++;
        const r = await w.ask(e), last = r.calls.at(-1) ?? '';
        if (!r.done) bad.push(`${m.name} : « ${e} » laissé à l'IA · ${r.why}`);
        else if (last && !last.startsWith(`${m.id}.`)) bad.push(`${m.name} : « ${e} » → ${last}`);
      }
    }
    assert.deepEqual(bad, [], `${n - bad.length}/${n} exemples`);
    assert.ok(n >= 40, `assez d'exemples vérifiés (${n})`);
  } finally { w.end(); }
});

test('Huginn : « vérifie » et « vérifier » ont la même racine, « fichier » n\'est pas « fiche »', () => {
  for (const [a, b] of [['vérifie', 'vérifier'], ['vérifiez', 'vérifier'], ['étudie', 'étudier'], ['copie', 'copier'], ['modifie', 'modifier'], ['redémarre', 'redémarrer'], ['bannies', 'bannir'], ['sauvegardes', 'sauvegarder']]) assert.equal(stem(a), stem(b), `${a} / ${b}`);
  assert.notEqual(stem('fichier'), stem('fiche')); assert.notEqual(stem('dossier'), stem('dos')); assert.equal(stem('fichiers'), stem('fichier'));
});

test('Rán sans IA : lire les paquets, pause, reprise', async () => {
  const w = world();
  try {
    for (const [t, want] of [['lis les paquets', 'ran.lire'], ['vas-y lis les paquets', 'ran.lire'], ['mets les paquets en pause', 'ran.pause'], ['arrête la capture des paquets', 'ran.pause'], ['reprends la lecture des paquets', 'ran.'], ['qui parle à qui sur le réseau', 'ran.expliquer']] as const) {
      const r = await w.ask(t);
      assert.ok(r.done, `${t} : ${r.why}`); assert.ok((r.calls.at(-1) ?? '').startsWith(want) && (want !== 'ran.' || /^ran\.(lire|reprendre)/.test(r.calls.at(-1) ?? '')), `${t} → ${r.calls.at(-1)}`);
    }
  } finally { w.end(); }
});
