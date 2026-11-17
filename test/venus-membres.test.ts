// Vénus ouvre les dossiers de la machine d'Odin et lit leurs médias : c'est au propriétaire seul. Un membre de Persona
// connecté à l'interface d'Odin (même avec le droit d'ouvrir Vénus) ne déclare aucun dossier, ne lance aucun scan,
// ne voit pas la bibliothèque et ne lit aucun flux. Un vrai Odin (serveur web + applis), par le même chemin que la page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';

const MDP = 'une-riviere-calme-sous-la-lune-48';
const IDS = ['var', 'freyja'];
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';

/** La connexion d'une personne de Persona à l'interface d'Odin, comme un navigateur : rend le cookie de sa session. */
async function entrer(v: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const html = await r.text(), demande = /name="demande" value="([^"]+)"/.exec(html)![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}

test('Vénus : un membre (même avec le droit Vénus) ne déclare, ne scanne, ne voit et ne lit rien ; le propriétaire, si', { timeout: 180_000 }, async () => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn }, medias = mkdtempSync(join(tmpdir(), 'venus-membre-medias-'));
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) }), va = valhallaOf()!;
    assert.equal((await va.act('var', 'ajouter', { login: 'membre-v', nom: 'Membre V', groupes: 'invite', mot_de_passe: MDP })).ok, true);
    for (const appli of ['odin', 'freyja']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-v' })).ok, true);
    lierProprietaire(persona()!);
    const m = await entrer(v, 'membre-v', MDP);
    assert.ok(m, 'le membre a une session');

    const membre = (chemin: string, corps?: unknown) => v.json(chemin, corps, { cookie: m });
    assert.equal((await membre('/venus/dossiers', { chemin: medias, categorie: 'films' })).status, 401, 'déclarer un dossier : refusé');
    assert.equal((await membre('/venus/dossiers')).status, 401, 'la liste des dossiers : refusée');
    assert.equal((await membre('/venus/scan', {})).status, 401, 'le scan : refusé');
    assert.equal((await membre('/venus/bibliotheque')).status, 401, 'la bibliothèque : refusée');
    assert.equal((await membre('/venus/flux/film%3Aessai')).status, 401, 'le flux : refusé');

    // Le propriétaire, lui, déclare son dossier.
    const p = await v.json('/venus/dossiers', { chemin: medias, categorie: 'films' });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.ok((p.body.dossiers as Array<{ chemin: string }>).some((d) => d.chemin === medias));
  } finally {
    await tt.end();
    Object.assign(console, orig);
    rmSync(medias, { recursive: true, force: true });
  }
});
