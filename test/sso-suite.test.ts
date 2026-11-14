// Connexion unique plus solide et plusieurs serveurs Vénus sur le même compte, pour de vrai : un vrai Odin (serveur web +
// applis), la vraie bibliothèque cliente (clients/odin-sso.mjs), de vrais échanges HTTP.
// - tolérance de 60 s au renouvellement : une réponse perdue en route (relais TCP qui la jette) → l'appli continue avec
//   le même couple ; le même ancien jeton 61 s plus tard (vraie attente) → session coupée + alerte ;
// - sauvegardes de plusieurs appareils : flux en direct (event: version), ?depuis, appareil_id, x-odin-etat,
//   empreinte par appareil, conservation par appareil ;
// - fiches Vénus (/api/venus/*) : envoi, flux sans boucle, le plus récent gagne, empreintes, tirer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { aGarderParAppareil, type Version } from '../src/valhalla/sso/sauvegardes.ts';
import { persona, sessionsApplis } from '../src/valhalla/sso/etat.ts';
// @ts-expect-error bibliothèque JavaScript sans types (copiée telle quelle dans Pégase et Vénus)
import { OdinSSO } from '../clients/odin-sso.mjs';

const MDP = 'girafe-orange-sous-la-pluie-42';
const IDS = ['var', 'brisingamen', 'freyja', 'garmr', 'fjalar', 'pegase'];
const fauxCoffre = () => { const m = new Map<string, string>(); return { m, disponible: async () => true, ranger: async (n: string, s: string) => { m.set(n, s); }, lire: async (n: string) => m.get(n), effacer: async (n: string) => { m.delete(n); } }; };
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function odin(tt: T): Promise<VraiOdin> {
  const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) });
  const r = await valhallaOf()!.act('var', 'ajouter', { login: 'moussa', nom: 'Moussa', groupes: 'famille', email: 'moussa@exemple.yt', mot_de_passe: MDP }); assert.equal(r.ok, true, r.text);
  return v;
}

/** Relais TCP devant Odin : `perdre` réponses à POST /sso/jeton sont jetées (Odin a bien traité la demande). */
async function relais(port: number) {
  const o = { perdre: 0, perdues: 0, port: 0, close: async () => undefined as unknown };
  const socks = new Set<net.Socket>();
  const srv = net.createServer((c) => {
    const up = net.connect(port, '127.0.0.1'); socks.add(c); socks.add(up);
    let debut = '', jeter = false;
    c.on('data', (d) => { if (debut.length < 64) { debut += d.toString('latin1'); if (/^POST \/sso\/jeton /.test(debut) && o.perdre > 0) { o.perdre--; jeter = true; } } up.write(d); });
    up.on('data', (d) => { if (jeter) { o.perdues++; c.destroy(); up.destroy(); return; } c.write(d); });
    const fin = () => { c.destroy(); up.destroy(); socks.delete(c); socks.delete(up); };
    c.on('error', fin); up.on('error', fin); c.on('close', fin); up.on('close', fin);
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  o.port = (srv.address() as net.AddressInfo).port;
  o.close = () => new Promise((r) => { for (const s of socks) s.destroy(); srv.close(() => r(undefined)); });
  return o;
}

/** Lit un flux SSE : `evenements` se remplit au fil de l'eau ; `fermer()` l'arrête. */
function sse(url: string, jeton: string) {
  const ctl = new AbortController(), evenements: Array<{ event: string; data: Record<string, unknown>; t: number }> = [];
  const pret = (async () => {
    const r = await fetch(url, { headers: { authorization: `Bearer ${jeton}` }, signal: ctl.signal });
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type') ?? '', /text\/event-stream/);
    const lecteur = r.body!.getReader(), dec = new TextDecoder(); let buf = '';
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await lecteur.read(); if (done) return;
          buf += dec.decode(value, { stream: true });
          let i; while ((i = buf.indexOf('\n\n')) >= 0) {
            const bloc = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = /^event: (.+)$/m.exec(bloc)?.[1], data = /^data: (.+)$/m.exec(bloc)?.[1];
            if (ev && data) evenements.push({ event: ev, data: JSON.parse(data) as Record<string, unknown>, t: Date.now() });
          }
        }
      } catch { /* fermé */ }
    })();
  })();
  return { evenements, pret, fermer: () => ctl.abort() };
}
const jusqua = async (f: () => boolean, ms = 5000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (f()) return true; await attendre(20); } return f(); };

