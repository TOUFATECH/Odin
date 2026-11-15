// Genèse · le suivi des installations par le réseau (PXE) : postes identifiés, déroulement jusqu'à la fin (terminée,
// échouée, abandonnée), blocage d'un poste, suspension, annulation, mot de passe d'installation (empreinte seule,
// 5 erreurs = poste bloqué 15 min, fichiers refusés sans laissez-passer), historique et rapport, et ce qu'Odin
// signale (sans doublon). Faux poste PXE : il demande le menu, le noyau, l'image et rend compte comme un vrai.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { COUT, Essais, Passes, PASSE_MS, RALENTI, VERROU_MS, empreinte, menuFerme, refusMotDePasse, scriptRefus, tapeEnAzerty, verifier } from '../src/valhalla/thjalfi/cle.ts';
import { avancement, csv, etatDe, identite, nettoyer, raisonLisible, rapport, replier, type Ligne, type Poste } from '../src/valhalla/thjalfi/suivi.ts';
import { proprietaireJournal } from '../src/valhalla/base/noms.ts';
import { INVENTAIRE, verifierInventaire } from '../src/valhalla/base/inventaire.ts';

COUT.N = 1024; // empreintes rapides pour les essais (65536 en vrai)
RALENTI.ms = 0; // pas d'attente réelle entre deux essais de mot de passe (3 s en vrai, quand les refus s'accumulent)
const FIX = join(import.meta.dirname, 'fixtures', 'thjalfi');
const U = 'ubuntu-24-04-3-live-server-amd64', R = 'rocky-9-6-x86-64-minimal';
const MIN = 60_000;
const pause = (ms = 60) => new Promise((r) => setTimeout(r, ms));

interface Rep { status: number; text: string }
interface W {
  v: Valhalla; home: string; base: string; dir: string;
  get: (p: string, h?: Record<string, string>) => Promise<Rep>;
  /** le poste envoie le mot de passe comme iPXE (« params », POST) */
  cle: (mac: string, mdp: string, qui?: string) => Promise<Rep>;
  /** avance l'horloge d'Odin */
  avance: (ms: number) => void;
  /** la surveillance (ce qu'Odin fait chaque minute) */
  veille: () => Promise<void>;
  act: (action: string, input?: Record<string, unknown>, o?: { auto?: boolean }) => Promise<{ ok?: boolean; text: string; data?: unknown }>;
  alertes: () => Array<{ title: string; level: string; detail?: string; count: number }>;
  evenements: Array<Record<string, unknown>>;
  end: () => void;
}
async function monde(): Promise<W> {
  const home = mkdtempSync(join(tmpdir(), 'genese-suivi-')), evenements: Array<Record<string, unknown>> = [];
  let T = Date.parse('2026-11-15T08:00:00Z');
  const cle = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'cd'.repeat(32);
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('réseau coupé'); }) as never, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(T) } as never);
  v.events.on('event', (e) => evenements.push(e as Record<string, unknown>));
  const iso = join(home, 'iso'); mkdirSync(iso, { recursive: true });
  for (const f of readdirSync(FIX)) writeFileSync(join(iso, f.replace(/\.gz$/, '')), gunzipSync(readFileSync(join(FIX, f))));
  await v.act('eitri', 'dossier', { chemin: iso });
  const dir = join(home, 'valhalla', 'thjalfi'), boot = join(dir, 'boot'); mkdirSync(boot, { recursive: true }); writeFileSync(join(boot, 'undionly.kpxe'), 'KPXE'); writeFileSync(join(boot, 'ipxe.efi'), 'EFI');
  v.ctx('thjalfi').saveSettings({ ports: { http: 0, tftp: 0, dhcp: 0, pxe: 0, client: 0 }, ip: '127.0.0.1', mode: 'aucun' });
  const base = /http:\/\/127\.0\.0\.1:\d+/.exec((await v.act('thjalfi', 'allumer')).text)![0];
  const rep = async (x: Response): Promise<Rep> => ({ status: x.status, text: await x.text() });
  return {
    v, home, base, dir, evenements,
    get: async (p, h = {}) => rep(await fetch(`${base}${p}`, { headers: h })),
    cle: async (mac, mdp, qui = '') => rep(await fetch(`${base}/cle.ipxe?mac=${mac}&fw=efi`, { method: 'POST', body: new URLSearchParams({ mdp, qui }) })),
    avance: (ms) => { T += ms; },
    veille: async () => { await v.modules().find((m) => m.id === 'thjalfi')!.watch!.run(v.ctx('thjalfi')); },
    act: (action, input = {}, o = {}) => v.act('thjalfi', action, input, o),
    alertes: () => v.alerts({ module: 'thjalfi', limit: 200 }) as never,
    end: () => { v.stop(); if (cle === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = cle; rmSync(home, { recursive: true, force: true }); },
  };
}
interface Vue { mac: string; id: string; nom: string | null; connu: boolean; ip: string; serie: string; uuid: string; marque: string; modele: string; image: string; recette: string; mode: string; lancePar: string; installateur: string; etape: string; etat: string; enCours: boolean; raison: string; arretePar: string; pct: number; reel: boolean; envoye: { octets: number; taille: number; pct: number } | null; etapes: Array<{ at: number; etape: string; detail: string }>; bloque: boolean }
const poste = async (w: W, mac: string) => (await w.act('poste', { mac })).data as { nom: string | null; poste: Vue | null; passees: Ligne[]; bloque: unknown; evenements: Array<{ quoi: string; detail?: string }> };
const lignes = async (w: W) => (await w.act('rapport', { periode: 'tout' })).data as { total: number; reussies: number; echecs: number; abandons: number; lancees: number; annulees: number; bloquees: number; lignes: Ligne[]; csv: string; evenements: Array<{ quoi: string; mac?: string; detail?: string }>; alertes: Array<{ titre: string }> };
/** Un poste autorisé en installation automatique demande le menu : rend le jeton de son installation. */
async function autorise(w: W, mac: string, iso = 'ubuntu', nom = ''): Promise<{ menu: string; jeton: string }> {
  const r = await w.act('autoriser', { mac, iso, nom, auto: true }); assert.notEqual(r.ok, false, r.text);
  const menu = (await w.get(`/menu.ipxe?mac=${mac}&fw=efi`)).text, jeton = /seed\/([\w-]+)\//.exec(menu)?.[1];
  assert.ok(jeton, `menu avec installation automatique pour ${mac}`);
  return { menu, jeton: jeton! };
}
const noyau = (mac: string, iso = U) => `/f/${iso}/${iso === U ? 'casper/vmlinuz' : 'images/pxeboot/vmlinuz'}?m=${mac}`;

// ---------------- Les fonctions pures ----------------
test('identité d\'un poste : série, marque et modèle nettoyés, valeurs bidon des cartes mères ignorées', () => {
  const q = (t: string) => new URLSearchParams(t);
  assert.deepEqual(identite(q('serie=PF2ABCDE&uuid=4C4C4544-0042-3510-8054-B7C04F4A3432&marque=LENOVO&modele=ThinkPad%20T14%20Gen%203')), { serie: 'PF2ABCDE', marque: 'LENOVO', modele: 'ThinkPad T14 Gen 3', uuid: '4c4c4544-0042-3510-8054-b7c04f4a3432' });
  assert.deepEqual(identite(q('serie=To%20Be%20Filled%20By%20O.E.M.&uuid=00000000-0000-0000-0000-000000000000&marque=System%20manufacturer&modele=Default%20string')), {}, 'valeurs bidon');
  assert.deepEqual(identite(q('serie=0000000&uuid=pas-un-uuid&marque=&modele=System%20Product%20Name')), {});
  assert.deepEqual(identite(q('serie=${serial:uristring}')), {}, 'un iPXE qui n\'a pas rempli la variable');
  const sale = identite(q(`modele=${encodeURIComponent('<script>alert(1)</script>\n#!ipxe\nboot ${base}')}&serie=${'A'.repeat(300)}`));
  assert.doesNotMatch(sale.modele ?? '', /[<>${}\n]/, 'rien qui puisse servir dans un script ou une page'); assert.equal(sale.serie?.length, 40, 'longueur bornée');
  assert.equal(nettoyer('  Dell   Inc.\u0000\u001b[31m '), 'Dell Inc. 31m');
  assert.equal(raisonLisible('kickstart'), 'l\'installateur (Anaconda) a signalé une erreur (elle est affichée sur l\'écran du poste)');
  assert.equal(raisonLisible('disque plein <b>'), 'disque plein b'); assert.equal(raisonLisible(''), 'échec signalé par le poste');
});

