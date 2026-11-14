// Plume (snotra) : le correcteur (maison, et LanguageTool par son API HTTP), les tableaux blancs et les schémas
// isométriques (enregistrés, relus, exportés en SVG valide et en PNG valide), « Schéma de mon réseau » depuis Atlas.
// Sur un VRAI Odin (interface web démarrée). LanguageTool n'est pas installé sur la machine d'essai : un faux serveur
// local répond comme sa documentation (POST /v2/check, formulaire text + language, réponse { matches: [...] }).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { useEngine } from '../src/valhalla/modules/naglfar.ts';
import { appliquer, corrigerMaison } from '../src/valhalla/snotra/correcteur.ts';
import { nettoyer, svgSchema, svgTableau } from '../src/valhalla/snotra/dessin.ts';
import { fakeEngine } from './helpers.ts';

type R = { ok?: boolean; text?: string; confirm?: string; data?: Record<string, unknown> & { fautes?: Array<{ regle: string; suggestions: string[] }> }; fichiers?: Array<{ nom: string; ref: string }> };
const acte = async (v: VraiOdin, action: string, input: Record<string, unknown> = {}, confirm = false, module = 'snotra') => (await v.json('/api/valhalla/act', { module, action, input, ...(confirm ? { confirm: true } : {}) })).body as R;
const outil = (cmd: string) => { try { execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }); return true; } catch { return false; } };

test('correcteur de base : de vraies phrases, des fautes trouvées, rien d\'inventé sur un texte juste', () => {
  const t = 'bonjour Karim , les maison de Mamoudzou sont belles.  Il à plu toute la nuit ! Merci de venir parmis nous, en faite c\'est le le jour.';
  const f = corrigerMaison(t), r = new Set(f.map((x) => x.regle));
  for (const x of ['MAJUSCULE_PHRASE', 'ESPACE_AVANT_VIRGULE', 'ACCORD_PLURIEL', 'ESPACES_DOUBLES', 'ESPACE_PONCTUATION', 'USAGE', 'MOT_REPETE']) assert.ok(r.has(x), x);
  assert.equal(appliquer(t, f), 'Bonjour Karim, les maisons de Mamoudzou sont belles. Il a plu toute la nuit ! Merci de venir parmi nous, en fait c\'est le jour.');
  for (const juste of ['Je suis venu avec mes enfants et des amis. Les journaux disent que les prix montent.', 'Nous nous sommes vus hier ; voici le lien : https://exemple.yt/page.', 'Les beaux jours arrivent, les chevaux aussi.', 'Il fait 30 °C à 10:30.', 'Rendez-vous le 14/11 à 9h.'])
    assert.deepEqual(corrigerMaison(juste).map((x) => `${x.regle} ${x.extrait}`), [], juste);
});

test('tableaux : ce qui vient de la page est vérifié, le SVG est un vrai SVG (xmllint), le texte y est échappé', { skip: !outil('xmllint') && 'xmllint absent' }, () => {
  const d = nettoyer({ formes: [{ t: 'rect', x: 10, y: 10, w: 100, h: 50, couleur: '#ff0000' }, { t: 'trait', x: 0, y: 0, pts: [0, 0, 10, 10, 20, 5] }, { t: 'texte', x: 5, y: 80, texte: 'Salut <script>alert(1)</script> & co' }, { t: 'virus', x: 1 }, { t: 'rect', x: 'NaN', couleur: 'red;background:url(x)' }, { t: 'fleche', x: 0, y: 0, w: 1e12, h: 5 }] }, { id: 'tx', nom: 'Essai', genre: 'tableau', maj: '2026-11-14' });
  assert.deepEqual(d.formes.map((f) => f.t), ['rect', 'trait', 'texte', 'rect', 'fleche']);
  assert.equal(d.formes[3].couleur, '#1f2937', 'couleur douteuse remplacée'); assert.equal(d.formes[4].w, 100_000, 'nombres bornés');
  const svg = svgTableau(d); assert.match(svg, /Salut &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; co/); assert.doesNotMatch(svg, /<script/);
  const f = join(process.env.TMPDIR ?? '/tmp', `plume-${process.pid}.svg`); writeFileSync(f, svg); execFileSync('xmllint', ['--noout', f]);
  const sch = nettoyer({ blocs: [{ id: 'a', genre: 'serveur', gx: 0, gy: 0, nom: 'Odin' }, { id: 'b', genre: 'box', gx: 2, gy: 0, nom: 'Box & <Wi-Fi>' }, { id: 'c', genre: 'fusée', gx: 1, gy: 1 }], liens: [{ de: 'a', vers: 'b' }, { de: 'a', vers: 'zz' }] }, { id: 'sx', nom: 'S', genre: 'schema', maj: '' });
  assert.deepEqual([sch.blocs.length, sch.liens.length], [2, 1]);
  writeFileSync(f, svgSchema(sch)); execFileSync('xmllint', ['--noout', f]);
});

