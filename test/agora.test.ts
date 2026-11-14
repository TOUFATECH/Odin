// Agora, le store d'Odin, pour de vrai : un vrai Odin (serveur web, applis, Persona, connexion unique), la vraie
// bibliothèque cliente de la connexion unique (clients/odin-sso.mjs), de vrais échanges HTTP et un vrai flux SSE.
// Seul le coffre du système est remplacé (pas de Secret Service sur la machine d'essai).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { relierProprietaire } from '../src/valhalla/sso/etat.ts';
import { depotDe, compareVersions } from '../src/valhalla/agora/store.ts';
// @ts-expect-error bibliothèque JavaScript sans types (copiée telle quelle dans les applis)
import { OdinSSO } from '../clients/odin-sso.mjs';

const MDP_SAMI = 'manguier-bleu-sous-le-lagon-12';
const IDS = ['var', 'brisingamen', 'agora', 'ullr', 'forseti', 'frigg', 'gladsheim', 'pegase'];
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const fauxCoffre = () => { const m = new Map<string, string>(); return { m, disponible: async () => true, ranger: async (n: string, s: string) => { m.set(n, s); }, lire: async (n: string) => m.get(n), effacer: async (n: string) => { m.delete(n); } }; };
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
const attendre = async (f: () => unknown, ms = 5000) => { const fin = Date.now() + ms; for (;;) { const x = await f(); if (x) return x; if (Date.now() > fin) return undefined; await new Promise((r) => setTimeout(r, 25)); } };

/** Un flux SSE ouvert avec un jeton : les événements reçus, avec l'heure d'arrivée. */
async function flux(v: VraiOdin, jeton: string) {
  const ac = new AbortController(), evs: Array<{ type: string; data: Record<string, unknown>; t: number }> = [];
  const r = await fetch(`${v.url}/api/agora/flux`, { headers: { authorization: `Bearer ${jeton}` }, signal: ac.signal });
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type') ?? '', /text\/event-stream/);
  const lecteur = r.body!.getReader(), dec = new TextDecoder(); let tampon = '';
  void (async () => { try { for (;;) { const { value, done } = await lecteur.read(); if (done) return; tampon += dec.decode(value, { stream: true }); let k; while ((k = tampon.indexOf('\n\n')) >= 0) { const bloc = tampon.slice(0, k); tampon = tampon.slice(k + 2); const type = /^event: (.+)$/m.exec(bloc)?.[1], data = /^data: (.+)$/m.exec(bloc)?.[1]; if (type && data) evs.push({ type, data: JSON.parse(data), t: Date.now() }); } } } catch { /* fermé */ } })();
  return { evs, fermer: () => ac.abort() };
}

