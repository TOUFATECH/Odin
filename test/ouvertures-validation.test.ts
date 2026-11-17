// Ouvrir, exposer, changer le système : seul, Odin ne fait que le sans-risque ; le reste attend la validation du
// propriétaire, et cette validation montre ce qui change (quoi, où, vers qui).
// 1. Le passage par réflexe : une appli qui en appelle une autre n'atteint une action « grave » que si l'action de départ
//    a été validée par le propriétaire (sa validation montrait ce qui allait suivre). Sinon : refusé, et il est prévenu.
// 2. Chaque action qui ouvre, expose ou change le système a sa validation ; une automatisation ne la lance pas.
// Rien n'est lancé sur la machine : un pare-feu ufw allumé est imité, chaque commande est notée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import type { Module } from '../src/valhalla/types.ts';
import { type Answers, type Judge } from '../src/mimir/client.ts';
import { call, makeOdin } from './helpers.ts';

/** Un monde d'Odin : les applis (ou celles données), un pare-feu ufw imité, les messages au propriétaire notés. */
function monde(mods?: Module[]) {
  const home = mkdtempSync(join(tmpdir(), 'odin-ouvertures-')), ran: string[] = [], dits: string[] = [];
  const v = new Valhalla(home, mods ?? allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {}, web: { port: 8888, tls: { enabled: false } }, mail: {} } } as never), {
    run: async (cmd, args) => { ran.push(`${cmd} ${args.join(' ')}`); return { code: 0, out: /command -v/.test(args.join(' ')) ? '/usr/bin/x' : cmd === 'ufw' && args[0] === 'status' ? 'Status: active' : '', err: '' }; },
    fetch: (async () => { throw new Error('réseau coupé'); }) as unknown as typeof fetch,
    notify: async (t) => { dits.push(t); }, autonomy: () => 'equilibre',
  });
  setValhalla(v);
  const ouverts = () => ran.filter((c) => /^ufw allow /.test(c));
  return { v, ran, dits, ouverts, fin: () => { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}

// ---------------- 1. Le passage par réflexe (applis imitées : rien d'autre ne bouge)
const ouvertures: string[] = [];
const vue = () => ({ sections: [] });
const porte: Module = { id: 'porte', name: 'Porte', family: 'Sécurité', what: '', does: [], from: [], upstream: [], words: [], view: vue,
  actions: [{ id: 'ouvrir', label: 'Ouvrir', what: '', grave: (i) => `ouvrir le port ${String(i.port)} vers Internet`, run: (_c, i) => { ouvertures.push(String(i.port)); return { text: `ouvert ${String(i.port)}` }; } }] };
const lanceur = (id: string, grave?: string, interne = false): Module => ({ id, name: id, family: 'Accès', what: '', does: [], from: [], upstream: [], words: [], view: vue,
  actions: [{ id: 'demarrer', label: 'Démarrer', what: '', ...(grave ? { grave: () => grave } : {}), run: async (ctx) => { const r = await ctx.call('porte', 'ouvrir', { port: 4711 }, 'ouvrir pour démarrer', interne ? { interne: true } : undefined); return { ok: r.ok, text: r.text }; } }] });
const applis = () => { ouvertures.length = 0; return [porte, lanceur('sansgrave'), lanceur('avecgrave', 'démarrer le service et ouvrir le port 4711 vers Internet'), lanceur('etape', undefined, true)]; };

test('Réflexe : une automatisation démarre une appli qui ouvre un port → rien ne s\'ouvre, le propriétaire est prévenu', async () => {
  const w = monde(applis());
  try {
    const r = await w.v.act('sansgrave', 'demarrer', {}, { auto: true });
    assert.deepEqual(ouvertures, [], `rien ne doit s'ouvrir (réponse : ${r.text})`);
    assert.match(r.text, /validation/);
    assert.ok(w.v.alerts({ module: 'porte' }).some((a) => /4711/.test(`${a.title} ${a.detail ?? ''}`)), 'une alerte dit ce qui a été refusé');
    assert.ok(w.dits.some((t) => /4711/.test(t)), 'le propriétaire reçoit le message');
  } finally { w.fin(); }
});

test('Réflexe : un appel entre applis sans action de départ (veille, minuteur) n\'atteint pas une action grave', async () => {
  const w = monde(applis());
  try {
    const r = await w.v.ctx('sansgrave').call('porte', 'ouvrir', { port: 4711 }, 'réflexe de veille');
    assert.equal(r.ok, false); assert.deepEqual(ouvertures, []);
  } finally { w.fin(); }
});

test('Réflexe : lancée par le propriétaire mais sans validation qui montre la suite → refusé aussi', async () => {
  const w = monde(applis());
  try {
    await w.v.act('sansgrave', 'demarrer');
    assert.deepEqual(ouvertures, [], 'la validation de départ ne montrait pas l\'ouverture');
  } finally { w.fin(); }
});

test('Réflexe : l\'action de départ validée (elle montrait l\'ouverture) → le port s\'ouvre', async () => {
  const w = monde(applis());
  try {
    const r = await w.v.act('avecgrave', 'demarrer');
    assert.notEqual(r.ok, false, r.text); assert.deepEqual(ouvertures, ['4711']);
    // La même, par une automatisation : refusée dès le départ.
    ouvertures.length = 0;
    assert.equal((await w.v.act('avecgrave', 'demarrer', {}, { auto: true })).ok, false); assert.deepEqual(ouvertures, []);
  } finally { w.fin(); }
});

test('Réflexe : une étape déclarée (« interne ») garde la règle d\'avant pour le propriétaire en personne, et reste refusée à une automatisation', async () => {
  const w = monde(applis());
  try {
    await w.v.act('etape', 'demarrer');
    assert.deepEqual(ouvertures, ['4711'], 'inchangé : étape de l\'action que le propriétaire a lancée lui-même');
    ouvertures.length = 0;
    await w.v.act('etape', 'demarrer', {}, { auto: true });
    assert.deepEqual(ouvertures, [], 'lancée par une automatisation : l\'étape grave est refusée');
  } finally { w.fin(); }
});

// ---------------- Les vraies applis : le trou constaté, puis les chemins voulus
test('Proxy (Valgrind) démarré par une automatisation : aucun port ne s\'ouvre au pare-feu', async () => {
  const w = monde();
  try {
    const r = await w.v.act('valgrind', 'demarrer', { http: 0, https: 0 }, { auto: true });
    assert.deepEqual(w.ouverts(), [], `aucune règle de pare-feu (réponse : ${r.text})`);
    assert.equal(r.ok, false);
  } finally { w.fin(); }
});

test('Cerbère appelé par une appli sans action de départ : le port reste fermé et le propriétaire est prévenu', async () => {
  const w = monde();
  try {
    const r = await w.v.ctx('vordr').call('garmr', 'ouvrir_port', { port: 4444 }, 'réflexe');
    assert.equal(r.ok, false, r.text); assert.deepEqual(w.ouverts(), []);
    assert.ok(w.dits.some((t) => /4444/.test(t)), 'prévenu');
  } finally { w.fin(); }
});

test('Chemin voulu : le propriétaire démarre le proxy, la validation dit quels ports, et les ports s\'ouvrent', async () => {
  const w = monde();
  try {
    const g = w.v.action('valgrind', 'demarrer')!.a.grave!({ http: 8080, https: 8443 }, w.v.ctx('valgrind')) ?? '';
    assert.match(g, /8080/); assert.match(g, /8443/); assert.match(g, /pare-feu/);
    const r = await w.v.act('valgrind', 'demarrer', { http: 0, https: 0 });
    assert.notEqual(r.ok, false, r.text);
    assert.equal(w.ouverts().length, 2, `les deux ports du proxy : ${w.ouverts().join(' | ')}`);
  } finally { w.fin(); }
});

test('Chemin voulu : le propriétaire allume le VPN, la validation dit le port, et le port s\'ouvre', { skip: process.platform === 'win32' ? 'Windows : le moteur du VPN est pour Linux (même saut que liens gjoll → garmr)' : false }, async () => {
  const w = monde();
  const { setTunFactory } = await import('../src/valhalla/modules/gjoll.ts');
  setTunFactory(async () => ({ write: () => {}, onPacket: () => {}, close: () => {} }));
  try {
    assert.match(w.v.action('gjoll', 'allumer')!.a.grave!({}, w.v.ctx('gjoll')) ?? '', /51820\/udp/);
    const r = await w.v.act('gjoll', 'allumer'); assert.notEqual(r.ok, false, r.text);
    assert.ok(w.ouverts().some((c) => /^ufw allow 51820\/udp/.test(c)), w.ran.join(' | '));
  } finally { await w.v.act('gjoll', 'eteindre').catch(() => undefined); w.fin(); }
});

test('Réflexe : fermer un port reste permis sans validation (veille, automatisation, action sans grave), sans alerte trompeuse', async () => {
  const fermeur = (interne: boolean): Module => ({ id: interne ? 'fermeur_etape' : 'fermeur', name: 'Fermeur', family: 'Sécurité', what: '', does: [], from: [], upstream: [], words: [], view: vue,
    actions: [{ id: 'ranger', label: 'Ranger', what: '', run: async (ctx) => { const r = await ctx.call('garmr', 'fermer_port', { port: 4444, proto: 'tcp' }, 'ranger', interne ? { interne: true } : undefined); return { ok: r.ok, text: r.text }; } }] });
  const w = monde([...allModules({ paths: { home: tmpdir(), workspace: tmpdir() }, cfg: { venus: {}, voice: {}, web: { port: 8888, tls: { enabled: false } }, mail: {} } } as never).filter((m) => m.id === 'garmr'), fermeur(false), fermeur(true)]);
  const fermes = () => w.ran.filter((c) => /^ufw delete /.test(c)).length;
  try {
    const cas: Array<[string, () => Promise<{ ok?: boolean; text: string }>]> = [
      ['veille', () => w.v.ctx('fermeur').call('garmr', 'fermer_port', { port: 4444, proto: 'tcp' }, 'veille')],
      ['automatisation → étape interne', () => w.v.act('fermeur_etape', 'ranger', {}, { auto: true })],
      ['action du propriétaire sans grave → réflexe', () => w.v.act('fermeur', 'ranger')],
    ];
    for (const [nom, faire] of cas) {
      const o = await w.v.act('garmr', 'ouvrir_port', { port: 4444, proto: 'tcp' }); assert.notEqual(o.ok, false, o.text);
      const avant = fermes(), r = await faire();
      assert.notEqual(r.ok, false, `${nom} : ${r.text}`);
      assert.equal(fermes(), avant + 1, `${nom} : la règle du pare-feu est retirée`);
    }
    assert.ok(!w.v.alerts({ module: 'garmr' }).some((a) => /sans ta validation/.test(a.title)), 'aucune alerte « refusé sans ta validation » pour une fermeture');
    // L'ouverture, elle, reste refusée au réflexe.
    assert.equal((await w.v.ctx('fermeur').call('garmr', 'ouvrir_port', { port: 4445 }, 'veille')).ok, false);
  } finally { w.fin(); }
});

// ---------------- 2. La liste : chaque action qui ouvre, expose ou change le système
/** [appli, action, entrée qui ouvre, ce que la validation doit dire, entrée qui ferme (pas de validation) ?] */
const LISTE: Array<[string, string, Record<string, unknown>, RegExp[], Record<string, unknown>?]> = [
  ['valgrind', 'demarrer', { http: 8080, https: 8443 }, [/8080/, /8443/, /pare-feu/]],
  ['valgrind', 'ajouter', { domaines: 'photos.exemple.fr', cible: '192.168.1.20:8080' }, [/photos\.exemple\.fr/, /192\.168\.1\.20:8080/, /Internet/]],
  ['valgrind', 'activer', { domaine: 'photos.exemple.fr', actif: true }, [/photos\.exemple\.fr/], { domaine: 'photos.exemple.fr', actif: false }],
  ['valgrind', 'flux', { port: 25565, cible: '192.168.1.30:25565' }, [/25565/, /192\.168\.1\.30/]],
  ['valgrind', 'acces', { domaine: 'photos.exemple.fr', autoriser: '' }, [/photos\.exemple\.fr/, /tout le monde/], { domaine: 'photos.exemple.fr', autoriser: '192.168.1.0/24', refuser: '192.168.1.66' }],
  ['valgrind', 'proteger', { domaine: 'photos.exemple.fr', retirer: true }, [/photos\.exemple\.fr/, /mot de passe/], { domaine: 'photos.exemple.fr', utilisateur: 'ines' }],
  ['valgrind', 'connexion_unique', { domaine: 'photos.exemple.fr', actif: false }, [/photos\.exemple\.fr/, /sans connexion/], { domaine: 'photos.exemple.fr', actif: true }],
  ['bru', 'demarrer', {}, [/Internet/]],
  ['bru', 'publier_odin', { domaine: 'odin.exemple.fr' }, [/odin\.exemple\.fr/, /Internet/]],
  ['bru', 'publier', { domaine: 'nas.exemple.fr', cible: 'http://192.168.1.10:8080' }, [/nas\.exemple\.fr/, /192\.168\.1\.10:8080/, /Internet/]],
  ['gjoll', 'ouvrir_port', {}, [/51820\/udp/, /box/, /Internet/]],
  ['gjoll', 'activer', { nom: 'Téléphone de Noam', actif: true }, [/Téléphone de Noam/], { nom: 'Téléphone de Noam', actif: false }],
  ['gjoll', 'reseaux', { reseaux: '192.168.1.0/24' }, [/192\.168\.1\.0\/24/], { reseaux: '', dns: '192.168.1.1' }],
  ['gjoll', 'allumer', {}, [/51820\/udp/, /pare-feu/]],
  ['vidarr', 'demarrer', { port: 53 }, [/53/, /pare-feu/]],
  ['skidbladnir', 'publier', { fichiers: 'fichiers.exemple.fr', partage: 'partage.exemple.fr' }, [/fichiers\.exemple\.fr/, /partage\.exemple\.fr/, /Internet/]],
  ['skidbladnir', 'lien', { espace: 'Famille', chemin: 'vacances', jours: 7 }, [/Famille/, /vacances/, /7 jour/]],
  ['skidbladnir', 'mot_de_passe_appli', { login: 'ines', nom: 'PC du bureau' }, [/ines/, /PC du bureau/]],
  ['vordr', 'page_publique', { active: true }, [/publique/], { active: false }],
  ['thjalfi', 'allumer', {}, [/réseau/]],
  ['appareils', 'appairer', {}, [/60 s/]],
  ['garmr', 'debannir', { ip: '203.0.113.9' }, [/203\.0\.113\.9/]],
  ['garmr', 'proteger', { ip: '203.0.113.9' }, [/203\.0\.113\.9/, /jamais/]],
  ['gladsheim', 'cle_tablette', { nom: 'Tablette entrée', droits: 'complet' }, [/Tablette entrée/, /comme toi/]],
  ['gladsheim', 'membre', { nom: 'Noam' }, [/Noam/, /position/]],
  ['gladsheim', 'home_assistant', { adresse: 'https://ha.exemple.fr:8123', odin: 'https://odin.exemple.fr' }, [/ha\.exemple\.fr/]],
];
/** Un site du proxy, réservé à la maison, pour les actions qui le changent. */
const unSite = (v: Valhalla) => v.ctx('valgrind').saveSettings({ hosts: [{ id: 'h1', domains: ['photos.exemple.fr'], target: 'http://192.168.1.20:8080', enabled: false, tls: 'auto', allow: ['192.168.1.0/24'], auth: { ines: 'x' }, sso: true }] });

test('Chaque action qui ouvre, expose ou change le système montre ce qui change ; la même qui ferme n\'en demande pas', () => {
  const w = monde();
  try {
    unSite(w.v);
    for (const [m, a, entree, dit, ferme] of LISTE) {
      const f = w.v.action(m, a); assert.ok(f, `${m}.${a} existe`);
      const g = f.a.grave?.(entree, w.v.ctx(m)) ?? '';
      for (const x of dit) assert.match(g, x, `${m}.${a} : la validation dit ${x} (elle dit : « ${g} »)`);
      if (ferme) assert.equal(f.a.grave!(ferme, w.v.ctx(m)), undefined, `${m}.${a} : fermer, couper, restreindre reste sans validation`);
    }
  } finally { w.fin(); }
});

test('Chaque action de la liste : une automatisation est refusée, rien n\'est lancé', async () => {
  const w = monde();
  try {
    unSite(w.v);
    for (const [m, a, entree] of LISTE) {
      const avant = w.ran.length, r = await w.v.act(m, a, entree, { auto: true });
      assert.equal(r.ok, false, `${m}.${a} par une automatisation : ${r.text}`);
      assert.match(r.text, /action grave/);
      assert.equal(w.ran.length, avant, `${m}.${a} : aucune commande lancée`);
    }
  } finally { w.fin(); }
});

/** Un juge qui dit : demandé clairement par le propriétaire, rien de risqué. */
const juge: Judge = async (_s, questions) => {
  const r: Answers = {};
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === 'noul') r[name] = { type: 'noul', noul: name === 'requested' ? 0.97 : 0.05 };
    else if (q.type === 'choice') { const top = Object.keys(q.criteria)[0]; r[name] = { type: 'choice', choice: top, probabilities: { [top]: 0.9 } }; }
  }
  return r;
};

test('Chaque action de la liste, demandée au chat : le propriétaire reçoit la demande de validation, et rien ne part sans sa réponse', async () => {
  const w = monde();
  try {
    unSite(w.v);
    for (const [m, a, entree] of LISTE) {
      const o = makeOdin([call('valhalla', { action: 'action', appli: m, quoi: a, entree: JSON.stringify(entree) }), { text: 'Voilà.' }], { judge: juge });
      try {
        const avant = w.ran.length;
        await o.agent.run(`Lance ${a} sur ${m}`, { sessionId: 'web:principal', channel: 'web' });
        assert.equal(o.approvals.length, 1, `${m}.${a} : une demande de validation`);
        assert.equal(o.approvals[0].severity, 'grave', `${m}.${a}`);
        assert.deepEqual(w.ran.slice(avant).filter((c) => !/command -v|ufw status/.test(c)), [], `${m}.${a} : rien n'est lancé sans réponse`);
      } finally { o.cleanup(); }
    }
  } finally { w.fin(); }
});
