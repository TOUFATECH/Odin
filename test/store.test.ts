// Le Store d'Andromède (ISO) et d'Hermès (logiciels) : le catalogue des dépôts officiels (filtres, recherche par nom),
// le téléchargement qui met en surveillance (chaque mois par défaut), les « Disponibles » comparés au catalogue (un
// fichier reconnu, une version plus récente signalée, rien de retéléchargé si c'est à jour), les « Surveillés » (état,
// avancement), et la recherche dans les index officiels en ligne (Homebrew, Flathub, GitHub) avec repli propre quand
// ils sont en panne. Faux dépôts officiels : chaque adresse rend un contenu préparé ; aucun accès à Internet.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { PLAN_DEFAUT, prochaineVerif } from '../src/valhalla/forge/bibliotheque.ts';
import '../src/valhalla/forge/catalogue.ts';
import { ISO, SOFT } from '../src/valhalla/forge/sources.ts';
import { entrees, filtrer, metaDe, motifDe, reconnaitre, sourceHomebrew, valeursFiltres, type EntreeStore } from '../src/valhalla/forge/store.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
type Route = string | Buffer | ((init?: RequestInit) => Response | Promise<Response>);

function monde() {
  const home = mkdtempSync(join(tmpdir(), 'odin-store-')), routes = new Map<string, Route>(), vus: string[] = [], alertes: Array<{ title: string; detail?: string }> = [];
  const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input), methode = (init?.method ?? 'GET').toUpperCase(); vus.push(`${methode} ${url}`);
    const r = routes.get(url); if (r === undefined) return new Response('introuvable', { status: 404 });
    if (typeof r === 'function') return r(init);
    const buf = Buffer.isBuffer(r) ? r : Buffer.from(r);
    if (methode === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': String(buf.length) } });
    const range = /bytes=(\d+)-/.exec(String((init?.headers as Record<string, string> | undefined)?.range ?? ''));
    return range ? new Response(buf.subarray(Number(range[1])), { status: 206 }) : new Response(buf, { status: 200, headers: { 'content-length': String(buf.length) } });
  };
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: fetchFn as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  v.events.on('alert', (a: { title: string; detail?: string }) => alertes.push(a));
  const iso = join(home, 'nas', 'iso'), log = join(home, 'nas', 'logiciels');
  /** Un faux dépôt officiel d'Ubuntu et de ses variantes : index des versions, empreintes, image. */
  const publier = (dossier: string, prefixe: string, version: string, contenu: Buffer, suffixe = 'desktop-amd64') => {
    const base = dossier ? `https://cdimage.ubuntu.com/${dossier}/releases/` : 'https://releases.ubuntu.com/', rel = dossier ? 'release/' : '';
    routes.set(base, `<a href="${version}/">${version}/</a>`); routes.set(`${base}${version}/${rel}SHA256SUMS`, `${sha(contenu)} *${prefixe}-${version}-${suffixe}.iso\n`); routes.set(`${base}${version}/${rel}${prefixe}-${version}-${suffixe}.iso`, contenu);
  };
  return { v, home, routes, vus, alertes, iso, log, publier, fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
type Store = { entrees: EntreeStore[]; total: number; filtres: { systemes: string[]; familles: string[]; archs: string[]; types: string[] }; index: Array<{ index: string; ok: boolean; n: number; erreur?: string }> };

test('le catalogue : large, officiel, rangé (système, type, architecture, catégorie) ; filtres et recherche par nom (pur)', () => {
  // Uniquement des sources officielles : une page en https, un fichier reconnaissable avec sa version, un identifiant unique.
  for (const s of [...ISO, ...SOFT]) { assert.match(s.page, /^https:\/\//, s.id); assert.ok(s.match.source.includes('('), `${s.id} : sa version se lit dans le nom du fichier`); assert.ok(s.latest || s.manual, `${s.id} : téléchargeable, ou manuel avec sa raison`); }
  assert.equal(new Set([...ISO, ...SOFT].map((s) => s.id)).size, ISO.length + SOFT.length);
  assert.ok(ISO.length >= 50 && SOFT.length >= 28, `${ISO.length} ISO, ${SOFT.length} logiciels`);
  const l = entrees({ sources: ISO, presents: new Map(), suivis: new Set(), vues: {}, enCours: new Set() }), f = valeursFiltres(l);
  assert.deepEqual(f.systemes, ['Autre', 'BSD', 'Linux', 'macOS', 'Windows']); assert.deepEqual(f.archs, ['arm64', 'x86_64']);
  for (const t of ['bureau', 'serveur', 'utilitaire', 'hyperviseur', 'NAS', 'pare-feu', 'secours']) assert.ok(f.types.includes(t), t);
  const ids = (x: EntreeStore[]) => x.map((e) => e.id).sort();
  assert.deepEqual(ids(filtrer(l, { systeme: 'BSD', type: 'serveur' })), ['freebsd', 'netbsd', 'openbsd']);
  assert.deepEqual(ids(filtrer(l, { arch: 'arm64' })), ['debian-arm64', 'ubuntu-server-arm64', 'windows11-arm64']);
  assert.deepEqual(ids(filtrer(l, { type: 'hyperviseur' })), ['esxi', 'proxmox', 'xcp-ng']);
  assert.deepEqual(ids(filtrer(l, { type: 'pare-feu' })), ['ipfire', 'opnsense', 'pfsense']); assert.deepEqual(ids(filtrer(l, { type: 'NAS' })), ['openmediavault', 'truenas', 'unraid']);
  // Recherche par nom : sans accents, sans majuscules, mots dans le désordre ; « tous » ne filtre pas.
  assert.deepEqual(ids(filtrer(l, { q: 'KUBUNTU' })), ['kubuntu']); assert.deepEqual(ids(filtrer(l, { q: 'live debian' })), ['debian-live-gnome', 'debian-live-kde']);
  assert.deepEqual(ids(filtrer(l, { q: 'depannage', systeme: 'tous' })).filter((x) => ['hirens', 'systemrescue'].includes(x)), ['hirens', 'systemrescue']);
  assert.equal(filtrer(l, { q: 'rien-de-tel' }).length, 0); assert.equal(filtrer(l, {}).length, l.length);
  // macOS et Windows Server par les voies officielles : pas de téléchargement automatique, la raison et la page sont dites.
  // Windows 11, lui, se télécharge chez Microsoft depuis le 16/11 (forge/microsoft.ts, commit 5d30f618) : il n'est plus manuel.
  const mac = l.find((e) => e.id === 'macos')!, win = l.find((e) => e.id === 'windows11')!, serveur = l.find((e) => e.id === 'windows-server')!;
  assert.equal(mac.etat, 'manuel'); assert.match(mac.manuel!, /Apple ne publie pas d'ISO/); assert.match(mac.page, /support\.apple\.com/);
  assert.equal(serveur.etat, 'manuel'); assert.match(serveur.manuel!, /formulaire/); assert.match(serveur.page, /^https:\/\/www\.microsoft\.com/);
  assert.notEqual(win.etat, 'manuel'); assert.equal(win.manuel, undefined);
  // Les icônes : dessinées ici, une par famille (aucune image prise ailleurs).
  assert.ok(l.every((e) => e.icone.startsWith('data:image/svg+xml;base64,'))); assert.notEqual(win.icone, mac.icone);
  // Logiciels : catégories et systèmes.
  const s = entrees({ sources: SOFT, presents: new Map(), suivis: new Set(), vues: {}, enCours: new Set() }), fs = valeursFiltres(s);
  assert.deepEqual(fs.systemes, ['Linux', 'macOS', 'Windows']); for (const c of ['Internet', 'Développement', 'Multimédia', 'Outils', 'Sécurité', 'Réseau', 'Bureautique']) assert.ok(fs.types.includes(c), c);
  assert.deepEqual(ids(filtrer(s, { systeme: 'macOS' })), ['firefox-mac', 'keepassxc-mac']); assert.deepEqual(ids(filtrer(s, { q: 'coffre', systeme: 'Linux' })), ['keepassxc-appimage']);
  assert.deepEqual(metaDe(SOFT.find((x) => x.id === 'vscode-deb')!), { systeme: 'Linux', arch: 'x86_64', type: 'Développement' });
  // L'état d'une entrée : présente et à jour, ou une version plus récente vue sur le site officiel.
  const e2 = entrees({ sources: ISO.filter((x) => x.id === 'debian'), presents: new Map([['debian', ['13.1.0']]]), suivis: new Set(['debian']), vues: { debian: { version: '13.2.0', at: 1, taille: 700 } }, enCours: new Set() })[0];
  assert.deepEqual([e2.etat, e2.version, e2.taille, e2.surveille, e2.presents], ['nouvelle version', '13.2.0', 700, true, ['13.1.0']]);
  assert.equal(motifDe('Outil-2.0.0-x64.exe', 'v2.0.0'), 'Outil-{version}-x64.exe'); assert.equal(motifDe('7z2501-x64.exe', '25.01'), '7z{version}-x64.exe'); assert.equal(motifDe('installateur.exe', '2.0'), undefined);
});

test('reconnaître un fichier déjà là : par son nom, par l\'empreinte de l\'éditeur, par ce qui est lu dedans (pur)', () => {
  const vues = { debian: { version: '13.2.0', at: 1, sha256: 'a'.repeat(64) }, 'ubuntu-server': { version: '24.04.3', at: 1 } };
  const nom = reconnaitre({ nom: 'debian-13.1.0-amd64-netinst.iso' }, ISO, vues);
  assert.deepEqual([nom.source?.id, nom.version, nom.par, nom.derniere, nom.etat], ['debian', '13.1.0', 'nom', '13.2.0', 'nouvelle version']);
  const empreinte = reconnaitre({ nom: 'image-renommée.iso', sha256: 'a'.repeat(64) }, ISO, vues);
  assert.deepEqual([empreinte.source?.id, empreinte.version, empreinte.par, empreinte.etat], ['debian', '13.2.0', 'empreinte', 'à jour']);
  const etiquette = reconnaitre({ nom: 'serveur-maison.iso', distribution: 'Ubuntu Server', version: '24.04.3', edition: 'serveur', arch: 'x86_64' }, ISO, vues);
  assert.deepEqual([etiquette.source?.id, etiquette.par, etiquette.etat], ['ubuntu-server', 'étiquette', 'à jour']);
  assert.equal(reconnaitre({ nom: 'debian-13.2.0-amd64-netinst.iso' }, ISO, {}).etat, 'pas vérifié', 'pas encore relu sur le site officiel');
  assert.equal(reconnaitre({ nom: 'inconnu.iso' }, ISO, vues).etat, 'hors catalogue');
});

test('Store des ISO : il liste, filtre et cherche ; télécharger met en surveillance (chaque mois) ; on peut retirer', async () => {
  const w = monde();
  try {
    mkdirSync(w.iso, { recursive: true }); await w.v.act('eitri', 'dossier', { chemin: w.iso });
    const S = async (i: Record<string, unknown> = {}) => { const r = await w.v.act('eitri', 'store', i); assert.notEqual(r.ok, false, r.text); return r.data as Store; };
    const tout = await S();
    assert.equal(tout.entrees.length, ISO.length); assert.equal(tout.total, ISO.length); assert.ok(tout.filtres.systemes.includes('BSD') && tout.filtres.types.includes('secours'));
    assert.deepEqual((await S({ systeme: 'BSD', type: 'serveur' })).entrees.map((e) => e.id).sort(), ['freebsd', 'netbsd', 'openbsd']);
    assert.deepEqual((await S({ q: 'kubuntu' })).entrees.map((e) => `${e.id}:${e.etat}:${e.surveille}`), ['kubuntu:à télécharger:false']);
    assert.match((await w.v.act('eitri', 'store', { q: 'kubuntu' })).text, /^1 sur \d+ au catalogue\.\n- Kubuntu \(LTS\) · Linux · bureau · x86_64 · à télécharger$/);
    // « Relire les versions » : la version courante et la taille viennent du dépôt officiel.
    const img = Buffer.alloc(150_000, 5); w.publier('kubuntu', 'kubuntu', '26.04.1', img);
    const k = (await S({ q: 'kubuntu', actualiser: true })).entrees[0];
    assert.deepEqual([k.version, k.taille, k.etat], ['26.04.1', 150_000, 'à télécharger']); assert.ok(!w.vus.some((u) => u.startsWith('GET') && u.endsWith('.iso')), 'rien n\'est téléchargé pour lire la version');
    // Télécharger depuis le Store : antivirus d'abord, rangé dans le dossier, et surveillé tout seul.
    const t = await w.v.act('eitri', 'telecharger', { nom: 'kubuntu' });
    assert.match(t.text, /✅ Kubuntu \(LTS\) 26\.04\.1 .*empreinte vérifiée/); assert.deepEqual(readFileSync(join(w.iso, 'Kubuntu', 'kubuntu-26.04.1-desktop-amd64.iso')), img);
    const sv = (await w.v.act('eitri', 'surveilles')).data as { texte: string; prochaine: string; surveilles: Array<{ id: string; presents: string[]; derniere?: string; etat: string }> };
    assert.deepEqual(sv.surveilles.map((x) => `${x.id}:${x.presents.join(',')}:${x.derniere}:${x.etat}`), ['kubuntu:26.04.1:26.04.1:à jour']);
    assert.match(sv.texte, /Surveillance chaque mois \(le 1\) à 04:00/); assert.equal(sv.prochaine, prochaineVerif(PLAN_DEFAUT, new Date()).toISOString(), 'prochaine vérification : le 1er du mois, par défaut');
    assert.deepEqual((await S({ q: 'kubuntu' })).entrees.map((e) => `${e.etat}:${e.surveille}:${e.presents.join(',')}`), ['à jour:true:26.04.1']);
    // La fréquence se règle (un seul réglage, partagé avec Hydre).
    await w.v.act('eitri', 'verification_iso', { frequence: 'semaine', jour: 2, heure: '05:00' });
    assert.match(((await w.v.act('eitri', 'surveilles')).data as { texte: string }).texte, /chaque semaine \(mardi\) à 05:00/);
    // Les onglets : Store, Disponibles, Surveillés, Réglages.
    const vue = await w.v.module('eitri')!.view(w.v.ctx('eitri'), new URLSearchParams());
    assert.deepEqual(vue.onglets, ['Store', 'Disponibles', 'Surveillés', 'Réglages']);
    const store = vue.sections.find((s) => s.title === `Store (${ISO.length})`) as { onglet?: string; items: Array<{ title: string; icon?: string; badge?: string; meta?: string; actions?: Array<{ action: string }> }> };
    assert.equal(store.onglet, 'Store'); assert.ok(store.items.every((c) => c.icon?.startsWith('data:image/svg')));
    const ck = store.items.find((c) => c.title === 'Kubuntu (LTS)')!; assert.equal(ck.badge, 'à jour'); assert.match(ck.meta!, /version 26\.04\.1 · 146 Ko · dans le dossier : 26\.04\.1/);
    assert.deepEqual(store.items.find((c) => c.title === 'Windows Server')!.actions, [], 'pas de bouton Télécharger pour ce qui est manuel (Windows 11 se télécharge depuis le commit 5d30f618)');
    const mes = vue.sections.find((s) => s.title === 'Mes ISO') as { onglet?: string; items: Array<{ title: string; badge?: string; meta?: string; actions: Array<{ action: string; label: string }> }> };
    assert.equal(mes.onglet, 'Surveillés'); assert.deepEqual(mes.items.map((c) => `${c.title}:${c.badge}`), ['Kubuntu (LTS):à jour']); assert.match(mes.items[0].meta!, /dernière version vue : 26\.04\.1 · prochaine vérification : /);
    assert.ok(mes.items[0].actions.some((a) => a.action === 'ne_plus_suivre' && a.label === 'Retirer'));
    // Retirer de la surveillance : le fichier reste, Odin ne le vérifie plus.
    assert.match((await w.v.act('eitri', 'ne_plus_suivre', { nom: 'kubuntu' })).text, /n'est plus suivi : Odin ne le vérifie plus/);
    assert.deepEqual(((await w.v.act('eitri', 'surveilles')).data as typeof sv).surveilles, []); assert.ok(existsSync(join(w.iso, 'Kubuntu', 'kubuntu-26.04.1-desktop-amd64.iso')));
    assert.match((await w.v.act('eitri', 'mettre_a_jour')).text, /Rien à suivre/);
    // Le suivre de nouveau le remet en surveillance.
    await w.v.act('eitri', 'suivre', { nom: 'kubuntu' }); assert.equal(((await w.v.act('eitri', 'surveilles')).data as typeof sv).surveilles.length, 1);
  } finally { w.fin(); }
});

test('Disponibles : le scan reconnaît un fichier du catalogue, signale une version plus récente ; rien n\'est retéléchargé si c\'est à jour', async () => {
  const w = monde();
  try {
    mkdirSync(w.iso, { recursive: true }); await w.v.act('eitri', 'dossier', { chemin: w.iso });
    // Trois fichiers déposés à la main : un nom officiel (Debian), une vraie petite image renommée (Ubuntu Server), un inconnu.
    const FIX = join(import.meta.dirname, 'fixtures', 'thjalfi'), ubuntu = gunzipSync(readFileSync(join(FIX, readdirSync(FIX).find((f) => /^ubuntu/.test(f))!)));
    writeFileSync(join(w.iso, 'debian-13.1.0-amd64-netinst.iso'), 'ancienne debian'); writeFileSync(join(w.iso, 'serveur-maison.iso'), ubuntu); writeFileSync(join(w.iso, 'mystere.iso'), 'rien de connu');
    const sums = (v: string, contenu: Buffer | string) => w.routes.set('https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/SHA256SUMS', `${sha(contenu)}  debian-${v}-amd64-netinst.iso\n`);
    const neuve = Buffer.alloc(80_000, 9); sums('13.2.0', neuve); w.routes.set('https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-13.2.0-amd64-netinst.iso', neuve);
    w.publier('', 'ubuntu', '24.04.3', ubuntu, 'live-server-amd64');
    // Le scan (surveillance d'Hydre : antivirus, fiche), puis la comparaison au catalogue.
    const veille = w.v.module('ymir')!.watch!; for (let k = 0; k < 3; k++) await veille.run(w.v.ctx('ymir'));
    type D = { nom: string; catalogue?: string; source?: string; versionReconnue?: string; par?: string; derniere?: string; etat: string; antivirus: string };
    const dispo = async () => ((await w.v.act('eitri', 'disponibles')).data as { fichiers: D[] }).fichiers, de = (l: D[], n: string) => l.find((x) => x.nom === n)!;
    // Premier passage : Odin reconnaît les fichiers ; puis il relit les versions sur les sites officiels.
    await dispo(); await w.v.act('eitri', 'verifier');
    let l = await dispo();
    assert.deepEqual((({ catalogue, versionReconnue, par, derniere, etat, antivirus }) => ({ catalogue, versionReconnue, par, derniere, etat, antivirus }))(de(l, 'debian-13.1.0-amd64-netinst.iso')), { catalogue: 'Debian (netinst)', versionReconnue: '13.1.0', par: 'nom', derniere: '13.2.0', etat: 'nouvelle version', antivirus: 'sain' });
    // L'image renommée est reconnue par ce qu'Odin a lu dedans (étiquette, fichiers), et par l'empreinte publiée par l'éditeur.
    const u = de(l, 'serveur-maison.iso'); assert.equal(u.source, 'ubuntu-server'); assert.equal(u.etat, 'à jour'); assert.ok(u.par === 'empreinte' || u.par === 'étiquette', u.par);
    assert.equal(de(l, 'mystere.iso').etat, 'hors catalogue');
    assert.match((await w.v.act('eitri', 'disponibles')).text, /debian-13\.1\.0-amd64-netinst\.iso · Debian \(netinst\) 13\.1\.0 \(reconnu par nom\) · nouvelle version 13\.2\.0/);
    const vue = await w.v.module('eitri')!.view(w.v.ctx('eitri'), new URLSearchParams());
    const cartes = vue.sections.find((s) => s.title === 'Dans ton dossier (3)') as { items: Array<{ title: string; badge?: string; actions: Array<{ action: string; label: string }> }> };
    const cd = cartes.items.find((c) => c.title === 'debian-13.1.0-amd64-netinst.iso')!; assert.equal(cd.badge, 'nouvelle version 13.2.0'); assert.deepEqual(cd.actions.map((a) => a.label), ['Fiche', 'Mettre à jour']);
    // Ce qui est déjà là est seulement vérifié ; c'est parce qu'une version plus récente existe qu'il est retéléchargé (l'ancienne va dans « old »).
    w.vus.length = 0;
    const p = (await w.v.act('eitri', 'tournee')).text;
    assert.match(p, /✅ Debian \(netinst\) 13\.2\.0/); assert.match(p, /✔ Ubuntu Server \(LTS\) 24\.04\.3 : à jour/);
    assert.deepEqual(w.vus.filter((x) => x.startsWith('GET') && x.endsWith('.iso')), ['GET https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-13.2.0-amd64-netinst.iso'], 'une seule image téléchargée : celle qui a une nouvelle version');
    assert.ok(existsSync(join(w.iso, 'Debian', 'debian-13.2.0-amd64-netinst.iso')) && existsSync(join(w.iso, 'Debian', 'old', 'debian-13.1.0-amd64-netinst.iso')) && !existsSync(join(w.iso, 'debian-13.1.0-amd64-netinst.iso')));
    // À jour : un nouveau passage ne retélécharge rien.
    w.vus.length = 0;
    const p2 = (await w.v.act('eitri', 'tournee')).text;
    assert.match(p2, /✔ Debian \(netinst\) 13\.2\.0 : à jour/); assert.deepEqual(w.vus.filter((x) => x.startsWith('GET') && x.endsWith('.iso')), [], 'rien n\'est retéléchargé');
    l = await dispo();
    assert.equal(de(l, 'debian-13.2.0-amd64-netinst.iso').etat, 'à jour'); assert.equal(de(l, 'debian-13.1.0-amd64-netinst.iso').etat, 'ancienne version (old)');
  } finally { w.fin(); }
});

test('Surveillés : l\'avancement d\'un téléchargement en cours ; la surveillance mensuelle télécharge la nouvelle version à son heure', async () => {
  const w = monde();
  try {
    mkdirSync(w.iso, { recursive: true }); await w.v.act('eitri', 'dossier', { chemin: w.iso });
    // Un dépôt lent : la moitié de l'image, puis on attend.
    const img = Buffer.alloc(200_000, 3); w.publier('xubuntu', 'xubuntu', '26.04.1', img);
    let suite!: () => void; const attente = new Promise<void>((ok) => { suite = ok; });
    w.routes.set('https://cdimage.ubuntu.com/xubuntu/releases/26.04.1/release/xubuntu-26.04.1-desktop-amd64.iso', () => new Response(new ReadableStream({ async start(c) { c.enqueue(img.subarray(0, 100_000)); await attente; c.enqueue(img.subarray(100_000)); c.close(); } }), { status: 200, headers: { 'content-length': String(img.length) } }));
    const fini = w.v.act('eitri', 'telecharger', { nom: 'xubuntu' });
    type SV = { surveilles: Array<{ id: string; etat: string; enCours?: { recu: number; total?: number; pct?: number } }> };
    let en: SV['surveilles'][0] | undefined;
    for (let k = 0; k < 200 && !en?.enCours?.recu; k++) { await new Promise((ok) => setTimeout(ok, 20)); en = ((await w.v.act('eitri', 'surveilles')).data as SV).surveilles.find((x) => x.id === 'xubuntu'); }
    assert.deepEqual([en!.etat, en!.enCours], ['en cours', { recu: 100_000, total: 200_000, pct: 50 }]);
    const vue = await w.v.module('eitri')!.view(w.v.ctx('eitri'), new URLSearchParams());
    const c = (vue.sections.find((s) => s.title === 'Mes ISO') as { items: Array<{ title: string; badge?: string; progress?: number; actions: Array<{ action: string }> }> }).items[0];
    assert.deepEqual([c.badge, c.progress, c.actions[0].action], ['téléchargement 50 %', 0.5, 'annuler']); assert.equal(vue.refreshMs, 3000, 'la page se relit toute seule pendant un téléchargement');
    assert.equal(((await w.v.act('eitri', 'store', { q: 'xubuntu' })).data as Store).entrees[0].etat, 'en cours');
    suite(); assert.match((await fini).text, /✅ Xubuntu \(LTS\) 26\.04\.1/);
    // La surveillance : rien avant son heure ; le 1er du mois, elle voit la nouvelle version et la télécharge.
    const neuve = Buffer.alloc(120_000, 4); w.publier('xubuntu', 'xubuntu', '26.04.2', neuve);
    const ymir = w.v.ctx('ymir') as { now: () => Date }, veille = w.v.module('ymir')!.watch!;
    ymir.now = () => new Date('2026-11-20T10:00:00'); await veille.run(w.v.ctx('ymir'));
    assert.ok(!existsSync(join(w.iso, 'Xubuntu', 'xubuntu-26.04.2-desktop-amd64.iso')), 'pas avant le passage prévu');
    ymir.now = () => new Date('2026-12-01T04:00:30'); await veille.run(w.v.ctx('ymir'));
    assert.deepEqual(readdirSync(join(w.iso, 'Xubuntu')).sort(), ['old', 'xubuntu-26.04.2-desktop-amd64.iso']); assert.deepEqual(readdirSync(join(w.iso, 'Xubuntu', 'old')), ['xubuntu-26.04.1-desktop-amd64.iso']);
    const cr = w.alertes.find((a) => /Hydre : vérification des ISO/.test(a.title))!; assert.match(cr.detail!, /✅ Xubuntu \(LTS\) 26\.04\.2/);
  } finally { w.fin(); }
});

test('Store des logiciels : index officiels en ligne (Homebrew, Flathub, GitHub) ; en panne, le catalogue local répond seul, sans erreur', async () => {
  const w = monde();
  try {
    mkdirSync(w.log, { recursive: true }); await w.v.act('fjalar', 'dossier', { chemin: w.log });
    const S = async (i: Record<string, unknown>) => { const r = await w.v.act('fjalar', 'store', i); assert.notEqual(r.ok, false, r.text); return { ...(r.data as Store), texte: r.text }; };
    // Tous les index en panne (aucun ne répond) : le catalogue local seul, et c'est dit.
    const panne = await S({ q: 'vlc', enligne: true });
    assert.deepEqual(panne.entrees.map((e) => e.id), ['vlc']); assert.deepEqual(panne.index.map((x) => `${x.index}:${x.ok}`), ['Homebrew:false', 'Flathub:false']);
    assert.match(panne.texte, /· Homebrew : en panne \(.*404\) — le catalogue local répond seul/);
    assert.deepEqual((await S({ q: 'vlc' })).index, [], 'sans la case « en ligne », aucun index n\'est interrogé');
    assert.deepEqual((await S({ systeme: 'macOS' })).entrees.map((e) => e.id).sort(), ['firefox-mac', 'keepassxc-mac']);
    // Les index répondent.
    const dmg = Buffer.from(`fausse image disque de VLC ${Math.random()}`);
    w.routes.set('https://formulae.brew.sh/api/cask.json', JSON.stringify([{ token: 'vlc', name: ['VLC media player'], desc: 'Multimedia player', homepage: 'https://www.videolan.org/vlc/', url: 'https://get.videolan.org/vlc/3.0.24/macosx/vlc-3.0.24-arm64.dmg', version: '3.0.24', sha256: sha(dmg) }, { token: 'firefox', name: ['Mozilla Firefox'], desc: 'Web browser', url: 'https://exemple.org/Firefox.dmg', version: '160.0', sha256: 'no_check' }]));
    w.routes.set('https://formulae.brew.sh/api/cask/vlc.json', JSON.stringify({ token: 'vlc', name: ['VLC media player'], homepage: 'https://www.videolan.org/vlc/', url: 'https://get.videolan.org/vlc/3.0.24/macosx/vlc-3.0.24-arm64.dmg', version: '3.0.24', sha256: sha(dmg) }));
    w.routes.set('https://get.videolan.org/vlc/3.0.24/macosx/vlc-3.0.24-arm64.dmg', dmg);
    w.routes.set('https://flathub.org/api/v2/search?locale=fr', (init) => { assert.equal(init?.method, 'POST'); assert.deepEqual(JSON.parse(String(init?.body)), { query: 'vlc' }); return Response.json({ hits: [{ app_id: 'org.videolan.VLC', name: 'VLC', summary: 'Lecteur multimédia', main_categories: 'audiovideo', verification_verified: true }] }); });
    const ok = await S({ q: 'vlc', enligne: true });
    assert.deepEqual(ok.index.map((x) => `${x.index}:${x.ok}:${x.n}`), ['Homebrew:true:1', 'Flathub:true:1']);
    assert.deepEqual(ok.entrees.map((e) => e.id), ['vlc', 'homebrew:vlc', 'flathub:org.videolan.VLC']);
    const brew = ok.entrees[1], flat = ok.entrees[2];
    assert.deepEqual([brew.nom, brew.systeme, brew.arch, brew.version, brew.enLigne?.index, brew.enLigne?.sha256], ['VLC media player', 'macOS', 'arm64', '3.0.24', 'homebrew', sha(dmg)]);
    assert.deepEqual([flat.systeme, flat.etat, flat.enLigne?.verifie], ['Linux', 'manuel', true]); assert.match(flat.manuel!, /flatpak install flathub org\.videolan\.VLC/);
    assert.deepEqual((await S({ q: 'vlc', enligne: true, systeme: 'Linux' })).entrees.map((e) => e.id), ['flathub:org.videolan.VLC'], 'les filtres valent aussi pour les résultats en ligne');
    // L'index Homebrew est gardé un jour : s'il tombe en panne ensuite, la dernière copie répond.
    w.routes.delete('https://formulae.brew.sh/api/cask.json');
    assert.ok(existsSync(join(w.home, 'valhalla', 'fjalar', 'index-homebrew.json'))); assert.equal((await S({ q: 'vlc', enligne: true })).index[0].ok, true);
    // Télécharger depuis l'index : antivirus d'abord, empreinte de l'éditeur vérifiée, puis surveillé comme le catalogue.
    const t = await w.v.act('fjalar', 'telecharger_en_ligne', { index: 'homebrew', ref: 'vlc', nom: 'VLC media player' });
    assert.match(t.text, /✅ VLC media player 3\.0\.24 .*empreinte vérifiée/); assert.deepEqual(readFileSync(join(w.log, 'VLC media player', 'vlc-3.0.24.dmg')), dmg);
    const sv = (await w.v.act('fjalar', 'surveilles')).data as { texte: string; surveilles: Array<{ id: string; presents: string[]; etat: string }> };
    assert.deepEqual(sv.surveilles.map((x) => `${x.id}:${x.presents.join(',')}:${x.etat}`), ['brew-vlc:3.0.24:à jour']); assert.match(sv.texte, /Surveillance chaque mois \(le 1\) à 04:00/);
    assert.equal(sourceHomebrew({ ref: 'vlc', name: 'VLC' }).match.exec('vlc-3.0.24.dmg')?.[1], '3.0.24'); assert.throws(() => sourceHomebrew({ ref: '../x', name: 'x' }), /invalide/);
    // GitHub : les fichiers publiés par un projet (« propriétaire/projet ») ; le fichier choisi est suivi par son motif.
    const exe = Buffer.from(`MZ${'outil'.repeat(400)}`);
    w.routes.set('https://api.github.com/repos/toufatech/outil/releases/latest', JSON.stringify({ tag_name: 'v2.0.0', html_url: 'https://github.com/toufatech/outil/releases/tag/v2.0.0', assets: [{ name: 'Outil-2.0.0-x64.exe', browser_download_url: 'https://github.com/toufatech/outil/releases/download/v2.0.0/Outil-2.0.0-x64.exe', size: exe.length, digest: `sha256:${sha(exe)}` }, { name: 'notes.txt', browser_download_url: 'https://x/notes.txt', size: 3 }] }));
    w.routes.set('https://github.com/toufatech/outil/releases/download/v2.0.0/Outil-2.0.0-x64.exe', exe);
    const gh = await S({ q: 'toufatech/outil', enligne: true });
    assert.deepEqual(gh.entrees.map((e) => `${e.id}:${e.version}:${e.systeme}`), ['github:toufatech/outil:Outil-2.0.0-x64.exe:2.0.0:Windows']); assert.equal(gh.index[0].index, 'GitHub');
    const tg = await w.v.act('fjalar', 'telecharger_en_ligne', { index: 'github', ref: 'toufatech/outil', fichier: 'Outil-2.0.0-x64.exe', version: '2.0.0' });
    assert.match(tg.text, /✅ outil \(exe\) 2\.0\.0 .*empreinte vérifiée/); assert.ok(existsSync(join(w.log, 'Autres', 'Outil-2.0.0-x64.exe')));
    assert.equal((await w.v.act('fjalar', 'telecharger_en_ligne', { index: 'github', ref: 'toufatech/outil', fichier: 'installateur.exe', version: '2.0.0' })).ok, false, 'sans version dans le nom, pas de suivi possible : c\'est dit');
    assert.match((await w.v.act('fjalar', 'telecharger_en_ligne', { index: 'flathub', ref: 'org.videolan.VLC' })).text, /s'installe avec Flatpak/);
    // Pour les ISO, pas d'index commun officiel : seul GitHub est interrogé, et seulement pour « propriétaire/projet ».
    assert.deepEqual(((await w.v.act('eitri', 'store', { q: 'ubuntu', enligne: true })).data as Store).index, []);
    // La page d'Hermès : les mêmes quatre onglets.
    const vue = await w.v.module('fjalar')!.view(w.v.ctx('fjalar'), new URLSearchParams());
    assert.deepEqual(vue.onglets, ['Store', 'Disponibles', 'Surveillés', 'Réglages']); assert.ok(vue.sections.some((s) => s.title === 'Mes logiciels' && s.onglet === 'Surveillés') && vue.sections.some((s) => s.title === 'Chercher dans le Store' && s.onglet === 'Store') && vue.sections.some((s) => s.title === 'Ajouter une source officielle'));
  } finally { w.fin(); }
});

test('la page du Store (src/web/pages/store.js) : une seule page pour Andromède et Hermès, sans fenêtre native, avec la barre de chargement', async () => {
  const vm = await import('node:vm'), src = readFileSync(new URL('../src/web/pages/store.js', import.meta.url), 'utf8');
  const win: { OdinPages?: Record<string, (o: Record<string, unknown>) => Promise<unknown>> } = {};
  vm.runInNewContext(src, { window: win, document: {}, console });
  assert.deepEqual(Object.keys(win.OdinPages!).sort(), ['eitri', 'fjalar']);
  // Une vue sans onglet « Store » (ou une page générique d'une autre forme) : la page générique reste comme elle est.
  assert.equal(await win.OdinPages!.eitri({ host: {}, generic: [], view: { sections: [], onglets: ['Autre'] } }), false);
  assert.equal(await win.OdinPages!.fjalar({ host: {}, generic: [{}], view: { sections: [], onglets: ['Store'] } }), false);
  assert.doesNotMatch(src, /(?<![.\w])(alert|confirm|prompt)\(/, 'pas de fenêtre native : OdinDialog'); assert.match(src, /window\.OdinDialog\.confirm\(/);
  // La barre de chargement : au centre, animée, pourcentage quand il est connu, sobre si l'appareil réduit les animations, couleurs du thème.
  for (const re of [/role: 'progressbar'/, /@keyframes stFile/, /prefers-reduced-motion:reduce/, /var\(--accent\)/, /var\(--panel\)/, /var\(--line\)/, /var\(--ink\)/, /Je consulte le Store…/, /Je télécharge \$\{e\.nom\}…/]) assert.match(src, re);
  // La même barre dans Hydre (chargement des images, import, téléchargement).
  const hydre = readFileSync(new URL('../src/web/pages/ymir.js', import.meta.url), 'utf8');
  for (const re of [/function charge\(texte/, /Je lis tes images…/, /@keyframes ymFile/, /prefers-reduced-motion:reduce\)\{\.ym-load/, /var\(--accent,var\(--ya\)\)/, /J'envoie \$\{f\.name\}/]) assert.match(hydre, re);
});

test('la page du Store exécutée (faux navigateur) : cartes du catalogue, recherche, onglets, téléchargement avec la barre au centre', async () => {
  const w = monde();
  try {
    mkdirSync(w.iso, { recursive: true }); await w.v.act('eitri', 'dossier', { chemin: w.iso });
    const img = Buffer.alloc(90_000, 6); w.publier('kubuntu', 'kubuntu', '26.04.1', img);
    // Un tout petit « document » : assez pour faire tourner la page (éléments, attributs, écouteurs, enfants).
    class N {
      tag: string; children: unknown[] = []; attrs: Record<string, string> = {}; ecoute: Record<string, (e: unknown) => unknown> = {}; textContent = ''; className = ''; hidden = false; value = ''; checked = false;
      style = { cssText: '', setProperty() { /* rien */ } }; classList = { add() { /* rien */ }, remove() { /* rien */ } };
      constructor(tag: string) { this.tag = tag; }
      append(...k: unknown[]) { this.children.push(...k); } replaceChildren(...k: unknown[]) { this.children = [...k]; }
      setAttribute(k: string, v: string) { this.attrs[k] = v; if (k === 'value') this.value = v; } removeAttribute(k: string) { delete this.attrs[k]; }
      addEventListener(e: string, f: (e: unknown) => unknown) { this.ecoute[e] = f; } scrollIntoView() { /* rien */ }
      get firstChild() { return this.children[0]; }
    }
    const tous = (n: unknown, p: (x: N) => boolean, out: N[] = []): N[] => { if (n instanceof N) { if (p(n)) out.push(n); for (const c of n.children) tous(c, p, out); } return out; };
    const texte = (n: unknown): string => (n instanceof N ? n.textContent + n.children.map(texte).join('') : typeof n === 'object' && n ? String((n as { t?: string }).t ?? '') : '');
    const notes: string[] = [];
    const fauxFetch = async (_u: string, init: { body: string }) => { const b = JSON.parse(init.body) as { module: string; action: string; input: Record<string, unknown> }; const r = await w.v.act(b.module, b.action, b.input); return { json: async () => r }; };
    const win: Record<string, unknown> = { OdinNotices: { local: (x: { title: string }) => notes.push(x.title) }, OdinDialog: { confirm: async () => true } };
    const vm = await import('node:vm');
    vm.runInNewContext(readFileSync(new URL('../src/web/pages/store.js', import.meta.url), 'utf8'), { window: win, document: { createElement: (t: string) => new N(t), createTextNode: (t: string) => ({ t }), getElementById: () => null, head: new N('head') }, Node: N, fetch: fauxFetch, AbortSignal, setTimeout, clearTimeout, setInterval, clearInterval, performance, console });
    const vue = await w.v.module('eitri')!.view(w.v.ctx('eitri'), new URLSearchParams());
    const generic = vue.sections.map((s) => { const n = new N('section'); n.textContent = s.title; return n; }), host = new N('div');
    const pages = win.OdinPages as Record<string, (o: Record<string, unknown>) => Promise<unknown>>;
    assert.equal(await pages.eitri({ host, generic, view: vue, info: { name: 'Andromède' } }), true);
    const attendre = async (p: () => boolean) => { for (let k = 0; k < 300 && !p(); k++) await new Promise((ok) => setTimeout(ok, 20)); assert.ok(p(), 'la page a fini de se dessiner'); };
    const noms = () => tous(host, (x) => x.className === 'st-c').map((c) => texte(tous(c, (y) => y.tag === 'b')[0]));
    // Pendant la lecture : la barre de chargement au centre ; puis les cartes du catalogue.
    assert.ok(tous(host, (x) => x.className === 'st-load').length === 1 && /Je consulte le Store/.test(texte(host)));
    await attendre(() => noms().length > 40);
    assert.ok(noms().includes('Kubuntu (LTS)') && noms().includes('FreeBSD') && noms().includes('Windows 11')); assert.equal(tous(host, (x) => x.className === 'st-load').length, 0);
    assert.deepEqual(tous(host, (x) => x.attrs.role === 'tab').map(texte), ['Store', 'Disponibles', 'Surveillés', 'Réglages']);
    // Recherche par nom (au fil de la frappe) et filtre.
    const q = tous(host, (x) => x.tag === 'input' && x.attrs.type === 'search')[0]; q.ecoute.input({ target: { value: 'kubuntu' } });
    await attendre(() => noms().length === 1); assert.deepEqual(noms(), ['Kubuntu (LTS)']);
    q.ecoute.input({ target: { value: '' } }); await attendre(() => noms().length > 40);
    const sys = tous(host, (x) => x.tag === 'select' && x.attrs['aria-label'] === 'Système')[0]; sys.ecoute.change({ target: { value: 'BSD' } });
    assert.deepEqual(noms().sort(), ['FreeBSD', 'NetBSD', 'OPNsense', 'OpenBSD', 'pfSense']); sys.ecoute.change({ target: { value: '' } });
    // Une entrée « manuelle » n'a pas de bouton Télécharger, mais sa page officielle.
    const win11 = tous(host, (x) => x.className === 'st-c').find((c) => texte(tous(c, (y) => y.tag === 'b')[0]) === 'Windows Server')!; // toujours manuel (Windows 11 se télécharge depuis 5d30f618)
    assert.deepEqual(tous(win11, (x) => x.tag === 'button').map(texte), []); assert.match(tous(win11, (x) => x.tag === 'a')[0].attrs.href, /^https:\/\/www\.microsoft\.com/);
    // Télécharger : la barre au centre pendant le téléchargement, puis l'entrée est à jour et surveillée.
    q.ecoute.input({ target: { value: 'kubuntu' } }); await attendre(() => noms().length === 1);
    const bouton = tous(host, (x) => x.tag === 'button' && texte(x) === 'Télécharger')[0]; const fini = bouton.ecoute.click({}) as Promise<void>;
    assert.match(texte(tous(host, (x) => x.className === 'st-load')[0]), /Je télécharge Kubuntu \(LTS\)….*antivirus d'abord/);
    await fini; await attendre(() => noms().length === 1 && /à jour/.test(texte(tous(host, (x) => x.className === 'st-c')[0])));
    assert.ok(existsSync(join(w.iso, 'Kubuntu', 'kubuntu-26.04.1-desktop-amd64.iso'))); assert.ok(notes.some((n) => /✅ Kubuntu \(LTS\) 26\.04\.1/.test(n)), 'une note dit le résultat');
    assert.match(texte(tous(host, (x) => x.className === 'st-c')[0]), /Dans ton dossier : 26\.04\.1/); assert.deepEqual(tous(host, (x) => x.tag === 'button' && /élécharger/.test(texte(x))).map(texte), ['Retélécharger']);
    // Les autres onglets montrent les sections de l'appli (page générique), chacune à sa place.
    tous(host, (x) => x.attrs.role === 'tab')[2].ecoute.click({});
    assert.deepEqual(tous(host, (x) => x.tag === 'section').map((x) => x.textContent), ['Mes ISO', 'Surveillance']);
    tous(host, (x) => x.attrs.role === 'tab')[3].ecoute.click({});
    assert.deepEqual(tous(host, (x) => x.tag === 'section').map((x) => x.textContent), ['Dossier', 'Surveillance et vérification des ISO', 'Vérifier maintenant', 'Programmation à jours fixes (facultatif)', 'Historique', 'Windows (site de Microsoft)']); // réglage Windows ajouté par le commit 5d30f618
  } finally { w.fin(); }
});
