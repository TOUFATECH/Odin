// Réseau, lot R1 (maquette validée le 23/11) : les actions qui CHANGENT le réseau ou montrent un secret, dans Vortex
// (VPN) et Sphinx (DNS, DHCP), sont au propriétaire seul. Ni une automatisation (Talos), ni un autre assistant (MCP),
// ni un lien entre applis lancé sans lui, ni Odin seul, ni un membre qui parle à Odin (Telegram, outil de l'IA), ni une
// conversation marquée (contenu extérieur lu). Les lectures d'aujourd'hui restent ouvertes. Chaque action qui change le
// réseau laisse une ligne « qui a fait quoi » (qui, quoi, quand, résultat), jamais un secret dedans.
// Aucun vrai changement réseau : la carte VPN est factice, aucune commande système ne part, rien n'écoute (ni DNS, ni
// DHCP, ni tunnel) ; les actions qui allumeraient un serveur ou toucheraient la box sont remplacées par un bouchon pour
// le passage du propriétaire (la garde, elle, est la vraie).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { vidarr } from '../src/valhalla/modules/vidarr.ts';
import { gjoll, keypair, setTunFactory, type Peer } from '../src/valhalla/modules/gjoll.ts';
import type { Action, Module } from '../src/valhalla/types.ts';
import { entree, REFUS, SPHINX, VORTEX } from './reseau-r1-commun.ts';

setTunFactory(async () => ({ write: () => {}, onPacket: () => {}, close: () => {} }));

/** Celles qui allumeraient un serveur, parleraient à la box ou à Internet : un bouchon pour le passage du propriétaire. */
const BOUCHONS = new Set(['gjoll.ouvrir_port', 'gjoll.fermer_port', 'gjoll.detecter', 'gjoll.allumer', 'gjoll.eteindre', 'gjoll.serveur', 'vidarr.demarrer', 'vidarr.arreter', 'vidarr.ajouter_liste', 'vidarr.activer_liste', 'vidarr.retirer_liste', 'vidarr.mettre_a_jour', 'vidarr.dhcp_demarrer', 'vidarr.dhcp_arreter', 'vidarr.dns_chiffre', 'vidarr.reglages', 'vidarr.pubs_reseaux', 'vidarr.horaires', 'vidarr.dhcp_mode', 'vidarr.dhcp_reglages']);

/** Remplace l'exécution de ces actions par un bouchon (la garde « propriétaire seul » est vérifiée avant elle). */
function boucher(v: Valhalla): void { for (const m of [v.module('gjoll')!, v.module('vidarr')!]) for (const a of m.actions) if (BOUCHONS.has(`${m.id}.${a.id}`)) a.run = async () => ({ text: 'bouchon d\'essai' }); }

/** Un Odin d'essai avec Vortex et Sphinx seulement : aucune commande système, aucune sortie réseau. */
export function monde() {
  const home = mkdtempSync(join(tmpdir(), 'reseau-r1-')), commandes: string[] = [];
  const v = new Valhalla(home, [gjoll, vidarr()], {
    run: async (cmd, args) => { commandes.push(`${cmd} ${args.join(' ')}`); return { code: 1, out: '', err: 'essai : aucune commande' }; },
    fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as unknown as typeof fetch,
    notify: async () => {}, autonomy: () => 'equilibre',
  });
  const g = v.ctx('gjoll'); g.saveSettings({ server: { ...keypair(), net: '10.8.0', port: 51820, endpoint: '198.51.100.20', dns: '', iface: 'wg-essai' } });
  return { v, home, commandes, fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

/** Tout ce qui n'est pas le propriétaire en personne. */
const PAS_LUI: Array<[string, Parameters<Valhalla['act']>[3]]> = [
  ['une automatisation (Talos)', { auto: true, by: 'automatisation' }],
  ['un autre assistant (MCP)', { auto: true, by: 'assistant' }],
  ['un lien entre applis lancé sans lui (réflexe)', { by: 'réflexe' }],
  ['Odin seul (tâche sans surveillance)', { by: 'odin' }],
  ['un membre qui parle à Odin (Telegram, outil de l\'IA)', { qui: 'member' }],
  ['un invité', { qui: 'guest' }],
  ['une conversation marquée (contenu extérieur lu)', { qui: 'owner', marque: true }],
];

function tousLesFichiers(d: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) out.push(...tousLesFichiers(p)); else out.push(p); }
  return out;
}

