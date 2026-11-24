// Le voile des réponses secrètes : la page générique des applis (src/web/valhalla.js, show()) cache le QR code derrière
// « Montrer » quand la réponse d'une action porte la marque `secret: true`. Ici : les réponses qui dessinent un secret
// en QR code portent bien la marque, telles que la page les reçoit (vrai Odin d'essai, session du propriétaire) :
// la double authentification (Persona), le Wi-Fi invités avec mot de passe (Zéphyr), l'invitation (Persona).
// Contrôle : l'étiquette d'inventaire (Atlas) n'est pas un secret et ne la porte pas.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin;
type Rep = { ok?: boolean; text?: string; data?: { svg?: string; conf?: string; secret?: unknown } };
const acte = async (module: string, action: string, input: Record<string, unknown> = {}) => (await v.json('/api/valhalla/act', { module, action, input, confirm: true })).body as Rep;

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['var', 'svalinn', 'askr'].includes(m.id)) });
  assert.equal((await valhallaOf()!.act('var', 'ajouter', { login: 'membre-a', nom: 'Membre A', groupes: 'invite', mot_de_passe: 'un-sentier-de-sable-sous-les-pins-31' })).ok, true);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('double authentification (Persona) : le QR code et la clé à taper sont marqués secrets', async () => {
  const r = await acte('var', 'double_auth', { login: 'membre-a' });
  assert.equal(r.ok, true, r.text); assert.match(String(r.data?.svg), /^<svg/); assert.ok(r.data?.conf, 'la clé à taper est là');
  assert.equal(r.data?.secret, true);
});

test('Wi-Fi invités (Zéphyr) : le QR code qui porte le mot de passe est marqué secret ; sans mot de passe, il ne l\'est pas', async () => {
  const z = valhallaOf()!.ctx('svalinn');
  z.saveSettings({ invites: { ssid: 'Maison-Invites' } });
  const ouvert = await acte('svalinn', 'qr_invites');
  assert.equal(ouvert.ok, true, ouvert.text); assert.match(String(ouvert.data?.svg), /^<svg/); assert.notEqual(ouvert.data?.secret, true, 'réseau ouvert : rien à cacher');
  assert.equal((await valhallaOf()!.act('svalinn', 'regler', { invites_nom: 'Maison-Invites', invites_mdp: 'bienvenue-essai-2026' })).ok, true);
  const r = await acte('svalinn', 'qr_invites');
  assert.equal(r.ok, true, r.text); assert.match(String(r.data?.svg), /^<svg/);
  assert.equal(r.data?.secret, true);
});

test('invitation (Persona) : le QR code du lien à usage unique est marqué secret', async () => {
  const r = await acte('var', 'inviter', { nom: 'Proche E', groupes: 'invite' });
  assert.equal(r.ok, true, r.text); assert.match(String(r.data?.svg), /^<svg/);
  assert.equal(r.data?.secret, true);
});

test('contrôle : l\'étiquette d\'inventaire (Atlas) n\'est pas un secret', async () => {
  assert.equal((await valhallaOf()!.act('askr', 'ajouter', { nom: 'Imprimante essai', type: 'imprimante' })).ok, true);
  const r = await acte('askr', 'etiquette', { appareil: 'Imprimante essai' });
  assert.equal(r.ok, true, r.text); assert.match(String(r.data?.svg), /^<svg/); assert.notEqual(r.data?.secret, true);
});

test('filet : dans les applis, toute réponse qui dessine un QR code est marquée secrète, sauf celles connues pour ne rien cacher', () => {
  const SANS_SECRET = new Set(['modules/askr.ts']), oublis: string[] = [];
  const racine = new URL('../src/valhalla/', import.meta.url);
  const voir = (dossier: string) => {
    for (const e of readdirSync(new URL(dossier, racine), { withFileTypes: true })) {
      const chemin = join(dossier, e.name).replace(/\\/g, '/');
      if (e.isDirectory()) { voir(`${chemin}/`); continue; }
      if (!e.name.endsWith('.ts')) continue;
      readFileSync(new URL(chemin, racine), 'utf8').split('\n').forEach((ligne, n) => {
        if (/data: \{[^\n]*\bsvg: /.test(ligne) && !/\bsecret\b/.test(ligne.slice(ligne.search(/data: \{/))) && !SANS_SECRET.has(chemin)) oublis.push(`${chemin}:${n + 1}`);
      });
    }
  };
  voir('./');
  assert.deepEqual(oublis, []);
});
