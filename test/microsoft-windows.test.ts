// Andromède · Windows chez Microsoft (src/valhalla/forge/microsoft.ts), avec un FAUX serveur Microsoft local :
// jamais microsoft.com pendant les essais. Lire la page (version, éditions, empreintes, nouveau Windows), les langues
// et le lien, la veille (alerte une fois par version, nouveau Windows, nouveau Windows Server, heures creuses), le
// téléchargement avec l'empreinte publiée (vérifiée ou refusée), et le refus de Microsoft → page officielle, sans planter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { ISO } from '../src/valhalla/forge/sources.ts';
import { choisirEdition, dansCreuses, empreinteDe, languesWindows, liensWindows, lireEvalCenter, lirePageWindows, raisonRefus, langueIso, choisirSku } from '../src/valhalla/forge/microsoft.ts';
import { fuseauOdin, murale } from '../src/draupnir/rythme.ts';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const ISO26 = Buffer.alloc(150_000, 7), ISO27 = Buffer.alloc(120_000, 9);

/** Une page de téléchargement comme celle de Microsoft (morceaux utiles seulement). */
function page(o: { version: string; num?: string; arm?: boolean; francais: string; anglais?: string; autres?: number[] }): string {
  const n = o.num ?? '11';
  return `<html><head><script>var x = "Version 99H9";</script></head><body>
  <a href="/fr-fr/software-download/windows11">Windows 11</a><a href="/fr-fr/software-download/windows11arm64">Windows 11 for Arm</a><a href="https://www.microsoft.com/fr-fr/software-download/windows10">Windows 10</a>
  ${(o.autres ?? []).map((k) => `<a href="https://www.microsoft.com/fr-fr/software-download/windows${k}">Windows ${k}</a>`).join('')}
  <h1>Télécharger Windows&nbsp;${n}</h1><span>(Version actuelle&nbsp;: Mise à jour Windows&nbsp;${n} 2026 l Version ${o.version})</span>
  <select id="product-edition"><option value="" selected>Sélectionner le téléchargement</option><option value="3813">Windows ${n} (ISO édition multiple pour les appareils ${o.arm ? 'Arm64' : 'x64'})</option><option value="3814">Windows ${n} Famille Chine</option></select>
  <table><tbody><tr><th>Pays région</th><th>Code de hachage</th></tr>
  <tr><td>Allemand 64-bit</td><td>${'A'.repeat(64)}</td></tr><tr><td>Anglais international 64-bit</td><td>${(o.anglais ?? 'f'.repeat(64)).toUpperCase()}</td></tr><tr><td>Français canadien 64-bit</td><td>${'B'.repeat(64)}</td></tr>
  <tr><td>Français&nbsp; 64-bit</td><td>${o.francais.toUpperCase()}</td></tr><tr><td>Français 32 bits</td><td>${'C'.repeat(64)}</td></tr></tbody></table></body></html>`;
}