test('R1 : chaque action de Vortex et de Sphinx qui change le réseau est refusée à tout ce qui n\'est pas le propriétaire en personne', async () => {
  const w = monde();
  try {
    // Même si la garde avait un trou, rien ne s'allume : ces actions-là sont bouchées (la garde passe avant elles).
    boucher(w.v);
    const passe: string[] = [];
    for (const [qui, o] of PAS_LUI) {
      for (const [m, ids] of [['gjoll', VORTEX], ['vidarr', SPHINX]] as const) {
        for (const id of ids) {
          const r = await w.v.act(m, id, entree(id), o);
          if (r.ok !== false || !REFUS.test(r.text)) passe.push(`${qui} · ${m}.${id} → ${r.ok === false ? 'refusé mais pas par la garde' : 'PASSÉ'} : ${r.text.split('\n')[0].slice(0, 90)}`);
        }
      }
    }
    assert.deepEqual(passe, [], 'tout est refusé par la garde « propriétaire seul »');
    assert.deepEqual(w.v.ctx('gjoll').settings.peers ?? [], [], 'aucun appareil VPN créé');
    assert.deepEqual(w.commandes, [], 'aucune commande système');
  } finally { w.fin(); }
});

test('R1 : la liste exacte — toute action de Vortex ou de Sphinx qui écrit est « propriétaire seul » (rien d\'oublié)', () => {
  const seul = (a: Action) => typeof a.proprietaireSeul === 'function' ? a.proprietaireSeul({}, undefined) : a.proprietaireSeul === true;
  for (const [m, ids] of [[gjoll, VORTEX], [vidarr(), SPHINX]] as Array<[Module, string[]]>) {
    const ecrit = m.actions.filter((a) => !a.read).map((a) => a.id).filter((id) => id !== 'qui_a_fait');
    assert.deepEqual(ecrit.filter((id) => !ids.includes(id)), [], `${m.name} : une action qui écrit n'est pas dans la liste`);
    for (const id of ids) assert.equal(seul(m.actions.find((a) => a.id === id)!), true, `${m.name} · ${id}`);
  }
  for (const id of ['qr', 'telecharger']) assert.equal(gjoll.actions.find((a) => a.id === id)!.read, true, `${id} reste une lecture (pour la page) mais réservée`);
});

