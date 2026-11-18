// Vénus : un film, une série ou un album dont le titre est écrit dans une écriture non latine (japonais, arabe,
// cyrillique, grec, chinois, coréen, hindi…) reçoit un identifiant propre (plus « sans-titre »), se retrouve par son
// titre et se lit par l'action « regarder ». Un titre latin garde EXACTEMENT son identifiant et sa recherche d'avant.
// Titres inventés, dossiers temporaires, faux ffprobe : aucun service réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirVenus, MagasinVenus, magasinVenus, oublierMagasins, type Enr } from '../src/valhalla/venus/base.ts';
import { analyserNom, bibliotheque, episodes, lireDemande, norm, noterReprise, reprise, scanner, slug, trouverOeuvre, type FichierVu, type Outils, type Probe } from '../src/valhalla/venus/bibliotheque.ts';
import { venus, CIBLE_VENUS } from '../src/valhalla/modules/venus.ts';

// ---- La forme d'AVANT, recopiée telle quelle (référence : les titres latins ne doivent pas bouger d'un caractère).
const normAvant = (t: string): string => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const slugAvant = (t: string): string => normAvant(t).replace(/\s+/g, '-').slice(0, 80) || 'sans-titre';
const trouverAvant = (l: Enr[], q: string): Enr | undefined => {
  const direct = l.find((e) => e.id === q); if (direct) return direct;
  const n = normAvant(q); if (!n) return undefined;
  return l.find((e) => normAvant(String(e.data.titre)) === n) ?? l.filter((e) => n.split(' ').every((w) => normAvant(String(e.data.titre)).includes(w))).sort((a, b) => String(a.data.titre).length - String(b.data.titre).length)[0];
};

const LATINS = [
  'Inception', 'One Piece', 'Le Fabuleux Destin d\'Amélie Poulain', 'Amélie', 'AMELIE', 'Léon', 'Straße der Sehnsucht', 'Œdipe Roi', 'Ærø Fortællinger',
  'Ça', 'Sólo con tu pareja', 'El laberinto del fauno', 'Cidade de Deus', 'Ladri di biciclette', 'Smultronstället', 'Das Boot', 'Pépé le Moko',
  'Łódź Nocą', 'Dziady', 'Kış Uykusu', 'Bao Ninh', 'Phở Hà Nội', 'Ngũ Long', 'Moana', 'Kirikou et la Sorcière', 'Mwana wa Mitsamiouli',
  'Shimaore Leo', 'Kibushi Tsara', 'Dark', 'Dark 2', 'The Matrix', 'The Matrix Reloaded', 'Star Wars: Episode IV – A New Hope', 'Se7en',
  '2001: A Space Odyssey', '12 Angry Men', '(500) Days of Summer', 'Mission: Impossible – Fallout', 'Spider-Man: No Way Home', 'WALL·E',
  'M*A*S*H', 'Fast & Furious', 'Ocean\'s Eleven', 'Rocky Ⅱ', 'Ｆｉｌｍ Ｌａｒｇｅ', 'Mère & Fils', 'Ève', 'Noël', 'Garçon', 'Über alles',
  'Ñandú', 'São Paulo', 'Nicolás', 'Dvořák', 'Šťastný', 'Ørsted', 'Ísland', 'Þór', 'Dagur', 'Æsir', 'Smørrebrød', 'Ğazi', 'İstanbul',
  'Spirited Away', 'Your Name.', 'Attack on Titan', 'Breaking Bad', 'Stranger Things', 'Les Misérables', 'Les Trois Lunes', 'Serie Lumen',
  'Nuit Rouge', 'Été Glacé', 'Brume', 'Brume!', 'brume', 'A', 'Z', '1917', '300', 'Blade Runner 2049', 'Alien³', 'Fargo²', 'Up',
  'It', 'Her', 'Us', 'Coco', 'Soul', 'Luca', 'Elio', 'Wish', 'Mulan', 'Aladdin', 'Hercules', 'Tarzan', 'Bambi', 'Dumbo', 'Pinocchio',
  'Fantasia 2000', 'Un titre très long qui dépasse largement quatre-vingts caractères pour vérifier que la coupe est la même qu\'avant, exactement',
];

