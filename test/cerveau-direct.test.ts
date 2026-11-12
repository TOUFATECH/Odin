// Cerveau direct : Odin retient une mission (une ou plusieurs actions), relie les façons de la dire, réfléchit
// avec ces liens quand aucune IA ne répond (il propose, tu décides), et range le tout dans le Cerveau,
// rubrique « Quotidien ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call, makeOdin } from './helpers.ts';
import { MANY, needsThinking, pendingProposal, proposeNear, tryDirect, type DirectDeps } from '../src/core/direct.ts';
import { alias, forget, keep, learn, linkWords, loadAcquis, loadLinks, match, meaning, missionOf, nearest, stepsOf, swapOf, used, wordsOf, type Acquis, type Kv, type WordLink } from '../src/learn/acquis.ts';
import { hubNote, missionNote, missions, syncQuotidien, watchQuotidien, type DailyDeps } from '../src/learn/quotidien.ts';
import { TYPES, Vault } from '../src/brain/vault.ts';
import { brainOf } from '../src/tools/brain.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';

const kv = (): Kv & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, getKv: (k) => data.get(k), setKv: (k, v) => { data.set(k, v); } }; };
const valhalla = (appli: string, quoi: string, entree: Record<string, unknown>) => ({ action: 'action', appli, quoi, entree: JSON.stringify(entree) });
const T0 = Date.UTC(2026, 10, 10, 9), NOW = new Date(2026, 10, 12, 8, 30);
const ok = (a: Acquis | { skip: string }): Acquis => { assert.ok(!('skip' in a), 'skip' in a ? `refusé : ${a.skip}` : ''); return a as Acquis; };
const skip = (a: Acquis | { skip: string }): string => ('skip' in a ? a.skip : '');
const BAN = { tool: 'valhalla', input: valhalla('garmr', 'bannir', { ip: '203.0.113.9' }), label: 'Garmr · Bannir une adresse' };
const LIST = { tool: 'valhalla', input: valhalla('garmr', 'bannis', {}), label: 'Garmr · Bannis en ce moment' };
const NIGHT = { tool: 'mode_set', input: { mode: 'sommeil' }, label: 'Mode du moment · sommeil' };
const LIGHT = (entity: string, service = 'turn_on') => ({ tool: 'ha_call', input: { domain: 'light', service, entity_id: entity }, label: `Maison · light.${service} → ${entity}` });

function deps(over: Partial<DirectDeps> = {}): DirectDeps & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, kv: kv(), sessionId: 's', has: (t) => ['mode_set', 'ha_call', 'valhalla', 'venus'].includes(t), now: NOW, run: async (name, input) => { calls.push([name, input]); return { ok: true, content: `fait:${name}` }; }, ...over };
}

test('mission : plusieurs actions à la suite s\'apprennent ; la valeur dite change partout à la fois', () => {
  const a = ok(learn({ phrase: 'Bannis 203.0.113.9 et montre les bannis', label: '', steps: [BAN, LIST], now: T0 }));
  assert.equal(a.label, 'Garmr · Bannir une adresse → Garmr · Bannis en ce moment');
  assert.equal(stepsOf(a).length, 2); assert.deepEqual(a.slots, [{ shape: 'ip' }]); assert.equal(a.origin, 'ia');
  // La même mission, avec une autre adresse : les deux actions sont prêtes, dans l'ordre.
  const m = match([a], 'bannis 198.51.100.7 et montre les bannis !');
  assert.deepEqual(m?.steps.map((s) => [s.tool, s.input.quoi, s.input.entree]), [['valhalla', 'bannir', '{"ip":"198.51.100.7"}'], ['valhalla', 'bannis', '{}']]);
  assert.equal(match([a], 'bannis 198.51.100.7'), undefined, 'une autre phrase n\'est pas cette mission');
  // La même valeur dans deux actions partage un seul repère.
  const two = ok(learn({ phrase: 'coupe puis rallume 203.0.113.9', label: '', steps: [{ ...BAN, input: valhalla('garmr', 'debannir', { ip: '203.0.113.9' }) }, BAN] }));
  assert.equal(two.slots.length, 1);
  assert.deepEqual(match([two], 'coupe puis rallume 198.51.100.7')?.steps.map((s) => s.input.entree), ['{"ip":"198.51.100.7"}', '{"ip":"198.51.100.7"}']);
  // Une seule action : rien ne change (pas de liste d'étapes gardée).
  const one = ok(learn({ phrase: 'je file au lit', tool: 'mode_set', input: { mode: 'sommeil' }, label: 'Mode du moment' }));
  assert.equal(one.steps, undefined); assert.equal(stepsOf(one).length, 1);
  // Une phrase ne mène qu'à une mission : apprise de nouveau avec d'autres actions, la nouvelle remplace l'ancienne.
  const k = kv(); keep(k, one); keep(k, ok(learn({ phrase: 'Je file au lit !', label: '', steps: [LIGHT('light.chambre', 'turn_off'), NIGHT] })));
  assert.deepEqual(loadAcquis(k).map((x) => stepsOf(x).map((s) => s.tool)), [['ha_call', 'mode_set']]);
});

test('mission : ce qui n\'est pas une vraie mission, ou dépend du moment, n\'est pas appris', () => {
  const five = Array.from({ length: 5 }, (_x, k) => LIGHT(`light.l${k}`));
  assert.equal(skip(learn({ phrase: 'allume tout le rez de chaussee', label: '', steps: five })), 'trop d\'étapes');
  assert.equal(skip(learn({ phrase: 'je file au lit', label: '', steps: [NIGHT, { ...NIGHT, input: { mode: 'disponible' } }] })), 'action corrigée en cours de route', 'deux réglages du même état : l\'IA s\'est reprise');
  assert.equal(skip(learn({ phrase: 'allume le salon deux fois', label: '', steps: [LIGHT('light.salon'), LIGHT('light.salon')] })), 'deux fois la même action');
  assert.equal(skip(learn({ phrase: 'lis mes mails et allume le salon', label: '', steps: [{ tool: 'mail_read', input: {}, label: 'Mail' }, LIGHT('light.salon')] })), 'outil non rejouable');
  // Une valeur que tu n'as pas dite, sortie du résultat d'une action d'avant : elle change d'un jour à l'autre.
  assert.equal(skip(learn({ phrase: 'regarde qui attaque et bannis le pire', label: '', steps: [{ ...LIST, out: '- 203.0.113.9 · 40 essais\n- 198.51.100.7 · 2 essais' }, BAN] })), 'dépend du résultat d\'une action précédente');
  // … ou de ce qui vient d'être dit dans la discussion.
  assert.equal(skip(learn({ phrase: 'bannis cette adresse', label: '', steps: [BAN], context: 'Qui attaque ?\nL\'adresse 203.0.113.9 insiste depuis ce matin.' })), 'valeur reprise de la discussion');
  assert.ok(!('skip' in learn({ phrase: 'bannis 203.0.113.9', label: '', steps: [BAN], context: 'L\'adresse 203.0.113.9 insiste.' })), 'dite dans la phrase : c\'est une valeur comme une autre');
  // Un pronom accroché au verbe, un rang : la phrase renvoie à la discussion.
  for (const p of ['rallume-la', 'bannis la première', 'éteins les autres', 'fais pareil pour le suivant']) assert.equal(skip(learn({ phrase: p, label: '', steps: [LIGHT('light.salon')] })), 'dépend du moment ou de la conversation', p);
  assert.ok(!('skip' in learn({ phrase: 'peux-tu allumer le salon', label: '', steps: [LIGHT('light.salon')] })), '« peux-tu » n\'est pas un renvoi');
});