test('R1 : le propriétaire en personne passe partout ; ses actions sont notées « qui a fait quoi », sans aucun secret', async () => {
  const w = monde();
  try {
    // Le passage du propriétaire : les actions qui allumeraient un serveur ou parleraient à la box sont bouchées.
    boucher(w.v);
    const refuses: string[] = [];
    const ordre: Array<[string, string]> = [['gjoll', 'ajouter'], ['gjoll', 'qr'], ['gjoll', 'telecharger'], ['gjoll', 'modifier'], ['gjoll', 'activer'], ...VORTEX.filter((x) => !['ajouter', 'qr', 'telecharger', 'modifier', 'activer', 'revoquer'].includes(x)).map((x) => ['gjoll', x] as [string, string]), ...SPHINX.map((x) => ['vidarr', x] as [string, string])];
    assert.equal((await w.v.act('gjoll', 'ajouter', { nom: 'Tablette 2', dns_odin: false })).ok, true);
    let qr = '';
    for (const [m, id] of ordre) {
      const r = await w.v.act(m, id, entree(id));
      if (REFUS.test(r.text)) refuses.push(`${m}.${id}`);
      if (m === 'gjoll' && id === 'qr') { assert.equal(r.ok, true, r.text); qr = String((r.data as { conf?: string }).conf ?? ''); }
    }
    const rv = await w.v.act('gjoll', 'revoquer', entree('revoquer'));
    assert.equal(rv.ok, true, rv.text);
    assert.deepEqual(refuses, [], 'le propriétaire n\'est jamais refusé');
    assert.match(qr, /PrivateKey = /, 'le propriétaire reçoit bien sa configuration');
    // Les effets réels (rien n'a été bouché ici) : l'appareil, le blocage, l'adresse fixe.
    const peers = w.v.ctx('gjoll').settings.peers as Peer[];
    assert.deepEqual(peers.map((p) => p.name), ['Téléphone 1'], 'Téléphone 1 gardé, Tablette 2 révoquée');

    // Le journal « qui a fait quoi » : qui, quoi, quand, résultat.
    for (const [m, nb] of [['gjoll', VORTEX.length + 1], ['vidarr', SPHINX.length]] as const) {
      const j = await w.v.act(m, 'qui_a_fait', { n: 200 });
      assert.equal(j.ok, true, j.text);
      const l = (j.data as { actes: Array<{ t: number; qui: string; action: string; ok: boolean; resultat: string }> }).actes;
      assert.ok(l.length >= nb - BOUCHONS.size, `${m} : ${l.length} lignes`);
      for (const x of l) { assert.equal(x.qui, 'propriétaire'); assert.ok(x.t > 0 && x.action && typeof x.ok === 'boolean', JSON.stringify(x)); }
      assert.match(j.text, /propriétaire/);
    }
    const jv = (await w.v.act('gjoll', 'qui_a_fait', {})).data as { actes: Array<{ action: string; quoi: string; ok: boolean }> };
    assert.ok(jv.actes.some((x) => x.action === 'QR code' && x.quoi.includes('Téléphone 1')), 'montrer le QR code est noté');
    assert.ok(jv.actes.some((x) => x.action === 'Révoquer' && x.ok), 'révoquer est noté');
    // Aucun secret dans les journaux ni dans les fichiers de journal : ni clé privée, ni clé partagée, ni configuration.
    const secrets = [...peers.flatMap((p) => [p.priv ?? '', p.psk]), String((w.v.ctx('gjoll').settings.server as { priv: string }).priv)].filter((x) => x.length > 20);
    const textes = [JSON.stringify((await w.v.act('gjoll', 'qui_a_fait', { n: 500 })).data), JSON.stringify((await w.v.act('vidarr', 'qui_a_fait', { n: 500 })).data)];
    for (const f of tousLesFichiers(w.home).filter((x) => /qui-a-fait|actes/.test(x))) textes.push(readFileSync(f, 'utf8'));
    for (const t of textes) { for (const s of secrets) assert.ok(!t.includes(s), 'un secret est dans le journal'); assert.doesNotMatch(t, /PrivateKey|PresharedKey/); }
    // Les commandes sont simulées (rien ne part) ; seules des lectures sont demandées : route par défaut, outil présent.
    assert.deepEqual(w.commandes.filter((c) => !/^ip route show default$|^sh -c command -v \w+$/.test(c)), [], 'aucune commande qui change la machine');
  } finally { w.fin(); }
});

test('R1 : le journal « qui a fait quoi » est lui aussi au propriétaire seul, et note aussi un échec', async () => {
  const w = monde();
  try {
    for (const [, o] of PAS_LUI) for (const m of ['gjoll', 'vidarr']) { const r = await w.v.act(m, 'qui_a_fait', {}, o); assert.equal(r.ok, false, `${m} ${JSON.stringify(o)}`); assert.match(r.text, REFUS); }
    const r = await w.v.act('gjoll', 'qr', { nom: 'Appareil inexistant' });
    assert.equal(r.ok, false);
    const j = (await w.v.act('gjoll', 'qui_a_fait', {})).data as { actes: Array<{ action: string; ok: boolean; resultat: string }> };
    assert.ok(j.actes.some((x) => x.action === 'QR code' && !x.ok && /introuvable/.test(x.resultat)), JSON.stringify(j.actes));
  } finally { w.fin(); }
});

test('R1 : les lectures d\'aujourd\'hui restent ouvertes (automatisation, assistant, membre qui parle à Odin)', async () => {
  const w = monde();
  try {
    for (const [, o] of PAS_LUI) {
      for (const [m, id, i] of [['gjoll', 'appareils', {}], ['gjoll', 'trafic', {}], ['vidarr', 'etat', {}], ['vidarr', 'listes', {}], ['vidarr', 'baux', {}], ['vidarr', 'journal', {}], ['vidarr', 'historique', {}]] as Array<[string, string, Record<string, unknown>]>) {
        const r = await w.v.act(m, id, i, o);
        assert.doesNotMatch(r.text, REFUS, `${m}.${id} ${JSON.stringify(o)}`);
        assert.equal(r.ok, true, `${m}.${id} ${JSON.stringify(o)} : ${r.text}`);
      }
    }
  } finally { w.fin(); }
});