/** Un titre par écriture (inventés), avec ses « premiers mots » tels qu'on les dit. */
const ECRITURES: Array<{ ecriture: string; titre: string; debut: string }> = [
  { ecriture: 'japonais', titre: '霧の向こうの町', debut: '霧の向こう' },
  { ecriture: 'arabe', titre: 'قصة المدينة البعيدة', debut: 'قصة المدينة' },
  { ecriture: 'cyrillique', titre: 'Тихий Дом у Реки', debut: 'тихий дом' },
  { ecriture: 'grec', titre: 'Το Σπίτι στη Θάλασσα', debut: 'το σπίτι' },
  { ecriture: 'chinois', titre: '山中的灯火', debut: '山中' },
  { ecriture: 'coréen', titre: '바다 위의 집', debut: '바다 위의' },
  { ecriture: 'hindi', titre: 'नदी के किनारे घर', debut: 'नदी के' },
  { ecriture: 'hébreu', titre: 'בית ליד הים', debut: 'בית ליד' },
  { ecriture: 'thaï', titre: 'บ้านริมทะเล', debut: 'บ้านริม' },
  { ecriture: 'amharique', titre: 'የባህር ዳር ቤት', debut: 'የባህር ዳር' },
];

const FORME = /^[a-z0-9-]{1,80}$/;

test('cent titres latins : identifiant et forme de recherche EXACTEMENT ceux d\'avant (et deux mille titres tirés au hasard)', () => {
  assert.ok(LATINS.length >= 100, `${LATINS.length} titres`);
  // Un seul titre de la liste n'avait pas d'identifiant propre (lettres pleine chasse → « sans-titre ») : il en reçoit un.
  const sansIdAvant = LATINS.filter((t) => slugAvant(t) === 'sans-titre');
  assert.deepEqual(sansIdAvant, ['Ｆｉｌｍ Ｌａｒｇｅ']); assert.match(slug(sansIdAvant[0]), /^u--[0-9a-f]{40}$/);
  for (const t of LATINS) { if (!sansIdAvant.includes(t)) assert.equal(slug(t), slugAvant(t), t); assert.equal(norm(t), normAvant(t), t); }
  // Tirage au hasard (graine fixe) dans les caractères latins, communs et les accents combinants.
  const pool = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789      .,;:!?\'"-–—_()[]&*/#@+=%~·²³¹½ßæøœþðłđħıĳŋſÆØŒÞÐŁĐĦİĲŊàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćČčĎďĒēĘęĚěĞğĪīŃńŇňŌōŐőŘřŚśŞşŠšŢţŤťŪūŮůŰűŹźŻżŽžǅǈǋẞḀḁẠạỲỳ'
    + 'ＡＢＣａｂｃ０１２ⅠⅡⅫ①②★☆♪€$©®™̸̧̀́̂̈᷄⃗­​  '];
  let x = 20261118;
  const r = () => { x = (x * 1103515245 + 12345) % 2147483648; return x; };
  for (let i = 0; i < 2000; i++) {
    let t = ''; const n = 1 + (r() % 40); for (let k = 0; k < n; k++) t += pool[r() % pool.length];
    const avant = slugAvant(t), apres = slug(t);
    assert.equal(norm(t), normAvant(t), JSON.stringify(t));
    // Seul « sans-titre » (un titre que l'ancienne forme ne savait pas lire) peut changer, jamais un identifiant propre.
    if (avant !== 'sans-titre') assert.equal(apres, avant, JSON.stringify(t));
  }
});