test('liens : deux façons de dire la même mission relient le mot qui change, seulement s\'il n\'y en a qu\'un', () => {
  const k = kv();
  const a = keep(k, ok(learn({ phrase: 'allume la lumière du salon', label: '', steps: [LIGHT('light.salon')], now: T0 })));
  const b = keep(k, ok(learn({ phrase: 'allume la lampe du salon', label: '', steps: [LIGHT('light.salon')], now: T0 + 1 })));
  assert.equal(missionOf(a), missionOf(b), 'mêmes actions : même mission');
  assert.notEqual(missionOf(a), missionOf(ok(learn({ phrase: 'éteins la lumière du salon', label: '', steps: [LIGHT('light.salon', 'turn_off')] }))), 'une autre action : une autre mission');
  assert.deepEqual([...wordsOf(a).keys()], ['allum', 'lumier', 'salon']);
  assert.deepEqual(swapOf(wordsOf(a), wordsOf(b)), { a: 'lamp', b: 'lumier', said: ['lampe', 'lumière'] });
  const l = linkWords(k, a, b, T0 + 2);
  assert.deepEqual(l && [l.said, l.n], [['lampe', 'lumière'], 1]);
  assert.equal(linkWords(k, a, b, T0 + 3)?.n, 2, 'revu : le lien se renforce');
  assert.equal(loadLinks(k).length, 1);
  // Deux mots qui changent d'un coup : on ne sait pas lequel va avec lequel. Deux missions différentes : aucun lien.
  const c = ok(learn({ phrase: 'mets la lampe du séjour', label: '', steps: [LIGHT('light.salon')] }));
  assert.equal(linkWords(k, a, c), undefined);
  assert.equal(linkWords(k, a, ok(learn({ phrase: 'allume la lampe du bureau', label: '', steps: [LIGHT('light.bureau')] }))), undefined);
  // Les valeurs variables ne comptent pas comme des mots : « vire <adresse> » et « dégage <adresse> » relient « vire » et « dégage ».
  const v1 = ok(learn({ phrase: 'vire 203.0.113.9', label: '', steps: [BAN] })), v2 = ok(learn({ phrase: 'dégage 198.51.100.7', label: '', steps: [{ ...BAN, input: valhalla('garmr', 'bannir', { ip: '198.51.100.7' }) }] }));
  assert.equal(missionOf(v1), missionOf(v2)); assert.deepEqual(linkWords(kv(), v1, v2)?.said, ['dégage', 'vire']);
});

test('réfléchir par les liens : chaque mot doit être expliqué, sinon aucun rapprochement', () => {
  const salon = ok(learn({ phrase: 'allume la lumière du salon', label: 'Maison', steps: [LIGHT('light.salon')], now: T0 }));
  const list = [salon];
  assert.deepEqual([...meaning('Odin, allume les lumières du salon stp')], ['allum', 'lumier', 'salon'], 'petits mots et accords mis de côté');
  // Mêmes mots (ordre, articles, pluriel) : rapprochement net.
  assert.equal(nearest(list, 'les lumières du salon, allume')?.a.id, salon.id);
  // Un mot en moins : rapproché, en disant ce qui n'a pas été dit.
  const n = nearest(list, 'allume le salon'); assert.equal(n?.a.id, salon.id); assert.deepEqual(n?.unsaid, ['lumière']);
  // La politesse et les mots creux ne comptent pas (« fais », « je voudrais », « maintenant »).
  const ronde = ok(learn({ phrase: 'ronde du soir', label: '', steps: [LIST], now: T0 }));
  for (const p of ['fais la ronde du soir', 'bonjour Odin, je voudrais la ronde du soir maintenant', 'la ronde du soir, tu peux la faire ?']) assert.equal(nearest([ronde], p)?.a.id, ronde.id, p);
  assert.equal(nearest([ronde], 'annule la ronde du soir'), undefined, 'un vrai verbe en plus n\'est pas un mot creux');
  // Un mot inconnu, et il n'y a plus de rapprochement : l'action contraire, une autre pièce, une négation, un mot en trop.
  for (const p of ['éteins la lumière du salon', 'allume la lumière de la cuisine', 'n\'allume pas la lumière du salon', 'allume la lumière du salon sans la lampe', 'allume vite la lumière du salon', 'salon'])
    assert.equal(nearest(list, p), undefined, p);
  // Un mot relié par Odin (deux façons de dire une même mission) explique le mot inconnu.
  const links: WordLink[] = [{ a: 'lamp', b: 'lumier', said: ['lampe', 'lumière'], n: 1, at: T0 }];
  assert.equal(nearest(list, 'allume la lampe du salon'), undefined, 'sans lien : « lampe » n\'est pas expliqué');
  const via = nearest(list, 'allume la lampe du salon', links);
  assert.equal(via?.a.id, salon.id); assert.deepEqual(via?.via, [{ said: 'lampe', known: 'lumière' }]); assert.ok(via!.score < 1 && via!.score > 0.9);
  // Un lien appris sur une mission sert à en comprendre une autre.
  const bureau = ok(learn({ phrase: 'allume la lumière du bureau', label: 'Maison', steps: [LIGHT('light.bureau')], now: T0 }));
  assert.equal(nearest([salon, bureau], 'allume la lampe du bureau', links)?.a.id, bureau.id);
  // Deux missions aussi proches l'une que l'autre : ce n'est pas clair, rien n'est proposé.
  assert.equal(nearest([salon, bureau], 'allume la lumière'), undefined);
  // Deux façons de dire la MÊME mission ne se gênent pas.
  const same = ok(learn({ phrase: 'lumière salon allume', label: 'Maison', steps: [LIGHT('light.salon')], now: T0 + 5 }));
  assert.ok(nearest([salon, same], 'salon allume lumière'));
  // Une demande à valeur variable ne se rapproche pas (une valeur ne se devine pas).
  assert.equal(nearest([ok(learn({ phrase: 'bannis l\'adresse 203.0.113.9', label: '', steps: [BAN] }))], 'adresse bannis 203.0.113.9'), undefined);
  // Confirmée par toi, la nouvelle façon de le dire devient un acquis à part entière, pour la même mission.
  const al = alias(salon, 'Allume le salon !', T0 + 9)!;
  assert.equal(al.origin, 'lien'); assert.equal(missionOf(al), missionOf(salon)); assert.notEqual(al.id, salon.id);
  assert.equal(match([salon, al], 'allume le salon')?.a.id, al.id);
  assert.equal(alias(salon, 'allume ça'), undefined, 'une phrase qui dépend de la discussion ne se retient pas');
  assert.equal(alias(salon, 'Allume la lumière du salon.'), undefined, 'la même phrase : rien de neuf');
});

