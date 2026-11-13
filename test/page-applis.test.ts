// La page d'une appli (maquette validée le 13/11/2026) : onglets courts, « Sur quel poste ? », zone de dépôt,
// « Ajouter un poste » pas à pas. Ici : ce que les applis décrivent (leurs vues) et les routes web ; le dessin lui-même
// est vérifié dans un vrai navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { conversionsPossibles } from '../src/valhalla/modules/dvalinn.ts';
import { PROFILES } from '../src/valhalla/modules/ullr.ts';
import type { Section, View } from '../src/valhalla/types.ts';

test('Alchimie : ce qu\'un fichier peut devenir, rangé par genre (pur)', () => {
  const film = conversionsPossibles('Vacances à Mayotte.MOV');
  assert.equal(film.famille, 'vidéo'); assert.equal(film.champ, 'format'); assert.equal(film.defaut, 'mp4');
  assert.deepEqual(film.groupes.map((g) => g.titre), ['Vidéo', 'Son seul']);
  assert.deepEqual(film.groupes[0].valeurs.map((x) => x.label), ['MP4', 'MKV', 'WebM', 'GIF animé'], 'le format d\'origine n\'est pas proposé ; le GIF d\'une vidéo se range avec les vidéos');
  assert.deepEqual(film.groupes[1].valeurs.map((x) => x.valeur), ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus']);
  assert.deepEqual(film.options, [{ champ: 'qualite', titre: 'Qualité', defaut: 'normale', valeurs: [{ valeur: 'legere', label: 'Légère' }, { valeur: 'normale', label: 'Normale' }, { valeur: 'haute', label: 'Haute' }] }]);
  // Pas de qualité pour ce qui ne se compresse pas.
  const st = conversionsPossibles('film.srt');
  assert.equal(st.famille, 'sous-titres'); assert.equal(st.groupes[0].titre, 'Sous-titres', 'le genre du fichier vient en premier'); assert.ok(st.groupes[0].valeurs.some((x) => x.valeur === 'vtt')); assert.equal(st.defaut, st.groupes[0].valeurs[0].valeur); assert.equal(st.options, undefined);
  // Un seul genre possible : pas de sous-titre de groupe.
  const seul = conversionsPossibles('archive.zip'); assert.equal(seul.groupes.length, 1); assert.equal(seul.groupes[0].titre, '');
  const doc = conversionsPossibles('note.docx');
  assert.equal(doc.famille, 'document'); assert.equal(doc.defaut, 'pdf'); assert.ok(doc.groupes.flatMap((g) => g.valeurs).every((x) => x.valeur !== 'docx')); assert.ok(doc.groupes.flatMap((g) => g.valeurs).some((x) => x.label === 'Markdown'));
  const img = conversionsPossibles('photo.JPEG');
  assert.ok(img.groupes.flatMap((g) => g.valeurs).every((x) => x.valeur !== 'jpg'), '.jpeg et .jpg sont le même format'); assert.ok(img.groupes.some((g) => g.titre === 'Document' && g.valeurs.some((x) => x.valeur === 'pdf')));
  // Un lien : c'est le nom du fichier au bout du lien qui compte (pas ce qui suit « ? »).
  assert.equal(conversionsPossibles('https://exemple.fr/dossier/Clients%202026.csv?jeton=abc.mp4').famille, 'tableau');
  // Rien à faire : dit clairement, sans bouton.
  for (const n of ['programme.exe', 'sans-extension', 'https://exemple.fr/']) { const r = conversionsPossibles(n); assert.deepEqual(r.groupes, [], n); assert.ok(r.refus && r.refus.length > 10, n); }
});

test('pages des applis : onglets courts et tous utilisés, « Sur quel poste ? » cohérent, zones de dépôt et cartes branchées sur de vraies actions', { timeout: 180_000 }, async () => {
  const tt = new T();
  try {
    await vraiOdin(tt, { compte: true }); const va = valhallaOf()!;
    let avecOnglets = 0, avecPostes = 0;
    for (const m of va.modules()) {
      let v: View;
      try { v = await Promise.race([Promise.resolve(m.view(va.ctx(m.id), new URLSearchParams())), new Promise<View>((_ok, ko) => { setTimeout(() => ko(new Error('lent')), 20_000).unref(); })]); } catch { continue; }
      const toutes: Section[] = [...v.sections, ...(v.side ?? [])], actions = new Set(m.actions.map((a) => a.id));
      if (v.onglets) {
        avecOnglets++;
        assert.ok(v.onglets.length >= 2 && v.onglets.length <= 4, `${m.id} : 2 à 4 onglets`); assert.equal(new Set(v.onglets).size, v.onglets.length, `${m.id} : onglets tous différents`);
        for (const o of v.onglets) assert.ok(o.length >= 3 && o.length <= 12 && !/\s/.test(o), `${m.id} : l'onglet « ${o} » est un mot court (il tient sur une ligne, même sur téléphone)`);
        for (const s of toutes) if (s.onglet !== undefined) assert.ok(v.onglets.includes(s.onglet), `${m.id} : la section « ${s.title} » va dans un onglet qui existe (${s.onglet})`);
        for (const o of v.onglets.slice(0, -1)) assert.ok(toutes.some((s) => (s.onglet ?? v.onglets![0]) === o), `${m.id} : l'onglet « ${o} » n'est pas vide`);
      } else for (const s of toutes) assert.equal(s.onglet, undefined, `${m.id} : une section dit son onglet seulement si la page a des onglets`);
      for (const s of toutes) {
        if (s.kind === 'depot') { assert.ok(actions.has(s.action) && Boolean(m.depot), `${m.id} : la zone de dépôt envoie vers une action de l'appli, qui sait recevoir des fichiers`); assert.ok(m.actions.find((a) => a.id === s.action)!.params?.some((p) => p.key === s.champ), `${m.id} : le fichier va dans un réglage qui existe (${s.champ})`); if (s.choix) assert.ok(m.actions.find((a) => a.id === s.choix!.action)?.read, `${m.id} : demander ce qu'on peut faire d'un fichier ne change rien`); if (s.lien) assert.ok(actions.has(s.lien.action) && Boolean(s.choix)); }
        if (s.kind === 'actions') { for (const b of s.boutons) assert.ok(actions.has(b.action), `${m.id} : le bouton « ${b.label} » lance une action qui existe`); if (s.liste) assert.ok(m.actions.find((a) => a.id === s.liste!.action)?.params?.some((p) => p.key === s.liste!.champ)); }
        if (s.kind === 'form') assert.ok(actions.has(s.action), `${m.id} : le formulaire « ${s.title} » lance une action qui existe`);
      }
      if (v.postes) {
        avecPostes++;
        assert.deepEqual(v.postes.choix[0], { id: '', nom: 'Cette machine' }, `${m.id} : la machine d'Odin d'abord`); assert.equal(v.postes.actuel, '');
        assert.ok(m.actions.some((a) => a.params?.some((p) => p.key === 'poste')), `${m.id} : au moins une action sait aller sur le poste choisi`);
        assert.ok(!toutes.some((s) => s.kind === 'form' && s.params.some((p) => p.key === 'poste')), `${m.id} : plus de champ « poste » dans les formulaires de la page`);
        if (v.postes.ensuite) assert.ok(actions.has(v.postes.ensuite.action) && v.postes.ensuite.cartes.some((c) => c.valeur === (v.postes!.ensuite!.defaut ?? v.postes!.ensuite!.cartes[0].valeur)));
      }
    }
    assert.ok(avecOnglets >= 2, 'Asclépios et Alchimie ont des onglets'); assert.ok(avecPostes >= 6, 'six applis au moins proposent « Sur quel poste ? »');

    // Asclépios : quatre onglets, les trois cartes de la maquette dans « Analyser », les chiffres clés gardés.
    const ullr = await va.module('ullr')!.view(va.ctx('ullr'), new URLSearchParams());
    assert.deepEqual(ullr.onglets, ['Analyser', 'Résultats', 'Règles', 'Réglages']);
    assert.deepEqual(ullr.sections.filter((s) => s.onglet === 'Analyser').map((s) => `${s.kind}:${s.title}`), ['depot:Un fichier de cet appareil', 'form:Le fichier d\'un lien', 'actions:Cette machine', 'form:Vérifier une adresse web']);
    const carte = ullr.sections.find((s) => s.kind === 'actions') as Extract<Section, { kind: 'actions' }>;
    assert.deepEqual(carte.boutons.map((b) => [b.label, b.input?.dossier, Boolean(b.primary)]), [['Analyse rapide', 'rapide', true], ['Tout analyser', 'tout', false]]);
    assert.deepEqual(carte.liste?.valeurs.map((x) => x.label), ['Téléchargements', 'Sites web', 'Dossier personnel', 'Dossier temporaire']); assert.ok(carte.liste?.libre);
    assert.equal(ullr.postes?.titre, 'Analyser un autre poste'); assert.deepEqual(ullr.postes?.ensuite?.cartes.map((c) => c.valeur), ['rapide', 'tout', 'dossier']); assert.equal(ullr.postes?.ensuite?.cartes[2].demande?.champ, 'ou');
    // « Analyse rapide » de cette machine : là où les fichiers arrivent (téléchargements, boîte d'arrivée d'Odin, dossiers temporaires).
    const profils = PROFILES({ home: va.ctx('ullr').home });
    assert.ok(profils.rapide.includes('/tmp') && profils['téléchargements'].every((d) => profils.rapide.includes(d)) && !profils.rapide.includes('/'), 'le profil « rapide » existe et ne lit pas toute la machine');
    // « Un seul dossier » sans dossier : refusé avant toute connexion.
    const sans = await va.act('ullr', 'analyser_poste', { poste: '192.168.1.99', quoi: 'dossier' }); assert.equal(sans.ok, false);

    // Alchimie : la zone de dépôt, les derniers résultats à reprendre, et l'action qui dit ce qu'un fichier peut devenir.
    const alch = await va.module('dvalinn')!.view(va.ctx('dvalinn'), new URLSearchParams());
    assert.deepEqual(alch.sections.filter((s) => s.onglet === 'Convertir').map((s) => `${s.kind}:${s.title}`), ['depot:Convertir un fichier', 'list:Derniers résultats']);
    const poss = await va.act('dvalinn', 'possibles', { nom: 'film.mov' }); assert.equal(poss.ok, true); assert.equal((poss.data as { famille: string }).famille, 'vidéo');
  } finally { await tt.end(); }
});

test('route « Tester la connexion » : session exigée, refus clairs, le mot de passe n\'est jamais rendu', { timeout: 120_000 }, async () => {
  const tt = new T();
  try {
    const v = await vraiOdin(tt, { compte: true });
    const sans = await fetch(`${v.url}/api/valhalla/poste`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ adresse: '192.168.1.20', utilisateur: 'root', mot_de_passe: 'secret-a-ne-pas-montrer' }) });
    assert.ok(sans.status === 401 || sans.status === 403, `sans session : refusé (${sans.status})`);
    let r = (await v.json('/api/valhalla/poste', { adresse: '', utilisateur: 'root', mot_de_passe: 'x' })).body as { ok?: boolean; text?: string };
    assert.equal(r.ok, false); assert.match(r.text ?? '', /^Quel poste \?/);
    r = (await v.json('/api/valhalla/poste', { adresse: '192.168.1.20', utilisateur: '-oProxyCommand=id', mot_de_passe: 'secret-a-ne-pas-montrer' })).body as { ok?: boolean; text?: string };
    assert.equal(r.ok, false); assert.match(r.text ?? '', /utilisateur invalide/); assert.ok(!JSON.stringify(r).includes('secret-a-ne-pas-montrer'));
  } finally { await tt.end(); }
});

