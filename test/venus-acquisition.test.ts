// Vénus · la chaîne d'acquisition native, de bout en bout, SANS réseau : un serveur HTTP local (127.0.0.1, port libre)
// joue la source (format de recherche standard des indexeurs) et les fichiers. Un vrai Odin (Valhalla + les vraies
// applis), un faux antivirus, un faux ffprobe (rien d'installé).
//   à venir → demande (Hnoss) → Sirius → Delta trouve → Comète télécharge → rangé, renommé → scanné → visible dans Vénus
//   même chose pour une série (Pléiades, l'épisode manquant seulement) ; refus pour un membre sans droit ; demande d'un
//   membre à valider ; chemin piégé ; fichier qui n'est pas une vidéo ; taille fausse ; annuler ; pause et reprendre.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { brancherGarde, type Passage } from '../src/valhalla/ullr/garde.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';
import { magasinVenus } from '../src/valhalla/venus/base.ts';
import { ajouterDossier, bibliotheque, fichierDeCible, scanner, type Outils } from '../src/valhalla/venus/bibliotheque.ts';
import { attendreComete, cheminFinal, cheminRelatif, nomSur, reglerOutilsComete, telechargement } from '../src/valhalla/venus/comete/index.ts';
import { lireFlux, meilleur } from '../src/valhalla/venus/delta/index.ts';

