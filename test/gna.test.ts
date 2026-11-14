// Ulysse (Gná · Trajets) : un VRAI Odin (serveur web, applis), de vraies positions au format OwnTracks envoyées à la
// vraie route /api/owntracks avec les identifiants d'un membre, la vraie page /trajets d'un membre (cookie), et le
// propriétaire par /api/valhalla/act. L'horloge (Date) est avancée par l'essai : une journée de trajets, puis la
// conservation un mois plus tard. Le GPX est relu par xmllint (s'il est installé) et par l'essai lui-même.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { understand } from '../src/valhalla/huginn.ts';
import { isSecretFile } from '../src/heimdall/policy.ts';
import { decouper, distance, gpx, nettoyer, type Pt } from '../src/valhalla/gna/trajets.ts';
import { oublierSessions } from '../src/web/gna-api.ts';

// ---------------- Le jeu de positions fabriqué : deux trajets, un arrêt, un point aberrant ----------------
const MAISON = { lat: -12.7806, lon: 45.2278 }, MARCHE = { lat: -12.839, lon: 45.18 };
/** Un trajet en voiture (un point toutes les `pas` ms, à `kmh`), un peu courbé pour ne pas être une ligne droite. */
function route(a: { lat: number; lon: number }, b: { lat: number; lon: number }, t0: number, pas: number, kmh: number): Pt[] {
  const n = Math.max(2, Math.round(distance(a, b) / ((kmh / 3.6) * (pas / 1000)))), out: Pt[] = [];
  for (let k = 1; k < n; k++) { const f = k / n, bosse = Math.sin(f * Math.PI) * 0.006; out.push({ t: t0 + k * pas, lat: a.lat + (b.lat - a.lat) * f + bosse, lon: a.lon + (b.lon - a.lon) * f - bosse, acc: 8 }); }
  return out;
}
function journeeFabriquee(t0: number): { pts: Pt[]; fou: Pt } {
  const aller = route(MAISON, MARCHE, t0, 20_000, 40), tArr = aller.at(-1)!.t + 20_000;
  const arret: Pt[] = Array.from({ length: 21 }, (_x, k) => ({ t: tArr + k * 60_000, lat: MARCHE.lat + Math.sin(k) * 0.0001, lon: MARCHE.lon + Math.cos(k * 1.7) * 0.0001, acc: 10 }));
  const retour = route(MARCHE, MAISON, arret.at(-1)!.t, 20_000, 40);
  // Un saut de 40 km en dix secondes, puis retour sur la route : le GPS s'est trompé.
  const fou: Pt = { t: aller[10].t + 10_000, lat: -12.5, lon: 45.6, acc: 12 };
  return { pts: [{ t: t0, ...MAISON, acc: 8 }, ...aller, fou, ...arret, ...retour, { t: retour.at(-1)!.t + 20_000, ...MAISON, acc: 8 }].sort((x, y) => x.t - y.t), fou };
}
const COORD = /-12\.[5-8]\d{2}|45\.(1[89]|2[0-4]|6)\d/;   // une coordonnée du jeu (latitude ou longitude) écrite en clair

test('découpe : deux trajets, un arrêt, le point aberrant écarté ; GPX bien formé', () => {
  const { pts, fou } = journeeFabriquee(new Date(2026, 10, 10, 8, 0).getTime());
  const n = nettoyer(pts);
  assert.deepEqual(n.ecartes.map((p) => [p.lat, p.lon]), [[fou.lat, fou.lon]], 'seul le saut impossible est écarté');
  const d = decouper(n.points);
  assert.equal(d.arrets.length, 1, 'un arrêt (le marché)');
  assert.ok(distance(d.arrets[0], MARCHE) < 30 && d.arrets[0].fin - d.arrets[0].debut >= 19 * 60_000, 'l\'arrêt est au marché, une vingtaine de minutes');
  assert.equal(d.trajets.length, 2, 'deux trajets : l\'aller et le retour');
  for (const t of d.trajets) {
    assert.ok(t.metres > 7000 && t.metres < 10_000, `distance plausible (${Math.round(t.metres)} m)`);
    const kmh = t.metres / 1000 / ((t.fin - t.debut) / 3_600_000);
    assert.ok(kmh > 35 && kmh < 45, `vitesse moyenne plausible (${kmh.toFixed(1)} km/h)`);
    assert.ok(!t.points.some((p) => p.lat === fou.lat), 'le point aberrant n\'est pas dans le tracé');
  }
  const x = gpx({ nom: 'Essai <1> & « co »', cree: pts[0].t, trajets: d.trajets.map((t, k) => ({ nom: `Trajet ${k + 1}`, points: t.points })), arrets: d.arrets.map((a) => ({ nom: 'Marché', lat: a.lat, lon: a.lon, debut: a.debut })) });
  assert.match(x, /<name>Essai &lt;1&gt; &amp; « co »<\/name>/, 'les caractères spéciaux sont échappés');
  assert.equal((x.match(/<trk>/g) ?? []).length, 2);
});