test('conservation des sauvegardes par appareil : un poste n\'efface jamais la série d\'un autre', () => {
  const H = 3600_000, now = Date.UTC(2026, 10, 14, 12);
  const v = (id: string, h: number, appareil_id: string, sorte: Version['sorte'] = 'complete', base: string | null = null): Version => ({ id, date: now - h * H, taille: 1, empreinte: id, sorte, raison: '', nom: '', base, appareil: appareil_id, appareil_id });
  // A : une complète vieille de 3 jours et ses changements ; B : 120 versions récentes (plus que les 100 des 48 h).
  const l = [v('a-complete', 72, 'A'), v('a-ch1', 71, 'A', 'changements', 'a-complete'), v('a-ch2', 70, 'A', 'changements', 'a-complete'), ...Array.from({ length: 120 }, (_, i) => v(`b${i}`, i / 10, 'B', i === 119 ? 'complete' : 'changements', 'b119'))];
  const k = aGarderParAppareil(l, now);
  for (const id of ['a-complete', 'a-ch1', 'a-ch2', 'b119']) assert.ok(k.has(id), `${id} gardée`);
});

test('tolérance de 60 s au renouvellement, pour de vrai : réponse perdue → l\'appli continue ; rejeu à 61 s → coupure + alerte', { timeout: 180_000 }, async () => {
  const tt = new T();
  try {
    const v = await odin(tt), va = valhallaOf()!, rl = await relais(v.port);
    tt.onEnd(() => rl.close());
    const adresse = `http://127.0.0.1:${rl.port}`;
    const sso = new OdinSSO({ adresse, appli: 'venus', appareil: { id: 'serveur-venus-tolerance', nom: 'Vénus du salon' }, coffre: fauxCoffre() });
    assert.equal((await sso.connecter({ identifiant: 'moussa', motdepasse: MDP, poste: false })).ok, true);
    const sid = sso.etat.refresh.split('.')[1], session = () => sessionsApplis(persona()!).find((x) => x.id === sid)!;
    // 1) La réponse du renouvellement se perd en route (Odin a fait la rotation, l'appli ne l'a pas reçue).
    rl.perdre = 1; const vieux = sso.etat.refresh;
    const r = await sso.renouveler();
    assert.equal(r.ok, true, r.message); assert.equal(rl.perdues, 1, 'une réponse a bien été jetée');
    assert.notEqual(sso.etat.refresh, vieux);
    assert.equal(session().h, sha(sso.etat.refresh), 'l\'appli a le jeton qu\'Odin attend : pas de seconde branche');
    assert.equal(session().anciens.length, 1, 'une seule rotation');
    const infos = await sso.infos(); assert.equal(infos.ok, true, infos.message); assert.equal(infos.preferred_username, 'moussa');
    assert.equal(session().revoque, undefined, 'la session continue');
    // L'appli continue : renouvellement suivant normal.
    assert.equal((await sso.renouveler()).ok, true); assert.equal(session().anciens.length, 2);
    // Pégase (jetons d'appli du SSO sur /api/pegase/*) : même correction, et son appareil reste le même après la reprise.
    const peg = new OdinSSO({ adresse, appli: 'pegase', appareil: { id: 'pegase-tolerance-x', nom: 'Pégase du salon' }, coffre: fauxCoffre() });
    assert.equal((await peg.connecter({ identifiant: 'moussa', motdepasse: MDP, poste: false })).ok, true);
    const moi = async () => (await fetch(`${v.url}/api/pegase/moi`, { headers: { authorization: `Bearer ${await peg.jeton()}` } })).json() as Promise<{ ok: boolean; appareil: { id: string } }>;
    const avant = await moi(); assert.equal(avant.ok, true);
    rl.perdre = 1; assert.equal((await peg.renouveler()).ok, true); assert.equal(rl.perdues, 2);
    const apres = await moi(); assert.equal(apres.ok, true); assert.equal(apres.appareil.id, avant.appareil.id, 'même appareil Pégase');
    // Les jetons d'appareil de Pégase (« pg1. ») ne tournent pas : rien à perdre en route (même jeton jusqu'à sa révocation).
    // 2) Un ancien jeton présenté 61 s après son remplacement (vraie attente) : vol probable.
    const ancien = sso.etat.refresh; assert.equal((await sso.renouveler()).ok, true);
    const t0 = session().grace!.t;
    await attendre(Math.max(0, t0 + 61_000 - Date.now()));
    const rj = await fetch(`${v.url}/sso/jeton`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: ancien, client_id: 'venus', appareil: 'serveur-venus-tolerance' }) });
    assert.equal(rj.status, 400); assert.match((await rj.json() as Record<string, string>).message, /déjà servi/);
    assert.ok(session().revoque, 'session coupée');
    assert.equal((await sso.infos()).code, 'jeton_invalide');
    const al = va.alerts({ limit: 50 }).find((a) => /Connexion de moussa à Vénus coupée/.test(a.title));
    assert.ok(al, 'alerte dans le fil commun (Forseti)'); assert.match(al!.detail ?? '', /6[1-9] s après son remplacement \(tolérance : 60 s\)/);
  } finally { await tt.end(); }
});