test('cent titres latins : la recherche rend exactement ce qu\'elle rendait', () => {
  const home = mkdtempSync(join(tmpdir(), 'venus-ecr-'));
  try {
    const m = new MagasinVenus(home, join(home, 'freyja'));
    for (const t of LATINS) m.poser('oeuvres', `film:${slugAvant(t)}`, { type: 'film', titre: t });
    const l = m.liste('oeuvres');
    const questions = LATINS.flatMap((t) => { const w = t.split(' '); return [t, t.toUpperCase(), normAvant(t), w[0], w.slice(0, 2).join(' '), w[w.length - 1]]; })
      .concat(['', '   ', '!!!', 'amelie', 'brume', 'matrix', 'zz inconnu', 'film:inception', 'film:sans-titre']);
    for (const q of questions) assert.equal(trouverOeuvre(m, q)?.id, trouverAvant(l, q)?.id, JSON.stringify(q));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('dix écritures : identifiants distincts, stables, de la forme stricte ; formes équivalentes = même identifiant', () => {
  const ids = ECRITURES.map((e) => slug(e.titre));
  for (const [i, e] of ECRITURES.entries()) {
    assert.equal(slugAvant(e.titre), 'sans-titre', `${e.ecriture} : avant, « sans-titre »`);
    assert.match(ids[i], FORME, e.ecriture); assert.match(ids[i], /^u--[0-9a-f]{40}$/, e.ecriture);
    assert.ok(CIBLE_VENUS.test(`serie:${ids[i]}:s2e5`) && CIBLE_VENUS.test(`film:${ids[i]}-2001`) && CIBLE_VENUS.test(`album:${ids[i]}:p1:${ids[i]}`), e.ecriture);
    assert.equal(slug(e.titre), ids[i], 'stable');
    assert.equal(slug(e.titre.normalize('NFD')), ids[i], `${e.ecriture} : forme décomposée`);
    assert.equal(slug(e.titre.toUpperCase()), ids[i], `${e.ecriture} : casse`);
    assert.equal(slug(`  ${e.titre.replace(/ /g, '  ')} `), ids[i], `${e.ecriture} : espaces`);
  }
  assert.equal(new Set(ids).size, ids.length, 'dix identifiants différents');
  // Même valeur sur toute machine : l'empreinte est fixée ici (SHA-256 du titre en minuscules NFC).
  assert.equal(slug('霧の向こうの町'), 'u--147c1063fbaad54fd908b6b707064079a0a03012');
  // Accent écrit de deux façons, casse : même identifiant. Accent différent : identifiants différents.
  assert.equal(slug('ΕΛΛΗΝΙΚΆ ΝΎΧΤΑ'), slug('ελληνικά νύχτα')); assert.equal(slug('ελληνικά νύχτα'.normalize('NFD')), slug('ελληνικά νύχτα'));
  assert.notEqual(slug('Мой дом'), slug('Мои дом'), 'й n\'est pas и');
  assert.notEqual(slug('が'), slug('か'), 'が n\'est pas か');
  // Titres mêlant deux écritures SANS partie latine : distincts entre eux. Un titre mêlé qui a une partie latine garde
  // l'identifiant d'avant (décision de la session : voir l'essai des titres mêlés).
  const meles = ['霧 Тихий', 'Тихий 霧', '霧', 'Тихий', '霧 Тихии', 'قصة ٣', 'قصة ٢', 'قصة 霧', 'Δ 霧'];
  assert.equal(new Set(meles.map(slug)).size, meles.length, meles.map(slug).join(' '));
  for (const t of meles) assert.match(slug(t), /^u--[0-9a-f]{40}$/, t);
  assert.equal(slug('Brume'), 'brume', 'le titre latin garde son identifiant');
  // Titres très longs qui ne diffèrent qu'à la fin.
  const long = '霧の向こうの町'.repeat(60);
  const longs = [long + 'あ', long + 'い', long + 'い い', long + ' 1', long + ' 2', `${'Тихий Дом '.repeat(40)}А`, `${'Тихий Дом '.repeat(40)}Б`];
  const lids = longs.map(slug);
  assert.equal(new Set(lids).size, longs.length);
  for (const id of lids) assert.ok(id.length <= 43 && FORME.test(id), id);
  // Plus aucun « sans-titre », sauf un titre vraiment vide (ni lettre, ni chiffre, ni symbole).
  for (const t of ['Ｆｉｌｍ Ｌａｒｇｅ', 'ß', '²', '🎬', '★☆']) assert.match(slug(t), /^u--[0-9a-f]{40}$/, t);
  assert.notEqual(slug('🎬'), slug('★☆'));
  for (const t of ['', '   ', '!!!', '---', '(…)']) assert.equal(slug(t), 'sans-titre', JSON.stringify(t));
});

test('la recherche dans toutes les écritures : titre exact, premiers mots, sans casse ni accents là où ils existent', () => {
  const home = mkdtempSync(join(tmpdir(), 'venus-ecr-'));
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home));
    for (const e of ECRITURES) m.poser('oeuvres', `film:${slug(e.titre)}`, { type: 'film', titre: e.titre });
    m.poser('oeuvres', 'film:brume', { type: 'film', titre: 'Brume' });
    for (const e of ECRITURES) {
      assert.equal(trouverOeuvre(m, e.titre)?.data.titre, e.titre, `${e.ecriture} : titre exact`);
      assert.equal(trouverOeuvre(m, e.debut)?.data.titre, e.titre, `${e.ecriture} : premiers mots`);
      assert.equal(trouverOeuvre(m, e.titre.toUpperCase().normalize('NFD'))?.data.titre, e.titre, `${e.ecriture} : casse et forme`);
      assert.equal(bibliotheque(m, { q: e.debut }).map((c) => c.titre).join('|'), e.titre, `${e.ecriture} : bibliothèque`);
      assert.ok(norm(e.titre).length > 0, 'aucune lettre effacée');
    }
    assert.equal(trouverOeuvre(m, 'το σπιτι')?.data.titre, 'Το Σπίτι στη Θάλασσα', 'grec sans accent');
    assert.equal(norm('が'), 'が'); assert.equal(norm('한국'), '한국'); assert.equal(norm('हिन्दी'), 'हिन्दी');
    assert.equal(trouverOeuvre(m, 'Brume')?.id, 'film:brume'); assert.equal(trouverOeuvre(m, '霧の向こうの町 Brume'), undefined);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('un vrai titre latin « Sans titre » se retrouve toujours par son titre, comme avant', () => {
  const home = mkdtempSync(join(tmpdir(), 'venus-ecr-'));
  try {
    const m = new MagasinVenus(home, join(home, 'freyja'));
    assert.equal(slug('Sans titre'), 'sans-titre'); assert.equal(slug('Sans-titre'), 'sans-titre');
    m.poser('oeuvres', 'film:sans-titre-2019', { type: 'film', titre: 'Sans titre', annee: 2019 });
    m.poser('oeuvres', 'film:sans-titre-2-2019', { type: 'film', titre: 'Sans titre 2', annee: 2019 });
    m.poser('oeuvres', 'film:inception-2019', { type: 'film', titre: 'Inception', annee: 2019 });
    m.poser('oeuvres', 'serie:sans-titre', { type: 'serie', titre: 'Sans-titre' });
    const l = m.liste('oeuvres');
    for (const q of ['Sans titre', 'sans-titre', 'SANS TITRE', 'Sans', 'titre', 'Sans titre 2', 'Inception'])
      assert.equal(trouverOeuvre(m, q)?.id, trouverAvant(l, q)?.id, JSON.stringify(q));
    assert.equal(trouverOeuvre(m, 'Sans titre')?.id, 'film:sans-titre-2019');
    // Seul dans la bibliothèque, il se retrouve aussi.
    const m2 = new MagasinVenus(join(home, 'b'), join(home, 'b', 'freyja'));
    m2.poser('oeuvres', 'film:sans-titre-2019', { type: 'film', titre: 'Sans titre', annee: 2019 });
    assert.equal(trouverOeuvre(m2, 'Sans titre')?.id, 'film:sans-titre-2019');
    // L'ancien amas non latin rangé sous « sans-titre » reste, lui, hors de la recherche par titre.
    m2.poser('oeuvres', 'film:sans-titre-2001', { type: 'film', titre: '山中的灯火', annee: 2001 });
    assert.equal(trouverOeuvre(m2, '山中的灯火'), undefined);
    assert.equal(trouverOeuvre(m2, 'film:sans-titre-2001')?.id, 'film:sans-titre-2001');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('saison et épisode d\'un nom de fichier se lisent quelle que soit l\'écriture du titre ; chiffres d\'une autre écriture : non lus', () => {
  assert.deepEqual(analyserNom('霧の向こうの町 S02E05.mkv'), { titre: '霧の向こうの町', saison: 2, episode: 5 });
  assert.deepEqual(analyserNom('霧の向こうの町S02E05.mkv'), { titre: '霧の向こうの町', saison: 2, episode: 5 });
  assert.deepEqual(analyserNom('قصة المدينة 2x05.mp4'), { titre: 'قصة المدينة', saison: 2, episode: 5 });
  assert.deepEqual(analyserNom('Тихий.Дом.S01E03.1080p.mkv'), { titre: 'Тихий Дом', saison: 1, episode: 3 });
  assert.deepEqual(analyserNom('Το Σπίτι 2004.mkv'), { titre: 'Το Σπίτι', annee: 2004 });
  assert.deepEqual(lireDemande('霧の向こうの町 S02E05'), { titre: '霧の向こうの町', saison: 2, episode: 5 });
  // Ce qui se passe aujourd'hui (constaté, pas corrigé) : chiffres pleine chasse et arabes-indiens ne sont pas lus
  // comme saison ou épisode ; ils restent dans le titre (aucun épisode inventé).
  assert.equal(analyserNom('霧の町 Ｓ０２Ｅ０５.mkv').saison, undefined);
  assert.equal(analyserNom('قصة ٢x٠٥.mkv').saison, undefined);
  assert.equal(lireDemande('霧の町 Ｓ０２Ｅ０５').saison, undefined);
});

const probe = (duree = 1000): Probe => ({ duree, hauteur: 1080, largeur: 1920, codecs: ['h264'], audio: ['aac'], sousTitres: [] });
const sansCle = async (f: () => Promise<void>) => { const cle = process.env.VENUS_API_KEY; delete process.env.VENUS_API_KEY; try { await f(); } finally { if (cle === undefined) delete process.env.VENUS_API_KEY; else process.env.VENUS_API_KEY = cle; } };

test('scan : deux œuvres japonaises ne se confondent plus ; ce qui était rangé sous « sans-titre » n\'est attribué à aucune œuvre', async () => {
  const home = mkdtempSync(join(tmpdir(), 'venus-ecr-'));
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home));
    // L'état d'avant : une œuvre « film:sans-titre » (le dernier film non latin scanné) et sa reprise.
    m.poser('oeuvres', 'film:sans-titre', { type: 'film', titre: '山中的灯火', fichier: '/films/山中的灯火.mkv', duree: 1000 });
    m.poser('oeuvres', 'serie:sans-titre', { type: 'serie', titre: '霧の向こうの町' });
    m.poser('episodes', 'serie:sans-titre:s1e1', { oeuvre_id: 'serie:sans-titre', saison: 1, episode: 1, titre: 'x', fichier: '/series/バラ/バラ S01E01.mkv', duree: 1000 });
    noterReprise(m, 'moi', 'film:sans-titre', 500, 1000); noterReprise(m, 'moi', 'serie:sans-titre:s1e1', 300, 1000);
    m.poser('dossiers', 'f', { chemin: '/films', categorie: 'films', actif: true });
    m.poser('dossiers', 's', { chemin: '/series', categorie: 'series', actif: true });
    const faux: Record<string, FichierVu[]> = {
      '/films': ['霧の向こうの町.mkv', '山中的灯火.mkv', 'قصة المدينة البعيدة 2019.mkv', 'Brume.mkv'].map((n) => ({ chemin: `/films/${n}`, taille: 1, mtime: 1 })),
      '/series': ['霧の向こうの町/霧の向こうの町 S02E05.mkv', 'バラ/バラ S01E01.mkv'].map((n) => ({ chemin: `/series/${n}`, taille: 1, mtime: 1 })),
    };
    const outils: Outils = { parcourir: (d) => faux[d] ?? [], ffprobe: async () => probe() };
    const b = await scanner(m, outils);
    assert.equal(b.oeuvres, 6, 'quatre films et deux séries distincts');
    const films = m.liste('oeuvres').filter((e) => e.data.type === 'film' && !e.id.endsWith('sans-titre'));
    assert.equal(new Set(films.map((e) => e.id)).size, 4);
    for (const e of m.liste('oeuvres')) assert.ok(CIBLE_VENUS.test(e.id), e.id);
    assert.equal(trouverOeuvre(m, 'Brume')?.id, 'film:brume', 'le titre latin garde son identifiant');
    const arabe = trouverOeuvre(m, 'قصة المدينة البعيدة');
    assert.equal(arabe?.id, `film:${slug('قصة المدينة البعيدة')}-2019`);
    // Le titre japonais est à la fois un film et une série : la recherche ne prend plus l'ancien « sans-titre ».
    const chinois = trouverOeuvre(m, '山中的灯火'); assert.equal(chinois?.id, `film:${slug('山中的灯火')}`);
    const serie = m.get('oeuvres', `serie:${slug('霧の向こうの町')}`); assert.ok(serie);
    assert.deepEqual(episodes(m, serie!.id).map((e) => e.id), [`serie:${slug('霧の向こうの町')}:s2e5`]);
    // L'ancienne reprise n'est ni effacée ni attribuée : la nouvelle œuvre repart de zéro.
    assert.equal(reprise(m, 'moi', chinois!.id), undefined);
    assert.equal(reprise(m, 'moi', `serie:${slug('バラ')}:s1e1`), undefined);
    assert.deepEqual(reprise(m, 'moi', 'film:sans-titre'), { position_s: 500, duree_s: 1000 });
    assert.ok(m.get('oeuvres', 'film:sans-titre'), 'rien n\'est effacé');
    assert.equal(trouverOeuvre(m, 'film:sans-titre')?.id, 'film:sans-titre', 'toujours joignable par son identifiant');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('de bout en bout, « regarder » : une série au titre japonais (S02E05) et un film au titre arabe → la bonne œuvre, le bon épisode, la ligne « Lire » de forme stricte', async () => {
  await sansCle(async () => {
    const home = mkdtempSync(join(tmpdir(), 'venus-ecr-'));
    try {
      oublierMagasins(); const dir = dirVenus(home), m = magasinVenus(home, dir);
      m.poser('dossiers', 'f', { chemin: '/films', categorie: 'films', actif: true });
      m.poser('dossiers', 's', { chemin: '/series', categorie: 'series', actif: true });
      const faux: Record<string, FichierVu[]> = {
        '/films': ['قصة المدينة البعيدة.mkv', 'قصة المدينة القريبة.mkv', '山中的灯火.mkv'].map((n) => ({ chemin: `/films/${n}`, taille: 1, mtime: 1 })),
        '/series': ['霧の向こうの町 S01E01.mkv', '霧の向こうの町 S02E04.mkv', '霧の向こうの町 S02E05.mkv', 'バラの町 S02E05.mkv'].map((n) => ({ chemin: `/series/${n.split(' ')[0]}/${n}`, taille: 1, mtime: 1 })),
      };
      await scanner(m, { parcourir: (d) => faux[d] ?? [], ffprobe: async () => probe() });
      const ctx = { home, dir, settings: {}, saveSettings() {}, alert() {}, emit() {}, now: () => new Date() } as never;
      const regarder = venus(() => '').actions.find((a) => a.id === 'regarder')!;
      const run = (i: Record<string, unknown>) => regarder.run(ctx, { ou: '', ...i }) as Promise<{ text: string; data?: Record<string, unknown> }>;
      const ligne = (t: string) => /\n\n\[▶ Vénus : ([^\]\n]+)\]$/.exec(t)?.[1];

      const s = await run({ quoi: '霧の向こうの町 S02E05' });
      assert.match(s.text, /« 霧の向こうの町 » S02E05/);
      assert.equal(s.data?.cible, `serie:${slug('霧の向こうの町')}:s2e5`);
      assert.equal(ligne(s.text), s.data?.cible); assert.ok(CIBLE_VENUS.test(String(ligne(s.text))));
      assert.match(String(ligne(s.text)), /^serie:u--[0-9a-f]{40}:s2e5$/);
      const s2 = await run({ quoi: '霧の向こうの町', saison: 2, episode: 4 });
      assert.equal(s2.data?.cible, `serie:${slug('霧の向こうの町')}:s2e4`, 'saison et épisode donnés à part');

      const f = await run({ quoi: 'قصة المدينة البعيدة' });
      assert.match(f.text, /« قصة المدينة البعيدة »/);
      assert.equal(f.data?.cible, `film:${slug('قصة المدينة البعيدة')}`);
      assert.notEqual(f.data?.cible, `film:${slug('قصة المدينة القريبة')}`, 'pas l\'autre film arabe');
      assert.ok(CIBLE_VENUS.test(String(ligne(f.text))) && ligne(f.text) === f.data?.cible);

      const absent = await run({ quoi: '月の町' });
      assert.match(absent.text, /n'est pas dans ta bibliothèque/); assert.doesNotMatch(absent.text, /\[▶ Vénus/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});

test('titres mêlés (lettres latines et autre écriture) : ils gardent EXACTEMENT leur identifiant d\'avant ; seul « sans-titre » change', async () => {
  // Décision de la session (règle la plus prudente) : un titre dont l'ancienne forme donnait un identifiant propre le garde.
  const meles: Array<[string, string]> = [['霧 Brume', 'brume'], ['Life of π', 'life-of'], ['Film ٣', 'film'], ['Δ Delta', 'delta'], ['Ponyo 崖の上', 'ponyo'], ['01 霧の歌.mp3', '01-mp3']];
  for (const [t, id] of meles) { assert.equal(slugAvant(t), id, t); assert.equal(slug(t), id, t); }
  const home = mkdtempSync(join(tmpdir(), 'venus-ecr-'));
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home));
    // L'état d'avant : la reprise d'un film mêlé et celle d'une piste au nom non latin dans un album latin.
    noterReprise(m, 'moi', 'film:brume', 400, 1000); noterReprise(m, 'moi', 'album:chansons-du-port:p1:01-mp3', 60, 200);
    m.poser('dossiers', 'f', { chemin: '/films', categorie: 'films', actif: true });
    m.poser('dossiers', 'm', { chemin: '/musique', categorie: 'musique', actif: true });
    const faux: Record<string, FichierVu[]> = {
      '/films': [{ chemin: '/films/霧 Brume.mkv', taille: 1, mtime: 1 }],
      '/musique': [{ chemin: '/musique/Chansons du port/01 霧の歌.mp3', taille: 1, mtime: 1 }],
    };
    await scanner(m, { parcourir: (d) => faux[d] ?? [], ffprobe: async () => probe() });
    const film = trouverOeuvre(m, '霧 Brume'); assert.equal(film?.id, 'film:brume');
    assert.deepEqual(reprise(m, 'moi', film!.id), { position_s: 400, duree_s: 1000 }, 'la reprise suit le titre mêlé');
    assert.ok(m.get('pistes', 'album:chansons-du-port:p1:01-mp3'), 'la piste garde son identifiant');
    assert.deepEqual(reprise(m, 'moi', 'album:chansons-du-port:p1:01-mp3'), { position_s: 60, duree_s: 200 });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('un titre latin « Sans titre AAAA » (année restée dans le titre) se retrouve par son titre, comme avant', async () => {
  // Une série « Sans titre 2024 » et un album « Sans titre 1999 » : identifiants « …:sans-titre-AAAA », titres latins.
  const home = mkdtempSync(join(tmpdir(), 'venus-ecr-'));
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home));
    m.poser('dossiers', 's', { chemin: '/series', categorie: 'series', actif: true });
    m.poser('dossiers', 'm', { chemin: '/musique', categorie: 'musique', actif: true });
    const faux: Record<string, FichierVu[]> = {
      '/series': [{ chemin: '/series/Sans titre 2024/Sans titre 2024 S01E01.mkv', taille: 1, mtime: 1 }],
      '/musique': [{ chemin: '/musique/Sans titre 1999/01 Intro.mp3', taille: 1, mtime: 1 }],
    };
    await scanner(m, { parcourir: (d) => faux[d] ?? [], ffprobe: async () => probe() });
    const ids = m.liste('oeuvres').map((e) => e.id).sort();
    assert.deepEqual(ids, ['album:sans-titre-1999', 'serie:sans-titre-2024']);
    const l = m.liste('oeuvres');
    for (const q of ['Sans titre 2024', 'Sans titre 1999', 'sans titre', 'SANS TITRE 2024', '1999', 'serie:sans-titre-2024'])
      assert.equal(trouverOeuvre(m, q)?.id, trouverAvant(l, q)?.id, JSON.stringify(q));
    assert.equal(trouverOeuvre(m, 'Sans titre 2024')?.id, 'serie:sans-titre-2024');
    assert.equal(trouverOeuvre(m, 'Sans titre 1999')?.id, 'album:sans-titre-1999');
    // L'ancien amas non latin sous « sans-titre-AAAA » reste, lui, hors de la recherche par titre.
    m.poser('oeuvres', 'film:sans-titre-2001', { type: 'film', titre: '山中的灯火', annee: 2001 });
    assert.equal(trouverOeuvre(m, '山中的灯火'), undefined);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