test('sans IA : une mission se rejoue dans l\'ordre, s\'arrête au premier souci, et « plusieurs demandes en une » la reconnaît', async () => {
  const d = deps();
  const a = keep(d.kv, ok(learn({ phrase: 'bannis 203.0.113.9 et montre les bannis', label: '', steps: [BAN, LIST], now: T0 })));
  assert.equal(needsThinking('bannis 198.51.100.7 et montre les bannis'), MANY);
  const r = await tryDirect('Bannis 198.51.100.7 et montre les bannis', d);
  assert.ok(r.done && r.acquis === a.id);
  assert.deepEqual(d.calls.map(([n, i]) => [n, i.quoi, i.entree]), [['valhalla', 'bannir', '{"ip":"198.51.100.7"}'], ['valhalla', 'bannis', '{}']]);
  assert.equal(r.done ? r.text : '', '1/2 · Garmr · Bannir une adresse\nfait:valhalla\n\n2/2 · Garmr · Bannis en ce moment\nfait:valhalla');
  assert.match(r.done ? r.why : '', /^appris le 10 novembre : « bannis 203\.0\.113\.9 et montre les bannis » → Garmr · Bannir une adresse → Garmr · Bannis en ce moment$/);
  assert.equal(loadAcquis(d.kv)[0].uses, 1);
  // Plusieurs demandes qui ne sont PAS une mission apprise : une IA, comme avant.
  const other = await tryDirect('bannis 198.51.100.7 et envoie un mail à Paul', d);
  assert.ok(!other.done && other.why === MANY);
  // La deuxième action échoue : Odin s'arrête, dit où il en est, et le note (deux fois = oubliée).
  let n = 0;
  const half = deps({ run: async () => (++n % 2 === 1 ? { ok: true, content: 'banni' } : { ok: false, content: 'Erreur : pare-feu injoignable' }) }); keep(half.kv, a);
  const h1 = await tryDirect('bannis 203.0.113.9 et montre les bannis', half);
  assert.ok(h1.done); assert.match(h1.done ? h1.text : '', /^1\/2 · Garmr · Bannir une adresse\nbanni\n\n2\/2 · Garmr · Bannis en ce moment\nErreur : pare-feu injoignable\n\nJe me suis arrêté là : 1 action sur 2 faite\.$/);
  const h2 = await tryDirect('bannis 203.0.113.9 et montre les bannis', half);
  assert.match(h2.done ? h2.text : '', /échoué deux fois : je l'ai oubliée/); assert.equal(loadAcquis(half.kv).length, 0);
  // La première action échoue : rien n'a été fait, l'IA reprend la main.
  const dead = deps({ run: async () => ({ ok: false, content: 'Erreur : pare-feu injoignable' }) }); keep(dead.kv, a);
  const d1 = await tryDirect('bannis 203.0.113.9 et montre les bannis', dead); assert.ok(!d1.done && /ne marche plus/.test(d1.why));
  // Refusée en route (par toi ou par une règle) : Odin s'arrête là, et ce qu'il a appris reste.
  let k = 0;
  const no = deps({ run: async () => (++k === 1 ? { ok: true, content: 'banni' } : { ok: false, content: 'Action refusée.', refused: true }) }); keep(no.kv, a);
  const r2 = await tryDirect('bannis 203.0.113.9 et montre les bannis', no);
  assert.match(r2.done ? r2.text : '', /2\/2 · Garmr · Bannis en ce moment\nAction refusée\.\n\nJe me suis arrêté là : 1 action sur 2 faite\.$/); assert.equal(loadAcquis(no.kv).length, 1); assert.equal(loadAcquis(no.kv)[0].fails, 0);
  // Un outil de la mission n'est pas disponible : elle n'est pas tentée.
  const lack = deps({ has: () => false }); keep(lack.kv, a);
  assert.equal((await tryDirect('bannis 203.0.113.9 et montre les bannis', lack)).done, false); assert.equal(lack.calls.length, 0);
});

test('aucune IA ne répond : Odin dit comment il a fait le lien, propose, et n\'agit qu\'après ton oui', async () => {
  const d = deps();
  const salon = keep(d.kv, ok(learn({ phrase: 'allume la lumière du salon', label: '', steps: [LIGHT('light.salon')], now: T0 })));
  const film = keep(d.kv, ok(learn({ phrase: 'soirée film au salon', label: '', steps: [LIGHT('light.salon', 'turn_off'), { tool: 'venus', input: { action: 'ecrans' }, label: 'Venus · ecrans' }], now: T0 })));
  d.kv.setKv('acquis-liens', JSON.stringify([{ a: 'lamp', b: 'lumier', said: ['lampe', 'lumière'], n: 1, at: T0 }]));
  // Rien de proche : pas de proposition (et rien en attente).
  assert.equal(proposeNear('quelle est la capitale du Japon', d), undefined);
  assert.equal(proposeNear('éteins la lumière du salon', d), undefined);
  assert.equal(proposeNear('écris-moi un mot pour allumer la lumière du salon', d), undefined, 'une demande à rédiger ne se rapproche de rien');
  assert.equal(pendingProposal(d.kv, 's', NOW.getTime()), undefined);
  // Proche, par un mot qu'Odin a relié : il dit comment il a réfléchi et ce qu'il ferait.
  const p = proposeNear('Allume la lampe du salon', d)!;
  assert.equal(p, [
    'Aucune IA ne me répond, alors j\'ai cherché dans ce que j\'ai déjà appris.',
    'Ta demande ressemble à « allume la lumière du salon » (appris le 10 novembre) : pour moi, « lampe » veut dire « lumière » (je les ai déjà reliés).',
    'Ce que je ferais : Maison · light.turn_on → light.salon.',
    'Je le fais ? Réponds oui ou non.',
  ].join('\n'));
  assert.equal(d.calls.length, 0, 'rien n\'est parti');
  assert.equal(pendingProposal(d.kv, 's', NOW.getTime())?.id, salon.id);
  assert.equal(pendingProposal(d.kv, 's', NOW.getTime() + 11 * 60_000), undefined, 'dix minutes plus tard, la proposition ne tient plus');
  // Non : rien ne part, rien n'est retenu.
  const non = await tryDirect('non', d);
  assert.ok(non.done && non.text === 'D\'accord, je ne fais rien.'); assert.equal(d.calls.length, 0); assert.equal(loadAcquis(d.kv).length, 2);
  assert.equal(pendingProposal(d.kv, 's', NOW.getTime()), undefined);
  // Oui : c'est fait, et cette façon de le dire est retenue (elle se fera ensuite sans rien demander).
  proposeNear('Allume la lampe du salon', d);
  const oui = await tryDirect('Oui, vas-y', d);
  assert.ok(oui.done); assert.deepEqual(d.calls, [['ha_call', { domain: 'light', service: 'turn_on', entity_id: 'light.salon' }]]);
  assert.equal(oui.done ? oui.text : '', 'Maison · light.turn_on → light.salon\nfait:ha_call\n\nC\'est retenu : « Allume la lampe du salon » se fera maintenant sans rien demander.');
  assert.match(oui.done ? oui.why : '', /^lien fait avec « allume la lumière du salon » \(appris le 10 novembre\), confirmé par toi$/);
  const again = await tryDirect('allume la lampe du salon', d);
  assert.ok(again.done && /^appris le 12 novembre/.test(again.why)); assert.equal(d.calls.length, 2);
  assert.equal(loadLinks(d.kv)[0].n, 2, 'ton oui renforce le lien entre les deux mots');
  // Une mission de plusieurs actions : chaque étape est annoncée avant ton oui.
  const pf = proposeNear('film au salon soirée', d)!;
  assert.match(pf, /Ce que je ferais :\n1\. Maison · light\.turn_off → light\.salon\n2\. Venus · ecrans\nJe le fais \?/);
  // Un autre message que oui ou non : la proposition est effacée, et le message suit son chemin habituel.
  const autre = await tryDirect('quelle heure est-il', d);
  assert.ok(autre.done && /^Il est /.test(autre.text)); assert.equal(pendingProposal(d.kv, 's', NOW.getTime()), undefined);
  assert.equal((await tryDirect('oui', d)).done, false, 'un « oui » sans proposition n\'est pas une demande que je sais faire seul');
  // Oui, mais la mission a été oubliée entre-temps : Odin le dit, sans rien lancer.
  proposeNear('film au salon soirée', d); forget(d.kv, film.id);
  const gone = await tryDirect('oui', d); assert.ok(gone.done && /Je ne retrouve plus ce que je t'avais proposé/.test(gone.text));
  // Oui, mais l'action est refusée : rien n'est retenu.
  const ref = deps({ run: async () => ({ ok: false, content: 'Action refusée.', refused: true }) }); keep(ref.kv, salon);
  proposeNear('allume le salon', ref);
  const rr = await tryDirect('oui', ref); assert.ok(rr.done && rr.text === 'Action refusée.'); assert.equal(loadAcquis(ref.kv).length, 1);
  // Ta phrase porte un secret connu : la mission est faite, mais cette façon de le dire n'est pas retenue.
  const sec = deps({ redact: (x) => x.replace(/salon/gi, '[masqué]') }); keep(sec.kv, salon);
  proposeNear('allume le salon', sec);
  const rs = await tryDirect('oui', sec); assert.ok(rs.done && !/C'est retenu/.test(rs.text)); assert.equal(sec.calls.length, 1); assert.equal(loadAcquis(sec.kv).length, 1);
  // Le réglage « apprendre » coupé : pas de réponse à une proposition.
  const off = deps({ acquis: false }); keep(off.kv, salon); proposeNear('allume le salon', off);
  assert.equal((await tryDirect('oui', off)).done, false);
});

// ---------------- Le Quotidien dans le Cerveau ----------------

function vaultWorld() {
  const dir = mkdtempSync(join(tmpdir(), 'odin-quotidien-')), vault = new Vault(dir), k = kv();
  for (const name of ['Garmr', 'Midgard', 'Freyja']) vault.write(`Odin/Applis/${name}`, { type: 'fiche', 'tenue par': 'Odin' }, `# ${name}\n`, { quiet: true });
  vault.write('Odin/Comment fonctionne Odin', { type: 'fiche', 'tenue par': 'Odin' }, '# Comment fonctionne Odin\n', { quiet: true });
  const names: Record<string, string> = { garmr: 'Garmr', midgard: 'Midgard', freyja: 'Freyja' };
  const d: DailyDeps = { vault, kv: k, app: (ref) => names[ref.toLowerCase()], now: Date.UTC(2026, 10, 12, 6) };
  return { dir, vault, kv: k, d, read: (p: string) => readFileSync(join(dir, `${p}.md`), 'utf8'), end: () => rmSync(dir, { recursive: true, force: true }) };
}

test('Quotidien : une note par mission, reliée aux applis, avec les façons de le dire et comment c\'est appris', () => {
  const w = vaultWorld();
  try {
    assert.deepEqual(TYPES.quotidien, { folder: 'Quotidien', label: 'Quotidien', props: ['appli', 'étapes', 'utilisé', 'dernière fois'] });
    // Rien d'appris : la note d'ensemble explique déjà comment ça marche.
    assert.deepEqual(syncQuotidien(w.d, { full: true }), { written: 1, removed: 0, total: 0 });
    assert.match(w.read('Quotidien/Cerveau direct'), /tenue par: Odin[\s\S]*# Cerveau direct[\s\S]*## Comment ça marche[\s\S]*## Ce qui ne change jamais[\s\S]*## Ce que je sais faire\n\nRien encore\.[\s\S]*Voir aussi \[\[Comment fonctionne Odin\]\]\.[\s\S]*## Mes notes/);
    const ban = keep(w.kv, ok(learn({ phrase: 'bannis 203.0.113.9 et montre les bannis', label: '', steps: [BAN, LIST], now: T0 })));
    const salon = keep(w.kv, ok(learn({ phrase: 'allume la lumière du salon', label: '', steps: [LIGHT('light.salon')], now: T0 })));
    const lampe = keep(w.kv, ok(learn({ phrase: 'allume la lampe du salon', label: '', steps: [LIGHT('light.salon')], now: T0 + 86_400_000 })));
    linkWords(w.kv, salon, lampe, T0 + 86_400_000);
    keep(w.kv, ok(learn({ phrase: 'éteins la lumière du salon', label: '', steps: [LIGHT('light.salon', 'turn_off')], now: T0 })));
    keep(w.kv, ok(learn({ phrase: 'je file au lit', label: '', steps: [NIGHT], now: T0 })));
    const ms = missions(loadAcquis(w.kv));
    assert.equal(ms.length, 4, 'deux façons de dire la même mission : une seule note');
    assert.deepEqual(ms.find((m) => m.key === missionOf(salon))!.all.map((a) => a.phrase), ['allume la lumière du salon', 'allume la lampe du salon']);
    assert.deepEqual(syncQuotidien(w.d), { written: 5, removed: 0, total: 4 });
    assert.deepEqual(readdirSync(join(w.dir, 'Quotidien')).sort(), ['Allume la lumière du salon.md', 'Bannis 203.0.113.9 et montre les bannis.md', 'Cerveau direct.md', 'Je file au lit.md', 'Éteins la lumière du salon.md'].sort());
    // Une mission en deux actions, avec une valeur qui peut changer.
    const nb = w.read('Quotidien/Bannis 203.0.113.9 et montre les bannis');
    assert.match(nb, /^---\ntype: quotidien\nappli: Garmr\nétapes: 2\nutilisé: 0\nmission: m\w+\ntenue par: Odin\ncréé: 2026-11-12\n---\n# Bannis 203\.0\.113\.9 et montre les bannis\n/);
    assert.match(nb, /## Ce que je fais\n\n1\. \[\[Garmr\]\] · Bannir une adresse\n2\. \[\[Garmr\]\] · Bannis en ce moment\n\nDans cet ordre\./);
    assert.match(nb, /## Ce qui peut changer\n\n« 203\.0\.113\.9 » \(une adresse IP\) : la même phrase avec une autre valeur marche aussi\./);
    assert.match(nb, /## Comment je l'ai appris\n\nLe 10 novembre 2026, une IA a réglé cette demande en 2 actions\. J'ai retenu « cette phrase → ces actions »\. Je ne l'ai pas encore refaite seul\./);
    assert.match(nb, new RegExp(`Dis « oublie l'acquis ${ban.id} », ou mets cette note à la corbeille`));
    assert.ok(!/entree|\{"ip"/.test(nb), 'aucun réglage brut dans la note');
    // Deux façons de le dire, le mot relié, la mission proche, le lien vers l'appli.
    const ns = w.read('Quotidien/Allume la lumière du salon');
    assert.match(ns, /1\. Maison · light\.turn_on → light\.salon \(\[\[Midgard\]\]\)/);
    assert.match(ns, /## Comment tu le dis\n\n- « allume la lumière du salon » — appris le 10 novembre 2026 : une IA l'avait réglé\n- « allume la lampe du salon » — appris le 11 novembre 2026 : une IA l'avait réglé/);
    assert.match(ns, /## Mots que j'ai reliés\n\n- « lampe » = « lumière »/);
    assert.match(ns, /## Missions proches\n\n- \[\[Quotidien\/Éteins la lumière du salon\|Éteins la lumière du salon\]\] \(mots en commun : lumière, salon\)/);
    // La note d'ensemble : les missions par appli, les mots reliés.
    const hub = w.read('Quotidien/Cerveau direct');
    assert.match(hub, /## Ce que je sais faire \(4 missions\)\n\n### Garmr\n\n- \[\[Quotidien\/Bannis 203\.0\.113\.9 et montre les bannis\|Bannis 203\.0\.113\.9 et montre les bannis\]\] — Garmr · Bannir une adresse → Garmr · Bannis en ce moment\n\n### Midgard\n\n- \[\[Quotidien\/Allume la lumière du salon\|Allume la lumière du salon\]\] — Maison · light\.turn_on → light\.salon · 2 façons de le dire\n- [^\n]*Éteins la lumière du salon[^\n]*\n\n### Mode du moment\n\n- [^\n]*Je file au lit/);
    assert.match(hub, /## Mots que j'ai reliés\n\n- « lampe » = « lumière »/);
    // Le graphe du Cerveau relie la mission à ses applis, à la note d'ensemble et à la mission proche.
    const g = w.vault.graph({ guessed: false }), edge = (x: string, y: string) => g.edges.some((e) => e.kind === 'lien' && [e.from, e.to].sort().join('|') === [x, y].sort().join('|'));
    assert.ok(edge('Quotidien/Bannis 203.0.113.9 et montre les bannis.md', 'Odin/Applis/Garmr.md'));
    assert.ok(edge('Quotidien/Allume la lumière du salon.md', 'Odin/Applis/Midgard.md'));
    assert.ok(edge('Quotidien/Allume la lumière du salon.md', 'Quotidien/Cerveau direct.md'));
    assert.ok(edge('Quotidien/Allume la lumière du salon.md', 'Quotidien/Éteins la lumière du salon.md'));
    assert.ok(edge('Quotidien/Cerveau direct.md', 'Odin/Comment fonctionne Odin.md'));
    assert.equal(g.nodes.find((n) => n.id === 'Quotidien/Je file au lit.md')?.type, 'quotidien');
    assert.equal(w.vault.database('quotidien').length, 4, 'la base « Quotidien » du Cerveau liste les missions (pas la note d\'ensemble)');
  } finally { w.end(); }
});

test('Quotidien : tenu à jour sans bruit ; tes notes sont gardées ; une mission oubliée part à la corbeille, et l\'inverse', () => {
  const w = vaultWorld();
  try {
    const salon = keep(w.kv, ok(learn({ phrase: 'allume la lumière du salon', label: '', steps: [LIGHT('light.salon')], now: T0 })));
    const lit = keep(w.kv, ok(learn({ phrase: 'je file au lit', label: '', steps: [NIGHT], now: T0 })));
    syncQuotidien(w.d, { full: true });
    assert.deepEqual(syncQuotidien(w.d), { written: 0, removed: 0, total: 2 }, 'rien n\'a changé : rien n\'est réécrit');
    assert.deepEqual(syncQuotidien(w.d, { full: true }), { written: 0, removed: 0, total: 2 }, 'même en relisant tout le coffre');
    // Tu écris sous « Mes notes » : gardé quand Odin met la note à jour (une utilisation de plus).
    const p = join(w.dir, 'Quotidien', 'Allume la lumière du salon.md');
    writeFileSync(p, readFileSync(p, 'utf8').replace(/_Écris ici[^\n]*_/, 'Seulement le soir.'));
    used(w.kv, salon.id, true, Date.UTC(2026, 10, 12, 18));
    assert.deepEqual(syncQuotidien(w.d), { written: 1, removed: 0, total: 2 });
    const after = readFileSync(p, 'utf8');
    assert.match(after, /utilisé: 1\ndernière fois: 2026-11-12\n/); assert.match(after, /Depuis, je l'ai refaite seul 1 fois, la dernière le 12 novembre 2026\./); assert.match(after, /## Mes notes\n\nSeulement le soir\.\n$/);
    // Tu renommes la note : Odin la suit (au démarrage) au lieu d'en recréer une.
    w.vault.rename('Quotidien/Je file au lit', 'Quotidien/Dodo');
    assert.deepEqual(syncQuotidien(w.d, { full: true }), { written: 1, removed: 0, total: 2 }, 'seule la note d\'ensemble change (le lien suit le nouveau nom)');
    assert.ok(!existsSync(join(w.dir, 'Quotidien', 'Je file au lit.md')));
    assert.match(w.read('Quotidien/Cerveau direct'), /\[\[Quotidien\/Dodo\|Je file au lit\]\]/);
    // Une note à toi qui porterait le nom de la note d'ensemble n'est jamais écrasée ; le nom d'une note existante n'est pas repris.
    const mine = vaultWorld();
    try {
      mine.vault.write('Quotidien/Cerveau direct', {}, 'Mes idées à moi.\n'); mine.vault.write('Quotidien/Je file au lit', {}, 'Ma note à moi.\n');
      keep(mine.kv, lit); syncQuotidien(mine.d, { full: true });
      assert.equal(mine.read('Quotidien/Cerveau direct'), 'Mes idées à moi.\n'); assert.equal(mine.read('Quotidien/Je file au lit'), 'Ma note à moi.\n');
      assert.match(mine.read('Quotidien/Je file au lit (2)'), /type: quotidien/);
    } finally { mine.end(); }
    // La phrase qui donnait son nom à la mission est oubliée, une autre façon de le dire reste : la note prend son nom, tes notes suivent.
    const ren = vaultWorld();
    try {
      const first = keep(ren.kv, salon); keep(ren.kv, alias(first, 'allume le salon', T0 + 5)!);
      syncQuotidien(ren.d, { full: true });
      const old = join(ren.dir, 'Quotidien', 'Allume la lumière du salon.md');
      writeFileSync(old, readFileSync(old, 'utf8').replace(/_Écris ici[^\n]*_/, 'Pas avant 18 h.'));
      forget(ren.kv, first.id);
      assert.deepEqual(syncQuotidien(ren.d), { written: 2, removed: 0, total: 1 });
      assert.ok(!existsSync(old)); assert.equal(ren.vault.trashed().length, 0, 'renommée, pas jetée');
      assert.match(ren.read('Quotidien/Allume le salon'), /# Allume le salon\n[\s\S]*- « allume le salon » — relié le[\s\S]*## Mes notes\n\nPas avant 18 h\.\n$/);
      assert.match(ren.read('Quotidien/Cerveau direct'), /\[\[Quotidien\/Allume le salon\|Allume le salon\]\]/);
    } finally { ren.end(); }
    // Le lien vers l'appli ne dépend pas du démarrage des applis (sinon la note changerait d'un lancement à l'autre).
    const bare = missionNote(missions([ok(learn({ phrase: 'bannis 203.0.113.9 et allume le salon', label: '', steps: [BAN, LIGHT('light.salon')], now: T0 }))])[0], { all: [], links: [], paths: new Map() });
    assert.match(bare.body, /1\. \[\[Garmr\]\] · Bannir une adresse\n2\. Maison · light\.turn_on → light\.salon \(\[\[Midgard\]\]\)/); assert.equal(bare.meta.appli, 'Garmr, Midgard');
    assert.match(hubNote([], [], new Map()).body, /Rien encore\./);
    // Odin oublie une mission : sa note part à la corbeille (restaurable), et la note d'ensemble suit.
    forget(w.kv, lit.id);
    assert.deepEqual(syncQuotidien(w.d), { written: 1, removed: 1, total: 1 });
    assert.ok(!existsSync(join(w.dir, 'Quotidien', 'Dodo.md'))); assert.equal(w.vault.trashed().length, 1);
    assert.match(w.read('Quotidien/Cerveau direct'), /## Ce que je sais faire \(1 mission\)/);
    // Tu mets une note du Quotidien à la corbeille depuis le Cerveau : Odin oublie la mission (toutes ses façons de le dire).
    keep(w.kv, alias(salon, 'allume le salon', T0 + 5)!);
    assert.equal(loadAcquis(w.kv).length, 2);
    let forgotten = -1;
    const stop = watchQuotidien(w.d, (n) => { forgotten = n; });
    try {
      w.vault.trash('Quotidien/Cerveau direct'); assert.equal(loadAcquis(w.kv).length, 2, 'la note d\'ensemble n\'est pas une mission');
      w.vault.trash('Quotidien/Allume la lumière du salon');
      assert.equal(forgotten, 2); assert.equal(loadAcquis(w.kv).length, 0);
      assert.match(w.read('Quotidien/Cerveau direct'), /Rien encore\./, 'la note d\'ensemble est refaite, à jour');
    } finally { stop(); }
    // Un secret connu ne s'écrit jamais dans une note.
    const red = vaultWorld();
    try {
      keep(red.kv, ok(learn({ phrase: 'réveille le serveur tonnerre', label: '', steps: [LIGHT('switch.serveur')], now: T0 })));
      syncQuotidien({ ...red.d, redact: (t) => t.replace(/tonnerre/gi, '[masqué]') }, { full: true });
      const all = readdirSync(join(red.dir, 'Quotidien')).map((f) => readFileSync(join(red.dir, 'Quotidien', f), 'utf8')).join('\n');
      assert.ok(!/tonnerre/i.test(all.replace(/^# .*$/gm, '').replace(/\[\[[^\]]*\]\]/g, '')), 'masqué dans le texte');
    } finally { red.end(); }
  } finally { w.end(); }
});

test('Quotidien : les notes sont un miroir, jamais la source d\'une action', async () => {
  const w = vaultWorld();
  try {
    const d = deps({ kv: w.kv });
    keep(w.kv, ok(learn({ phrase: 'allume la lumière du salon', label: '', steps: [LIGHT('light.salon')], now: T0 })));
    syncQuotidien(w.d, { full: true });
    // Quelqu'un (ou quelque chose) réécrit la note pour lui faire dire autre chose : l'action rejouée ne bouge pas.
    const p = join(w.dir, 'Quotidien', 'Allume la lumière du salon.md');
    writeFileSync(p, readFileSync(p, 'utf8').replace('light.turn_on → light.salon', 'lock.unlock → lock.porte_entree'));
    syncQuotidien(w.d, { full: true });
    assert.match(readFileSync(p, 'utf8'), /light\.turn_on → light\.salon/, 'Odin remet la note à l\'image de ce qu\'il sait');
    await tryDirect('allume la lumière du salon', d);
    assert.deepEqual(d.calls, [['ha_call', { domain: 'light', service: 'turn_on', entity_id: 'light.salon' }]]);
  } finally { w.end(); }
});

// ---------------- De bout en bout, avec l'agent ----------------

/** Les applis d'Odin, sans rien toucher sur la machine : les commandes sont notées, pas lancées. */
function world() {
  const home = mkdtempSync(join(tmpdir(), 'odin-direct-')), ran: string[] = [];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never), {
    run: async (cmd, args) => { ran.push(`${cmd} ${args.join(' ')}`); return { code: 0, out: /command -v/.test(args.join(' ')) ? '/usr/bin/x' : '', err: '' }; },
    fetch: (async () => { throw new Error('réseau coupé'); }) as unknown as typeof fetch,
    notify: async () => {}, autonomy: () => 'equilibre',
  });
  setValhalla(v);
  return { v, ran, end: () => { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
const S = { sessionId: 'web:principal', channel: 'web' as const };

test('agent : une mission de deux actions est apprise de l\'IA, refaite sans elle avec une autre valeur, et rangée dans le Quotidien', async () => {
  const w = world();
  const o = makeOdin([call('valhalla', valhalla('garmr', 'bannir', { ip: '203.0.113.9' })), call('valhalla', valhalla('garmr', 'bannis', {})), { text: 'C\'est fait, et voici la liste.' }], { approve: 'always' });
  try {
    const r1 = await o.agent.run('Bannis 203.0.113.9 et montre les bannis', S);
    assert.equal(o.provider.calls.length, 3, 'la première fois : l\'IA');
    assert.deepEqual(r1.ai, { needed: true, why: MANY });
    assert.match(r1.notices.join(' '), /J'ai appris cette mission \(2 actions\) : la prochaine fois, « Bannis 203\.0\.113\.9 et montre les bannis » se fera sans IA \(Garmr · Bannir une adresse → Garmr · Bannis en ce moment\)\./);
    assert.ok(w.ran.some((c) => /^nft add element inet odin garmr4 \{ 203\.0\.113\.9 /.test(c)));
    // La même mission, une autre adresse : aucune IA, les deux actions, dans l'ordre.
    const r2 = await o.agent.run('bannis 198.51.100.7 et montre les bannis', S);
    assert.equal(o.provider.calls.length, 3, 'aucun appel de plus');
    assert.equal(r2.ai?.needed, false); assert.equal(r2.toolCalls, 2);
    assert.match(r2.text, /^1\/2 · Garmr · Bannir une adresse\n[\s\S]*198\.51\.100\.7[\s\S]*\n\n2\/2 · Garmr · Bannis en ce moment\n[\s\S]*203\.0\.113\.9[\s\S]*198\.51\.100\.7/);
    assert.ok(w.ran.some((c) => /^nft add element inet odin garmr4 \{ 198\.51\.100\.7 /.test(c)), 'le pare-feu a bien reçu le deuxième ordre');
    // Le Cerveau a sa note, reliée à l'appli, à jour après l'utilisation.
    const vault = brainOf({ home: o.paths.home, careCfg: o.cfg, workspace: o.paths.workspace });
    const note = vault.find('Quotidien/Bannis 203.0.113.9 et montre les bannis');
    assert.equal(note?.meta.type, 'quotidien'); assert.equal(note?.meta.appli, 'Garmr'); assert.equal(note?.meta['étapes'], 2); assert.equal(note?.meta['utilisé'], 1);
    assert.deepEqual(note?.links.slice().sort(), ['Garmr', 'Quotidien/Cerveau direct']);
    assert.match(vault.find('Quotidien/Cerveau direct')?.body ?? '', /## Ce que je sais faire \(1 mission\)/);
  } finally { o.cleanup(); w.end(); }
});

test('agent : ce qu\'Odin relit pour vérifier ne fait pas partie de la mission ; la même mission dite autrement crée un lien', async () => {
  const w = world();
  const o = makeOdin([
    call('valhalla', valhalla('garmr', 'bannir', { ip: '203.0.113.9' })), { text: 'Banni.' }, call('valhalla', valhalla('garmr', 'bannis', {})), { text: 'Banni, vérifié dans la liste.' },
    call('valhalla', valhalla('garmr', 'bannir', { ip: '198.51.100.7' })), { text: 'Banni.' }, { text: 'Banni (déjà vérifié).' },
  ], { approve: 'always', config: (c) => ({ ...c, agent: { ...c.agent, verify: true } }) });
  try {
    const r1 = await o.agent.run('Vire 203.0.113.9', S);
    assert.equal(r1.toolCalls, 2, 'l\'action, puis la relecture imposée par le contrôle');
    assert.match(r1.notices.join(' '), /J'ai appris : la prochaine fois, « Vire 203\.0\.113\.9 » se fera sans IA \(Garmr · Bannir une adresse\)\./);
    assert.equal(stepsOf(loadAcquis(o.muninn)[0]).length, 1);
    // Une autre façon de le dire, réglée par l'IA de la même façon : Odin relie les deux phrases, et le mot qui change.
    const r2 = await o.agent.run('Dégage 198.51.100.7', S);
    assert.match(r2.notices.join(' '), /J'ai fait le lien : « Dégage 198\.51\.100\.7 » veut dire la même chose que « Vire 203\.0\.113\.9 » \(« dégage » = « vire »\)\. Les deux se feront sans IA \(Garmr · Bannir une adresse\)\./);
    assert.deepEqual(loadLinks(o.muninn).map((l) => l.said), [['dégage', 'vire']]);
    const before = o.provider.calls.length;
    const r3 = await o.agent.run('dégage 192.0.2.44', S);
    assert.equal(o.provider.calls.length, before, 'sans IA'); assert.equal(r3.ai?.needed, false);
    // Une seule note pour la mission, avec ses deux façons de le dire et le mot relié.
    const vault = brainOf({ home: o.paths.home, careCfg: o.cfg, workspace: o.paths.workspace });
    assert.equal(vault.database('quotidien').length, 1);
    assert.match(vault.find('Quotidien/Vire 203.0.113.9')?.body ?? '', /- « Vire 203\.0\.113\.9 » — appris[\s\S]*- « Dégage 198\.51\.100\.7 » — appris[\s\S]*## Mots que j'ai reliés\n\n- « dégage » = « vire »/);
  } finally { o.cleanup(); w.end(); }
});

test('agent : rien n\'est appris d\'une demande à rédiger, d\'une action refusée, d\'une valeur venue de la discussion', async () => {
  const w = world();
  try {
    // « Résume … » : la réponse de l'IA compte, l'action seule ne la remplace pas.
    let o = makeOdin([call('valhalla', valhalla('garmr', 'bannis', {})), { text: 'En résumé : personne.' }], { approve: 'always' });
    try { const r = await o.agent.run('résume qui est dehors', S); assert.equal(loadAcquis(o.muninn).length, 0); assert.equal(r.notices.join(' ').includes('appris'), false); } finally { o.cleanup(); }
    // Refusée par toi : rien à retenir.
    o = makeOdin([call('valhalla', valhalla('garmr', 'bannir', { ip: '203.0.113.9' })), { text: 'Tu as refusé.' }], { approve: false });
    try { await o.agent.run('vire 203.0.113.9', S); assert.equal(loadAcquis(o.muninn).length, 0); } finally { o.cleanup(); }
    // L'adresse vient de la réponse d'avant, pas de la phrase : elle changera, rien n'est retenu.
    o = makeOdin([{ text: 'L\'adresse 203.0.113.9 insiste depuis ce matin.' }, call('valhalla', valhalla('garmr', 'bannir', { ip: '203.0.113.9' })), { text: 'Banni.' }], { approve: 'always' });
    try {
      await o.agent.run('Écris-moi qui insiste à la porte', S);
      const r = await o.agent.run('vire cette adresse', S);
      assert.equal(r.toolCalls, 1); assert.equal(loadAcquis(o.muninn).length, 0);
    } finally { o.cleanup(); }
    // « Grave » se juge sur ce qui est demandé : une scène qui déverrouille la porte ne s'apprend pas, une scène sans risque, si.
    w.v.ctx('midgard').saveSettings({ scenes: [{ name: 'Dodo', steps: [] }, { name: 'Départ', steps: [{ appareil: 'ha:lock.entree', valeur: 'on' }] }] });
    o = makeOdin([call('valhalla', valhalla('midgard', 'scene', { scene: 'Départ' })), { text: 'Fait.' }, call('valhalla', valhalla('midgard', 'scene', { scene: 'Dodo' })), { text: 'Bonne nuit.' }], { approve: 'always' });
    try {
      await o.agent.run('protocole grand départ', S);
      assert.equal(o.approvals.length, 1, 'ton accord a bien été demandé'); assert.equal(loadAcquis(o.muninn).length, 0, 'action grave : jamais apprise');
      const r = await o.agent.run('protocole marchand de sable', S);
      assert.match(r.notices.join(' '), /J'ai appris : la prochaine fois, « protocole marchand de sable » se fera sans IA \(Midgard · Lancer une scène\)\./);
    } finally { o.cleanup(); }
  } finally { w.end(); }
});

test('agent : sans aucune IA, Odin fait le lien avec ce qu\'il a appris, propose, et retient ton oui', async () => {
  const w = world();
  const o = makeOdin([call('valhalla', valhalla('garmr', 'bannis', {})), { text: 'Voilà.' }], { approve: 'always' });
  try {
    await o.agent.run('opération porte close', S);
    assert.equal(loadAcquis(o.muninn).length, 1, 'appris avec l\'IA');
    // L'IA n'est plus là.
    o.agent.deps.offlineOnly = true;
    const calls = o.provider.calls.length;
    const p = await o.agent.run('porte close opération', S);
    assert.equal(p.offline, true); assert.equal(p.toolCalls, 0, 'rien n\'est parti');
    assert.match(p.text, /^Aucune IA ne me répond, alors j'ai cherché dans ce que j'ai déjà appris\.\nTa demande ressemble à « opération porte close » \(appris le [^)]+\)\.\nCe que je ferais : Garmr · Bannis en ce moment\.\nJe le fais \? Réponds oui ou non\.$/);
    // Non : rien, et ce « non » n'efface pas ce qu'il sait.
    const no = await o.agent.run('non', S);
    assert.equal(no.text, 'D\'accord, je ne fais rien.'); assert.equal(loadAcquis(o.muninn).length, 1);
    // Oui : fait, et retenu.
    await o.agent.run('porte close opération', S);
    const yes = await o.agent.run('oui', S);
    assert.equal(yes.toolCalls, 1); assert.match(yes.text, /^Garmr · Bannis en ce moment\n[\s\S]*C'est retenu : « porte close opération » se fera maintenant sans rien demander\.$/);
    assert.deepEqual(yes.ai, { needed: false, why: yes.ai!.why }); assert.match(yes.ai!.why, /^lien fait avec « opération porte close »/);
    const direct = await o.agent.run('porte close opération', S);
    assert.equal(direct.toolCalls, 1); assert.match(direct.ai?.why ?? '', /^appris le /);
    assert.equal(o.provider.calls.length, calls, 'aucun appel à un modèle depuis que l\'IA est partie');
    // Rien de proche : le cerveau de secours répond comme avant.
    const far = await o.agent.run('porte ouverte opération', S);
    assert.equal(far.offline, true); assert.ok(!/Ta demande ressemble/.test(far.text));
    // La note du Quotidien garde les deux façons de le dire.
    const vault = brainOf({ home: o.paths.home, careCfg: o.cfg, workspace: o.paths.workspace });
    assert.match(vault.find('Quotidien/Opération porte close')?.body ?? '', /- « opération porte close » — appris[\s\S]*- « porte close opération » — relié le [^:]+ : tu m'as dit oui/);
  } finally { o.cleanup(); w.end(); }
});