test('Plume sur un vrai Odin : correcteur maison puis LanguageTool (relié, puis en panne), tableaux et schémas enregistrés, exportés et téléchargés', { timeout: 180_000 }, async () => {
  const tt = new T(), lances: string[] = [];
  useEngine(() => fakeEngine([], (c) => lances.push(c)));
  // Un faux LanguageTool fidèle à sa documentation : formulaire text + language, réponse { matches }.
  const recus: Array<Record<string, string>> = [];
  const lt = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/v2/check') { res.writeHead(404).end(); return; }
      const q = Object.fromEntries(new URLSearchParams(b)); recus.push(q);
      const i = q.text.indexOf('une essai'), j = q.text.indexOf('maison');
      const matches = [...(i >= 0 ? [{ message: 'Accord du genre : « essai » est masculin.', shortMessage: 'Accord', offset: i, length: 9, replacements: [{ value: 'un essai' }], rule: { id: 'FR_ACCORD_GENRE', description: 'Accord', category: { id: 'GRAMMAR', name: 'Grammaire' } }, context: { text: q.text, offset: i, length: 9 } }] : []), ...(j >= 0 ? [{ message: 'Pluriel attendu.', offset: j, length: 6, replacements: [{ value: 'maisons' }], rule: { id: 'FR_PLURIEL' } }] : [])];
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ software: { name: 'LanguageTool' }, language: { code: q.language }, matches }));
    });
  });
  await new Promise<void>((r) => lt.listen(0, '127.0.0.1', r)); tt.onEnd(() => new Promise((r) => lt.close(r)));
  const portLT = (lt.address() as { port: number }).port;
  try {
    const v = await vraiOdin(tt, { compte: true }), va = valhallaOf()!;
    // 1. Correcteur de base.
    let r = await acte(v, 'corriger', { texte: 'les maison sont belles.  Il à plu !' });
    assert.notEqual(r.ok, false, r.text); assert.equal(r.data?.moteur, 'maison'); assert.match(r.text!, /Texte corrigé :\nLes maisons sont belles\. Il a plu !/);
    // Par une phrase, sans IA (le texte entre guillemets).
    const o = (await v.json('/api/valhalla/order', { text: 'corrige ce texte : « il à plu »' })).body as { module?: string; text?: string };
    assert.equal(o.module, 'snotra'); assert.match(o.text ?? '', /il a plu/);
    // Appelé par une autre appli.
    const c = await va.ctx('saga').call('snotra', 'corriger', { texte: 'parmis nous' }, 'essai'); assert.match(c.text, /parmi/);

    // 2. LanguageTool : installé par le moteur de conteneurs d'Odin (accord demandé), ou relié s'il existe déjà.
    r = await acte(v, 'installer_correcteur'); assert.match(r.confirm ?? '', /installer le service LanguageTool/);
    r = await acte(v, 'installer_correcteur', {}, true); assert.notEqual(r.ok, false, r.text);
    assert.ok(lances.some((x) => /odin run odin-languagetool erikvl87\/languagetool/.test(x)), lances.join(' | '));
    r = await acte(v, 'relier_correcteur', { adresse: `http://127.0.0.1:${portLT}` }); assert.notEqual(r.ok, false, r.text); assert.match(r.text!, /LanguageTool répond/);
    r = await acte(v, 'corriger', { texte: 'Ceci est une essai de maison.' });
    assert.equal(r.data?.moteur, 'LanguageTool'); assert.match(r.text!, /Accord du genre/); assert.match(r.text!, /Ceci est un essai de maisons\./);
    assert.deepEqual({ language: recus.at(-1)!.language, text: recus.at(-1)!.text }, { language: 'fr', text: 'Ceci est une essai de maison.' });
    // LanguageTool en panne : le correcteur de base prend le relais, et le dit.
    lt.closeAllConnections(); await new Promise((res) => lt.close(res));
    r = await acte(v, 'corriger', { texte: 'les maison' }); assert.equal(r.data?.moteur, 'maison'); assert.match(r.text!, /LanguageTool ne répond pas/);
    r = await acte(v, 'retirer_correcteur'); assert.match(r.text!, /correcteur de base/);

    // 3. Tableau blanc : enregistrer, relire, exporter en SVG (téléchargé) et en PNG.
    r = await acte(v, 'enregistrer_tableau', { nom: 'Réunion', genre: 'tableau', contenu: JSON.stringify({ formes: [{ id: 'a', t: 'rect', x: 20, y: 20, w: 200, h: 100, couleur: '#2563eb', ep: 3 }, { id: 'b', t: 'texte', x: 40, y: 60, texte: 'Ordre du jour', couleur: '#111111', ep: 1 }, { id: 'c', t: 'fleche', x: 220, y: 70, w: 120, h: 0, couleur: '#111111', ep: 2 }] }) });
    const id = String(r.data?.id); assert.match(id, /^t[0-9a-f]{10}$/);
    r = await acte(v, 'ouvrir_tableau', { id }); assert.equal((r.data as { formes: unknown[] }).formes.length, 3);
    r = await acte(v, 'enregistrer_tableau', { id, contenu: JSON.stringify({ formes: [{ id: 'a', t: 'ellipse', x: 0, y: 0, w: 50, h: 50, couleur: '#000000', ep: 2 }] }) });
    r = await acte(v, 'ouvrir_tableau', { id }); assert.deepEqual([(r.data as { nom: string }).nom, (r.data as { formes: Array<{ t: string }> }).formes.map((f) => f.t)], ['Réunion', ['ellipse']], 'mis à jour, nom gardé');
    r = await acte(v, 'exporter_tableau', { id, format: 'svg' }); const svg = r.fichiers![0];
    const dl = await fetch(`${v.url}/api/valhalla/fichier?module=snotra&ref=${encodeURIComponent(svg.ref)}`, { headers: { cookie: v.session } });
    assert.equal(dl.status, 200); const corps = await dl.text(); assert.match(corps, /^<\?xml[\s\S]*<svg [\s\S]*<ellipse /);
    if (outil('xmllint')) { const f = join(tt.tmp('plume-'), 'a.svg'); writeFileSync(f, corps); execFileSync('xmllint', ['--noout', f]); }
    assert.equal((await fetch(`${v.url}/api/valhalla/fichier?module=snotra&ref=${encodeURIComponent('export:../tableaux/x.json')}`, { headers: { cookie: v.session } })).status, 404);
    if (outil('rsvg-convert') || outil('convert')) {
      r = await acte(v, 'exporter_tableau', { id, format: 'png' }); assert.notEqual(r.ok, false, r.text);
      const png = Buffer.from(await (await fetch(`${v.url}/api/valhalla/fichier?module=snotra&ref=${encodeURIComponent(r.fichiers![0].ref)}`, { headers: { cookie: v.session } })).arrayBuffer());
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'signature PNG'); assert.equal(png.subarray(12, 16).toString(), 'IHDR'); assert.ok(png.readUInt32BE(16) > 40 && png.readUInt32BE(20) > 40, 'une vraie image');
    }
    r = await acte(v, 'enregistrer_tableau', { id, contenu: '{pas du json' }); assert.equal(r.ok, false);
    r = await acte(v, 'ouvrir_tableau', { id: '../../compte' }); assert.equal(r.ok, false);

    // 4. Schéma de mon réseau : depuis l'inventaire d'Atlas.
    r = await acte(v, 'schema_reseau'); assert.equal(r.ok, false); assert.match(r.text!, /inventaire est vide/);
    for (const [nom, type, ip] of [['Livebox', 'réseau', '192.168.1.1'], ['NAS Synology', 'autre', '192.168.1.5'], ['Caméra entrée', 'caméra', '192.168.1.30'], ['PC de Karim', 'ordinateur', '192.168.1.20']]) {
      const x = await acte(v, 'ajouter', { nom, type, ip }, false, 'askr'); assert.notEqual(x.ok, false, x.text);
    }
    r = await acte(v, 'schema_reseau'); assert.notEqual(r.ok, false, r.text);
    r = await acte(v, 'ouvrir_tableau', { id: String(r.data?.id) });
    const sch = r.data as { genre: string; blocs: Array<{ nom: string; genre: string }>; liens: unknown[] };
    assert.equal(sch.genre, 'schema'); assert.deepEqual(sch.blocs.map((b) => `${b.genre}:${b.nom}`).sort(), ['box:Livebox', 'camera:Caméra entrée', 'nas:NAS Synology', 'nuage:Internet', 'pc:PC de Karim'].sort());
    assert.equal(sch.liens.length, 4, 'Internet → box, et chaque appareil relié à la box');
    // La page : quatre onglets, et rien n'est supprimé sans accord.
    const vue = await va.module('snotra')!.view(va.ctx('snotra'), new URLSearchParams());
    assert.deepEqual(vue.onglets, ['Documents', 'Correcteur', 'Tableaux', 'Schémas']); assert.ok(vue.sections.every((x) => !x.onglet || vue.onglets!.includes(x.onglet)));
    r = await acte(v, 'supprimer_tableau', { id }); assert.match(r.confirm ?? '', /effacer le tableau « Réunion »/);
    r = await acte(v, 'supprimer_tableau', { id }, true); assert.match(r.text!, /effacé/); assert.ok(!existsSync(join(va.ctx('snotra').dir, 'tableaux', `${id}.json`)));
  } finally { await tt.end(); }
});