test('avancement : un pourcentage qui ne recule pas, et la part réelle de l\'image quand elle est calculable', () => {
  const m: Poste = { mac: 'aa:bb:cc:dd:ee:01', step: 'menu', steps: [], started: 0, updated: 0 };
  const vus: number[] = [];
  for (const step of ['démarrage réseau', 'chargeur', 'menu', 'chargement']) { m.step = step; m.steps.push({ at: 1, step }); vus.push(avancement(m).pct); }
  assert.equal(avancement(m).reel, false, 'taille inconnue : pas de pourcentage réel');
  m.taille = 1000; for (const o of [0, 250, 500, 1000, 1500]) { m.octets = o; vus.push(avancement(m).pct); }
  assert.deepEqual(avancement(m).image, { octets: 1500, taille: 1000, pct: 100 }); assert.equal(avancement(m).reel, true);
  for (const step of ['installation', 'logiciels', 'fini']) { m.step = step; m.steps.push({ at: 2, step }); vus.push(avancement(m).pct); }
  assert.deepEqual(vus, [...vus].sort((a, b) => a - b), `jamais en arrière : ${vus.join(' ')}`); assert.equal(vus.at(-1), 100);
  assert.equal(etatDe(m), 'terminée');
  // Une installation abandonnée garde l'avancement de sa dernière vraie étape.
  const a: Poste = { mac: 'x', step: 'sans nouvelles', steps: [{ at: 1, step: 'installation' }, { at: 2, step: 'sans nouvelles' }], started: 0, updated: 0, fin: 'sans nouvelles' };
  assert.equal(avancement(a).pct, 50); assert.equal(etatDe(a), 'abandonnée');
  assert.equal(etatDe({ ...a, fin: undefined }), 'repartie sur son disque'); assert.equal(etatDe({ ...a, fin: 'lancée' }), 'lancée à la main'); assert.equal(etatDe({ ...a, step: 'échec', fin: 'annulée' }), 'annulée');
});