test('Odin arrêté pendant son démarrage : aucune appli ne démarre après l\'arrêt, celle en cours est arrêtée', async () => {
  const { Valhalla } = await import('../src/valhalla/service.ts');
  const { mkdtempSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'odin-arret-')), vu: string[] = [];
  const appli = (id: string, ms: number) => ({ id, name: id, family: 'Données' as const, what: '', does: [], from: [], upstream: [], words: [], actions: [], view: () => ({ sections: [] }),
    start: async () => { vu.push(`démarre ${id}`); await new Promise((r) => setTimeout(r, ms)); vu.push(`démarré ${id}`); }, stop: () => { vu.push(`arrêt ${id}`); }, watch: { every: 3600, run: () => { vu.push(`surveille ${id}`); } } });
  try {
    const v = new Valhalla(home, [appli('a', 60), appli('b', 1)], { run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => new Response('')) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
    const depart = v.start();
    v.stop();                      // coupé alors que « a » est encore en train de démarrer
    await depart;
    assert.ok(!vu.includes('démarre b'), `« b » ne démarre pas après l'arrêt (${vu.join(', ')})`);
    assert.equal(vu.at(-1), 'arrêt a', '« a », qui finissait de démarrer, est arrêtée à son tour');
    assert.equal((v as unknown as { timers: unknown[] }).timers.length, 0, 'aucune surveillance programmée après l\'arrêt');
    // Un nouveau démarrage repart normalement.
    vu.length = 0; await v.start(); assert.deepEqual(vu, ['démarre a', 'démarré a', 'démarre b', 'démarré b']); v.stop();
  } finally { rmSync(home, { recursive: true, force: true }); }
});