/** Le faux serveur : www.microsoft.com (pages et service) et le serveur de téléchargement. */
async function fauxMicrosoft() {
  const etat = {
    w11: page({ version: '26H2', francais: sha(ISO26), autres: [] as number[] }), w10: page({ version: '22H2', num: '10', francais: 'd'.repeat(64) }),
    eval: '<a href="https://www.microsoft.com/fr-fr/evalcenter/evaluate-windows-server-2022">2022</a><a href="https://www.microsoft.com/fr-fr/evalcenter/evaluate-windows-server-2025">2025</a>',
    liens: 'sentinel' as 'ok' | 'sentinel' | '715' | 'html' | 'ailleurs', skus: [] as string[], fichier: 'Win11_26H2_French_x64.iso', iso: ISO26, pageStatut: 200,
  };
  const hits: string[] = [];
  const srv: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x'), [, host] = u.pathname.split('/'), chemin = u.pathname.slice(host.length + 1);
    hits.push(`${host}${chemin}${u.search}`);
    const json = (o: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (host === 'www.microsoft.com' && chemin === '/fr-fr/software-download/windows11') { res.writeHead(etat.pageStatut, { 'content-type': 'text/html' }); res.end(etat.w11); return; }
    if (host === 'www.microsoft.com' && chemin === '/fr-fr/software-download/windows10ISO') { res.writeHead(200); res.end(etat.w10); return; }
    if (host === 'www.microsoft.com' && chemin === '/fr-fr/evalcenter') { res.writeHead(200); res.end(etat.eval); return; }
    if (host === 'www.microsoft.com' && chemin === '/software-download-connector/api/getskuinformationbyproductedition') {
      assert.equal(u.searchParams.get('profile'), '606624d44113'); assert.ok(u.searchParams.get('sessionID'));
      // Comme le vrai : la réponse JSON écrite dans une chaîne JSON.
      return json(JSON.stringify({ ValidationContainer: { Errors: [] }, Skus: [{ Id: '27126', Language: 'German', LocalizedLanguage: 'Allemand' }, { Id: '27134', Language: 'French', LocalizedLanguage: 'Français' }, { Id: '27133', Language: 'French Canadian', LocalizedLanguage: 'Français canadien' }, { Id: '27160', Language: 'English', LocalizedLanguage: 'Anglais (États-Unis)' }, { Id: '27161', Language: 'English International', LocalizedLanguage: 'Anglais international' }] }));
    }
    if (host === 'www.microsoft.com' && chemin === '/software-download-connector/api/GetProductDownloadLinksBySku') {
      etat.skus.push(String(u.searchParams.get('SKU')));
      if (etat.liens === 'sentinel') return json({ Errors: [{ Key: 'ErrorSettings.SentinelReject', Value: 'Sentinel marked this request as rejected.', Type: 8 }] });
      if (etat.liens === '715') return json({ Errors: [{ Key: 'ErrorSettings.Blocked', Value: 'message code 715-123130', Type: 9 }] });
      if (etat.liens === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>Vérification…</html>'); return; }
      const hote = etat.liens === 'ailleurs' ? 'exemple.org' : 'software.download.prss.microsoft.com';
      return json({ ProductDownloadOptions: [{ Uri: `https://${hote}/dbazure/${etat.fichier}?t=jeton&P1=1`, DownloadType: 1 }, { Uri: 'https://software.download.prss.microsoft.com/dbazure/Win11_32.iso', DownloadType: 0 }] });
    }
    if (host === 'software.download.prss.microsoft.com' && chemin === `/dbazure/${etat.fichier}`) { res.writeHead(200, { 'content-length': String(etat.iso.length), 'content-type': 'application/octet-stream' }); res.end(etat.iso); return; }
    res.writeHead(404); res.end('introuvable');
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = (srv.address() as { port: number }).port;
  /** Toute adresse de Microsoft est envoyée au faux serveur ; tout le reste répond 404 (aucun accès à Internet). */
  const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    if (!/(^|\.)microsoft\.com$/.test(u.hostname)) return new Response('hors essai', { status: 404 });
    return fetch(`http://127.0.0.1:${port}/${u.hostname}${u.pathname}${u.search}`, init);
  };
  return { etat, hits, fetch: fetchFn, fin: () => new Promise<void>((ok) => srv.close(() => ok())) };
}

function monde(fetchFn: typeof fetch, langue = 'fr') {
  const cfg = { ...DEFAULT_CONFIG, voice: { ...DEFAULT_CONFIG.voice, stt: { ...DEFAULT_CONFIG.voice.stt, language: langue } } };
  const home = mkdtempSync(join(tmpdir(), 'windows-')), alerts: Array<{ level: string; title: string; detail?: string }> = [];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: fetchFn, notify: async () => {}, autonomy: () => 'equilibre' });
  v.events.on('alert', (a: { level: string; title: string; detail?: string }) => alerts.push(a));
  return { v, alerts, home, dir: join(home, 'nas', 'iso'), act: (a: string, i: Record<string, unknown> = {}) => v.act('eitri', a, i), fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
/** Une plage d'heures creuses qui contient maintenant (ou qui ne le contient pas). */
function plage(dedans: boolean): string {
  const w = murale(Date.now(), fuseauOdin()), h = (x: number) => `${String((x + 24) % 24).padStart(2, '0')}:00`;
  return dedans ? `${h(w.h)}-${h(w.h + 1)}` : `${h(w.h + 3)}-${h(w.h + 4)}`;
}

test('lire les pages de Microsoft : version, éditions, empreintes, nouveau Windows, Windows Server (pur)', () => {
  const p = lirePageWindows(page({ version: '26H2', francais: 'e'.repeat(64), autres: [12] }));
  assert.equal(p.version, '26H2', 'la version de la page, pas celle d\'un script');
  assert.equal(p.libelle, 'Mise à jour Windows 11 2026');
  assert.deepEqual(p.editions.map((e) => e.id), ['3813', '3814']);
  assert.equal(choisirEdition(p.editions)?.id, '3813', 'par défaut : pas l\'édition pour la Chine');
  assert.equal(choisirEdition(p.editions, 'chine')?.id, '3814'); assert.equal(choisirEdition(p.editions, '3814')?.id, '3814');
  assert.equal(empreinteDe(p, 'Français'), 'e'.repeat(64), '« Français » (64 bits), pas « Français canadien » ni le 32 bits');
  assert.equal(empreinteDe(p, 'francais canadien'), 'b'.repeat(64)); assert.equal(empreinteDe(p, 'Klingon'), undefined);
  assert.deepEqual(p.windows, [10, 11, 12]);
  assert.deepEqual(lireEvalCenter('<a href="/fr-fr/evalcenter/evaluate-windows-server-2019">x</a><a href="/fr-fr/evalcenter/evaluate-windows-server-2025">y</a><a href="/fr-fr/evalcenter/evaluate-windows-server-2016-essentials">z</a>'), ['2019', '2025']);
  assert.match(raisonRefus([{ Key: 'ErrorSettings.SentinelReject', Value: 'Sentinel marked this request as rejected.', Type: 8 }]), /Sentinel.*ne la contourne pas/);
  assert.match(raisonRefus([{ Type: 9, Value: '' }]), /715-123130/);
  // Heures creuses (à cheval sur minuit compris).
  const tz = 'Europe/Paris', t = (h: string) => new Date(`2026-11-16T${h}:00+01:00`);
  assert.ok(dansCreuses(t('02:00'), '01:00-06:00', tz) && !dansCreuses(t('07:00'), '01:00-06:00', tz));
  assert.ok(dansCreuses(t('23:30'), '22:00-06:00', tz) && dansCreuses(t('05:59'), '22:00-06:00', tz) && !dansCreuses(t('12:00'), '22:00-06:00', tz));
  // Le catalogue : Windows 11, Windows 11 ARM 64 et Windows 10 savent demander à Microsoft ; Windows Server reste manuel.
  const id = (n: string) => ISO.find((x) => x.match.test(n))?.id;
  assert.deepEqual(['Win11_26H2_French_x64.iso', 'Win11_26H2_French_Arm64.iso', 'Win10_22H2_French_x64v1.iso'].map(id), ['windows11', 'windows11-arm64', 'windows10']);
  for (const x of ['windows11', 'windows11-arm64', 'windows10']) { const s = ISO.find((y) => y.id === x)!; assert.ok(s.latest && !s.manual, x); }
  assert.ok(ISO.find((y) => y.id === 'windows-server')!.manual);
});

test('le service de Microsoft (faux serveur) : langues, lien, refus', async () => {
  const m = await fauxMicrosoft(), f = m.fetch as never, o = { session: 'essai', referer: 'https://www.microsoft.com/fr-fr/software-download/windows11' };
  try {
    const l = await languesWindows(f, '3813', o);
    assert.deepEqual(l.map((x) => x.nom), ['Allemand', 'Français', 'Français canadien', 'Anglais (États-Unis)', 'Anglais international']);
    m.etat.liens = 'ok';
    const liens = await liensWindows(f, '27134', o);
    assert.deepEqual(liens.map((x) => [x.arch, x.fichier]), [['x64', 'Win11_26H2_French_x64.iso'], ['x86', 'Win11_32.iso']]);
    assert.match(liens[0].url, /^https:\/\/software\.download\.prss\.microsoft\.com\//);
    m.etat.liens = 'ailleurs'; assert.deepEqual((await liensWindows(f, '27134', o)).map((x) => x.arch), ['x86'], 'un lien hors de Microsoft est écarté');
    m.etat.liens = 'sentinel'; await assert.rejects(liensWindows(f, '27134', o), /Sentinel/);
    m.etat.liens = '715'; await assert.rejects(liensWindows(f, '27134', o), /715-123130/);
    m.etat.liens = 'html'; await assert.rejects(liensWindows(f, '27134', o), /page au lieu de la réponse/);
    assert.ok(m.hits.every((h) => h.startsWith('www.microsoft.com/') || h.startsWith('software.download.prss.microsoft.com/')));
  } finally { await m.fin(); }
});

test('Andromède : refus de Microsoft → page officielle ; lien accepté → téléchargé, empreinte vérifiée ; empreinte fausse → jeté', async () => {
  const m = await fauxMicrosoft(), w = monde(m.fetch as typeof fetch);
  try {
    mkdirSync(w.dir, { recursive: true }); writeFileSync(join(w.dir, 'Win11_25H2_French_x64.iso'), 'ancien windows');
    assert.ok((await w.act('dossier', { chemin: w.dir })).ok);
    // Vérifier : la version de la page, sans rien demander au service.
    assert.match((await w.act('verifier')).text, /🆕 Windows 11 : 25H2 → 26H2/);
    assert.ok(!m.hits.some((h) => h.includes('software-download-connector')), 'vérifier ne demande pas de lien');
    // Microsoft refuse le lien (Sentinel) : rien n'est contourné, la page officielle est donnée, sans planter.
    const r1 = await w.act('telecharger', { nom: 'windows11' });
    assert.match(r1.text, /🆕 Windows 11 26H2 disponible \(tu as 25H2\) : .*Sentinel.*https:\/\/www\.microsoft\.com\/fr-fr\/software-download\/windows11/);
    assert.ok(!m.hits.some((h) => h.endsWith('.iso')), 'aucune ISO demandée');
    assert.ok(w.alerts.some((a) => /Windows 11 26H2 : à prendre sur la page officielle/.test(a.title)));
    const vue = (w.v.ctx('eitri').settings.vues as Record<string, { version: string; sha256?: string }>).windows11;
    assert.deepEqual([vue.version, vue.sha256], ['26H2', sha(ISO26)], 'l\'empreinte publiée par Microsoft est retenue (pour reconnaître l\'ISO déposée)');
    // Blocage 715-123130 : pareil.
    m.etat.liens = '715'; assert.match((await w.act('telecharger', { nom: 'windows11' })).text, /715-123130.*page officielle/);
    // La page ne répond pas : un message clair avec la page officielle, sans planter.
    m.etat.pageStatut = 503; assert.match((await w.act('telecharger', { nom: 'windows11' })).text, /❌ Windows 11 : page officielle de Microsoft injoignable .*windows11/); m.etat.pageStatut = 200;
    // Microsoft donne le lien : téléchargé, empreinte de Microsoft vérifiée, antivirus, l'ancienne dans « old ».
    m.etat.liens = 'ok';
    const r2 = await w.act('telecharger', { nom: 'windows11' });
    assert.match(r2.text, /✅ Windows 11 26H2 .*empreinte vérifiée/);
    assert.ok(m.etat.skus.length && m.etat.skus.every((x) => x === '27134'), "Odin en français : l'ISO demandée en français");
    assert.ok(existsSync(join(w.dir, 'Windows 11', 'Win11_26H2_French_x64.iso')));
    assert.deepEqual(readdirSync(join(w.dir, 'Windows 11', 'old')), ['Win11_25H2_French_x64.iso']);
    assert.ok(m.hits.some((h) => h.startsWith('software.download.prss.microsoft.com/dbazure/Win11_26H2_French_x64.iso')));
    // Une 27H2 dont le fichier ne correspond pas à l'empreinte publiée : jeté, alerte rouge.
    m.etat.w11 = page({ version: '27H2', francais: sha(ISO27) }); m.etat.fichier = 'Win11_27H2_French_x64.iso'; m.etat.iso = Buffer.from('pirate');
    assert.match((await w.act('telecharger', { nom: 'windows11' })).text, /❌ .*empreinte fausse/);
    assert.ok(!readdirSync(join(w.dir, 'Windows 11')).some((n) => n.includes('27H2')));
    assert.ok(w.alerts.some((a) => a.level === 'critique' && /empreinte fausse/.test(a.title)));
  } finally { w.fin(); await m.fin(); }
});

test('veille Windows (Talos) : nouvelle version, nouveau Windows, Windows Server, prévenir ou heures creuses', async () => {
  const m = await fauxMicrosoft(), w = monde(m.fetch as typeof fetch);
  try {
    mkdirSync(w.dir, { recursive: true }); writeFileSync(join(w.dir, 'Win11_25H2_French_x64.iso'), 'ancien windows');
    assert.ok((await w.act('dossier', { chemin: w.dir })).ok);
    // La tâche est dans Talos : chaque jour à 03:30 par défaut.
    const t = w.v.module('eitri')!.taches!(w.v.ctx('eitri')).find((x) => x.id === 'veille_windows')!;
    assert.deepEqual(t.rythme(w.v.ctx('eitri')), { genre: 'jour', heure: '03:30' }); assert.deepEqual(t.lancer, { action: 'veille_windows' });
    // Prévenir seulement.
    assert.ok((await w.act('reglage_windows', { auto: false, creuses: '01:00-06:00' })).ok);
    m.etat.w11 = page({ version: '26H2', francais: sha(ISO26), autres: [12] });
    const v1 = (await w.act('veille_windows')).text;
    assert.match(v1, /🆕 Windows 11 26H2 disponible \(tu as 25H2\) : je te préviens seulement/);
    assert.match(v1, /ℹ Windows 10 22H2 chez Microsoft \(pas dans la bibliothèque\)/);
    assert.match(v1, /🆕 Nouveau : Windows 12 apparaît chez Microsoft/);
    assert.match(v1, /✔ Windows Server : 2025/);
    assert.ok(w.alerts.some((a) => a.title === '🆕 Windows 11 26H2 est sortie' && /25H2/.test(a.detail ?? '')));
    assert.ok(w.alerts.some((a) => a.level === 'haute' && a.title === '🆕 Un nouveau Windows chez Microsoft : Windows 12'));
    assert.ok(!m.hits.some((h) => h.includes('software-download-connector')), 'prévenir seulement : aucun lien demandé');
    // Deuxième passage : pas de nouvelle alerte pour la même version ; Windows Server 2028 apparaît.
    const n = w.alerts.length;
    m.etat.eval += '<a href="https://www.microsoft.com/fr-fr/evalcenter/evaluate-windows-server-2028">2028</a>';
    const v2 = (await w.act('veille_windows')).text;
    assert.match(v2, /🆕 Windows Server 2028 chez Microsoft \(formulaire à remplir toi-même\)/);
    assert.deepEqual(w.alerts.slice(n).map((a) => a.title), ['🆕 Windows Server 2028 chez Microsoft']);
    // Télécharger tout seul, hors heures creuses : en attente.
    m.etat.liens = 'ok';
    await w.act('reglage_windows', { auto: true, creuses: plage(false) });
    assert.match((await w.act('veille_windows')).text, /téléchargement prévu aux heures creuses/);
    assert.deepEqual((w.v.ctx('eitri').settings.windows as { attente: string[] }).attente, ['windows11']);
    assert.ok(!m.hits.some((h) => h.endsWith('.iso')));
    // Dans les heures creuses : téléchargé (empreinte de Microsoft vérifiée).
    await w.act('reglage_windows', { auto: true, creuses: plage(true) });
    assert.match((await w.act('veille_windows')).text, /✅ Windows 11 26H2 .*empreinte vérifiée/);
    assert.deepEqual((w.v.ctx('eitri').settings.windows as { attente: string[] }).attente, []);
    assert.match((await w.act('veille_windows')).text, /✔ Windows 11 26H2 : à jour/);
    // Microsoft injoignable : la veille le dit et ne plante pas.
    m.etat.pageStatut = 500;
    assert.match((await w.act('veille_windows')).text, /❌ Windows 11 : page officielle injoignable/);
    // Éditions, langues et empreinte, sans rien télécharger.
    m.etat.pageStatut = 200;
    const info = (await w.act('windows_microsoft', { produit: 'windows11' })).text;
    assert.match(info, /version 26H2/); assert.match(info, /Français, Français canadien/); assert.match(info, /Langue de l'ISO : Français \(la langue d'Odin\)/); assert.match(info, new RegExp(sha(ISO26)));
    assert.ok(m.hits.every((h) => /^(www|software\.download\.prss)\.microsoft\.com\//.test(h)), 'seulement des serveurs de Microsoft (faux, en local)');
  } finally { w.fin(); await m.fin(); }
});

test("la langue de l'ISO suit celle d'Odin (pur, puis faux serveur)", async () => {
  assert.equal(langueIso('fr', 'YT')?.ms, 'French'); assert.equal(langueIso('fr', 'CA')?.ms, 'French Canadian');
  assert.equal(langueIso('en', 'US')?.ms, 'English'); assert.equal(langueIso('en', 'GB')?.ms, 'English International'); assert.equal(langueIso('pt', 'BR')?.ms, 'Brazilian Portuguese');
  const skus = [{ id: '1', langue: 'French', nom: 'Français' }, { id: '2', langue: 'English', nom: 'Anglais (États-Unis)' }, { id: '3', langue: 'English International', nom: 'Anglais international' }];
  assert.equal(choisirSku(skus, { ms: 'French', fr: 'Français', pays: 'FR' }).sku?.id, '1');
  const r = choisirSku(skus, { ms: 'Japanese', fr: 'Japonais', pays: 'FR' }); assert.equal(r.sku?.id, '3'); assert.match(r.note ?? '', /ne propose pas l'ISO en « Japonais » : Odin prend l'anglais/);
  assert.equal(choisirSku(skus, { ms: 'Japanese', fr: 'Japonais', pays: 'US' }).sku?.id, '2', "aux États-Unis : l'anglais des États-Unis");
  // Odin en anglais : l'ISO est demandée en anglais (International hors États-Unis et Canada), avec son empreinte.
  for (const [langue, sku, note] of [['en', '27161', false], ['ja', '27161', true]] as const) {
    const m = await fauxMicrosoft(), w = monde(m.fetch as typeof fetch, langue);
    try {
      m.etat.liens = 'ok'; m.etat.fichier = 'Win11_26H2_EnglishInternational_x64.iso'; m.etat.w11 = page({ version: '26H2', francais: 'e'.repeat(64), anglais: sha(ISO26) });
      mkdirSync(w.dir, { recursive: true }); assert.ok((await w.act('dossier', { chemin: w.dir })).ok);
      const r2 = await w.act('telecharger', { nom: 'windows11' });
      assert.deepEqual(m.etat.skus, [sku], `Odin en « ${langue} »`);
      assert.match(r2.text, /✅ Windows 11 26H2 .*empreinte vérifiée/);
      assert.equal(/Odin prend l'anglais/.test(r2.text), note, "repli sur l'anglais dit seulement quand il a lieu");
    } finally { w.fin(); await m.fin(); }
  }
});
