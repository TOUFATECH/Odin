// Partage de la page d'une appli : lien privé ou public vers une copie figée, en lecture seule, sans script.
// Sur un vrai Odin (serveur web, applis, Persona) : création, accord pour un lien public, ouverture sans compte (public)
// et avec (privé : toi, une personne invitée, une personne pas invitée), un seul onglet, nombre d'ouvertures, retrait,
// expiration (horloge des applis avancée), applis sensibles refusées, secrets masqués, débit limité, aucun script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { isSecretFile } from '../src/heimdall/policy.ts';
import { refusDe, type PageExport } from '../src/valhalla/export/page.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { JETON, Partages } from '../src/valhalla/partage.ts';
import { DEBIT } from '../src/web/partage-api.ts';

/** Le texte d'une page HTML, entités remises en caractères. */
const lisible = (t: string) => t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const PAGE: PageExport = { odin: 1, at: new Date(2026, 10, 14).toISOString(), app: { id: 'eir', name: 'Hygie', family: 'Machines', what: 'x' }, kpis: [], sections: [{ kind: 'text', title: 'T', text: 't' }], retire: [], masques: 0 };

test('le magasin des partages : adresse secrète longue, seule son empreinte sur le disque, fin, retrait (pur)', (t) => {
  const tt = new T(); t.after(() => tt.end());
  const dir = tt.tmp('partages-'); let maintenant = Date.UTC(2026, 10, 14);
  const m = new Partages(dir, () => maintenant);
  const { partage, jeton } = m.creer(PAGE, { type: 'public', fin: maintenant + 7 * 864e5 });
  assert.match(jeton, JETON); assert.equal(Buffer.from(jeton, 'base64url').length, 32, '256 bits tirés au hasard');
  const disque = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  assert.ok(!disque.includes(jeton), 'l\'adresse secrète n\'est pas sur le disque');
  assert.ok(disque.includes(createHash('sha256').update(jeton).digest('hex')), 'seulement son empreinte');
  assert.equal(m.trouver(jeton)?.partage.id, partage.id);
  for (const faux of ['', 'x', jeton.slice(0, -1), `${jeton.slice(0, -1)}${jeton.endsWith('A') ? 'B' : 'A'}`, '../index', randomBytes(32).toString('base64url')]) assert.equal(m.trouver(faux), undefined, `« ${faux} » n'ouvre rien`);
  assert.equal(m.compter(partage.id), 1); assert.equal(m.compter(partage.id), 2); assert.equal(m.liste()[0].ouvertures, 2);
  assert.throws(() => m.creer(PAGE, { type: 'public', fin: maintenant - 1 }), /dans le futur/);
  // La date de fin passée : le lien ne marche plus, la copie est effacée.
  maintenant += 7 * 864e5;
  assert.equal(m.trouver(jeton), undefined); assert.deepEqual(m.liste(), []); assert.deepEqual(readdirSync(dir).filter((f) => f !== 'index.json'), []);
  // Retrait d'un geste.
  const b = m.creer(PAGE, { type: 'prive', fin: maintenant + 864e5, personnes: ['awa', 'awa'] });
  assert.deepEqual(b.partage.personnes, ['awa']);
  assert.equal(m.retirer(b.partage.id), true); assert.equal(m.trouver(b.jeton), undefined); assert.equal(m.retirer(b.partage.id), false);
  // Le dossier des partages est interdit aux outils de fichiers d'Odin.
  assert.equal(isSecretFile('/home/x/.odin/valhalla/partages/index.json'), true);
});