const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const video = (n: number) => Buffer.concat([EBML, randomBytes(n)]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const FICHIERS: Record<string, Buffer> = {
  '/f/dune720.mkv': video(4000), '/f/dune1080.mkv': video(5000), '/f/autre.mkv': video(3000),
  '/f/etoiles-s01e01.mkv': video(2000), '/f/etoiles-s01e02.mkv': video(2100),
  '/f/piege.mkv': Buffer.concat([Buffer.from('MZ'), randomBytes(3000)]),
  '/f/mensonge.mkv': video(3000), '/f/evil.mkv': video(2500),
  '/f/lent.mkv': video(3 * 1024 * 1024), '/f/pause.mkv': video(3 * 1024 * 1024 + 77),
  '/f/tard.mkv': video(2200),
};
const requetes: string[] = [];
const item = (titre: string, lien: string, taille?: number, type = 'video/x-matroska') => `<item><title>${titre}</title><link>${lien}</link><enclosure url="${lien}" length="${taille ?? 0}" type="${type}"/>${taille ? `<torznab:attr name="size" value="${taille}"/>` : ''}</item>`;
const F = 'http://fichiers.exemple.test';
function flux(q: URLSearchParams): string {
  const t = q.get('q') ?? '', items: string[] = [];
  if (t === 'Dune Part Two') items.push(item('Dune.Part.Two.2024.2160p.MULTI', 'magnet:?xt=urn:btih:0000000000000000000000000000000000000000', 9e9, 'application/x-bittorrent'), item('Dune.Part.Two.2024.720p.WEB', `${F}/f/dune720.mkv`, FICHIERS['/f/dune720.mkv'].length), item('Dune.Part.Two.2024.1080p.MULTI.WEB', `${F}/f/dune1080.mkv`, FICHIERS['/f/dune1080.mkv'].length), item('Autre.Film.2024.1080p', `${F}/f/autre.mkv`), item('Dune.Part.Two.2024.1080p.setup', `${F}/f/setup.exe`, 100, 'application/octet-stream'));
  if (t === 'Les Etoiles') { const ep = q.get('ep'); for (const e of [1, 2]) if (!ep || Number(ep) === e) items.push(item(`Les.Etoiles.S01E0${e}.1080p.WEB`, `${F}/f/etoiles-s01e0${e}.mkv`, FICHIERS[`/f/etoiles-s01e0${e}.mkv`].length)); }
  if (t === 'Kumo') items.push(item('Kumo.S01E01.1080p.VOSTFR', `${F}/f/etoiles-s01e01.mkv`, FICHIERS['/f/etoiles-s01e01.mkv'].length));
  if (t === 'Piege') items.push(item('Piege.2023.1080p', `${F}/f/piege.mkv`));
  if (t === 'Mensonge') items.push(item('Mensonge.2023.1080p', `${F}/f/mensonge.mkv`, 10_000_000));
  if (t === '../../../Evil') items.push(item('Evil.2024.1080p', `${F}/f/evil.mkv`));
  if (t === 'Lent') items.push(item('Lent.2022.1080p', `${F}/f/lent.mkv`));
  if (t === 'Pause') items.push(item('Pause.2022.1080p', `${F}/f/pause.mkv`));
  if (t === 'Doute' || t === 'Doute Accepte') items.push(item(`${t.replace(' ', '.')}.2020.1080p`, `${F}/f/tard.mkv`));
  if (t === 'Tard') items.push(item('Tard.2021.1080p', `${F}/f/tard.mkv`));
  if (t === 'Jonction') items.push(item('Jonction.S01E01.1080p', `${F}/f/etoiles-s01e01.mkv`, FICHIERS['/f/etoiles-s01e01.mkv'].length));
  return `<?xml version="1.0"?><rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${items.join('')}</channel></rss>`;
}
const srv = createServer((req, res) => {
  const u = new URL(req.url!, 'http://x'); requetes.push(`${u.pathname}?${u.searchParams.toString()}`);
  if (u.pathname === '/api') { res.writeHead(200, { 'content-type': 'application/rss+xml' }); res.end(u.searchParams.get('t') === 'caps' ? '<caps><searching/></caps>' : flux(u.searchParams)); return; }
  const corps = FICHIERS[u.pathname]; if (!corps) { res.writeHead(404); res.end(); return; }
  const m = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range ?? '')), etag = `"${sha(corps).slice(0, 12)}"`;
  if (m) { const d = Number(m[1]), f = m[2] ? Number(m[2]) : corps.length - 1, part = corps.subarray(d, f + 1); res.writeHead(206, { 'content-range': `bytes ${d}-${f}/${corps.length}`, 'content-length': part.length, 'accept-ranges': 'bytes', etag }); res.end(part); return; }
  res.writeHead(200, { 'content-length': corps.length, etag }); res.end(corps);
});
let base = '';
const home = mkdtempSync(join(tmpdir(), 'venus-acq-')), messages: string[] = [];
const local: typeof fetch = (u, i) => fetch(String(u).replace(/^http:\/\/(indexeur|fichiers)\.exemple\.test/, base), i);
// `retenue` : l'essai garde la lecture du fichier en suspens (pour annuler pendant les vérifications).
let retenue: Promise<void> | undefined;
// `douteux` : l'antivirus d'essai a un doute (sans bloquer).
let douteux = false;
const faux: Outils = { ffprobe: async (f) => (await retenue, readFileSync(f).subarray(0, 4).equals(EBML) ? { duree: 120, hauteur: 1080, codecs: ['h264'], audio: ['aac'], sousTitres: [] } : null) };
let v: Valhalla;
const mag = () => magasinVenus(home, v.ctx('freyja').dir);
const films = join(home, 'Medias', 'Films'), series = join(home, 'Medias', 'Series');
const act = (a: string, i: Record<string, unknown> = {}) => v.act('freyja', a, i);
const membre = (login: string, a: string, i: Record<string, unknown>) => auNomDe({ login, name: `Membre ${login}`, groups: ['invite'] }, () => v.act('freyja', a, i));
const demandes = () => (mag().liste('demandes').map((e) => ({ id: e.id, ...e.data })) as Array<Record<string, unknown>>);

before(async () => {
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening'); base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  // Réglage d'essai explicite : le réseau passe par le serveur local (jamais par défaut).
  reglerOutilsComete({ outils: faux, resoudre: async (h) => (/\.exemple\.test$/.test(h) ? ['203.0.113.10'] : []), reseauEssai: local });
  brancherGarde(async (): Promise<Passage> => ({ ok: !douteux, bloque: false, analyse: true, sha256: '0'.repeat(64), taille: 1, score: 0, pourquoi: [], texte: 'rien', gardien: 'asclepios' } as Passage));
  setVerificateur((id, q) => (id === 'freyja' && q.login === 'sans-droit' ? "Tu n'as pas le droit d'ouvrir Vénus." : undefined));
  v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { notify: async (t: string) => { messages.push(t); }, autonomy: () => 'equilibre', fetch: local } as never);
  const ullr = v.modules().find((m) => m.id === 'ullr')!.actions.find((a) => a.id === 'adresse')!;
  ullr.run = (async () => ({ text: '', data: { score: 0 } })) as typeof ullr.run;
  mkdirSync(films, { recursive: true }); mkdirSync(series, { recursive: true });
});
after(async () => { await attendreComete(); v?.stop(); srv.close(); brancherGarde(undefined); reglerOutilsComete(); rmSync(home, { recursive: true, force: true }); });