test('Ulysse dans un vrai Odin : OwnTracks, accord de chaque membre, trajets, GPX, effacement, conservation', async () => {
  const tt = new T();
  // L'horloge : mardi 10 novembre 2026, 6 h (heure de la machine). Seul Date est avancé ; les minuteries restent vraies.
  let maintenant = new Date(2026, 10, 10, 6, 0).getTime();
  mock.timers.enable({ apis: ['Date'], now: maintenant });
  const regler = (t: number) => { maintenant = t; mock.timers.setTime(t); };
  const tmp = mkdtempSync(join(tmpdir(), 'gna-essai-'));
  try {
    const o = await vraiOdin(tt, { compte: true });
    const v = valhallaOf()!, dir = v.ctx('gna').dir;
    oublierSessions();
    // ---- Le propriétaire, dans Odin ----
    const proprio = async (action: string, input: Record<string, unknown> = {}, confirm = false, module = 'gna') => (await o.json('/api/valhalla/act', { module, action, input, confirm })).body as { ok: boolean; text?: string; confirm?: string; data?: Record<string, unknown>; fichiers?: Array<{ nom: string; ref: string }> };
    const ajout = async (nom: string) => { const r = await proprio('membre', { nom, adresse: o.url }, false, 'gladsheim'); const pass = /Mot de passe : (\S+)/.exec(r.text ?? '')?.[1], user = /Identifiant : (\S+)/.exec(r.text ?? '')?.[1]; assert.ok(pass && user, r.text); return { user, pass }; };
    const nour = await ajout('Nour'), sami = await ajout('Sami');
    assert.match((await proprio('membre', { nom: 'Lina', adresse: o.url }, false, 'gladsheim')).text ?? '', new RegExp(`Ses trajets \\(Ulysse\\) ne sont pas gardés : Lina peut allumer son historique, et le revoir, sur ${o.url.replace(/[.]/g, '\\.')}/trajets`), 'Hestia dit au membre où régler ses trajets');
    const ids = Object.fromEntries((v.ctx('gladsheim').settings.members as Array<{ id: string; name: string }>).map((m) => [m.name, m.id]));

    // ---- Le téléphone : la vraie route OwnTracks, avec les identifiants du membre ----
    const owntracks = async (m: { user: string; pass: string }, p: Pt) => {
      regler(p.t);
      const r = await fetch(`${o.url}/api/owntracks`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${m.user}:${m.pass}`).toString('base64')}`, 'content-type': 'application/json' }, body: JSON.stringify({ _type: 'location', lat: p.lat, lon: p.lon, acc: p.acc, tst: Math.floor(p.t / 1000), tid: 'NO', batt: 80, conn: 'm', vel: 40 }) });
      assert.equal(r.status, 200); await r.arrayBuffer();
    };
    const gardees = (id: string) => { try { return readdirSync(join(dir, 'positions', id)).filter((f) => f.endsWith('.jsonl')).reduce((n, f) => n + readFileSync(join(dir, 'positions', id, f), 'utf8').split('\n').filter(Boolean).length, 0); } catch { return 0; } };

    // 1. Historique éteint (au départ) : rien n'est gardé au-delà de ce que fait Hestia (la dernière position).
    await owntracks(nour, { t: new Date(2026, 10, 10, 6, 30).getTime(), ...MAISON, acc: 10 });
    assert.equal(gardees(ids.Nour), 0, 'éteint : aucune position gardée par Ulysse');
    assert.ok(!existsSync(join(dir, 'positions')), 'éteint : pas même un dossier');
    assert.match((await proprio('positions', {}, false, 'gladsheim')).text ?? '', /Nour/, 'Hestia garde sa dernière position, comme avant');

    // 2. La page d'un membre : /trajets, avec ses identifiants OwnTracks.
    const page = await fetch(`${o.url}/trajets`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<script nonce="[^"]+" src="\/pages\/gna\.js"><\/script>/);
    assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'.*frame-ancestors 'none'/);
    const entrer = async (m: { user: string; pass: string }) => {
      const r = await fetch(`${o.url}/api/trajets/entrer`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ identifiant: m.user, mot_de_passe: m.pass }) });
      const c = r.headers.getSetCookie().find((x) => x.startsWith('odin_trajets='));
      return { status: r.status, cookie: c?.split(';')[0] ?? '', brut: c ?? '' };
    };
    assert.equal((await entrer({ user: nour.user, pass: 'pas-le-bon' })).status, 401, 'mauvais mot de passe refusé');
    let cn = await entrer(nour), cs = await entrer(sami);
    assert.equal(cn.status, 200); assert.match(cn.brut, /HttpOnly; SameSite=Strict/);
    type R = { ok: boolean; text?: string; confirm?: string; data?: Record<string, unknown>; fichiers?: Array<{ nom: string; ref: string }>; error?: string };
    const membre = async (c: { cookie: string }, action: string, input: Record<string, unknown> = {}, confirm = false) => {
      const r = await fetch(`${o.url}/api/trajets/act`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1', cookie: c.cookie }, body: JSON.stringify({ action, input, confirm }) });
      return { status: r.status, ...(await r.json() as R) };
    };
    assert.equal((await fetch(`${o.url}/api/trajets/act`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cn.cookie }, body: '{"action":"etat"}' })).status, 403, 'sans l\'en-tête x-odin (demande venue d\'un autre site) : refusé');
    assert.equal((await membre({ cookie: '' }, 'etat')).status, 401, 'sans session : refusé');
    assert.equal((await membre(cn, 'fond_de_carte', { allume: true })).status, 403, 'le fond de carte se règle par le propriétaire seulement');

    // 3. Le propriétaire n'allume pas l'historique de quelqu'un sans son accord.
    const sansAccord = await proprio('allumer', { membre: 'Nour' });
    assert.equal(sansAccord.ok, false); assert.match(sansAccord.text ?? '', /ne s'allume qu'avec son accord/);
    assert.equal(gardees(ids.Nour), 0);
    // Nour l'allume lui-même, sur sa page : noté dans son journal, à son nom.
    const allume = await membre(cn, 'allumer', { membre: ids.Sami, conservation: '90 jours' });
    assert.equal(allume.ok, true); assert.match(allume.text ?? '', /Ton historique est allumé : tes positions sont gardées 90 jours/);
    let etatN = (await membre(cn, 'etat')).data as { membres: Array<{ id: string; nom: string; etat: string; journal: Array<{ par: string; quoi: string }> }> };
    assert.deepEqual(etatN.membres.map((m) => m.nom), ['Nour'], 'un membre ne voit que lui-même');
    assert.equal(etatN.membres[0].etat, 'allumé');
    assert.deepEqual(etatN.membres[0].journal.map((n) => [n.par, n.quoi]), [['Nour', 'Historique allumé : positions gardées 90 jours.']]);
    assert.equal((await membre(cs, 'etat')).data && ((await membre(cs, 'etat')).data as typeof etatN).membres[0].etat, 'éteint', 'demander pour un autre membre allume le sien, jamais celui de Sami');
    // Pour Sami, le propriétaire déclare son accord : confirmation demandée d'abord, puis c'est noté.
    const q = await proprio('allumer', { membre: 'Sami', accord: true });
    assert.match(q.confirm ?? '', /garder les positions de Sami pendant 90 jours \(tu confirmes que Sami est d'accord : c'est noté dans son journal\)/);
    assert.equal((await proprio('allumer', { membre: 'Sami', accord: true }, true)).ok, true);
    const jS = ((await membre(cs, 'etat')).data as typeof etatN).membres[0].journal;
    assert.deepEqual(jS.map((n) => [n.par, n.quoi]), [['le propriétaire', 'Historique allumé : positions gardées 90 jours. Accord de Sami déclaré par le propriétaire.']], 'Sami voit sur sa page que le propriétaire a déclaré son accord');

    // 4. Une journée : deux trajets, un arrêt, un point aberrant, envoyés un par un comme le ferait le téléphone.
    const { pts } = journeeFabriquee(new Date(2026, 10, 10, 8, 0).getTime());
    for (const p of pts) await owntracks(nour, p);
    assert.equal(gardees(ids.Nour), pts.length, 'allumé : chaque position reçue est gardée (le point aberrant aussi : il est écarté au calcul, pas effacé)');
    assert.equal(gardees(ids.Sami), 0, 'rien chez Sami');
    regler(new Date(2026, 10, 10, 21, 0).getTime());
    // La session d'un membre dure 12 heures : celle de 6 h 30 est finie, Nour et Sami entrent de nouveau.
    assert.equal((await membre(cn, 'etat')).status, 401, 'session de plus de 12 heures : finie');
    cn = await entrer(nour); cs = await entrer(sami);
    const jour = await membre(cn, 'trajets', { jour: '2026-11-10' });
    assert.equal(jour.ok, true, JSON.stringify(jour));
    assert.match(jour.text ?? '', /^Trajets de Nour, mardi 10 novembre 2026 : 2 trajets, 1[67],\d km, \d+ min en déplacement, 1 point aberrant écarté\./);
    assert.doesNotMatch(jour.text ?? '', COORD, 'aucune coordonnée dans le texte (celui que lisent l\'IA et Logos)');
    const d = jour.data as { total: { trajets: number; arrets: number; ecartes: number; vitesse: string }; etapes: Array<{ genre: string; n?: number; points?: number[][]; osm?: string }> };
    assert.deepEqual([d.total.trajets, d.total.arrets, d.total.ecartes], [2, 1, 1]);
    assert.match(d.total.vitesse, /^(3\d|4\d)(,\d)? km\/h$/);
    assert.deepEqual(d.etapes.map((e) => e.genre), ['trajet', 'arret', 'trajet']);
    assert.ok(d.etapes.filter((e) => e.genre === 'trajet').every((e) => (e.points?.length ?? 0) >= 2), 'la page reçoit le tracé à dessiner');
    assert.match(d.etapes[1].osm ?? '', /^https:\/\/www\.openstreetmap\.org\/\?mlat=-12\.83\d*&mlon=45\.18\d*#map=17\//, 'lien « ouvrir dans OpenStreetMap » de l\'arrêt');

    // 5. Un membre ne lit pas les trajets d'un autre ; le propriétaire seulement si le membre l'a accepté.
    const chezSami = await membre(cs, 'trajets', { membre: ids.Nour, jour: '2026-11-10' });
    assert.doesNotMatch(JSON.stringify(chezSami), /Nour|-12\.8/, 'Sami ne reçoit rien de Nour, même en demandant son identifiant');
    const avant = await proprio('trajets', { membre: 'Nour', jour: '2026-11-10' });
    assert.equal(avant.ok, false); assert.match(avant.text ?? '', /ne sont visibles que par Nour/);
    assert.doesNotMatch(JSON.stringify(avant), COORD);
    const partage = await membre(cn, 'partage', { visible: true });
    assert.match(partage.confirm ?? '', /montrer tes trajets au propriétaire d'Odin/, 'Nour confirme avant de montrer ses trajets');
    assert.equal((await membre(cn, 'partage', { visible: true }, true)).ok, true);
    const apres = await proprio('trajets', { membre: 'Nour', jour: '2026-11-10' });
    assert.equal(apres.ok, true); assert.match(apres.text ?? '', /2 trajets/);
    etatN = (await membre(cn, 'etat')).data as typeof etatN;
    assert.equal(etatN.membres[0].journal[0].quoi, 'Trajets montrés au propriétaire d\'Odin.', 'son choix est noté');

    // 6. Lieux nommés par le membre, sans service extérieur.
    const nomme = await membre(cn, 'nommer_lieu', { nom: 'Marché', jour: '2026-11-10', heure: '08:20' });
    assert.equal(nomme.ok, true, nomme.text);
    assert.match((await membre(cn, 'trajets', { jour: '2026-11-10' })).text ?? '', /arrêt 08:12 → 08:32 \(20 min\) · Marché/);

    // 7. Export GPX (fichier remis par la page), relu ; un autre membre ne peut pas le prendre.
    const ex = await membre(cn, 'exporter', { jour: '2026-11-10' });
    assert.equal(ex.ok, true, ex.text); assert.equal(ex.fichiers?.length, 1);
    const prendre = (ref: string, c: { cookie: string }) => fetch(`${o.url}/api/trajets/fichier?${new URLSearchParams({ ref })}`, { headers: { cookie: c.cookie } });
    const f = await prendre(ex.fichiers![0].ref, cn);
    assert.equal(f.status, 200); assert.match(f.headers.get('content-disposition') ?? '', /^attachment; filename="trajets-nour-2026-11-10\.gpx"$/);
    const x = await f.text(), fx = join(tmp, 'nour.gpx'); writeFileSync(fx, x);
    let relu = 'xmllint absent : relu par l\'essai seulement';
    try { execFileSync('xmllint', ['--noout', fx], { stdio: 'pipe' }); relu = 'xmllint : bien formé'; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') assert.fail(`GPX mal formé : ${String((e as { stderr?: Buffer }).stderr ?? e)}`); }
    console.log(`# GPX ${relu}`);
    assert.match(x, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<gpx version="1\.1" creator="Odin - Ulysse" xmlns="http:\/\/www\.topografix\.com\/GPX\/1\/1"/);
    assert.equal((x.match(/<trk>/g) ?? []).length, 2); assert.match(x, /<wpt lat="-12\.83\d*" lon="45\.18\d*"><time>2026-11-10T05:12:20Z<\/time><name>Marché<\/name><\/wpt>/);
    const temps = [...x.matchAll(/<trkpt lat="(-?[\d.]+)" lon="(-?[\d.]+)"><time>([^<]+)<\/time><\/trkpt>/g)];
    assert.ok(temps.length >= 60, `points du tracé (${temps.length})`);
    assert.ok(temps.every((m) => Math.abs(Number(m[1]) + 12.8) < 0.1 && Math.abs(Number(m[2]) - 45.2) < 0.1), 'aucun point aberrant dans le GPX');
    assert.equal((await prendre(ex.fichiers![0].ref, cs)).status, 404, 'Sami ne télécharge pas le fichier de Nour');
    const exP = await proprio('exporter', { membre: 'Nour', jour: '2026-11-10', trajet: 2 });
    assert.equal(exP.ok, true, exP.text);
    const fp = await fetch(`${o.url}/api/valhalla/fichier?${new URLSearchParams({ module: 'gna', ref: exP.fichiers![0].ref })}`, { headers: { cookie: o.session } });
    assert.equal(fp.status, 200); assert.equal(((await fp.text()).match(/<trk>/g) ?? []).length, 1, 'un seul trajet exporté');

    // 8. Effacer un trajet : confirmation d'abord ; les arrêts aux deux bouts restent.
    const avantEff = gardees(ids.Nour);
    const eff = await membre(cn, 'effacer', { du: '2026-11-10', trajet: 1 });
    assert.match(eff.confirm ?? '', /effacer le trajet de 08:00 à 08:12 du mardi 10 novembre 2026 dans ton historique \(3\d positions\)/);
    assert.equal(gardees(ids.Nour), avantEff, 'rien d\'effacé sans confirmation');
    assert.match((await membre(cn, 'effacer', { du: '2026-11-10', trajet: 1 }, true)).text ?? '', /^🗑 3\d positions effacées dans ton historique/);
    const reste = await membre(cn, 'trajets', { jour: '2026-11-10' });
    assert.match(reste.text ?? '', /: 1 trajet, /);
    assert.match(reste.text ?? '', /08:00 → 08:12 : rien de gardé \(pause, ou effacé\)/, 'le trou laissé par l\'effacement est dit');
    assert.match(((await membre(cn, 'etat')).data as typeof etatN).membres[0].journal[0].quoi, /^Effacé : un trajet\. \(le trajet de 08:00 à 08:12/);
    // Une position prise pendant ce trajet et reçue en retard (téléphone resté sans réseau) n'est pas regardée.
    const apresEff = gardees(ids.Nour);
    assert.ok(apresEff < avantEff - 30);
    regler(new Date(2026, 10, 10, 21, 30).getTime());
    const tard = await fetch(`${o.url}/api/owntracks`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${nour.user}:${nour.pass}`).toString('base64')}`, 'content-type': 'application/json' }, body: JSON.stringify({ _type: 'location', lat: -12.8, lon: 45.2, acc: 10, tst: Math.floor(new Date(2026, 10, 10, 8, 5).getTime() / 1000) }) });
    assert.equal(tard.status, 200); await tard.arrayBuffer();
    assert.equal(gardees(ids.Nour), apresEff, 'position en retard dans la période effacée : pas gardée');

    // 9. Pause : plus rien n'est gardé ; reprise ; conservation raccourcie puis appliquée un mois plus tard.
    assert.match((await membre(cn, 'pause')).text ?? '', /^⏸ Ton historique est en pause/);
    const n0 = gardees(ids.Nour);
    await owntracks(nour, { t: new Date(2026, 10, 11, 9, 0).getTime(), ...MARCHE, acc: 10 });
    assert.equal(gardees(ids.Nour), n0, 'en pause : la position n\'est pas gardée');
    assert.equal((await membre(cn, 'allumer')).ok, true, 'reprise');
    await owntracks(nour, { t: new Date(2026, 10, 11, 10, 0).getTime(), ...MARCHE, acc: 10 });
    assert.equal(gardees(ids.Nour), n0 + 1, 'reprise : de nouveau gardée');
    cn = await entrer(nour);
    const c30 = await membre(cn, 'conservation', { duree: '30 jours' });
    assert.equal(c30.ok, true, JSON.stringify(c30)); assert.match(c30.text ?? '', /gardées 30 jours/);
    assert.equal((await proprio('conservation', { membre: 'Sami', duree: '1 an' })).ok, false, 'garder plus longtemps demande l\'accord du membre');
    // Un mois plus tard (le 11 décembre à 9 h 30) : le ménage d'Ulysse efface ce qui a plus de 30 jours.
    regler(new Date(2026, 11, 10, 9, 30).getTime());
    v.module('gna')!.watch!.run(v.ctx('gna'));
    assert.deepEqual(readdirSync(join(dir, 'positions', ids.Nour)), ['2026-11-11.jsonl'], 'le 10 novembre (plus de 30 jours) est effacé, le 11 reste');
    regler(new Date(2026, 11, 11, 10, 30).getTime());
    v.module('gna')!.watch!.run(v.ctx('gna'));
    assert.equal(gardees(ids.Nour), 0, 'le 11 novembre est effacé à son tour, au point près');
    cn = await entrer(nour); cs = await entrer(sami);
    assert.match((await membre(cn, 'trajets', { jour: '2026-11-10' })).text ?? '', /rien de gardé ce jour-là/);

    // 10. Éteindre : tout est effacé, le partage avec le propriétaire est retiré ; plus rien n'est gardé.
    await owntracks(nour, { t: new Date(2026, 11, 11, 11, 0).getTime(), ...MAISON, acc: 10 });
    assert.equal(gardees(ids.Nour), 1);
    const et = await membre(cn, 'eteindre');
    assert.match(et.confirm ?? '', /éteindre ton historique et effacer tout ce qui est gardé \(1 position\)/);
    assert.match((await membre(cn, 'eteindre', {}, true)).text ?? '', /^⏹ Ton historique est éteint : 1 position effacée/);
    await owntracks(nour, { t: new Date(2026, 11, 11, 11, 5).getTime(), ...MAISON, acc: 10 });
    assert.equal(gardees(ids.Nour), 0, 'éteint : plus rien n\'est gardé');
    const fin = ((await membre(cn, 'etat')).data as { membres: Array<{ visible: boolean; etat: string }> }).membres[0];
    assert.deepEqual([fin.etat, fin.visible], ['éteint', false]);

    // 11. Vie privée : le dossier d'Ulysse est fermé aux outils de fichiers ; aucune coordonnée dans les alertes ni le journal des actions.
    assert.ok(isSecretFile(join(dir, 'positions', ids.Sami, '2026-11-10.jsonl')) && isSecretFile(join(dir, 'choix.json')), 'SECRET_FILES couvre le dossier d\'Ulysse');
    assert.doesNotMatch(JSON.stringify([v.alerts(), v.manips({ limit: 200 })]), COORD);
    // Un membre retiré de Hestia : sa session ne marche plus, son historique et ses choix sont effacés.
    await owntracks(sami, { t: new Date(2026, 11, 11, 12, 0).getTime(), ...MAISON, acc: 10 });
    assert.equal(gardees(ids.Sami), 1);
    assert.match((await v.act('gladsheim', 'retirer_membre', { nom: 'Sami' })).text, /Sami retiré/);   // (la session du propriétaire a expiré en un mois : directement dans Odin)
    assert.ok(!existsSync(join(dir, 'positions', ids.Sami)) && !readFileSync(join(dir, 'choix.json'), 'utf8').includes(ids.Sami));
    assert.equal((await membre(cs, 'etat')).status, 401);
  } finally { mock.timers.reset(); rmSync(tmp, { recursive: true, force: true }); await tt.end(); }
});