test('un vrai Odin : liens public et privé, accord, invités, onglet, ouvertures, retrait, fin, applis sensibles, débit, sans script', { timeout: 240_000 }, async () => {
  const tt = new T();
  try {
    const v = await vraiOdin(tt, { compte: true }), va = valhallaOf()!;
    // L'horloge des applis (celle des partages) : les essais l'avancent.
    let decalage = 0; (va as unknown as { deps: { now?: () => Date } }).deps.now = () => new Date(Date.now() + decalage);
    const S = { cookie: v.session };
    const poster = async (chemin: string, corps: Record<string, unknown>, h: Record<string, string> = {}) => (await v.json(chemin, corps, h)).body as Record<string, unknown> & { ok?: boolean; error?: string; text?: string };
    const creer = (corps: Record<string, unknown>) => poster('/api/valhalla/partage', corps) as Promise<{ ok?: boolean; error?: string; confirm?: string; refus?: boolean; lien?: string; chemin?: string; text?: string; partage?: { id: string; ouvertures: number; fin: number; onglet: string | null }; notes?: string[] }>;
    const ouvrir = (chemin: string, h: Record<string, string> = {}) => fetch(`${v.url}${chemin}`, { headers: h, redirect: 'manual' });
    const SECRET = 'Mdp-du-coffre-4821!'; v.o.redactor.add(SECRET);
    va.alert('forseti', { level: 'haute', title: `Sauvegarde refusée : mot de passe ${SECRET} rejeté`, detail: SECRET, key: 'essai-partage' });

    // Sans connexion : rien. Sans l'en-tête de la page d'Odin : refusé.
    assert.equal((await fetch(`${v.url}/api/valhalla/partage?id=eir`)).status, 401);
    assert.equal((await fetch(`${v.url}/api/valhalla/partages`)).status, 401);
    assert.equal((await fetch(`${v.url}/api/valhalla/partage`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ id: 'eir', type: 'prive' }) })).status, 401);
    assert.equal((await fetch(`${v.url}/api/valhalla/partage`, { method: 'POST', headers: { ...S, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'eir', type: 'prive' }) })).status, 403);

    // Ce que la page peut proposer pour une appli.
    const info = (await v.json('/api/valhalla/partage?id=eir')).body as { ok: boolean; name: string; export: { permis: boolean; formats: Array<{ id: string; permis: boolean }> }; partage: { permis: boolean; jours: { defaut: number; max: number }; portee: string; note: string; invites: { personnes: unknown[]; note: string } }; partages: unknown[] };
    assert.equal(info.ok, true); assert.equal(info.name, 'Hygie'); assert.equal(info.export.permis, true);
    assert.deepEqual(info.export.formats.map((f) => [f.id, f.permis]), [['docx', true], ['pdf', true], ['md', true], ['json', true], ['gdoc', false]]);
    assert.equal(info.partage.permis, true); assert.deepEqual(info.partage.jours, { defaut: 7, max: 90 }); assert.equal(info.partage.portee, 'machine', 'Odin n\'accepte que cette machine dans cet essai');
    assert.match(info.partage.invites.note, /Personne n'a encore de compte dans Persona/); assert.deepEqual(info.partages, []);

    // Les applis sensibles : ni export ni partage, avec la raison.
    for (const id of ['brisingamen', 'var', 'skidbladnir', 'gladsheim']) {
      const x = (await v.json(`/api/valhalla/partage?id=${id}`)).body as { export: { permis: boolean; raison: string }; partage: { permis: boolean; raison: string } };
      assert.equal(x.partage.permis, false); assert.equal(x.export.permis, false); assert.equal(x.partage.raison, refusDe(va.module(id)!));
      for (const type of ['public', 'prive']) { const r = await creer({ id, type, confirm: true }); assert.equal(r.ok, false); assert.equal(r.refus, true); assert.equal(r.error, refusDe(va.module(id)!)); }
    }
    assert.deepEqual((await v.json('/api/valhalla/partages')).body.partages, [], 'rien n\'a été créé');

    // Demandes mal faites.
    assert.match(String((await creer({ id: 'eir' })).error), /Choisis le genre de lien/);
    assert.equal((await creer({ id: 'nexiste', type: 'prive' })).error, 'Appli inconnue.');
    assert.match(String((await creer({ id: 'eir', type: 'prive', jours: 0 })).error), /de 1 à 90 jours/);
    assert.match(String((await creer({ id: 'eir', type: 'prive', jours: 91 })).error), /de 1 à 90 jours/);
    assert.match(String((await creer({ id: 'eir', type: 'prive', fin: '2001-01-01' })).error), /dans le futur/);
    assert.match(String((await creer({ id: 'eir', type: 'prive', fin: 'demain' })).error), /illisible/);
    assert.match(String((await creer({ id: 'ullr', type: 'prive', onglet: 'Nulle part' })).error), /n'a pas d'onglet « Nulle part »/);

    // Lien public : action grave, l'accord est demandé avec la phrase qui dit ce que ça ouvre.
    const accord = await creer({ id: 'forseti', type: 'public' });
    assert.equal(accord.ok, false); assert.match(String(accord.confirm), /^Confirmer : créer un lien public vers la page Forseti \? Toute personne qui a ce lien verra une copie de cette page, sans compte, jusqu'au \d\d\/\d\d\/\d{4} à \d\d:\d\d\.$/);
    assert.deepEqual((await v.json('/api/valhalla/partages')).body.partages, [], 'rien sans accord');
    const pub = await creer({ id: 'forseti', type: 'public', confirm: true });
    assert.equal(pub.ok, true, pub.error); assert.match(String(pub.chemin), /^\/partage\/[A-Za-z0-9_-]{43}$/); assert.equal(pub.lien, `${v.url}${pub.chemin}`);
    assert.match(String(pub.text), /^Lien public créé pour la page Forseti\. Copie-le maintenant : Odin ne le montrera plus\. Il marche jusqu'au /);
    assert.ok(Math.abs(pub.partage!.fin - (Date.now() + 7 * 864e5)) < 60_000, '7 jours par défaut');
    assert.match(String(pub.notes?.[0]), /ne s'ouvre que d'ici/);

    // Ouvert sans compte : la copie, lisible, sans script, sans formulaire, sans bouton, jamais indexée, secret masqué.
    const p1 = await ouvrir(pub.chemin!); assert.equal(p1.status, 200);
    const html = lisible(await p1.text());
    assert.equal(p1.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive, nosnippet'); assert.equal(p1.headers.get('cache-control'), 'no-store');
    assert.equal(p1.headers.get('referrer-policy'), 'no-referrer'); assert.equal(p1.headers.get('x-frame-options'), 'DENY');
    const csp = String(p1.headers.get('content-security-policy'));
    assert.match(csp, /^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; sandbox$/); assert.ok(!/script-src/.test(csp));
    assert.ok(!/<script|<form|<button|<input|<iframe|<img|<a\s|\son[a-z]+=|javascript:/i.test(html), 'ni script, ni formulaire, ni bouton, ni lien');
    assert.match(html, /<meta name="robots" content="noindex/);
    assert.match(html, /Copie de la page Forseti d'Odin, prise le \d\d\/\d\d\/\d{4} à \d\d:\d\d\. Elle ne se met pas à jour\. Ce lien marche jusqu'au/);
    assert.match(html, /Sauvegarde refusée : mot de passe ••• rejeté/); assert.ok(!html.includes(SECRET), 'le secret n\'est pas dans la copie');
    const dossier = join(va.dir, 'partages'), disque = readdirSync(dossier).map((f) => readFileSync(join(dossier, f), 'utf8')).join('\n');
    assert.ok(!disque.includes(SECRET) && !disque.includes(pub.chemin!.slice(9)), 'ni le secret ni l\'adresse sur le disque');
    assert.equal((await fetch(`${v.url}${pub.chemin}`, { method: 'POST' })).status, 405);
    await (await ouvrir(pub.chemin!)).text();
    let liste = (await v.json('/api/valhalla/partages?id=forseti')).body.partages as Array<{ id: string; type: string; ouvertures: number; derniere: number | null; h?: string }>;
    assert.equal(liste.length, 1); assert.equal(liste[0].ouvertures, 2, 'les ouvertures sont comptées'); assert.ok(liste[0].derniere); assert.equal(liste[0].h, undefined, 'l\'empreinte ne sort pas');

    // Lien privé : il faut être connecté. Toi d'abord (pas d'invité : toute personne connectée).
    const priv = await creer({ id: 'eir', type: 'prive', jours: 1 });
    assert.equal(priv.ok, true, priv.error); assert.match(String(priv.text), /pour toute personne connectée à Odin/);
    const anonyme = await ouvrir(priv.chemin!); assert.equal(anonyme.status, 401); const t401 = lisible(await anonyme.text());
    assert.match(t401, /Ce lien est privé/); assert.ok(!t401.includes('Hygie'), 'rien de la page sans connexion'); assert.ok(!/<script/i.test(t401));
    const moi = await ouvrir(priv.chemin!, S); assert.equal(moi.status, 200); const tmoi = lisible(await moi.text()); assert.match(tmoi, /Hygie/); assert.match(tmoi, /Lien privé, réservé aux personnes invitées/);
    // Puis des personnes de Persona : Awa est invitée, Bao non.
    assert.equal((await v.json('/api/valhalla/act', { module: 'var', action: 'ajouter', input: { login: 'awa', nom: 'Awa', groupes: 'famille', mot_de_passe: 'une phrase assez longue' } })).body.ok, true);
    assert.equal((await v.json('/api/valhalla/act', { module: 'var', action: 'ajouter', input: { login: 'bao', nom: 'Bao', groupes: 'amis', mot_de_passe: 'une autre phrase longue' } })).body.ok, true);
    // (leurs sessions, comme après une connexion au portail de Persona : la vérification, elle, est celle de Persona)
    const sessionDe = (login: string) => { const tok = randomBytes(32).toString('base64url'), now = Date.now(); const c = va.ctx('var'); c.saveSettings({ sessions: [...((c.settings.sessions as unknown[]) ?? []), { id: createHash('sha256').update(tok).digest('hex'), login, created: now, expires: now + 3600_000, ip: '127.0.0.1', agent: 'essai', seen: now }] }); return { cookie: `odin_var=${tok}` }; };
    const awa = sessionDe('awa'), bao = sessionDe('bao');
    const info2 = (await v.json('/api/valhalla/partage?id=ullr')).body as { partage: { invites: { personnes: Array<{ login: string; nom: string; groupes: string[] }>; groupes: string[] } } };
    assert.deepEqual(info2.partage.invites.personnes.map((p) => p.login).sort(), ['awa', 'bao']); assert.deepEqual(info2.partage.invites.groupes, ['amis', 'famille']);
    assert.ok(!JSON.stringify(info2).includes('phrase'), 'aucun mot de passe dans la liste des invités');
    assert.match(String((await creer({ id: 'ullr', type: 'prive', personnes: ['inconnu'] })).error), /Inconnu dans Persona : inconnu/);
    const pourAwa = await creer({ id: 'ullr', type: 'prive', personnes: 'awa', onglet: 'règles' });
    assert.equal(pourAwa.ok, true, pourAwa.error); assert.equal(pourAwa.partage!.onglet, 'Règles'); assert.match(String(pourAwa.text), /pour awa\.$/);
    const va1 = await ouvrir(pourAwa.chemin!, awa); assert.equal(va1.status, 200); const tawa = lisible(await va1.text());
    assert.match(tawa, /Asclépios/); assert.match(tawa, /onglet « Règles »/);
    const vueUllr = ((await v.json('/api/valhalla/view?id=ullr')).body.view) as { sections: Array<{ title: string; onglet?: string; kind: string }> };
    for (const s of vueUllr.sections.filter((x) => x.onglet === 'Analyser' && !['form', 'depot', 'actions'].includes(x.kind))) assert.ok(!tawa.includes(`>${s.title}<`), `« ${s.title} » (autre onglet) n'est pas dans la copie`);
    const vb = await ouvrir(pourAwa.chemin!, bao); assert.equal(vb.status, 403); assert.match(lisible(await vb.text()), /pas pour toi/);
    assert.equal((await ouvrir(pourAwa.chemin!)).status, 401);
    // Un groupe invité.
    const pourAmis = await creer({ id: 'eir', type: 'prive', groupes: ['amis'] });
    assert.equal((await ouvrir(pourAmis.chemin!, bao)).status, 200); assert.equal((await ouvrir(pourAmis.chemin!, awa)).status, 403);

    // Retrait : le lien ne marche plus tout de suite.
    let r = await poster('/api/valhalla/partage_retirer', { partage: pourAmis.partage!.id });
    assert.equal(r.ok, true); assert.equal(r.text, 'Partage de Hygie retiré : le lien ne marche plus.');
    const mort = await ouvrir(pourAmis.chemin!, bao); assert.equal(mort.status, 404); assert.match(await mort.text(), /Lien inactif/);
    r = await poster('/api/valhalla/partage_retirer', { partage: pourAmis.partage!.id }); assert.equal(r.ok, false); assert.match(String(r.error), /n'existe plus/);

    // La date de fin : le lien d'un jour s'éteint quand l'horloge avance de deux jours ; celui de 7 jours marche encore.
    decalage = 2 * 864e5;
    assert.equal((await ouvrir(priv.chemin!, S)).status, 404);
    assert.equal((await ouvrir(pub.chemin!)).status, 200);
    liste = (await v.json('/api/valhalla/partages')).body.partages as typeof liste;
    assert.deepEqual(liste.map((p) => p.id).sort(), [pub.partage!.id, pourAwa.partage!.id].sort(), 'le partage arrivé à sa fin n\'est plus listé');
    decalage = 8 * 864e5; // les liens de 7 jours (public, et celui d'Awa) s'éteignent
    assert.equal((await ouvrir(pub.chemin!)).status, 404);
    decalage = 0;

    // Tout retirer.
    const encore = await creer({ id: 'eir', type: 'public', confirm: true, jours: 3 });
    r = await poster('/api/valhalla/partage_retirer', { tout: true });
    assert.equal(r.ok, true); assert.equal(r.retires, 1, "les autres sont arrivés à leur fin"); assert.equal((await ouvrir(encore.chemin!)).status, 404);
    assert.deepEqual((await v.json('/api/valhalla/partages')).body.partages, []);

    // Débit limité : quelqu'un qui essaie des adresses au hasard est arrêté, puis peut revenir plus tard.
    const vrai = await creer({ id: 'eir', type: 'public', confirm: true });
    decalage = 3600_000; // une nouvelle fenêtre pour cette adresse IP
    let refus = 0;
    for (let i = 0; i < DEBIT.fausses + 3; i++) { const x = await ouvrir(`/partage/${randomBytes(32).toString('base64url')}`); await x.text(); if (x.status === 429) { refus++; assert.ok(Number(x.headers.get('retry-after')) > 0); } else assert.equal(x.status, 404); }
    assert.equal(refus, 3);
    const bloque = await ouvrir(vrai.chemin!); assert.equal(bloque.status, 429, 'même la bonne adresse attend'); await bloque.text();
    decalage += DEBIT.fenetre + 1000;
    assert.equal((await ouvrir(vrai.chemin!)).status, 200, 'après la fenêtre, ça repart');
    // Et trop de pages, même vraies.
    decalage += DEBIT.fenetre + 1000;
    let n = 0; for (; n < DEBIT.pages + 5; n++) { const x = await ouvrir(vrai.chemin!); await x.text(); if (x.status === 429) break; }
    assert.equal(n, DEBIT.pages);
  } finally { await tt.end(); }
});