test('purs : flux lu, liens de partage écartés, meilleur choix, noms et chemins sûrs', () => {
  const l = lireFlux(flux(new URLSearchParams({ q: 'Dune Part Two' })), { id: 's', nom: 'S' });
  assert.equal(l.length, 5);
  assert.equal(l[0].genre, 'partage'); assert.equal(l[4].genre, 'inconnu', 'un .exe n\'est pas un lien direct');
  const b = meilleur(l, { genre: 'film', titre: 'Dune Part Two', annee: 2024 }, { qualite: '1080p', tailleMaxOctets: 1e12, langue: 'vf' });
  assert.equal(b.choisi?.lien, `${F}/f/dune1080.mkv`);
  assert.ok(b.ecartes.some((e) => /partage/.test(e.pourquoi)) && b.ecartes.some((e) => /autre titre/.test(e.pourquoi)) && b.ecartes.some((e) => /720p|en dessous/.test(e.pourquoi)));
  assert.equal(nomSur('../../../Evil'), 'Evil');
  assert.throws(() => cheminFinal(films, ['..', 'x.mkv']), /hors du dossier/);
  assert.throws(() => cheminRelatif({ genre: 'film', titre: 'X' }, '.exe'), /pas une vidéo/);
  assert.deepEqual(cheminRelatif({ genre: 'episode', titre: 'Série', saison: 1, episode: 2 }, '.MKV'), ['Série', 'Saison 01', 'Série - S01E02.mkv']);
});

test('sources : réglées par le propriétaire seul, aucune pré-remplie, la clé jamais dans la base ni dans un texte', async () => {
  assert.match((await act('delta_sources')).text, /Aucune source/);
  assert.equal((await v.act('freyja', 'delta_ajouter', { nom: 'Mon indexeur', adresse: 'http://indexeur.exemple.test/api', cle: 'cle-essai-123' }, { qui: 'member' })).ok, false, 'un membre ne règle pas une source');
  assert.equal((await act('delta_ajouter', { nom: 'Machine', adresse: 'http://127.0.0.1:9/api' })).ok, false, 'la machine d\'Odin : refusée');
  const r = await act('delta_ajouter', { nom: 'Mon indexeur', type: 'torznab', adresse: 'http://indexeur.exemple.test/api', cle: 'cle-essai-123' });
  assert.equal(r.ok, true, r.text);
  const dir = v.ctx('freyja').dir;
  for (const f of readdirSync(dir)) if (f.endsWith('.jsonl') || f.endsWith('.json')) assert.ok(!readFileSync(join(dir, f), 'utf8').includes('cle-essai-123'), `la clé n'est pas en clair dans ${f}`);
  const l = await act('delta_sources'); assert.ok(!l.text.includes('cle-essai-123') && !JSON.stringify(l.data).includes('cle-essai-123'));
  assert.equal((await act('delta_tester', { id: 'mon-indexeur' })).ok, true);
});