test('Agora, le store d\'Odin, pour de vrai', { timeout: 180_000 }, async (t) => {
  const tt = new T(), logs: string[] = [], orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) }), va = valhallaOf()!;
    relierProprietaire(va.ctx('var'));
    assert.equal((await va.act('var', 'ajouter', { login: 'sami', nom: 'Sami', groupes: 'invite', email: 'sami@exemple.yt', mot_de_passe: MDP_SAMI })).ok, true);
    const ag = va.ctx('agora'), d = depotDe(ag.dir), dir = tt.tmp('agora-essai-');
    // Une petite AppImage d'essai (le contenu ne compte pas pour Odin : il le range, l'analyse et calcule son empreinte).
    const appimage = join(dir, 'bloc-notes-1.0.0.AppImage'), contenu = '#!/bin/sh\necho "Bloc-notes d\'essai"\n'; writeFileSync(appimage, contenu, { mode: 0o755 });
    const sha = createHash('sha256').update(contenu).digest('hex');
    let sso: InstanceType<typeof OdinSSO>, jeton = '';
    const api = async (chemin: string, corps?: unknown, tok = jeton) => { const r = await fetch(`${v.url}/api/agora/${chemin}`, { method: corps === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${tok}`, ...(corps === undefined ? {} : { 'content-type': 'application/json' }) }, body: corps === undefined ? undefined : JSON.stringify(corps) }); return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, any> }; };
    const store = async () => ((await api('store')).body.store as Array<{ id: string; mode: string; paquet?: { sha256: string; telecharger: string }; web?: string }>);

    await t.test('catalogue : Pégase et Vénus préinscrits, une AppImage ajoutée (empreinte, Asclépios), une appli d\'Odin (web)', async () => {
      assert.deepEqual(d.elements.map((e) => e.id), ['pegase', 'venus']);
      const r = await va.act('agora', 'ajouter', { nom: 'Bloc-notes', description: 'Prendre des notes', fichier: appimage });
      assert.equal(r.ok, true, r.text); assert.match(r.text, /Bloc-notes 1\.0\.0 \(Linux, AppImage/); assert.match(r.text, /rien de connu \(Asclépios\)/);
      const e = d.element('bloc-notes')!; assert.equal(e.paquets[0].sha256, sha); assert.equal(e.droit, 'agora-bloc-notes');
      assert.equal((await va.act('agora', 'ajouter', { appli_odin: 'Chronos' })).ok, true); assert.equal(d.element('chronos')?.web, 'frigg');
      // Empreinte donnée fausse, virus (fichier d'essai des antivirus) : refusés.
      const x = await va.act('agora', 'ajouter', { nom: 'Bloc-notes', fichier: appimage, empreinte: 'a'.repeat(64) }); assert.equal(x.ok, false); assert.match(x.text, /empreinte donnée ne correspond pas/);
      const virus = join(dir, 'piege-2.0.exe'); writeFileSync(virus, EICAR);
      const y = await va.act('agora', 'ajouter', { nom: 'Piège', fichier: virus }); assert.equal(y.ok, false); assert.match(y.text, /bloqué par Asclépios/); assert.ok(!d.element('piege'));
      assert.ok(va.alerts({ module: 'agora' }).some((a) => /installateur refusé/.test(a.title)));
      assert.equal(compareVersions('1.2.10', '1.2.9'), 1); assert.equal(compareVersions('v1.0', '1.0.0'), 0);
    });

    await t.test('inscription par la connexion unique (audience « agora ») ; sans groupe, rien dans le store', async () => {
      sso = new OdinSSO({ adresse: v.url, appli: 'agora', appareil: { id: 'pc-salon-essai-01', nom: 'PC-SALON', plateforme: 'linux' }, coffre: fauxCoffre() });
      const c = await sso.connecter({ identifiant: 'sami', motdepasse: MDP_SAMI, poste: false }); assert.equal(c.ok, true, c.message);
      jeton = await sso.jeton();
      assert.equal((await api('store')).status, 404, 'pas encore inscrit');
      const r = await api('inscrire', { nom: 'PC-SALON', plateforme: 'linux', systeme: 'Ubuntu 26.04', version: '0.1.0' }); assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.appareil.nom, 'PC-SALON'); assert.equal(r.body.personne.login, 'sami');
      assert.deepEqual(r.body.store, [], 'invité : rien');
      assert.ok(va.alerts({ module: 'agora' }).some((a) => /nouvel appareil pour Sami/.test(a.title) && a.fix?.action === 'retirer_appareil'), 'alerte « nouvel appareil » dans Forseti');
      // Un jeton d'une autre appli ne sert pas ici.
      const autre = new OdinSSO({ adresse: v.url, appli: 'pegase', appareil: { id: 'pc-salon-essai-01', nom: 'PC-SALON', plateforme: 'linux' }, coffre: fauxCoffre() });
      assert.equal((await autre.connecter({ identifiant: 'sami', motdepasse: MDP_SAMI, poste: false })).ok, true);
      assert.equal((await api('store', undefined, await autre.jeton())).status, 403);
      assert.equal((await api('store', undefined, 'faux')).status, 401);
    });

    await t.test('mettre Sami dans le groupe famille : l\'élément apparaît dans son store (API) et dans son espace Odin', async () => {
      assert.equal((await va.act('agora', 'definir_mode', { element: 'bloc-notes', groupe: 'famille', mode: 'Proposée' })).ok, true);
      assert.equal((await va.act('agora', 'definir_mode', { element: 'chronos', groupe: 'famille', mode: 'Proposée' })).ok, true);
      const droits = va.ctx('var').settings.ssoDroits as Record<string, string[]>;
      assert.ok(droits['agora-bloc-notes'].includes('famille') && droits.frigg.includes('famille'), 'le droit est celui de la connexion unique (ssoDroits)');
      assert.equal((await va.act('agora', 'ajouter_personne', { login: 'sami', groupe: 'famille' })).ok, true);
      const l = await store(), bn = l.find((x) => x.id === 'bloc-notes');
      assert.equal(bn?.mode, 'proposee'); assert.equal(bn?.paquet?.sha256, sha); assert.equal(l.find((x) => x.id === 'chronos')?.web, 'frigg');
      // Téléchargement : l'empreinte part avec le fichier.
      const tl = await fetch(v.url + bn!.paquet!.telecharger, { headers: { authorization: `Bearer ${jeton}` } });
      assert.equal(tl.status, 200); assert.equal(tl.headers.get('x-odin-empreinte'), sha); assert.equal(createHash('sha256').update(Buffer.from(await tl.arrayBuffer())).digest('hex'), sha);
      // L'espace Odin de Sami (connexion par Persona) : Chronos y est.
      let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' });
      const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
      r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: 'sami', motdepasse: MDP_SAMI }) });
      r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); const membre = cookieDe(r, 'odin_session'); assert.ok(membre);
      const ids = ((await v.json('/api/valhalla/catalog', undefined, { cookie: membre })).body as { modules: Array<{ id: string }> }).modules.map((x) => x.id);
      assert.ok(ids.includes('frigg'), 'Chronos dans son espace'); assert.ok(ids.includes('agora'), 'et son store');
      // Un membre n'ouvre pas les pages d'admin d'Agora : il voit SON store, et les actions d'admin sont refusées.
      const vue = ((await v.json('/api/valhalla/view?id=agora', undefined, { cookie: membre })).body as { view: { onglets?: string[]; sections: Array<{ title: string }> } }).view;
      assert.equal(vue.onglets, undefined); assert.deepEqual(vue.sections.map((x) => x.title), ['Mon store', 'Mes appareils']);
      const act = await v.json('/api/valhalla/act', { module: 'agora', action: 'definir_mode', input: { element: 'bloc-notes', groupe: 'invite', mode: 'Proposée' }, confirm: true }, { cookie: membre });
      assert.equal((act.body as { ok: boolean }).ok, false); assert.match(String((act.body as { text: string }).text), /réservée aux admins/);
      const forcer = await v.json('/api/valhalla/act', { module: 'agora', action: 'forcer', input: { appareil: 'pc-salon-essai-01', element: 'bloc-notes' }, confirm: true }, { cookie: membre });
      assert.equal((forcer.body as { ok: boolean }).ok, false);
      // Le propriétaire voit les quatre onglets.
      const adm = ((await v.json('/api/valhalla/view?id=agora')).body as { view: { onglets: string[] } }).view;
      assert.deepEqual(adm.onglets, ['Catalogue', 'Groupes', 'Appareils', 'Journal']);
    });

    await t.test('« installée d\'office » : l\'ordre arrive par le flux en moins d\'une seconde ; compte rendu → fait', async () => {
      const f = await flux(v, jeton); tt.onEnd(f.fermer);
      assert.ok(await attendre(() => f.evs.some((e) => e.type === 'bonjour')));
      const t0 = Date.now();
      assert.equal((await va.act('agora', 'definir_mode', { element: 'bloc-notes', groupe: 'famille', mode: 'Installée d\'office' })).ok, true);
      const o = await attendre(() => f.evs.find((e) => e.type === 'ordre' && e.data.action === 'installer'), 2000) as { data: Record<string, unknown>; t: number } | undefined;
      assert.ok(o, 'ordre reçu'); const ms = o!.t - t0; assert.ok(ms < 1000, `reçu en ${ms} ms`); tt.note?.(`ordre reçu en ${ms} ms`);
      assert.equal(o!.data.element, 'bloc-notes'); assert.equal(o!.data.version, '1.0.0'); assert.equal(o!.data.impose, true);
      assert.ok(d.enLigne.has('pc-salon-essai-01'));
      assert.equal((await api('etat', { element: 'bloc-notes', etat: 'installation', progression: 62, ordre: o!.data.id })).status, 200);
      assert.equal(d.ordres.find((x) => x.id === o!.data.id)?.progression, 62);
      assert.equal((await api('etat', { element: 'bloc-notes', etat: 'installee', version: '1.0.0', ordre: o!.data.id })).status, 200);
      assert.equal(d.ordres.find((x) => x.id === o!.data.id)?.etat, 'fait');
      assert.equal((await store()).find((x) => x.id === 'bloc-notes')?.mode, 'office');
      f.fermer();
    });

    await t.test('l\'enlever du groupe (dans Persona) : ordre de désinstallation ; disparaît de son espace Odin', async () => {
      const f = await flux(v, jeton); tt.onEnd(f.fermer);
      assert.ok(await attendre(() => f.evs.some((e) => e.type === 'bonjour')));
      assert.equal((await va.act('var', 'modifier', { login: 'sami', groupes: 'invite' })).ok, true); // directement dans Persona
      const o = await attendre(() => f.evs.find((e) => e.type === 'ordre' && e.data.action === 'desinstaller'), 3000) as { data: Record<string, unknown> } | undefined;
      assert.ok(o, 'ordre de désinstallation reçu'); assert.equal(o!.data.element, 'bloc-notes');
      assert.equal((await api('etat', { element: 'bloc-notes', etat: 'absente', ordre: o!.data.id })).status, 200);
      assert.equal(d.ordres.find((x) => x.id === o!.data.id)?.etat, 'fait');
      assert.deepEqual(await store(), []);
      // Sans droit, plus de téléchargement.
      assert.equal((await api('telecharger?element=bloc-notes&plateforme=linux')).status, 403);
      f.fermer();
    });

    await t.test('forcer sur un appareil : accord demandé, puis ordre et journal ; échec → alerte dans Forseti', async () => {
      const f = await flux(v, jeton); tt.onEnd(f.fermer);
      assert.ok(await attendre(() => f.evs.some((e) => e.type === 'bonjour')));
      const sans = await v.json('/api/valhalla/act', { module: 'agora', action: 'forcer', input: { appareil: 'pc-salon-essai-01', element: 'bloc-notes', sens: 'installer' } });
      assert.equal((sans.body as { ok: boolean }).ok, false); assert.match(String((sans.body as { confirm: string }).confirm), /installer « bloc-notes » sur l'appareil « PC-SALON » sans demander/);
      assert.ok(!d.journal.some((l) => /FORCÉ/.test(l.quoi)), 'rien fait sans accord');
      const avec = await v.json('/api/valhalla/act', { module: 'agora', action: 'forcer', input: { appareil: 'pc-salon-essai-01', element: 'bloc-notes', sens: 'installer' }, confirm: true });
      assert.equal((avec.body as { ok: boolean }).ok, true, JSON.stringify(avec.body));
      assert.ok(d.journal.some((l) => l.grave && /FORCÉ : installation de Bloc-notes sur PC-SALON \(Sami\)/.test(l.quoi)), 'noté au journal');
      const o = await attendre(() => f.evs.find((e) => e.type === 'ordre' && e.data.par === 'force'), 2000) as { data: Record<string, unknown> } | undefined;
      assert.ok(o); assert.equal(o!.data.action, 'installer');
      // Un membre sans droit peut télécharger ce qui est forcé sur SON appareil.
      assert.equal((await api('telecharger?element=bloc-notes&plateforme=linux')).status, 200);
      // L'appareil dit que l'installation a échoué (ex. empreinte fausse) : alerte « installation échouée ».
      assert.equal((await api('etat', { element: 'bloc-notes', etat: 'erreur', erreur: 'Empreinte différente : installation refusée', ordre: o!.data.id })).status, 200);
      assert.equal(d.ordres.find((x) => x.id === o!.data.id)?.etat, 'echec');
      const al = va.alerts({ module: 'agora' }).find((a) => /installation de Bloc-notes échouée sur PC-SALON/.test(a.title));
      assert.ok(al, 'alerte dans le fil commun'); assert.equal(al!.fix?.action, 'reessayer'); assert.match(al!.detail ?? '', /Empreinte différente/);
      // Annuler le forçage : l'ordre en cours est annulé, l'appareil le sait.
      assert.equal((await va.act('agora', 'annuler_force', { appareil: 'PC-SALON', element: 'bloc-notes' })).ok, true);
      assert.ok(!depotDe(ag.dir).appareil('pc-salon-essai-01')!.forces['bloc-notes']);
      f.fermer();
    });

    await t.test('appareil inconnu : refusé et alerte ; la page d\'admin montre tout', async () => {
      const intrus = new OdinSSO({ adresse: v.url, appli: 'agora', appareil: { id: 'appareil-pas-inscrit-77', nom: 'Inconnu', plateforme: 'windows' }, coffre: fauxCoffre() });
      assert.equal((await intrus.connecter({ identifiant: 'sami', motdepasse: MDP_SAMI, poste: false })).ok, true);
      const r = await api('flux', undefined, await intrus.jeton()); assert.equal(r.status, 404); assert.equal(r.body.code, 'appareil_inconnu');
      assert.ok(va.alerts({ module: 'agora' }).some((a) => a.title === 'Agora : appareil inconnu'));
      const vue = ((await v.json('/api/valhalla/view?id=agora')).body as { view: { sections: Array<{ title: string; kind: string; rows?: Array<{ cells: string[] }>; lines?: string[] }>; kpis: Array<{ label: string; value: string }> } }).view;
      const ap = vue.sections.find((x) => x.title === 'Appareils')!; assert.equal(ap.rows![0].cells[0], 'PC-SALON'); assert.equal(ap.rows![0].cells[1], 'Sami');
      assert.ok(vue.sections.find((x) => x.title === 'Dans le store')!.rows!.some((x) => x.cells[0].startsWith('Bloc-notes')));
      assert.ok(vue.sections.some((x) => x.title.startsWith('Groupe famille')));
      assert.ok(vue.sections.find((x) => x.kind === 'log')!.lines!.some((l) => /Bloc-notes · groupe famille : installée d'office/.test(l)));
    });

    await t.test('phrases sans IA (Logos) : vers Agora, et pas les phrases banales', async () => {
      const r = await va.order('montre le catalogue du store');
      assert.equal(r.understood && 'module' in r.understood ? r.understood.module : '', 'agora', r.text); assert.match(r.text, /Bloc-notes/);
      const m = await va.order('mon store'); assert.equal(m.understood && 'module' in m.understood ? m.understood.module : '', 'agora');
      for (const banal of ['je vais au marché acheter des mangues', 'installe le chauffe-eau demain', 'ajoute du lait à la liste de courses']) {
        const x = await va.order(banal); assert.notEqual(x.understood && 'module' in x.understood ? x.understood.module : '', 'agora', banal);
      }
    });
  } finally { Object.assign(console, orig); await tt.end(); }
});
