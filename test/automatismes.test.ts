// Le registre des automatismes (src/valhalla/automatismes.ts) : une veille de sécurité toutes les 10 s et une tâche
// réglable, sur un Valhalla de test à l'horloge simulée. Pause, reprise seule, accord, rien d'écrit après les relevés,
// relu au redémarrage, passage mesuré, pas de double passage, rythme changé lancé à son heure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { regionDe, setLieuCourant } from '../src/valhalla/lieu.ts';
import type { Module } from '../src/valhalla/types.ts';

function banc() {
  const home = mkdtempSync(join(tmpdir(), 'automatismes-'));
  let now = new Date('2026-11-16T10:10:00Z');
  const n = { veille: 0, tache: 0 };
  let lent: Promise<void> | undefined, rate = false;
  const mod = (id: string, every: number, run: () => Promise<void> | void): Module => ({ id, name: id === 'himinbjorg' ? 'Cyclope' : 'Ulysse', family: 'Maison', what: 'essai', does: [], from: [], upstream: [], words: [], actions: [], view: () => ({ sections: [] }), watch: { every, run } });
  const mods = [
    mod('himinbjorg', 10, () => { n.veille++; }),
    mod('gna', 900, async () => { n.tache++; if (lent) await lent; if (rate) throw new Error('disque plein'); }),
  ];
  const v = new Valhalla(home, mods, { now: () => now });
  return { home, v, mods, n, set now(d: Date) { now = d; }, get now() { return now; }, lent: (p: Promise<void> | undefined) => { lent = p; }, rate: (x: boolean) => { rate = x; }, fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

test('la liste : une veille de sécurité, une tâche réglable', () => {
  const b = banc();
  try {
    const l = b.v.automatismes.lignes();
    assert.deepEqual(l.map((x) => x.id), ['veille:himinbjorg', 'veille:gna']);
    const [c, g] = l;
    assert.equal(c.sorte, 'veille'); assert.equal(c.securite, true); assert.deepEqual(c.reglable, []); assert.equal(c.phrase, 'En continu, toutes les 10 secondes');
    assert.deepEqual(c.peut, { lancer: true, pause: true, rythme: false, decaler: false, supprimer: false });
    assert.equal(g.sorte, 'tache'); assert.deepEqual(g.reglable, ['minutes', 'heures']); assert.equal(g.phrase, 'Toutes les 15 minutes'); assert.equal(g.peut.rythme, true);
    assert.equal(g.lien?.appli, 'gna'); assert.equal(g.etat, 'actif');
  } finally { b.fin(); }
});

test('une pause saute le passage ; aucun fichier écrit après 50 relevés de veille', async () => {
  const b = banc(), A = b.v.automatismes, f = join(b.v.dir, 'automatismes.json');
  try {
    assert.equal((A.pause('veille:gna', true) as { ok: boolean }).ok, true);
    assert.equal(await A.passageAuto('veille:gna'), 'pause'); assert.equal(b.n.tache, 0);
    A.pause('veille:gna', false);
    assert.ok(existsSync(f)); const avant = statSync(f).mtimeMs;
    for (let k = 0; k < 50; k++) await A.passageAuto('veille:himinbjorg');
    assert.equal(b.n.veille, 50); assert.equal(statSync(f).mtimeMs, avant, 'les relevés de veille restent en mémoire');
    assert.equal(A.historique('veille:himinbjorg').length, 20, '20 passages gardés');
    await A.passageAuto('veille:gna'); assert.ok(statSync(f).mtimeMs >= avant); assert.equal(b.n.tache, 1);
  } finally { b.fin(); }
});

test('veille de sécurité : accord, 24 h au plus, alerte visible, reprise seule', async () => {
  const b = banc(), A = b.v.automatismes;
  try {
    const sans = A.pause('veille:himinbjorg', true) as { ok: boolean; code?: string; confirm?: string };
    assert.equal(sans.ok, false); assert.equal(sans.code, 'accord'); assert.ok(sans.confirm && sans.confirm.length > 20);
    assert.equal(A.enPause('veille:himinbjorg'), false);
    const r = A.pause('veille:himinbjorg', true, { confirme: true, jusqua: new Date(b.now.getTime() + 48 * 3600_000).toISOString() }) as { ok: true; ligne: { etat: string; pauseJusqua?: string } };
    assert.equal(r.ok, true); assert.equal(r.ligne.etat, 'pause');
    assert.equal(Date.parse(r.ligne.pauseJusqua!) - b.now.getTime(), 24 * 3600_000, 'la pause d\'une veille de sécurité dure 24 h au plus');
    assert.ok(b.v.alerts({ module: 'himinbjorg' }).some((a) => a.level === 'haute' && /surveillance en pause jusqu'à/.test(a.title)), 'une alerte haute reste visible');
    assert.equal(await A.passageAuto('veille:himinbjorg'), 'pause');
    b.now = new Date(b.now.getTime() + 25 * 3600_000);
    await A.verifierDus();
    assert.equal(A.enPause('veille:himinbjorg'), false, 'reprise toute seule');
    await A.passageAuto('veille:himinbjorg'); assert.equal(b.n.veille, 1);
    // Sans fin donnée : une heure.
    const h = A.pause('veille:himinbjorg', true, { confirme: true }) as { ok: true; ligne: { pauseJusqua?: string } };
    assert.equal(Date.parse(h.ligne.pauseJusqua!) - b.now.getTime(), 3600_000);
  } finally { b.fin(); }
});

test('pauses et rythmes relus par une nouvelle instance', () => {
  const b = banc();
  try {
    assert.equal((b.v.automatismes.rythme('veille:gna', { genre: 'heures', n: 2, minute: 0 }) as { ok: boolean }).ok, true);
    b.v.automatismes.pause('veille:gna', true);
    const refus = b.v.automatismes.rythme('veille:gna', { genre: 'mois', jour: 1, heure: '03:00' }) as { ok: boolean; code?: string };
    assert.equal(refus.ok, false); assert.equal(refus.code, 'invalide', 'genre non permis');
    assert.equal((b.v.automatismes.rythme('veille:himinbjorg', { genre: 'minutes', n: 5 }) as { ok: boolean }).ok, false, 'une veille ne se règle pas');
    const v2 = new Valhalla(b.home, b.mods, { now: () => b.now });
    const l = v2.automatismes.ligne('veille:gna')!;
    assert.deepEqual(l.rythme, { genre: 'heures', n: 2, minute: 0 }); assert.equal(l.phrase, 'Toutes les 2 heures'); assert.equal(l.etat, 'pause');
    v2.stop();
  } finally { b.fin(); }
});

test('lancer : passage mesuré (ms, réussite), et pas de second passage par-dessus', async () => {
  const b = banc(), A = b.v.automatismes;
  try {
    const r = await A.lancer('veille:gna') as { ok: true; resultat: { ok: boolean; ms: number; texte: string; at: string } };
    assert.equal(r.ok, true); assert.equal(r.resultat.ok, true); assert.ok(r.resultat.ms >= 0); assert.equal(r.resultat.at, b.now.toISOString());
    b.rate(true);
    const e = await A.lancer('veille:gna') as { ok: true; resultat: { ok: boolean; texte: string } };
    assert.equal(e.resultat.ok, false); assert.match(e.resultat.texte, /disque plein/);
    assert.equal(A.ligne('veille:gna')!.etat, 'erreur');
    b.rate(false);
    let fini!: () => void; b.lent(new Promise<void>((ok) => { fini = ok; }));
    const p = A.lancer('veille:gna');
    const deux = await A.lancer('veille:gna') as { ok: boolean; code?: string };
    assert.equal(deux.ok, false); assert.equal(deux.code, 'en_cours');
    assert.equal(A.ligne('veille:gna')!.etat, 'en_cours');
    fini(); await p; b.lent(undefined);
    assert.equal((await A.lancer('inconnu:x') as { code?: string }).code, 'introuvable');
  } finally { b.fin(); }
});

test('un rythme changé lance le passage à son heure (horloge du registre)', async () => {
  setLieuCourant({ nom: 'Essai', fuseau: 'UTC', region: regionDe('FR') });
  const b = banc(), A = b.v.automatismes;
  try {
    A.rythme('veille:gna', { genre: 'heures', n: 1, minute: 0 });
    A.armer(b.mods[1], async () => { await b.mods[1].watch!.run(b.v.ctx('gna')); });
    assert.equal(A.ligne('veille:gna')!.prochaine, '2026-11-16T11:00:00.000Z');
    b.now = new Date('2026-11-16T10:40:00Z'); await A.verifierDus(); assert.equal(b.n.tache, 0);
    b.now = new Date('2026-11-16T11:00:20Z'); await A.verifierDus(); assert.equal(b.n.tache, 1);
    await A.verifierDus(); assert.equal(b.n.tache, 1, 'une seule fois');
    assert.equal(A.ligne('veille:gna')!.prochaine, '2026-11-16T12:00:00.000Z');
  } finally { A.arreter(); b.fin(); setLieuCourant(undefined); }
});

test('une seule chose à la fois par appli : sa surveillance et sa tâche ne se doublent pas', async () => {
  const home = mkdtempSync(join(tmpdir(), 'automatismes-appli-'));
  let fini!: () => void, passages = 0, verifs = 0;
  const lent = new Promise<void>((ok) => { fini = ok; });
  // Hydre simulée : la surveillance vérifie les ISO (longue), la tâche « verification_iso » fait le même travail.
  const ymir: Module = {
    id: 'ymir', name: 'Hydre', family: 'Maison', what: 'essai', does: [], from: [], upstream: [], words: [],
    actions: [{ id: 'verifier_isos', label: 'Vérifier', what: 'x', run: async () => { verifs++; return { text: 'vérifiées' }; } }],
    view: () => ({ sections: [] }),
    taches: () => [{ id: 'verification_iso', nom: 'Vérification des ISO', quoi: 'x', rythme: () => ({ genre: 'mois', jour: 1, heure: '04:00' }), lancer: { action: 'verifier_isos' } }],
    watch: { every: 120, run: async () => { passages++; await lent; } },
  };
  const now = new Date('2026-11-16T10:10:00Z');
  const v = new Valhalla(home, [ymir], { now: () => now }), A = v.automatismes;
  try {
    const p = A.passageAuto('veille:ymir');
    const t = await A.lancer('tache:ymir:verification_iso') as { ok: boolean; code?: string };
    assert.equal(t.ok, false); assert.equal(t.code, 'en_cours', 'la tâche attend la fin de la surveillance de la même appli');
    assert.equal(verifs, 0);
    fini(); await p;
    const t2 = await A.lancer('tache:ymir:verification_iso') as { ok: boolean };
    assert.equal(t2.ok, true); assert.equal(verifs, 1);
    assert.equal(passages, 1);
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('un relevé de veille qui ne rend jamais la main : déclaré bloqué, alerte, les passages suivants repartent', async () => {
  const home = mkdtempSync(join(tmpdir(), 'automatismes-bloque-'));
  let now = new Date('2026-11-16T10:10:00Z'), n = 0;
  const jamais = new Promise<void>(() => {});
  const ullr: Module = { id: 'ullr', name: 'Asclépios', family: 'Sécurité', what: 'essai', does: [], from: [], upstream: [], words: [], actions: [], view: () => ({ sections: [] }), watch: { every: 10, run: async () => { n++; if (n === 1) await jamais; } } };
  const v = new Valhalla(home, [ullr], { now: () => now }), A = v.automatismes;
  try {
    void A.passageAuto('veille:ullr');
    assert.equal(await A.passageAuto('veille:ullr'), 'en_cours', 'pas de second passage par-dessus tant que le délai n\'est pas passé');
    assert.equal(A.ligne('veille:ullr')!.etat, 'en_cours');
    now = new Date(now.getTime() + 61_000); // 2 × 10 s, ramené à une minute au moins
    const p = await A.passageAuto('veille:ullr') as { ok: boolean };
    assert.equal(p.ok, true, 'le passage suivant repart'); assert.equal(n, 2);
    const h = A.historique('veille:ullr');
    assert.ok(h.some((x) => !x.ok && /bloqué/.test(x.texte ?? '')), 'le passage bloqué est noté en échec');
    assert.ok(v.alerts({ module: 'ullr' }).some((a) => a.level === 'haute' && /surveillance bloquée/.test(a.title)), 'alerte haute : c\'est une veille de sécurité');
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('une pause sans fin laisse une alerte visible, marquée vue à la reprise', () => {
  const b = banc(), A = b.v.automatismes;
  try {
    const r = A.pause('veille:gna', true) as { ok: boolean; ligne: { pauseJusqua?: string } };
    assert.equal(r.ok, true); assert.equal(r.ligne.pauseJusqua, undefined, 'sans date de fin');
    const al = b.v.alerts({ module: 'gna' }).find((a) => /en pause sans date de fin/.test(a.title));
    assert.ok(al, 'une alerte dit que la tâche est en pause sans fin');
    A.pause('veille:gna', false);
    assert.equal(b.v.alerts({ module: 'gna' }).find((a) => a.id === al!.id)?.ack, true, 'l\'alerte est marquée vue à la reprise');
  } finally { b.fin(); }
});