test('le parcours d\'un film : à venir → demande → Sirius → Delta → Comète → rangé → scanné → visible dans Vénus', async () => {
  // Sans dossier déclaré : la demande attend, rien n'est téléchargé.
  const sans = await act('hnoss_obtenir', { titre: 'Dune Part Two', genre: 'film', annee: '2024' });
  assert.match(sans.text, /aucun dossier/);
  ajouterDossier(mag(), films, 'films'); ajouterDossier(mag(), series, 'series');
  assert.match((await act('a_venir')).text, /Aucun catalogue/, 'aucun catalogue public branché par défaut');
  const r = await act('hnoss_obtenir', { titre: 'Dune Part Two', genre: 'film', annee: '2024' });
  assert.equal(r.ok, true, r.text);
  const d = r.data as { demande: { id: string; etat: string }; telechargements: Array<{ id: string }> };
  assert.equal(d.telechargements.length, 1, r.text); assert.equal(d.demande.etat, 'en téléchargement');
  assert.ok(requetes.some((q) => q.startsWith('/api?') && q.includes('apikey=cle-essai-123') && q.includes('t=movie')), 'la clé part seulement à la source');
  await attendreComete();
  const t = telechargement(mag(), d.telechargements[0].id)!;
  assert.equal(t.etat, 'termine', t.texte);
  const final = join(films, 'Dune Part Two (2024)', 'Dune Part Two (2024).mkv');
  assert.equal(t.chemin, final); assert.equal(sha(readFileSync(final)), sha(FICHIERS['/f/dune1080.mkv']), 'le 1080p est pris, pas le lien de partage ni le 720p');
  assert.ok(bibliotheque(mag()).some((c) => c.id === 'film:dune-part-two-2024' && c.type === 'film'), 'visible dans Vénus');
  assert.equal(fichierDeCible(mag(), 'film:dune-part-two-2024')?.fichier, final, 'et lisible');
  assert.equal(demandes().find((x) => x.id === d.demande.id)?.etat, 'disponible');
  const j = await act('comete_journal'); assert.match(j.text, /ajouté/); assert.match(j.text, /terminé/);
  assert.ok(!j.text.includes('apikey'));
  const s = (await act('suivis', { applicatif: 'sirius' })).data as { suivis: Array<{ id: string; etat: string }> };
  assert.equal(s.suivis.find((x) => x.id === 'film:dune-part-two-2024')?.etat, 'disponible');
});

test('une série : Pléiades ne fait venir que l\'épisode manquant', async () => {
  const deja = join(series, 'Les Etoiles', 'Saison 01'); mkdirSync(deja, { recursive: true });
  writeFileSync(join(deja, 'Les Etoiles - S01E01.mkv'), FICHIERS['/f/etoiles-s01e01.mkv']);
  await scanner(mag(), faux);
  const r = await act('hnoss_obtenir', { titre: 'Les Etoiles', genre: 'série', saisons: '1' });
  const d = r.data as { demande: { id: string }; telechargements: Array<{ id: string; cible: { episode: number } }> };
  assert.equal(d.telechargements.length, 1, r.text); assert.equal(d.telechargements[0].cible.episode, 2);
  await attendreComete();
  assert.equal(telechargement(mag(), d.telechargements[0].id)?.etat, 'termine');
  assert.ok(existsSync(join(series, 'Les Etoiles', 'Saison 01', 'Les Etoiles - S01E02.mkv')));
  assert.ok(mag().get('episodes', 'serie:les-etoiles:s1e2'), 'épisode visible dans Vénus');
  assert.equal(demandes().find((x) => x.id === d.demande.id)?.etat, 'disponible');
});

test('un animé : rangé par Pléiades, son œuvre porte la catégorie « anime »', async () => {
  const r = await act('hnoss_obtenir', { titre: 'Kumo', genre: 'animé', saisons: '1' });
  assert.equal((r.data as { telechargements: unknown[] }).telechargements.length, 1, r.text);
  await attendreComete();
  assert.equal(mag().get('oeuvres', 'serie:kumo')?.data.categorie, 'anime');
});