test('historique : une installation = une ligne ; rapport lisible à voix haute, filtres, export pour tableur', () => {
  const now = Date.parse('2026-11-15T12:00:00Z'), j = 864e5;
  const l = (o: Partial<Ligne>): Ligne => ({ at: now - j, mac: '52:54:00:00:00:01', iso: 'u', isoName: 'ubuntu-24.04', ms: 20 * MIN, result: 'fini', ...o });
  const tout: Ligne[] = [
    l({ id: 'a', host: 'bureau-1', result: 'sans nouvelles' }), l({ id: 'a', host: 'bureau-1', result: 'fini', ms: 30 * MIN }), // un « fini » arrivé après l'abandon
    l({ id: 'b', host: 'bureau-2', ms: 10 * MIN }), l({ id: 'c', host: 'bureau-3', result: 'échec', raison: 'disque plein', isoName: 'debian-13' }),
    l({ id: 'd', host: 'atelier', result: 'annulée', arretePar: 'Odin' }), l({ id: 'e', mac: '52:54:00:00:00:09', result: 'lancée' }), l({ host: 'ancienne', at: now - 60 * j }),
  ];
  assert.equal(replier(tout).length, 6, 'la dernière ligne d\'une installation gagne'); assert.equal(replier(tout).find((x) => x.id === 'a')?.result, 'fini');
  const r = rapport(tout, { now });
  assert.equal(r.total, 5); assert.equal(r.reussies, 2); assert.equal(r.echecs, 1); assert.equal(r.annulees, 1); assert.equal(r.lancees, 1); assert.equal(r.abandons, 0);
  assert.equal(r.taux, 67, 'réussite parmi celles suivies jusqu\'au bout (une installation à la main ou annulée ne compte pas en échec)'); assert.equal(r.dureeMoyenneMs, 20 * MIN);
  assert.match(r.texte, /^5 installations sur les 30 derniers jours : 2 réussies, 1 échec sur le poste bureau-3, 1 annulée, 1 lancée\(s\) à la main \(suite inconnue\)\. Réussite : 67 %\. Durée moyenne d'une installation réussie : 20 min\.$/);
  assert.deepEqual(r.parImage[0], { image: 'ubuntu-24.04', total: 4, reussies: 2 });
  assert.equal(rapport(tout, { now, periode: 'tout' }).total, 6); assert.equal(rapport(tout, { now, periode: '7 jours', resultat: 'échecs' }).lignes.length, 1);
  assert.equal(rapport(tout, { now, q: 'BUREAU-2' }).total, 1); assert.match(rapport(tout, { now, q: 'rien' }).texte, /Aucune installation sur les 30 derniers jours pour « rien »/);
  const c = csv([l({ host: '=cmd|calc', raison: 'a;b "c"', debut: now - j - 20 * MIN })]).split('\r\n');
  assert.match(c[0], /^Fin \(UTC\);Début \(UTC\);Poste;Adresse MAC;/); assert.match(c[1], /;'=cmd\|calc;52:54:00:00:00:01;/, 'une formule de tableur est neutralisée'); assert.match(c[1], /;terminée;"a;b ""c""";/);
});

test('mot de passe : empreinte scrypt (jamais le mot de passe), clavier AZERTY lu en américain, essais comptés, laissez-passer court', async () => {
  const e = await empreinte('Maison2026!');
  assert.equal(e.algo, 'scrypt'); assert.ok(!JSON.stringify(e).includes('Maison')); assert.ok(e.hash2, 'la forme tapée sur un clavier AZERTY a son empreinte');
  assert.equal(await verifier('Maison2026!', e), true); assert.equal(await verifier('maison2026!', e), false); assert.equal(await verifier('', e), false); assert.equal(await verifier('Maison2026!', undefined), false);
  assert.equal(tapeEnAzerty('azerty1'), 'qwerty!'); assert.equal(await verifier(tapeEnAzerty('Maison2026!'), e), true, 'tapé sur un AZERTY, lu par iPXE comme un clavier américain');
  assert.notEqual((await empreinte('Maison2026!')).hash, e.hash, 'sel aléatoire');
  assert.match(refusMotDePasse('abc') ?? '', /trop court/); assert.equal(refusMotDePasse('Maison2026!'), undefined);
  const es = new Essais(); let r = { n: 0 } as { n: number; verrou?: number };
  for (let i = 0; i < 5; i++) r = es.rate('m:x', 1000);
  assert.equal(r.n, 5); assert.equal(r.verrou, 1000 + VERROU_MS); assert.equal(es.verrou('m:x', 2000), 1000 + VERROU_MS); assert.equal(es.verrou('m:x', 1001 + VERROU_MS), undefined, 'le blocage tombe après 15 min');
  assert.equal(es.rate('m:x', 2000 + VERROU_MS).n, 1, 'et le compte repart de zéro'); assert.equal(es.verrou('m:y', 2000), undefined);
  const ps = new Passes(), p = ps.donner('aa', '10.0.0.5', 'Awa', 0);
  assert.equal(ps.de('aa', PASSE_MS - 1)?.qui, 'Awa'); assert.equal(ps.parIp('10.0.0.5', 1)?.mac, 'aa'); assert.equal(ps.parIp('10.0.0.6', 1), undefined);
  ps.prolonger(p, PASSE_MS - 1); assert.ok(ps.de('aa', PASSE_MS + 5), 'prolongé tant que le poste charge'); assert.equal(ps.de('aa', 3 * PASSE_MS), undefined, 'il tombe sans activité');
  // Les scripts : rien de sensible, jamais sans issue (le disque du poste reste possible).
  const m = menuFerme({ base: 'http://10.0.0.2:16000', mac: '52:54:00:aa:bb:cc', delai: 10 });
  assert.match(m, /choose --default local --timeout 10000/); assert.match(m, /login \|\| goto local/); assert.match(m, /param mdp \$\{password\}/); assert.match(m, /cle\.ipxe\?mac=52:54:00:aa:bb:cc&fw=\$\{platform\}##params/);
  assert.doesNotMatch(m, /kernel|initrd|\/f\/|\/iso\//, 'aucun système dans le menu fermé'); assert.match(m, /sanboot --no-describe --drive 0x80/);
  assert.doesNotMatch(menuFerme({ base: 'http://o:1', mac: 'x"; boot', delai: 0 }), /boot\n|x"/, 'une adresse mal formée n\'est jamais recopiée');
  assert.match(scriptRefus(['Poste bloqué : `rm` ${x} | ok']), /^#!ipxe\n[\s\S]*echo Poste bloque : rm x ok\n[\s\S]*goto local/);
});

test('bases : le fil des étapes va dans la base de Genèse (GENESE_ODIN), comme l\'historique', () => {
  assert.equal(proprietaireJournal('thjalfi_etapes'), 'thjalfi'); assert.equal(proprietaireJournal('thjalfi'), 'thjalfi');
  assert.ok(INVENTAIRE.thjalfi.some((r) => r.support === 'base' && r.journal === 'thjalfi_etapes'), 'déclaré dans l\'inventaire');
  assert.deepEqual(verifierInventaire(), []);
});

// ---------------- De bout en bout, avec le faux poste PXE ----------------
test('postes identifiés : série et modèle gardés, nom pris dans l\'inventaire, poste inconnu signalé une seule fois', async () => {
  const w = await monde();
  try {
    assert.match((await w.get('/boot.ipxe')).text, /menu\.ipxe\?mac=\$\{netX\/mac\}&fw=\$\{platform\}&serie=\$\{serial:uristring\}&uuid=\$\{uuid\}&marque=\$\{manufacturer:uristring\}&modele=\$\{product:uristring\}/);
    const A = '52:54:00:a1:00:01', B = '52:54:00:a1:00:02', C = '52:54:00:a1:00:03';
    await w.get(`/menu.ipxe?mac=${A}&fw=efi&serie=PF2ABCDE&uuid=4c4c4544-0042-3510-8054-b7c04f4a3432&marque=LENOVO&modele=ThinkPad%20T14`);
    await pause();
    const a = await poste(w, A);
    assert.equal(a.poste?.serie, 'PF2ABCDE'); assert.equal(a.poste?.marque, 'LENOVO'); assert.equal(a.poste?.modele, 'ThinkPad T14'); assert.equal(a.poste?.uuid, '4c4c4544-0042-3510-8054-b7c04f4a3432');
    assert.equal(a.poste?.nom, null, 'poste inconnu'); assert.equal(a.poste?.connu, false); assert.equal(a.poste?.ip, '127.0.0.1'); assert.equal(a.poste?.etat, 'au menu'); assert.match(a.poste?.id ?? '', /^525400a10001-/);
    const inconnu = () => w.alertes().filter((x) => x.title === `🆕 Poste inconnu au démarrage réseau : ${A}`);
    assert.equal(inconnu().length, 1, 'Odin prévient'); assert.equal(inconnu()[0].level, 'info'); assert.match(inconnu()[0].detail ?? '', /LENOVO ThinkPad T14 · série PF2ABCDE/);
    await w.get(`/menu.ipxe?mac=${A}&fw=efi`); w.avance(7 * 3600_000); await w.get(`/menu.ipxe?mac=${A}&fw=efi`); await pause();
    assert.equal(inconnu().length, 1, 'une seule fois, même des heures plus tard'); assert.equal(inconnu()[0].count, 1);
    // Valeurs bidon et texte piégé : rien de gardé qui ne soit propre.
    await w.get(`/menu.ipxe?mac=${B}&fw=efi&serie=To%20Be%20Filled%20By%20O.E.M.&uuid=00000000-0000-0000-0000-000000000000&marque=System%20manufacturer&modele=${encodeURIComponent('<img src=x>')}`);
    const b = (await poste(w, B)).poste!; assert.equal(b.serie, ''); assert.equal(b.uuid, ''); assert.equal(b.marque, ''); assert.equal(b.modele, 'img src x');
    // Un poste connu de l'inventaire d'Odin (Atlas) porte son nom, et n'est pas dit « inconnu ».
    assert.notEqual((await w.v.act('askr', 'ajouter', { nom: 'Portable de Awa', type: 'ordinateur', mac: C })).ok, false);
    await w.get(`/menu.ipxe?mac=${C}&fw=efi`); await pause();
    assert.equal((await poste(w, C)).poste?.nom, 'Portable de Awa'); assert.equal((await poste(w, C)).poste?.connu, true);
    assert.ok(!w.alertes().some((x) => x.title.includes(`Poste inconnu au démarrage réseau : ${C}`)));
    const s = (await w.act('suivi')).data as { postes: Vue[]; chiffres: { auMenu: number; enCours: number } };
    assert.equal(s.postes.length, 3); assert.equal(s.chiffres.enCours, 0, 'au menu : pas encore une installation');
    assert.match((await w.act('poste', { mac: 'pas une adresse' })).text, /adresse MAC invalide/);
  } finally { w.end(); }
});

test('déroulement complet d\'une installation automatique : étapes horodatées, avancement, octets servis, début signalé une fois, historique', async () => {
  const w = await monde(), mac = '52:54:00:a2:00:01';
  try {
    const { jeton } = await autorise(w, mac, 'ubuntu', 'Bureau 7');
    const pcts: number[] = [], vu = async () => { const p = (await poste(w, mac)).poste!; pcts.push(p.pct); return p; };
    assert.equal((await vu()).etat, 'au menu');
    w.avance(MIN); assert.equal((await w.get(noyau(mac))).status, 200);
    w.avance(MIN); assert.equal((await w.get(`/iso/${U}.iso`, { range: 'bytes=0-99' })).status, 206); await pause();
    let p = await vu();
    assert.equal(p.etape, 'chargement'); assert.equal(p.etat, 'en cours'); assert.equal(p.mode, 'auto'); assert.equal(p.recette, 'ubuntu'); assert.equal(p.lancePar, 'autorisation'); assert.equal(p.nom, 'bureau-7');
    assert.equal(p.envoye?.octets, 12_100, 'le noyau (12 000 octets) et le premier morceau de l\'image'); assert.ok(p.envoye!.taille > 12_100 && p.reel, 'avancement réel : octets servis sur taille de l\'image');
    await w.get(`/iso/${U}.iso`, { range: 'bytes=100-20099' }); await pause(); assert.equal((await vu()).envoye?.octets, 32_100);
    // Le fichier de réponses : signe de vie chaque minute, et un raté est signalé à Odin.
    const ud = (await w.get(`/seed/${jeton}/user-data`)).text;
    assert.match(ud, new RegExp(`while :; do wget -qO- 'http://127\\.0\\.0\\.1:\\d+/etat/${jeton}\\?e=vie' >/dev/null 2>&1; sleep 60; done\\) </dev/null >/dev/null 2>&1 &`));
    assert.match(ud, new RegExp(`error-commands:\\n    - "wget -qO- 'http://127\\.0\\.0\\.1:\\d+/etat/${jeton}\\?e=echec&raison=ubuntu' \\|\\| true"`));
    w.avance(MIN); assert.equal((await w.get(`/etat/${jeton}?e=installation`)).text, 'ok'); await vu();
    w.avance(MIN); assert.equal((await w.get(`/etat/${jeton}?e=vie`)).text, 'ok', 'signe de vie'); p = await vu(); assert.equal(p.etape, 'installation', 'un signe de vie n\'est pas une étape');
    w.avance(10 * MIN); await w.get(`/etat/${jeton}?e=logiciels`); await vu();
    w.avance(2 * MIN); assert.equal((await w.get(`/etat/${jeton}?e=fini&nom=bureau-7&ip=192.168.1.57`)).text, 'ok');
    p = await vu(); assert.equal(p.etat, 'terminée'); assert.equal(p.pct, 100); assert.equal(p.enCours, false);
    assert.deepEqual(pcts, [...pcts].sort((a, b) => a - b), `l'avancement ne recule jamais : ${pcts.join(' ')}`);
    const ordre = p.etapes.map((e) => e.etape).filter((e, i, l) => e !== l[i - 1]); assert.deepEqual(ordre, ['menu', 'chargement', 'installation', 'logiciels', 'fini']);
    assert.deepEqual(p.etapes.map((e) => e.at), [...p.etapes.map((e) => e.at)].sort((a, b) => a - b), 'étapes horodatées dans l\'ordre');
    // Odin a prévenu : le début (une seule fois, en vert) et la réussite.
    const debut = w.alertes().filter((x) => /^▶ bureau-7 démarre ubuntu-24\.04\.3-live-server-amd64$/.test(x.title));
    assert.equal(debut.length, 1); assert.equal(debut[0].level, 'info'); assert.equal(debut[0].count, 1); assert.match(debut[0].detail ?? '', /installation automatique \(le disque est effacé\) · lancée par : autorisation/);
    const fin = w.alertes().filter((x) => /^✅ bureau-7 installée/.test(x.title)); assert.equal(fin.length, 1); assert.equal(fin[0].level, 'info');
    // L'historique : une ligne, complète.
    const h = (await lignes(w)).lignes; assert.equal(h.length, 1);
    assert.equal(h[0].result, 'fini'); assert.equal(h[0].id, p.id); assert.equal(h[0].recette, 'ubuntu'); assert.equal(h[0].mode, 'auto'); assert.equal(h[0].lancePar, 'autorisation'); assert.equal(h[0].host, 'bureau-7'); assert.equal(h[0].octets, 32_100);
    assert.equal(h[0].ms, 16 * MIN); assert.equal(h[0].at - h[0].debut!, 16 * MIN); assert.ok(h[0].etapes!.some((e) => e.etape === 'installation') && h[0].etapes!.at(-1)!.etape === 'fini');
    // Le fil durable (journal « thjalfi_etapes », en base quand elle est là ; ici son repli en fichier).
    const fil = readFileSync(join(w.dir, 'etapes.jsonl'), 'utf8').trim().split('\n').map((x) => JSON.parse(x) as { quoi: string; etape?: string; id?: string });
    assert.ok(fil.some((e) => e.quoi === 'début' && e.id === p.id) && fil.some((e) => e.quoi === 'étape' && e.etape === 'installation') && fil.some((e) => e.quoi === 'fin' && e.etape === 'fini'));
    assert.ok(existsSync(join(w.dir, 'historique.jsonl')));
    assert.match((await w.act('rapport')).text, /^1 installation sur les 30 derniers jours : 1 réussie\. Réussite : 100 %\. Durée moyenne d'une installation réussie : 16 min\.$/);
    assert.match((await w.act('historique')).text, /bureau-7 \(192\.168\.1\.57\) · ubuntu-24\.04\.3-live-server-amd64 · fini/);
  } finally { w.end(); }
});

test('échec : signalé par l\'installateur ou par iPXE, avec la raison ; le deuxième raté du même poste est signalé aussi, en grave', async () => {
  const w = await monde(), mac = '52:54:00:a3:00:01', X = '52:54:00:a3:00:09';
  try {
    const { jeton } = await autorise(w, mac, 'rocky', 'serveur-1');
    await w.get(noyau(mac, R));
    const ks = (await w.get(`/seed/${jeton}/ks.cfg`)).text;
    assert.match(ks, /%onerror\ncurl -fsS 'http:\/\/127\.0\.0\.1:\d+\/etat\/[\w-]+\?e=echec&raison=kickstart' \|\| true\n%end/); assert.match(ks, /%pre\n[^%]*e=vie[^%]*<\/dev\/null >\/dev\/null 2>&1 &\n%end/);
    w.avance(5 * MIN); assert.equal((await w.get(`/etat/${jeton}?e=echec&raison=kickstart`)).text, 'ok');
    let p = (await poste(w, mac)).poste!; assert.equal(p.etat, 'échouée'); assert.match(p.raison, /Anaconda.*a signalé une erreur/);
    const rates = () => w.alertes().filter((x) => x.title === '❌ Installation ratée sur serveur-1');
    assert.equal(rates().length, 1); assert.equal(rates()[0].level, 'haute', 'un souci'); assert.match(rates()[0].detail ?? '', /Anaconda/);
    let h = (await lignes(w)).lignes; assert.equal(h[0].result, 'échec'); assert.match(h[0].raison ?? '', /Anaconda/);
    // Le même poste retente dans l'heure et rate encore : signalé de nouveau (pas avalé), cette fois en grave.
    w.avance(20 * MIN); assert.notEqual((await w.act('reinstaller', { mac })).ok, false);
    const m2 = (await w.get(`/menu.ipxe?mac=${mac}&fw=efi`)).text, j2 = /seed\/([\w-]+)\//.exec(m2)![1];
    await w.get(noyau(mac, R)); await w.get(`/etat/${j2}?e=installation`); w.avance(3 * MIN);
    await w.get(`/etat/${j2}?e=echec&raison=${encodeURIComponent('disque plein <script>')}`);
    assert.equal(rates().length, 2, 'le deuxième échec n\'est pas avalé'); assert.ok(rates().some((x) => x.level === 'critique' && /disque plein script\. .*déjà 1 raté sur ce poste depuis 24 h/.test(x.detail ?? '')));
    h = (await lignes(w)).lignes; assert.equal(h.length, 2); assert.notEqual(h[0].id, h[1].id, 'deux installations, deux lignes'); assert.equal(h[0].raison, 'disque plein script');
    // iPXE : l'image choisie ne démarre pas (« :echec » du menu) : le menu redemandé le dit à Odin.
    const menu = (await w.get(`/menu.ipxe?mac=${X}&fw=efi`)).text; assert.match(menu, new RegExp(`:echec\\n[\\s\\S]*menu\\.ipxe\\?mac=${X}&echec=1 \\|\\| goto local`));
    await w.get(noyau(X)); assert.equal((await poste(w, X)).poste?.mode, 'manuelle');
    await w.get(`/menu.ipxe?mac=${X}&echec=1`);
    const hx = (await lignes(w)).lignes.find((x) => x.mac === X)!; assert.equal(hx.result, 'échec'); assert.match(hx.raison ?? '', /l'image n'a pas pu démarrer sur le poste/);
    p = (await poste(w, X)).poste!; assert.equal(p.etat, 'au menu', 'le poste est revenu au menu : un nouveau passage commence'); assert.notEqual(p.id, hx.id);
    assert.equal((await lignes(w)).echecs, 3);
    // Un poste qui tourne en boucle (démarre, rate, revient au menu…) : UNE installation dans l'historique, avec le compte
    // des essais ; Odin ne sonne pas à chaque tour, et ce n'est pas un « deuxième raté » (pas d'urgence pour une boucle).
    for (let i = 0; i < 4; i++) { w.avance(MIN); await w.get(noyau(X)); await w.get(`/menu.ipxe?mac=${X}&echec=1`); }
    w.avance(3 * MIN); await w.veille(); // la boucle s'est arrêtée : le dernier compte est écrit
    const lx = (await lignes(w)).lignes.filter((x) => x.mac === X && x.result === 'échec');
    assert.equal(lx.length, 1, 'une boucle = une seule installation au rapport'); assert.equal(lx[0].id, hx.id); assert.equal(lx[0].tours, 5, 'les essais sont comptés');
    assert.ok(readFileSync(join(w.dir, 'historique.jsonl'), 'utf8').trim().split('\n').filter((x) => x.includes(X)).length <= 3, 'pas une ligne écrite à chaque tour');
    assert.equal((await lignes(w)).echecs, 3);
    const boucle = w.alertes().filter((x) => x.title === `❌ Installation ratée sur poste inconnu ${X}`);
    assert.equal(boucle.length, 1, 'un seul avertissement pour toute la boucle'); assert.equal(boucle[0].level, 'haute'); assert.ok(boucle[0].count >= 5, 'chaque tour y est compté');
    assert.equal(w.alertes().filter((x) => x.title.startsWith(`▶ Un poste inconnu (${X}) démarre`)).length, 2, 'le début cesse de sonner à chaque tour');
    const filX = readFileSync(join(w.dir, 'etapes.jsonl'), 'utf8').trim().split('\n').map((x) => JSON.parse(x) as { quoi: string; mac?: string }).filter((e) => e.mac === X);
    assert.ok(filX.filter((e) => e.quoi === 'début').length <= 2 && filX.length <= 14, `le fil durable ne se remplit pas à chaque tour (${filX.length} entrées)`);
  } finally { w.end(); }
});

test('abandon par délai : plus de signe de vie → abandonnée et signalée ; au menu → rien ; à la main → « lancée » ; un « fini » tardif corrige la ligne', async () => {
  const w = await monde(), A = '52:54:00:a4:00:01', B = '52:54:00:a4:00:02', C = '52:54:00:a4:00:03', D = '52:54:00:a4:00:04';
  try {
    const a = await autorise(w, A, 'ubuntu', 'salle-1'); await w.get(noyau(A)); await w.get(`/etat/${a.jeton}?e=installation`);
    await w.get(`/menu.ipxe?mac=${B}&fw=efi`);                       // B reste au menu
    await w.get(`/menu.ipxe?mac=${C}&fw=efi`); await w.get(noyau(C)); // C lance l'installation à la main (Odin ne peut pas savoir la suite)
    const d = await autorise(w, D, 'ubuntu', 'salle-4'); await w.get(noyau(D)); await w.get(`/etat/${d.jeton}?e=installation`);
    w.avance(20 * MIN); await w.veille();
    for (const m of [A, B, C, D]) assert.equal((await poste(w, m)).poste?.enCours, true, 'avant le délai (30 min) : rien');
    await w.get(`/etat/${d.jeton}?e=vie`);                             // D donne signe de vie
    w.avance(15 * MIN); await w.veille();
    const pa = (await poste(w, A)).poste!; assert.equal(pa.etat, 'abandonnée'); assert.match(pa.raison, /plus de signe de vie depuis 35 min \(dernière étape : installation\)/);
    assert.equal((await poste(w, D)).poste?.etat, 'en cours', 'un signe de vie repousse le délai');
    assert.equal((await poste(w, B)).poste?.etat, 'repartie sur son disque'); assert.equal((await poste(w, C)).poste?.etat, 'lancée à la main');
    const ab = () => w.alertes().filter((x) => /installation abandonnée/.test(x.title));
    assert.equal(ab().length, 1, 'seule l\'installation suivie est signalée'); assert.equal(ab()[0].title, '❔ salle-1 : installation abandonnée (plus de signe de vie)'); assert.equal(ab()[0].level, 'moyenne');
    let r = await lignes(w);
    assert.equal(r.abandons, 1); assert.equal(r.lancees, 1); assert.equal(r.echecs, 0); assert.ok(!r.lignes.some((x) => x.mac === B), 'resté au menu : ni historique ni alerte');
    assert.equal(r.lignes.find((x) => x.mac === C)?.mode, 'manuelle');
    await w.veille(); assert.equal(ab().length, 1, 'pas de doublon au passage suivant de la surveillance'); assert.equal((await lignes(w)).abandons, 1);
    // L'installation de A a fini quand même (le poste était lent) : sa ligne est corrigée, pas doublée.
    w.avance(10 * MIN); assert.equal((await w.get(`/etat/${a.jeton}?e=fini&nom=salle-1&ip=192.168.1.71`)).text, 'ok');
    r = await lignes(w); assert.equal(r.lignes.filter((x) => x.mac === A).length, 1); assert.equal(r.lignes.find((x) => x.mac === A)?.result, 'fini'); assert.equal(r.abandons, 0); assert.equal(r.reussies, 1);
    assert.equal(readFileSync(join(w.dir, 'historique.jsonl'), 'utf8').trim().split('\n').filter((x) => x.includes(A)).length, 2, 'les deux lignes restent écrites, la dernière gagne à la lecture');
    // Le délai est réglable.
    assert.match((await w.act('delai_abandon', { minutes: 5 })).text, /depuis 5 min/); assert.equal((await w.act('delai_abandon', { minutes: 2 })).ok, false, 'pas moins de 5 minutes');
    w.avance(10 * MIN); await w.veille(); assert.equal((await poste(w, D)).poste?.etat, 'abandonnée'); assert.equal(ab().length, 2);
  } finally { w.end(); }
});

test('poste bloqué : ni menu ni fichiers, un message clair et son disque ; signalé s\'il retente (sans doublon) ; débloquer rétablit', async () => {
  const w = await monde(), X = '52:54:00:a5:00:01', Y = '52:54:00:a5:00:02', Z = '52:54:00:a5:00:03';
  try {
    // X : un poste inconnu, bloqué avant tout.
    assert.match((await w.act('bloquer', { mac: X, raison: 'poste de passage' })).text, /est bloqué : plus de menu ni de fichiers/);
    const refus = (await w.get(`/menu.ipxe?mac=${X}&fw=efi`)).text;
    assert.match(refus, /echo Ce poste \(52:54:00:a5:00:01\) est bloque dans Odin/); assert.match(refus, /sanboot --no-describe --drive 0x80/, 'il garde toujours son propre disque');
    assert.doesNotMatch(refus, /kernel|initrd|item e-|\/f\/|\/iso\//, 'aucun système proposé');
    const k = await w.get(noyau(X)); assert.equal(k.status, 403); assert.match(k.text, /poste bloqué/);
    assert.equal((await w.get(`/iso/${U}.iso?m=${X}`)).status, 403); assert.equal((await w.get('/ecran/ovl/525400a50001.apkovl.tar.gz')).status, 403);
    assert.deepEqual(JSON.parse((await w.get(`/ecran/choisir?mac=${X}&iso=${U}&mode=installer`)).text), { ok: false, texte: 'Ce poste est bloqué dans Odin.' }, 'pas de contournement par l\'écran d\'Odin');
    assert.match((await w.get(`/ecran/attente.ipxe?mac=${X}&fw=efi&n=0`)).text, /demarrage sur le disque\.\ngoto local/);
    await w.get(`/menu.ipxe?mac=${X}&fw=efi`); await w.get(`/menu.ipxe?mac=${X}&fw=efi`);
    const retente = () => w.alertes().filter((x) => /^🚫 Poste bloqué : .* a retenté de démarrer par le réseau$/.test(x.title));
    assert.equal(retente().length, 1, 'trois tentatives, une seule notification'); assert.equal(retente()[0].level, 'moyenne'); assert.match(retente()[0].detail ?? '', /Raison du blocage : poste de passage/);
    assert.equal((await lignes(w)).evenements.filter((e) => e.quoi === 'refus' && e.mac === X).length, 1, 'noté dans le fil de Genèse');
    const vue = await w.v.modules().find((m) => m.id === 'thjalfi')!.view(w.v.ctx('thjalfi'), new URLSearchParams());
    const tb = vue.sections.find((s) => s.title === 'Postes bloqués') as { rows: Array<{ cells: string[]; actions: Array<{ action: string }> }> };
    assert.equal(tb.rows[0].cells[0], X); assert.equal(tb.rows[0].cells[3], 'poste de passage'); assert.equal(tb.rows[0].actions[0].action, 'debloquer');
    assert.match((vue.sections.find((s) => s.title === 'Protection des installations') as { text: string }).text, /Pas de mot de passe d'installation/);
    // Y : autorisé, bloqué avant d'avoir commencé : son jeton ne vaut plus rien.
    const y = await autorise(w, Y); assert.notEqual((await w.act('bloquer', { mac: Y }, { auto: true })).ok, false, 'rien en cours : pas une action grave');
    assert.equal((await w.get(`/seed/${y.jeton}/user-data`)).status, 404); assert.equal((await w.get(`/etat/${y.jeton}?e=installation`)).status, 404);
    assert.match((await w.act('debloquer', { mac: Y })).text, /est débloqué/); assert.equal((await w.act('debloquer', { mac: Y })).ok, false);
    assert.match((await w.get(`/menu.ipxe?mac=${Y}&fw=efi`)).text, /kernel \$\{base\}\/f\//, 'débloqué : le menu revient'); assert.equal((await w.get(`/seed/${y.jeton}/user-data`)).status, 200);
    // Z : bloqué en pleine installation : action grave (accord demandé), installation arrêtée et notée « bloquée ».
    const z = await autorise(w, Z, 'ubuntu', 'accueil'); await w.get(noyau(Z)); await w.get(`/etat/${z.jeton}?e=installation`);
    const lignesVue = (await w.v.modules().find((m) => m.id === 'thjalfi')!.view(w.v.ctx('thjalfi'), new URLSearchParams())).sections.find((s) => s.title === 'En cours de déploiement') as { rows: Array<{ cells: string[]; actions: Array<{ action: string }> }> };
    assert.deepEqual(lignesVue.rows.find((r) => r.cells[0] === Z)?.actions.map((a) => a.action), ['annuler', 'bloquer']);
    const non = await w.act('bloquer', { mac: Z }, { auto: true }); assert.equal(non.ok, false); assert.match(non.text, /action grave .*pendant son installation/);
    assert.match((await w.act('bloquer', { mac: Z, raison: 'erreur de poste' })).text, /Son installation en cours .* est arrêtée/);
    const pz = (await poste(w, Z)).poste!; assert.equal(pz.etat, 'bloquée'); assert.equal(pz.bloque, true); assert.match(pz.arretePar, /Bloquer un poste/);
    assert.equal((await w.get(`/etat/${z.jeton}?e=logiciels`)).status, 404); assert.equal((await w.get(`/seed/${z.jeton}/user-data`)).status, 404);
    const hz = (await lignes(w)).lignes.find((x) => x.mac === Z)!; assert.equal(hz.result, 'bloquée'); assert.match(hz.raison ?? '', /poste bloqué depuis Odin : erreur de poste/);
    assert.ok(w.alertes().some((x) => x.title === '🚫 Poste bloqué : accueil' && x.level === 'info'));
    assert.equal(((await w.act('suivi')).data as { bloques: unknown[] }).bloques.length, 2);
  } finally { w.end(); }
});

test('annuler une installation en cours : accord demandé ; plus de jeton ni de fichiers, elle ne repart pas seule, notée « annulée »', async () => {
  const w = await monde(), mac = '52:54:00:a6:00:01';
  try {
    const { jeton } = await autorise(w, mac, 'ubuntu', 'compta'); await w.get(noyau(mac)); await w.get(`/etat/${jeton}?e=installation`);
    assert.equal((await w.get(`/f/${U}/casper/initrd`)).status, 200, 'pendant l\'installation, ses fichiers lui sont servis');
    const non = await w.act('annuler', { mac }, { auto: true }); assert.equal(non.ok, false); assert.match(non.text, /action grave .*disque peut rester à moitié écrit/, 'jamais depuis une automatisation');
    assert.equal((await poste(w, mac)).poste?.etat, 'en cours');
    w.avance(4 * MIN); const r = await w.act('annuler', { mac }); assert.notEqual(r.ok, false, r.text); assert.match(r.text, /^✋ Installation annulée sur compta/);
    await pause();
    // Refusé deux fois : son adresse est coupée (403), et son jeton n'existe plus (404 une fois l'adresse rendue, voir plus bas).
    assert.equal((await w.get(`/seed/${jeton}/user-data`)).status, 403, 'plus de fichier de réponses'); assert.equal((await w.get(`/etat/${jeton}?e=fini&nom=compta`)).status, 404, 'un retour tardif ne marque plus rien');
    const f = await w.get(`/f/${U}/casper/initrd`); assert.equal(f.status, 403); assert.match(f.text, /installation arrêtée depuis Odin/);
    const p = (await poste(w, mac)).poste!; assert.equal(p.etat, 'annulée'); assert.equal(p.enCours, false); assert.match(p.arretePar, /Annuler/);
    assert.equal((w.v.ctx('thjalfi').settings.machines as Array<{ mac: string; fait?: boolean }>).find((x) => x.mac === mac)?.fait, true, 'l\'installation automatique ne repart pas au prochain démarrage');
    assert.ok(!existsSync(join(w.dir, 'deploiements.json')) || !readFileSync(join(w.dir, 'deploiements.json'), 'utf8').includes(jeton));
    const h = (await lignes(w)).lignes; assert.equal(h.length, 1); assert.equal(h[0].result, 'annulée'); assert.equal(h[0].ms, 4 * MIN); assert.match(h[0].arretePar ?? '', /Annuler/);
    assert.equal(w.alertes().filter((x) => x.title === '✋ Installation annulée sur compta').length, 1);
    assert.equal((await w.act('annuler', { mac })).ok, false, 'plus rien à annuler');
    // Le poste redémarre par le réseau : il n'est pas bloqué, il a le menu, sans installation automatique.
    const menu = (await w.get(`/menu.ipxe?mac=${mac}&fw=efi`)).text; assert.match(menu, /item e-ubuntu/); assert.doesNotMatch(menu, /autoinstall/);
    assert.equal((await w.get(`/f/${U}/casper/initrd`)).status, 200);
    assert.equal((await w.get(`/seed/${jeton}/user-data`)).status, 404, 'le jeton de cette installation est mort'); assert.equal((await w.get(`/etat/${jeton}?e=fini&nom=compta`)).status, 404);
    assert.equal((await poste(w, mac)).poste?.etat, 'au menu'); assert.equal((await lignes(w)).lignes.length, 1);
    assert.match((await w.act('annuler', { mac })).text, /au menu : aucune installation n'est lancée ni prévue/);
  } finally { w.end(); }
});

test('suspendre : plus aucune nouvelle installation, celles en cours finissent ; reprendre rétablit', async () => {
  const w = await monde(), A = '52:54:00:a7:00:01', B = '52:54:00:a7:00:02';
  try {
    const a = await autorise(w, A); await w.get(noyau(A)); await w.get(`/etat/${a.jeton}?e=installation`);
    assert.match((await w.act('suspendre')).text, /Nouvelles installations suspendues/); assert.equal((await w.act('suspendre')).ok, false);
    const m = (await w.get(`/menu.ipxe?mac=${B}&fw=efi`)).text; assert.match(m, /echo Les installations par le reseau sont suspendues dans Odin\./); assert.doesNotMatch(m, /kernel|item e-/); assert.match(m, /sanboot/);
    assert.equal((await w.get(noyau(B))).status, 403); assert.equal(JSON.parse((await w.get(`/ecran/choisir?mac=${B}&iso=${U}&mode=installer`)).text).ok, false);
    assert.equal(JSON.parse((await w.get(`/ecran/choisir?mac=${B}&mode=disque`)).text).ok, true, 'choisir son disque reste possible');
    assert.equal((await w.get(`/f/${U}/casper/initrd`)).status, 200, 'l\'installation déjà lancée continue'); assert.equal((await w.get(`/etat/${a.jeton}?e=fini&nom=x`)).text, 'ok');
    assert.equal(((await w.act('suivi')).data as { suspendu: unknown }).suspendu !== null, true);
    assert.match((await w.act('reprendre')).text, /de nouveau possibles/);
    assert.match((await w.get(`/menu.ipxe?mac=${B}&fw=efi`)).text, /item e-ubuntu/); assert.equal((await w.get(noyau(B))).status, 200);
  } finally { w.end(); }
});

test('mot de passe d\'installation : menu fermé, fichiers refusés sans laissez-passer, 5 erreurs = poste bloqué 15 min, rien d\'écrit en clair', async () => {
  const w = await monde(), P = '52:54:00:a8:00:01', Q = '52:54:00:a8:00:02', R2 = '52:54:00:a8:00:03', MDP = 'Maison2026!';
  try {
    assert.match((await w.act('mot_de_passe', { mot_de_passe: 'abc' })).text, /trop court/);
    const r = await w.act('mot_de_passe', { mot_de_passe: MDP }); assert.notEqual(r.ok, false, r.text);
    assert.match(r.text, /Mot de passe d'installation réglé : demandé à tous les postes/); assert.match(r.text, /Odin ne garde que son empreinte/); assert.ok(!r.text.includes(MDP));
    const secrets = readFileSync(join(w.dir, 'secrets.json'), 'utf8'), reglages = readFileSync(join(w.dir, 'réglages.json'), 'utf8');
    assert.ok(!secrets.includes(MDP) && !reglages.includes(MDP), 'jamais en clair sur le disque'); assert.match(secrets, /"algo":"scrypt"/); assert.doesNotMatch(reglages, /scrypt|hash|salt/, 'l\'empreinte n\'est que dans le fichier protégé');
    const sel = (JSON.parse(secrets) as { cle: { e: { salt: string; hash: string } } }).cle.e;
    // Le menu fermé : le disque par défaut, ou « installer » qui demande le mot de passe. Rien d'autre.
    const ferme = (await w.get(`/menu.ipxe?mac=${P}&fw=efi`)).text;
    assert.match(ferme, /item cle Installer un systeme \(mot de passe demande\)/); assert.match(ferme, /choose --default local/); assert.match(ferme, /login \|\| goto local/);
    assert.doesNotMatch(ferme, /kernel|initrd|item e-|item ecran|seed\//, 'aucun système, aucun jeton'); assert.ok(!ferme.includes(MDP) && !ferme.includes(sel.salt) && !ferme.includes(sel.hash), 'ni mot de passe ni empreinte dans le menu');
    // Sans laissez-passer : aucun fichier d'installation.
    for (const p of [noyau(P), `/f/${U}/casper/initrd`, `/iso/${U}.iso`, '/boot/wimboot', '/ecran/ovl/525400a80001.apkovl.tar.gz']) { const x = await w.get(p); assert.equal(x.status, 403, p); assert.match(x.text, /mot de passe d'installation demandé/); }
    assert.equal(JSON.parse((await w.get(`/ecran/choisir?mac=${P}&iso=${U}&mode=installer`)).text).ok, false, 'pas de contournement par l\'écran d\'Odin');
    assert.equal((await w.get('/boot.ipxe')).status, 200); assert.equal((await w.get('/ecran/fond-texte.png')).status, 200, 'le décor du menu reste servi');
    // Le mot de passe ne se donne jamais dans l'adresse.
    assert.equal((await w.get(`/cle.ipxe?mac=${P}&mdp=${MDP}`)).status, 400); assert.equal((await w.get(`/cle.ipxe?mac=${P}`)).status, 401);
    assert.equal((await fetch(`${w.base}/menu.ipxe?mac=${P}`, { method: 'POST', body: 'x' })).status, 405); assert.equal((await fetch(`${w.base}/cle.ipxe?mac=${P}`, { method: 'POST', body: 'x'.repeat(5000) })).status, 413);
    // Cinq erreurs : le poste est bloqué 15 min, c'est noté et Odin prévient ; même le bon mot de passe attend.
    for (let i = 1; i <= 4; i++) assert.match((await w.cle(P, `faux-essai-${i}`)).text, new RegExp(`echo Mot de passe refuse \\(essai ${i} sur 5\\)\\.`));
    assert.match((await w.cle(P, 'faux-essai-5')).text, /echo Trop d'essais : ce poste est bloque 15 min/);
    const verrou = () => w.alertes().filter((x) => /^🔒 5 mots de passe refusés : .* est bloqué 15 min$/.test(x.title));
    assert.equal(verrou().length, 1); assert.equal(verrou()[0].level, 'haute'); assert.match(verrou()[0].detail ?? '', new RegExp(P));
    const bloque = (await w.cle(P, MDP)).text; assert.match(bloque, /Trop d'essais/); assert.doesNotMatch(bloque, /menu\.ipxe/); assert.equal((await w.get(noyau(P))).status, 403);
    assert.equal(verrou().length, 1, 'pas de notification en double'); assert.deepEqual(((await w.act('suivi')).data as { protection: { actif: boolean; verrous: Array<{ mac: string }> } }).protection.verrous.map((x) => x.mac), [P]);
    // Un autre poste n'est pas puni (compte par poste) ; le bon mot de passe ouvre le menu et les fichiers.
    const ok = (await w.cle(Q, MDP, 'Awa <b>')).text; assert.match(ok, /echo Mot de passe accepte\.\nchain http:\/\/127\.0\.0\.1:\d+\/menu\.ipxe\?mac=52:54:00:a8:00:02&fw=efi/); assert.match(ok, /clear password/);
    const ouvert = (await w.get(`/menu.ipxe?mac=${Q}&fw=efi`)).text; assert.match(ouvert, /item e-ubuntu/); assert.match(ouvert, /kernel \$\{base\}\/f\//);
    assert.equal((await w.get(noyau(Q))).status, 200); assert.equal((await w.get(`/iso/${U}.iso`, { range: 'bytes=0-9' })).status, 206);
    assert.equal((await poste(w, Q)).poste?.installateur, 'Awa b', 'qui installe : le nom saisi, nettoyé');
    // Le laissez-passer est court : sans activité il tombe et le menu se referme. Un poste qui n'a rien lancé n'a plus droit aux
    // fichiers ; une installation déjà lancée garde son droit jusqu'à sa fin (elle ne casse pas au bout de 20 min).
    const Q2 = '52:54:00:a8:00:06'; assert.match((await w.cle(Q2, MDP)).text, /Mot de passe accepte/); assert.match((await w.get(`/menu.ipxe?mac=${Q2}&fw=efi`)).text, /item e-ubuntu/);
    w.avance(21 * MIN); assert.equal((await w.get(noyau(Q2))).status, 403, 'rien de lancé : le laissez-passer est tombé'); assert.match((await w.get(`/menu.ipxe?mac=${Q}&fw=efi`)).text, /item cle Installer/);
    assert.equal((await w.get(`/f/${U}/casper/initrd`)).status, 200, 'l\'installation de Q, déjà lancée, continue'); assert.equal((await w.get(`/iso/${U}.iso?m=${Q}`, { range: 'bytes=10-19' })).status, 206);
    // P, 15 minutes après : le bon mot de passe passe ; tapé sur un clavier AZERTY (lu en américain par iPXE) aussi.
    assert.match((await w.cle(P, MDP)).text, /Mot de passe accepte/); assert.match((await w.cle(R2, tapeEnAzerty(MDP))).text, /Mot de passe accepte/);
    // iPXE sans « params » : identification HTTP simple (en-tête), jamais dans l'adresse.
    assert.match((await w.get('/cle.ipxe?mac=52:54:00:a8:00:04&fw=efi', { authorization: `Basic ${Buffer.from(`odin:${MDP}`).toString('base64')}` })).text, /Mot de passe accepte/);
    assert.match((await w.get('/cle.ipxe?mac=52:54:00:a8:00:05&fw=efi', { authorization: `Basic ${Buffer.from('odin:pas-le-bon').toString('base64')}` })).text, /Mot de passe refuse \(essai 1 sur 5\)/);
    // Rien de ce qui a été tapé n'est gardé : alertes, événements, fil, fiches, historique, réglages.
    await pause();
    const partout = [JSON.stringify(w.v.alerts({ limit: 500 })), JSON.stringify(w.evenements), ...readdirSync(w.dir).filter((f) => /\.(json|jsonl)$/.test(f)).map((f) => readFileSync(join(w.dir, f), 'utf8')), JSON.stringify((await lignes(w)))].join('\n');
    for (const secret of [MDP, tapeEnAzerty(MDP), 'faux-essai', 'pas-le-bon']) assert.ok(!partout.includes(secret), `« ${secret} » n'est écrit nulle part`);
    assert.ok((await lignes(w)).evenements.some((e) => e.quoi === 'mot de passe refusé' && e.mac === P && /essai 5 sur 5/.test(e.detail ?? '')), 'le refus est noté (sans le mot de passe)');
    assert.ok((await lignes(w)).evenements.some((e) => e.quoi === 'verrou' && e.mac === P) && (await lignes(w)).evenements.some((e) => e.quoi === 'mot de passe accepté' && e.mac === Q && e.detail === 'saisi par Awa b'));
    // « Postes non autorisés seulement » : un poste que tu as autorisé passe sans rien taper, un inconnu non.
    const S1 = '52:54:00:a8:00:11';
    assert.match((await w.act('mot_de_passe', { pour: 'postes non autorisés seulement' })).text, /inchangé.*aux postes non autorisés seulement/);
    const s1 = await autorise(w, S1); assert.equal((await w.get(noyau(S1))).status, 200); assert.equal((await w.get(`/seed/${s1.jeton}/user-data`)).status, 200); assert.equal((await w.get(`/f/${U}/casper/initrd`)).status, 200);
    assert.match((await w.get('/menu.ipxe?mac=52:54:00:a8:00:12&fw=efi')).text, /item cle Installer/); assert.equal((await w.get(noyau('52:54:00:a8:00:12'))).status, 403);
    // Des essais envoyés en rafale ne passent pas la limite : comptés avant le calcul, 5 seulement sont examinés.
    const rafale = await Promise.all(Array.from({ length: 12 }, (_, i) => w.cle('52:54:00:a8:00:21', `rafale-${i}`)));
    assert.equal(rafale.filter((x) => /Mot de passe refuse \(essai/.test(x.text)).length, 4); assert.equal(rafale.filter((x) => /Trop d'essais/.test(x.text)).length, 8);
    assert.match((await w.cle('52:54:00:a8:00:21', MDP)).text, /Trop d'essais/); assert.equal(verrou().length, 2, 'un blocage, une notification');
    // Retirer le mot de passe : action grave, refusée depuis une automatisation.
    const non = await w.act('retirer_mot_de_passe', {}, { auto: true }); assert.equal(non.ok, false); assert.match(non.text, /action grave/);
    assert.match((await w.get('/menu.ipxe?mac=52:54:00:a8:00:12&fw=efi')).text, /item cle Installer/);
    assert.match((await w.act('retirer_mot_de_passe')).text, /retiré/); assert.ok(!readFileSync(join(w.dir, 'secrets.json'), 'utf8').includes('scrypt'));
    assert.match((await w.get('/menu.ipxe?mac=52:54:00:a8:00:12&fw=efi')).text, /item e-ubuntu/); assert.equal((await w.get(noyau('52:54:00:a8:00:12'))).status, 200);
  } finally { w.end(); }
});

test('le mot de passe garde ceux des profils : le fichier protégé est réécrit sans rien perdre', async () => {
  const w = await monde();
  try {
    await w.act('profil', { nom: 'Atelier', utilisateur: 'tech' });
    const avant = JSON.parse(readFileSync(join(w.dir, 'secrets.json'), 'utf8')) as { profils: Record<string, string> };
    await w.act('mot_de_passe', { mot_de_passe: 'Autre-Secret-9' });
    const apres = JSON.parse(readFileSync(join(w.dir, 'secrets.json'), 'utf8')) as { profils: Record<string, string>; cle: unknown };
    assert.deepEqual(apres.profils, avant.profils); assert.ok(apres.cle);
    await w.act('profil', { nom: 'Bureau', utilisateur: 'awa' });
    assert.ok((JSON.parse(readFileSync(join(w.dir, 'secrets.json'), 'utf8')) as { cle?: unknown }).cle, 'un nouveau profil ne retire pas le mot de passe d\'installation');
    // Les nouvelles actions sont bien celles de l'appli, graves quand il le faut.
    const a = w.v.modules().find((m) => m.id === 'thjalfi')!.actions;
    for (const id of ['suivi', 'poste', 'bloquer', 'debloquer', 'annuler', 'suspendre', 'reprendre', 'mot_de_passe', 'retirer_mot_de_passe', 'delai_abandon', 'rapport']) assert.ok(a.some((x) => x.id === id), id);
    assert.ok(a.find((x) => x.id === 'annuler')!.grave!({ mac: 'x' })); assert.equal(a.find((x) => x.id === 'mot_de_passe')!.grave!({}), undefined);
    for (const id of ['suivi', 'poste', 'rapport']) assert.equal(a.find((x) => x.id === id)!.read, true);
    assert.equal(a.find((x) => x.id === 'mot_de_passe')!.params!.find((p) => p.key === 'mot_de_passe')!.kind, 'password', 'masqué dans le journal des manips');
  } finally { w.end(); }
});
