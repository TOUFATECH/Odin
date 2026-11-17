// Les épingles du menu « Plus » (src/web/epingles-api.ts) : par compte, bornées à 12 applis, un membre n'épingle que
// ce qu'il a le droit d'ouvrir, gardées sur le serveur et écrites d'un coup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ecrireEpingles, fichierEpingles, lireEpingles, MAX_EPINGLES, traiterEpingles, VUES, type EtatEpingles } from '../src/web/epingles-api.ts';

const P = '@proprietaire';
const tout = () => true;
const APPLIS = Array.from({ length: 14 }, (_, i) => `a${i}`);
const ok = (r: ReturnType<typeof traiterEpingles>) => { assert.equal(r.reponse.ok, true, JSON.stringify(r.reponse)); return r.reponse as { ok: true; epingles: string[]; vues?: unknown[]; max?: number; proprietaire?: boolean }; };

test('par défaut : le propriétaire a les 7 vues dans l\'ordre du menu, un membre n\'a rien', () => {
  const p = ok(traiterEpingles({}, P, true, tout));
  assert.deepEqual(p.epingles, ['vue:flows', 'vue:runes', 'vue:missions', 'vue:skills', 'vue:jobs', 'vue:audit', 'vue:profil']);
  assert.equal(p.max, 12); assert.equal(p.proprietaire, true); assert.deepEqual(p.vues, VUES);
  const m = ok(traiterEpingles({}, 'awa', false, tout));
  assert.deepEqual(m.epingles, []); assert.deepEqual(m.vues, [], 'aucune vue pour un membre'); assert.equal(m.proprietaire, false);
});

test('épingler, retirer, ordonner, défaut ; 12 applis au plus (les vues ne comptent pas)', () => {
  let e: EtatEpingles = {};
  for (const a of APPLIS.slice(0, MAX_EPINGLES)) { const r = traiterEpingles(e, P, true, tout, { faire: 'epingler', id: `appli:${a}` }); ok(r); e = r.etat; }
  assert.equal(e[P].length, 7 + 12, 'à la suite des vues');
  const deja = traiterEpingles(e, P, true, tout, { faire: 'epingler', id: 'appli:a0' }); assert.equal(deja.change, false, 'déjà épinglée : rien ne change');
  const trop = traiterEpingles(e, P, true, tout, { faire: 'epingler', id: 'appli:a12' });
  assert.equal(trop.reponse.ok, false); assert.equal((trop.reponse as { code: string }).code, 'max');
  let r = traiterEpingles(e, P, true, tout, { faire: 'retirer', id: 'vue:audit' }); e = r.etat; assert.ok(!ok(r).epingles.includes('vue:audit'));
  r = traiterEpingles(e, P, true, tout, { faire: 'epingler', id: 'vue:audit' }); e = r.etat; assert.equal(ok(r).epingles.at(-1), 'vue:audit', 'une vue se remet comme une appli');
  const liste = e[P], ordre = [...liste].reverse();
  r = traiterEpingles(e, P, true, tout, { faire: 'ordonner', ordre }); e = r.etat; assert.deepEqual(ok(r).epingles, ordre);
  for (const faux of [ordre.slice(1), [...ordre.slice(1), 'appli:zz'], [...ordre.slice(1), ordre[1]], 'non']) {
    const x = traiterEpingles(e, P, true, tout, { faire: 'ordonner', ordre: faux });
    assert.equal((x.reponse as { code?: string }).code, 'invalide', JSON.stringify(faux).slice(0, 40));
  }
  r = traiterEpingles(e, P, true, tout, { faire: 'defaut' }); assert.deepEqual(ok(r).epingles, VUES.map((v) => v.id)); assert.equal(r.etat[P], undefined);
  assert.equal((traiterEpingles({}, P, true, tout, { faire: 'epingler', id: 'vue:inconnue' }).reponse as { code?: string }).code, 'inconnu');
  assert.equal((traiterEpingles({}, P, true, tout, { faire: 'n_importe' }).reponse as { code?: string }).code, 'invalide');
});

test('un membre : pas de vues, seulement les applis qu\'il a le droit d\'ouvrir ; une appli disparue ou retirée part à la lecture', () => {
  const droit = (a: string) => a === 'agora' || a === 'sol';
  const vue = traiterEpingles({}, 'awa', false, droit, { faire: 'epingler', id: 'vue:flows' });
  assert.equal((vue.reponse as { code?: string }).code, 'interdit');
  const sans = traiterEpingles({}, 'awa', false, droit, { faire: 'epingler', id: 'appli:sindri' });
  assert.equal((sans.reponse as { code?: string }).code, 'interdit');
  let r = traiterEpingles({}, 'awa', false, droit, { faire: 'epingler', id: 'appli:agora' }); let e = r.etat;
  r = traiterEpingles(e, 'awa', false, droit, { faire: 'epingler', id: 'appli:sol' }); e = r.etat;
  assert.deepEqual(ok(r).epingles, ['appli:agora', 'appli:sol']);
  // Le droit à Hélios est retiré (ou l'appli disparaît) : elle n'est plus rendue.
  assert.deepEqual(ok(traiterEpingles(e, 'awa', false, (a) => a === 'agora')).epingles, ['appli:agora']);
  // Deux clés séparées : le propriétaire garde les siennes.
  r = traiterEpingles(e, P, true, tout, { faire: 'epingler', id: 'appli:sindri' }); e = r.etat;
  assert.deepEqual(e.awa, ['appli:agora', 'appli:sol']); assert.equal(e[P].at(-1), 'appli:sindri');
});

test('rangé sur le serveur, écrit d\'un coup', () => {
  const home = mkdtempSync(join(tmpdir(), 'epingles-'));
  try {
    const f = fichierEpingles(home);
    assert.deepEqual(lireEpingles(f), {}, 'pas encore de fichier');
    const r = traiterEpingles(lireEpingles(f), P, true, tout, { faire: 'epingler', id: 'appli:ymir' });
    ecrireEpingles(f, r.etat);
    assert.ok(existsSync(f)); assert.deepEqual(readdirSync(join(home, 'interface')), ['epingles.json'], 'pas de fichier .tmp laissé');
    assert.equal(lireEpingles(f)[P].at(-1), 'appli:ymir');
    assert.equal(f, join(home, 'interface', 'epingles.json'));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