test('membres : sans droit, refusé ; avec droit, la demande attend la validation du propriétaire (rien ne se télécharge)', async () => {
  const refus = await membre('sans-droit', 'hnoss_demander', { titre: 'Autre Film', genre: 'film', annee: '2024' });
  assert.equal(refus.ok, false, refus.text);
  assert.ok(!demandes().some((x) => x.titre === 'Autre Film'), 'aucune demande posée');
  const n = messages.length;
  const ok = await membre('avec-droit', 'hnoss_demander', { titre: 'Piege', genre: 'film', annee: '2023' });
  assert.equal(ok.ok, true, ok.text);
  const dm = demandes().find((x) => x.titre === 'Piege')!;
  assert.equal(dm.etat, 'à valider'); assert.equal((dm.qui as { login: string }).login, 'avec-droit');
  assert.ok(messages.slice(n).some((m) => /avec-droit|Membre avec-droit/.test(m) && /Piege/.test(m)), 'le propriétaire est prévenu');
  assert.equal((await membre('avec-droit', 'hnoss_obtenir', { titre: 'Piege', genre: 'film' })).ok, false, 'un membre ne lance pas de téléchargement');
  assert.equal((await membre('avec-droit', 'hnoss_valider', { demande: String(dm.id) })).ok, false, 'ni ne valide');
  assert.equal((await v.act('freyja', 'hnoss_obtenir', { titre: 'Piege', genre: 'film' }, { auto: true })).ok, false, 'une automatisation non plus');
  assert.ok(!(await act('comete_file')).text.includes('Piege'), 'rien dans la file');
  const mes = (await membre('avec-droit', 'hnoss_demandes', {})).data as { demandes: Array<{ titre: string }> };
  assert.deepEqual(mes.demandes.map((x) => x.titre), ['Piege'], 'un membre ne voit que ses demandes');
  // Le propriétaire valide : le fichier n'est pas une vidéo (un programme) → effacé, jamais rangé, échec.
  const val = await act('hnoss_valider', { demande: String(dm.id) });
  assert.equal(val.ok, true, val.text);
  await attendreComete();
  assert.equal(demandes().find((x) => x.id === dm.id)?.etat, 'échec');
  assert.ok(!existsSync(join(films, 'Piege (2023)', 'Piege (2023).mkv')), 'rien rangé');
  assert.match(String(demandes().find((x) => x.id === dm.id)?.note), /programme Windows/);
});

test('sûreté : chemin piégé gardé dans la bibliothèque, dossier hors bibliothèque refusé, taille fausse refusée', async () => {
  const r = await act('hnoss_obtenir', { titre: '../../../Evil', genre: 'film', annee: '2024' });
  await attendreComete();
  const t = telechargement(mag(), (r.data as { telechargements: Array<{ id: string }> }).telechargements[0].id)!;
  assert.equal(t.etat, 'termine', t.texte);
  assert.ok(resolve(t.chemin!).startsWith(resolve(films) + sep), `rangé sous le dossier Films : ${t.chemin}`);
  assert.ok(!existsSync(join(home, 'Evil (2024)')) && !existsSync(join(home, 'Medias', 'Evil (2024)')));
  assert.equal((await act('suivi_regler', { applicatif: 'sirius', dossier: join(home, 'ailleurs') })).ok, false, 'un dossier non déclaré est refusé');
  const m = await act('hnoss_obtenir', { titre: 'Mensonge', genre: 'film', annee: '2023' });
  await attendreComete();
  const tm = telechargement(mag(), (m.data as { telechargements: Array<{ id: string }> }).telechargements[0].id)!;
  assert.equal(tm.etat, 'echec'); assert.match(String(tm.texte), /taille reçue/);
  assert.ok(!existsSync(join(films, 'Mensonge (2023)')));
});

const attendre = async (f: () => boolean, ms = 8000) => { const fin = Date.now() + ms; while (!f() && Date.now() < fin) await new Promise((r) => setTimeout(r, 50)); return f(); };