test('plusieurs serveurs Vénus sur le même compte : sauvegardes (flux, depuis, appareil) et fiches synchronisées par Odin', { timeout: 120_000 }, async (t) => {
  const tt = new T();
  try {
    const v = await odin(tt);
    const A = new OdinSSO({ adresse: v.url, appli: 'venus', appareil: { id: 'serveur-venus-a', nom: 'Vénus A' }, coffre: fauxCoffre() });
    const B = new OdinSSO({ adresse: v.url, appli: 'venus', appareil: { id: 'serveur-venus-b', nom: 'Vénus B' }, coffre: fauxCoffre() });
    for (const x of [A, B]) assert.equal((await x.connecter({ identifiant: 'moussa', motdepasse: MDP, poste: false })).ok, true);

    await t.test('sauvegardes : appareil_id, x-odin-etat, ?depuis, empreinte par appareil, flux en direct', async () => {
      const ca = await A.sauvegarder(Buffer.from('base de A v1'), { raison: 'démarrage', etat: 'empreinte-base-a-1' });
      assert.equal(ca.ok, true, ca.message); assert.equal(ca.version.appareil_id, 'serveur-venus-a'); assert.equal(ca.version.etat, 'empreinte-base-a-1');
      const t1 = Date.now();
      await attendre(5);
      const cb = await B.sauvegarder(Buffer.from('base de B v1'), { raison: 'démarrage', etat: 'empreinte-base-b-1' }); assert.equal(cb.ok, true);
      // Même contenu que la dernière de A, mais envoyé par B : rangé (chaque appareil sa série).
      assert.equal((await B.sauvegarder(Buffer.from('base de A v1'))).inchange, false);
      const depuis = await (await fetch(`${v.url}/api/sauvegardes/venus?depuis=${t1}`, { headers: { authorization: `Bearer ${await A.jeton()}` } })).json() as { versions: Version[]; serveur: number };
      assert.deepEqual(depuis.versions.map((x) => x.appareil_id), ['serveur-venus-b', 'serveur-venus-b'], '?depuis : seulement les plus récentes');
      const ea = await (await fetch(`${v.url}/api/sauvegardes/venus/empreinte?appareil=serveur-venus-a`, { headers: { authorization: `Bearer ${await A.jeton()}` } })).json() as Record<string, unknown>;
      assert.equal(ea.version, ca.version.id); assert.equal(ea.etat, 'empreinte-base-a-1'); assert.equal(ea.empreinte, sha('base de A v1'));
      // Flux : B écoute (avec ?depuis=t1 : il reçoit d'abord ce qu'il a manqué), A envoie des changements.
      const f = sse(`${v.url}/api/sauvegardes/venus/flux?depuis=${t1}`, await B.jeton()); tt.onEnd(() => f.fermer()); await f.pret;
      assert.ok(await jusqua(() => f.evenements.filter((e) => e.event === 'version').length === 2), 'les 2 versions manquées d\'abord');
      const t0 = Date.now(), ch = await A.sauvegarder(Buffer.from('changements de A'), { sorte: 'changements', base: ca.version.id, raison: 'favori', etat: 'empreinte-base-a-2' });
      assert.equal(ch.ok, true, ch.message);
      assert.ok(await jusqua(() => f.evenements.some((e) => e.event === 'version' && e.data.id === ch.version.id), 2000), 'reçue en direct');
      const e = f.evenements.find((x) => x.data.id === ch.version.id)!;
      assert.ok(e.t - t0 < 2000, `${e.t - t0} ms`); assert.equal(e.data.appareil_id, 'serveur-venus-a'); assert.equal(e.data.etat, 'empreinte-base-a-2');
      f.fermer();
    });

    await t.test('fiches : un favori de A arrive chez B en direct, jamais renvoyé à A (pas de boucle)', async () => {
      const fa = sse(`${v.url}/api/venus/flux`, await A.jeton()), fb = sse(`${v.url}/api/venus/flux`, await B.jeton());
      tt.onEnd(() => { fa.fermer(); fb.fermer(); }); await Promise.all([fa.pret, fb.pret]);
      assert.ok(await jusqua(() => fb.evenements.some((e) => e.event === 'bonjour')));
      const envoyer = async (x: typeof A, l: unknown[]) => (await fetch(`${v.url}/api/venus/envoyer`, { method: 'POST', headers: { authorization: `Bearer ${await x.jeton()}`, 'content-type': 'application/json' }, body: JSON.stringify({ changements: l }) })).json() as Promise<Record<string, unknown>>;
      const maj = Date.now(), fav = { id: 'a41f0c9e2b:tmdb-movie-603', col: 'favoris', data: { avis: 1 }, maj };
      const t0 = Date.now(), r = await envoyer(A, [fav]); assert.equal(r.appliques, 1);
      assert.ok(await jusqua(() => fb.evenements.some((e) => e.event === 'changements'), 2000), 'chez B en moins de 2 s');
      const recu = (fb.evenements.find((e) => e.event === 'changements')!.data.changements as Array<Record<string, unknown>>)[0];
      assert.equal(recu.id, fav.id); assert.equal(recu.appareil, 'serveur-venus-a', 'l\'appareil est celui du jeton'); console.log(`# favori A → B : ${fb.evenements.find((e) => e.event === 'changements')!.t - t0} ms`);
      await attendre(500); assert.ok(!fa.evenements.some((e) => e.event === 'changements'), 'A ne reçoit pas son propre envoi');
      // Renvoyer la même fiche ne fait rien (et ne repart vers personne).
      assert.equal((await envoyer(A, [fav])).appliques, 0);
      // Conflit : B envoie une version plus ancienne → ignorée, Odin rend la gagnante.
      const vieux = await envoyer(B, [{ ...fav, data: { avis: -1 }, maj: maj - 5000 }]);
      assert.equal(vieux.appliques, 0); assert.deepEqual((vieux.gagnants as Array<Record<string, unknown>>)[0].data, { avis: 1 });
      // Plus récente → elle gagne, et A la reçoit.
      assert.equal((await envoyer(B, [{ ...fav, data: { avis: -1 }, maj: maj + 1000 }])).appliques, 1);
      assert.ok(await jusqua(() => fa.evenements.some((e) => e.event === 'changements'), 2000));
      // Suppression, refus.
      const r2 = await envoyer(A, [{ id: fav.id, col: 'favoris', maj: maj + 2000, suppr: true }, { id: 'x', col: 'inconnue', maj, data: {} }, { id: 'y', col: 'reprises', maj: Date.now() + 3600_000, data: {} }]);
      assert.equal(r2.appliques, 1); assert.deepEqual((r2.refuses as Array<{ raison: string }>).map((x) => x.raison), ['collection inconnue', 'date « maj » dans le futur (horloge du serveur fausse ?)']);
      // Empreintes = celles qu'un serveur calcule de son côté avec les fiches tirées.
      const emp = (await (await fetch(`${v.url}/api/venus/empreintes`, { headers: { authorization: `Bearer ${await B.jeton()}` } })).json() as { empreintes: Record<string, { n: number; hash: string }> }).empreintes;
      const tire = await (await fetch(`${v.url}/api/venus/tirer`, { method: 'POST', headers: { authorization: `Bearer ${await B.jeton()}`, 'content-type': 'application/json' }, body: JSON.stringify({ col: 'favoris' }) })).json() as { changements: Array<{ id: string; maj: number; suppr?: boolean }> };
      assert.equal(tire.changements.length, 1); assert.equal(tire.changements[0].suppr, true);
      assert.deepEqual(emp.favoris, { n: 1, hash: sha(tire.changements.map((x) => `${x.id}:${x.maj}`).sort().join('\n')) });
      assert.equal(emp.reprises.n, 0);
      // Un jeton d'une autre appli est refusé.
      const P = new OdinSSO({ adresse: v.url, appli: 'pegase', appareil: { id: 'pegase-essai-x' }, coffre: fauxCoffre() }); await P.connecter({ identifiant: 'moussa', motdepasse: MDP, poste: false });
      const mauvais = await fetch(`${v.url}/api/venus/empreintes`, { headers: { authorization: `Bearer ${await P.jeton()}` } }); assert.equal(mauvais.status, 403); assert.equal((await mauvais.json() as Record<string, string>).code, 'mauvaise_appli');
      assert.equal((await fetch(`${v.url}/api/venus/empreintes`)).status, 401);
      fa.fermer(); fb.fermer();
    });
  } finally { await tt.end(); }
});