test('Logos (sans IA) : les phrases des trajets arrivent chez Ulysse, les phrases banales non', async () => {
  const tt = new T();
  try {
    await vraiOdin(tt, {});
    const v = valhallaOf()!;
    await v.act('gladsheim', 'membre', { nom: 'Nour' });
    const vers = async (p: string) => { const u = await understand(v, p, `s-${Math.random()}`); return !u ? '' : u.kind === 'action' || u.kind === 'ask' ? `${u.module}.${u.action}` : u.kind; };
    for (const [p, a] of Object.entries({
      'mes trajets': 'gna.trajets', 'mes trajets d\'hier': 'gna.trajets', 'les trajets de Nour hier': 'gna.trajets', 'où suis-je allé hier ?': 'gna.trajets', 'carte des trajets': 'gna.trajets',
      'historique des trajets': 'gna.etat', 'historique des positions': 'gna.etat', 'lieux fréquents': 'gna.lieux',
      'allume l\'historique des trajets de Nour': 'gna.allumer', 'mets en pause l\'historique des trajets de Nour': 'gna.pause', 'éteins l\'historique des trajets de Nour': 'gna.eteindre',
      'efface les trajets de Nour': 'gna.effacer', 'exporte en gpx les trajets de Nour': 'gna.exporter',
    })) assert.equal(await vers(p), a, p);
    for (const p of ['quel trajet pour aller à la plage ?', 'combien de temps dure le trajet jusqu\'à Mamoudzou', 'j\'ai fait un long trajet hier', 'où est la famille', 'efface l\'historique', 'historique du réseau', 'montre la carte du réseau', 'change le fond d\'écran', 'mets la musique en pause', 'mes lieux préférés à Mayotte', 'convertis ce fichier gpx en kml', 'position de la famille']) {
      assert.doesNotMatch(await vers(p), /^gna\./, p);
    }
    // « efface les trajets de Nour » : le prénom ne sert qu'à désigner le membre (pas une date), et l'accord est demandé.
    const r = await v.order('efface les trajets de Nour');
    assert.match(r.confirm ?? r.text, /effacer tout l'historique dans l'historique de Nour|L'historique de Nour/);
  } finally { await tt.end(); }
});