test('Comète : annuler efface ce qui est reçu ; pause puis reprendre finit le fichier juste', async () => {
  assert.equal((await act('comete_regler', { debit_mo: 1 })).ok, true);
  const enCours = join(v.ctx('freyja').dir, 'comete', 'en-cours');
  const a = await act('hnoss_obtenir', { titre: 'Lent', genre: 'film', annee: '2022' });
  const ida = (a.data as { telechargements: Array<{ id: string }> }).telechargements[0].id;
  assert.ok(await attendre(() => telechargement(mag(), ida)?.etat === 'en_cours'));
  assert.equal((await membre('avec-droit', 'comete_annuler', { id: ida })).ok, false, 'un membre n\'annule pas');
  assert.equal((await act('comete_annuler', { id: ida })).ok, true);
  await attendreComete();
  assert.equal(telechargement(mag(), ida)?.etat, 'annule');
  assert.deepEqual(readdirSync(enCours).filter((f) => f.includes(ida)), [], 'rien de reçu ne reste');
  assert.ok(!existsSync(join(films, 'Lent (2022)')));

  const p = await act('hnoss_obtenir', { titre: 'Pause', genre: 'film', annee: '2022' });
  const idp = (p.data as { telechargements: Array<{ id: string }> }).telechargements[0].id;
  assert.ok(await attendre(() => (telechargement(mag(), idp)?.fait ?? 0) > 0), 'il avance');
  assert.equal((await act('comete_pause', { id: idp })).ok, true);
  await attendreComete();
  assert.equal(telechargement(mag(), idp)?.etat, 'pause');
  assert.ok(readdirSync(enCours).some((f) => f.includes(idp)), 'ce qui est reçu est gardé');
  assert.equal((await act('comete_regler', { debit_mo: 0 })).ok, true);
  assert.equal((await act('comete_reprendre', { id: idp })).ok, true);
  await attendreComete();
  const t = telechargement(mag(), idp)!;
  assert.equal(t.etat, 'termine', t.texte);
  assert.equal(sha(readFileSync(t.chemin!)), sha(FICHIERS['/f/pause.mkv']), 'le fichier repris est juste');
  assert.ok(bibliotheque(mag()).some((c) => c.id === 'film:pause-2022'));
});

test('la parole : « télécharge le film » passe par Hnoss, et le téléchargement attend la confirmation', async () => {
  const act0 = v.modules().find((m) => m.id === 'freyja')!.actions.find((a) => a.id === 'hnoss_demander')!;
  assert.ok(act0.words?.includes('telecharge le film'));
  const valider = v.modules().find((m) => m.id === 'freyja')!.actions.find((a) => a.id === 'hnoss_valider')!;
  assert.ok(valider.grave?.({ demande: 'x' }, v.ctx('freyja')), 'valider demande la confirmation du propriétaire');
  const r = await act('hnoss_demander', { titre: 'Autre Film', genre: 'film', annee: '2024' });
  assert.equal(r.ok, true, r.text);
  assert.ok(!(await act('comete_file')).text.includes('Autre Film'), 'rien ne se télécharge sans confirmation');
});

// ---------------------------------------------------------------- Relecture (sûreté) : ce qui passait avant
test('confirmation : obtenir est grave (l\'IA et la parole demandent) ; relancer ne contourne pas la validation', async () => {
  const fr = v.modules().find((m) => m.id === 'freyja')!;
  assert.ok(fr.actions.find((a) => a.id === 'hnoss_obtenir')!.grave?.({ titre: 'X' }, v.ctx('freyja')), 'obtenir lance un téléchargement : confirmation');
  // « Autre Film » : demandé par le propriétaire (trouvé, pas validé). Relancer ne doit rien télécharger sans « valide ».
  const r = await act('hnoss_relancer', { demande: 'Autre Film' });
  assert.equal(r.ok, false, r.text); assert.match(r.text, /validation/);
  assert.ok(!(await act('comete_file')).text.includes('Autre Film'));
});

test('un membre ne voit dans Comète, les suivis et « À venir » que ce qui vient de SES demandes', async () => {
  for (const a of ['comete_file', 'suivis', 'a_venir', 'medias']) {
    const r = await membre('avec-droit', a, {});
    assert.ok(!/Dune|Etoiles|Kumo|Lent|Pause/.test(r.text + JSON.stringify(r.data ?? {})), `${a} : ${r.text.slice(0, 200)}`);
  }
  const p = await act('comete_file'); assert.match(p.text, /Dune/, 'le propriétaire voit tout');
});

test('annulé pendant les vérifications (antivirus, lecture) : jamais rangé', async () => {
  let lacher!: () => void; retenue = new Promise<void>((r) => { lacher = r; });
  try {
    const a = await act('hnoss_obtenir', { titre: 'Tard', genre: 'film', annee: '2021' });
    const id = (a.data as { telechargements: Array<{ id: string }> }).telechargements[0].id;
    assert.ok(await attendre(() => telechargement(mag(), id)?.texte === 'vérification'), 'il est en vérification');
    assert.equal((await act('comete_annuler', { id })).ok, true);
    lacher(); await attendreComete();
    assert.equal(telechargement(mag(), id)?.etat, 'annule', telechargement(mag(), id)?.texte);
    assert.ok(!existsSync(join(films, 'Tard (2021)')), 'rien rangé');
  } finally { lacher?.(); retenue = undefined; }
});

test('au démarrage, un téléchargement annulé juste avant un arrêt brutal n\'est jamais repris', async () => {
  const { relancer } = await import('../src/valhalla/venus/comete/index.ts');
  mag().poser('telechargements', 'c-0000000000000001', { titre: 'Coupe', lien: '', cible: { genre: 'film', titre: 'Coupe' }, moteur: 'direct', source: 'x', racine: films, categorie: 'films', etat: 'en_cours', fait: 10, vitesse: 0, ajoute: Date.now(), annulation: true });
  relancer(v.ctx('freyja')); await attendreComete();
  assert.equal(telechargement(mag(), 'c-0000000000000001')?.etat, 'annule');
});

test('une jonction dans le chemin de la bibliothèque : refusée, et rien n\'est créé dehors', async () => {
  const { symlinkSync } = await import('node:fs');
  const dehors = join(home, 'dehors'); mkdirSync(dehors, { recursive: true });
  symlinkSync(dehors, join(series, 'Jonction'), 'junction');
  const r = await act('hnoss_obtenir', { titre: 'Jonction', genre: 'série', saisons: '1' });
  const id = (r.data as { telechargements: Array<{ id: string }> }).telechargements[0]?.id; assert.ok(id, r.text);
  await attendreComete();
  const t = telechargement(mag(), id)!;
  assert.equal(t.etat, 'echec'); assert.match(String(t.texte), /hors de la bibliothèque/);
  assert.deepEqual(readdirSync(dehors), [], 'aucun dossier créé hors de la bibliothèque');
});

test("un fichier dont l'antivirus doute est MIS À PART : hors de la bibliothèque, jusqu'à ton accord (accepter ou jeter, noté au journal)", async () => {
  douteux = true;
  try {
    const a = await act('hnoss_obtenir', { titre: 'Doute', genre: 'film', annee: '2020' }), b = await act('hnoss_obtenir', { titre: 'Doute Accepte', genre: 'film', annee: '2020' });
    await attendreComete();
    const ida = (a.data as { telechargements: Array<{ id: string }> }).telechargements[0].id, idb = (b.data as { telechargements: Array<{ id: string }> }).telechargements[0].id;
    for (const id of [ida, idb]) assert.equal(telechargement(mag(), id)?.etat, 'a_part', telechargement(mag(), id)?.texte);
    assert.ok(!existsSync(join(films, 'Doute (2020)')) && !existsSync(join(films, 'Doute Accepte (2020)')), 'rien dans la bibliothèque');
    assert.ok(!bibliotheque(mag()).some((c) => c.id === 'film:doute-2020'));
    const fr = v.modules().find((m) => m.id === 'freyja')!;
    assert.ok(fr.actions.find((x) => x.id === 'comete_accepter')!.grave?.({ id: ida }, v.ctx('freyja')), 'accepter demande ta confirmation');
    assert.equal((await membre('avec-droit', 'comete_accepter', { id: ida })).ok, false, "un membre n'accepte pas");
    assert.equal((await v.act('freyja', 'comete_jeter', { id: ida }, { auto: true })).ok, false, 'une automatisation ne jette pas');
    const chemin = telechargement(mag(), ida)!.chemin!; assert.ok(existsSync(chemin));
    assert.equal((await act('comete_jeter', { id: ida })).ok, true);
    assert.ok(!existsSync(chemin), 'jeté : effacé'); assert.equal(telechargement(mag(), ida)?.etat, 'echec');
    const r = await act('comete_accepter', { id: idb }); assert.equal(r.ok, true, r.text);
    assert.ok(existsSync(join(films, 'Doute Accepte (2020)', 'Doute Accepte (2020).mkv')), 'accepté : rangé');
    const j = (await act('comete_journal')).text; assert.match(j, /mis à part/); assert.match(j, /accepté/); assert.match(j, /jeté/);
  } finally { douteux = false; }
});
