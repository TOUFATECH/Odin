// Sans IA d'abord : ce qu'Odin sait faire seul n'est pas confié à une IA ; il dit si une IA a servi et
// pourquoi ; il apprend des demandes réglées en une action ; il compte ce que ça évite.
// (Les missions de plusieurs actions, les liens et le Quotidien : test/cerveau-direct.test.ts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, makeOdin } from './helpers.ts';
import { needsThinking, tryDirect, type DirectDeps } from '../src/core/direct.ts';
import { describeAcquis, fold, forget, keep, learn, loadAcquis, match, soft, used, type Acquis, type Kv } from '../src/learn/acquis.ts';
import { savings, savingsReport, type SavingsData } from '../src/providers/savings.ts';
import { iaLine } from '../src/bifrost/gateway.ts';
import { Router, priceOf } from '../src/providers/router.ts';
import { MockProvider } from '../src/providers/mock.ts';
import type { ProviderConfig } from '../src/config.ts';

const kv = (): Kv & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, getKv: (k) => data.get(k), setKv: (k, v) => { data.set(k, v); } }; };
const valhalla = (appli: string, quoi: string, entree: Record<string, unknown>) => ({ action: 'action', appli, quoi, entree: JSON.stringify(entree) });

test('sans IA d\'abord : ce qui demande de réfléchir part à une IA, avec la raison', () => {
  for (const t of ['quelle heure est-il ?', 'allume la lumière du salon', 'bannis 1.2.3.4', 'comment va le site monsite.fr ?', 'explique Ullr', 'éteins la clim merci']) assert.equal(needsThinking(t), undefined, t);
  assert.match(needsThinking('pourquoi le site est lent ?') ?? '', /rédiger, expliquer ou raisonner/);
  assert.match(needsThinking('écris-moi un mail pour le client') ?? '', /rédiger/);
  assert.match(needsThinking('résume ce document') ?? '', /rédiger/);
  assert.match(needsThinking('allume le salon et envoie-moi le rapport du site') ?? '', /plusieurs demandes en une/);
  assert.match(needsThinking('bannis 1.2.3.4 puis préviens-moi') ?? '', /plusieurs demandes/);
  assert.match(needsThinking('C\'est quoi Ullr ? Et Idunn, ça sert à quoi ?') ?? '', /plusieurs demandes/);
  assert.match(needsThinking('regarde\n[Image jointe : inbox/photo.jpg (image/jpeg, 1200 o)]') ?? '', /pièce jointe/);
  assert.match(needsThinking(`${'mot '.repeat(40)}`) ?? '', /longue/);
  // Une adresse, un nom de domaine, un nombre à virgule ne coupent pas la phrase.
  assert.equal(needsThinking('mets la clim à 24.5 degrés'), undefined);
});

test('acquis : une demande réglée par une seule action s\'apprend ; la valeur peut changer, jamais l\'action', () => {
  const a = learn({ phrase: 'Vire l’adresse 1.2.3.4 pendant 60 minutes stp', tool: 'valhalla', input: valhalla('loki', 'bannir', { ip: '1.2.3.4', minutes: 60 }), label: 'Loki · Bannir une adresse', now: 1 }) as Acquis;
  assert.equal(a.phrase, 'Vire l’adresse 1.2.3.4 pendant 60 minutes');
  assert.deepEqual(a.slots, [{ shape: 'ip' }, { shape: 'nombre', number: true }]);
  // La même demande avec d'autres valeurs : mêmes appli et action, valeurs reprises telles qu'écrites.
  const m = match([a], 'vire l\'adresse 203.0.113.9 pendant 15 minutes')!;
  assert.deepEqual(m.input, valhalla('loki', 'bannir', { ip: '203.0.113.9', minutes: 15 }));
  assert.equal(match([a], 'vire l\'adresse 999.1.1.1 pendant 15 minutes'), undefined, 'adresse impossible');
  assert.equal(match([a], 'vire l\'adresse 1.2.3.4'), undefined, 'phrase différente : pas reconnue');
  assert.equal(match([a], 'vire l\'adresse 1.2.3.4 pendant 15 minutes et efface tout'), undefined);
  // Un nom garde ses majuscules et ses accents ; un mot vague n'est pas une valeur.
  const b = learn({ phrase: 'Redémarre le conteneur Web', tool: 'valhalla', input: valhalla('njord', 'redemarrer', { nom: 'Web' }), label: 'Njörd · Redémarrer', now: 1 }) as Acquis;
  assert.deepEqual(match([b], 'redémarre le conteneur Base-De-Données')!.input, valhalla('njord', 'redemarrer', { nom: 'Base-De-Données' }));
  assert.equal(match([b], 'redémarre le conteneur ça'), undefined);
  assert.equal(match([b], 'redémarre le conteneur tout'), undefined);
  // Sans valeur dans la phrase : la phrase exacte seulement (l'appareil a été trouvé par l'IA).
  const c = learn({ phrase: 'allume la lumière du salon', tool: 'ha_call', input: { domain: 'light', service: 'turn_on', entity_id: 'light.salon_plafonnier' }, label: 'Maison', now: 1 }) as Acquis;
  assert.deepEqual(c.slots, []);
  assert.deepEqual(match([c], 'Allume la lumière du salon !')!.input, { domain: 'light', service: 'turn_on', entity_id: 'light.salon_plafonnier' });
  assert.equal(match([c], 'allume la lumière de la cuisine'), undefined);
  // L'appli et l'action ne deviennent jamais des valeurs, même si la phrase les nomme.
  const d = learn({ phrase: 'loki bannir 1.2.3.4', tool: 'valhalla', input: valhalla('loki', 'bannir', { ip: '1.2.3.4' }), label: 'Loki', now: 1 }) as Acquis;
  assert.equal(d.slots.length, 1);
  assert.equal(match([d], 'freyja bannir 1.2.3.4'), undefined);
});

test('acquis : rien n\'est appris d\'une phrase qui dépend du moment, d\'un secret ou d\'un outil non rejouable', () => {
  const skip = (x: Parameters<typeof learn>[0]) => { const r = learn(x); return 'skip' in r ? r.skip : ''; };
  assert.match(skip({ phrase: 'rappelle-moi demain de sortir', tool: 'valhalla', input: valhalla('x', 'y', {}), label: 'x' }), /dépend du moment/);
  assert.match(skip({ phrase: 'refais ça', tool: 'ha_call', input: { domain: 'light', service: 'turn_on' }, label: 'x' }), /dépend du moment|trop courte/);
  assert.match(skip({ phrase: 'garde le code wifi Azerty123', tool: 'valhalla', input: valhalla('coffre', 'garder', { secret: 'Azerty123' }), label: 'x' }), /secret/);
  assert.match(skip({ phrase: 'lance un shell', tool: 'shell', input: { command: 'ls' }, label: 'x' }), /non rejouable/);
  assert.match(skip({ phrase: 'lis le fichier', tool: 'fs_read', input: { path: 'a' }, label: 'x' }), /non rejouable/);
  assert.match(skip({ phrase: 'bannis 1.2.3.4', tool: 'valhalla', input: valhalla('loki', 'bannir', { ip: '1.2.3.4' }), label: 'x', redact: (t) => t.replace('1.2.3.4', '•••') }), /secret connu/);
  assert.match(skip({ phrase: `${'mot '.repeat(30)}`, tool: 'net_scan', input: {}, label: 'x' }), /trop longue/);
  assert.equal(fold('Éteins l’Écran'), 'eteins l\'ecran');
  assert.equal(soft('  Odin, allume  la lumière stp !'), 'allume la lumière');
});

test('acquis : gardés, comptés, oubliés après deux échecs ou à la demande', () => {
  const k = kv();
  const a = keep(k, learn({ phrase: 'je file au lit', tool: 'mode_set', input: { mode: 'sommeil' }, label: 'Mode du moment', now: 10 }) as Acquis);
  assert.equal(loadAcquis(k).length, 1);
  assert.equal(used(k, a.id, true, 20), false); assert.equal(loadAcquis(k)[0].uses, 1);
  assert.match(describeAcquis(loadAcquis(k)), /« je file au lit » → Mode du moment · utilisé 1 fois/);
  assert.equal(used(k, a.id, false), false, 'un échec : gardé');
  assert.equal(used(k, a.id, false), true, 'deux échecs : oublié');
  assert.equal(loadAcquis(k).length, 0);
  keep(k, a); assert.equal(forget(k, a.id), 1); assert.equal(forget(k, a.id), 0);
  keep(k, a); assert.equal(forget(k, 'tout'), 1);
  assert.match(describeAcquis([]), /rien appris/);
});

/** Dépendances factices : on voit quels outils partent. */
function deps(over: Partial<DirectDeps> = {}): DirectDeps & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return { calls, kv: kv(), sessionId: 's', has: (t) => ['reminder_set', 'mode_set', 'admin_enable', 'ha_call', 'ha_states'].includes(t), now: new Date(2026, 10, 11, 22, 30), run: async (name, input) => { calls.push([name, input]); return { ok: true, content: `fait:${name}` }; }, ...over };
}

test('sans IA : l\'heure, les rappels, les droits, les économies et les acquis se disent sans modèle', async () => {
  const d = deps({ texts: { reminders: () => 'Tes rappels : aucun', savings: () => 'Économies : …', rights: () => 'Sur cette machine : administrateur' } });
  const time = await tryDirect('Quelle heure est-il ?', d);
  assert.ok(time.done && /^Il est 22:30, mercredi 11 novembre 2026\.$/.test(time.text), JSON.stringify(time));
  assert.ok((await tryDirect('mes rappels', d)).done);
  const rights = await tryDirect('es-tu administrateur ?', d); assert.ok(rights.done && /administrateur/.test(rights.text));
  const eco = await tryDirect('combien j\'ai économisé ?', d); assert.ok(eco.done && /Économies/.test(eco.text));
  const learned = await tryDirect('ce que tu as appris', d); assert.ok(learned.done && /rien appris/.test(learned.text));
  // Un rappel simple : programmé seul, date calculée, texte sans les mots de date.
  const r = await tryDirect('rappelle-moi demain à 9h de payer la facture EDM', d);
  assert.ok(r.done); assert.deepEqual(d.calls.at(-1), ['reminder_set', { at: '2026-11-12 09:00', text: 'payer la facture EDM' }]);
  // Un rappel qui revient, ou sans date claire : c'est pour l'IA.
  assert.equal((await tryDirect('rappelle-moi tous les lundis de sortir les poubelles', d)).done, false);
  assert.equal((await tryDirect('rappelle-moi de payer la facture', d)).done, false);
  // Rien de net : une IA est nécessaire, avec la raison.
  const no = await tryDirect('trouve-moi une idée de cadeau pour ma mère', d);
  assert.equal(no.done, false); assert.match(no.why, /aucune de mes actions ne correspond clairement/);
});

test('sans IA : un acquis rejoue l\'action sous les mêmes règles, et s\'efface s\'il ne marche plus', async () => {
  const d = deps();
  const a = keep(d.kv, learn({ phrase: 'je file au lit', tool: 'mode_set', input: { mode: 'sommeil' }, label: 'Mode du moment', now: Date.UTC(2026, 10, 10) }) as Acquis);
  const r = await tryDirect('Je file au lit !', d);
  assert.ok(r.done && r.acquis === a.id); assert.deepEqual(d.calls, [['mode_set', { mode: 'sommeil' }]]);
  assert.match(r.done ? r.why : '', /appris le 10 novembre : « je file au lit » → Mode du moment/);
  assert.equal(loadAcquis(d.kv)[0].uses, 1);
  // « As-tu besoin d'une IA pour … ? » : la réponse, sans rien lancer.
  const before = d.calls.length;
  const q1 = await tryDirect('as-tu besoin d\'une IA pour je file au lit ?', d); assert.ok(q1.done && /^Non : « je file au lit »/.test(q1.text));
  const q2 = await tryDirect('as-tu besoin d\'une IA pour écrire un poème sur la mer ?', d); assert.ok(q2.done && /^Oui : pour « écrire un poème sur la mer », il faut une IA/.test(q2.text));
  assert.equal(d.calls.length, before, 'rien n\'a été lancé');
  // Refusé par toi : la réponse est le refus, l'acquis reste. En panne deux fois : oublié, et l'IA reprend.
  const refused = deps({ run: async () => ({ ok: false, content: 'Action refusée.', refused: true }) }); keep(refused.kv, a);
  const rr = await tryDirect('je file au lit', refused); assert.ok(rr.done && rr.text === 'Action refusée.'); assert.equal(loadAcquis(refused.kv).length, 1);
  const broken = deps({ run: async () => ({ ok: false, content: 'Erreur : mode inconnu' }) }); keep(broken.kv, a);
  assert.equal((await tryDirect('je file au lit', broken)).done, false);
  const again = await tryDirect('je file au lit', broken); assert.equal(again.done, false); assert.match(again.done ? '' : again.why, /ne marche plus \(je l'ai oublié\)/);
  assert.equal(loadAcquis(broken.kv).length, 0);
  // « oublie ce dernier acquis », « oublie l'acquis <id> », « oublie tous les acquis ».
  const f = await tryDirect('oublie ce dernier acquis', d); assert.ok(f.done && /C'est oublié/.test(f.text)); assert.equal(loadAcquis(d.kv).length, 0);
  keep(d.kv, a); assert.ok((await tryDirect(`oublie l'acquis ${a.id}`, d)).done); assert.equal(loadAcquis(d.kv).length, 0);
  // Le réglage coupé : les acquis ne servent plus.
  const off = deps({ acquis: false }); keep(off.kv, a);
  assert.equal((await tryDirect('je file au lit', off)).done, false);
  // Un mot de passe de ce poste vient d'être donné : Odin devient administrateur lui-même, aucune IA ne voit rien.
  const adm = deps({ adminSecret: true });
  const ra = await tryDirect('le mot de passe admin de ce poste : [mot de passe reçu — gardé à part, référence secret:dernier]', adm);
  assert.ok(ra.done && /aucune IA ne le voit/.test(ra.why)); assert.deepEqual(adm.calls, [['admin_enable', {}]]);
});

test('agent : une demande qu\'Odin sait faire seul n\'appelle aucune IA, et il le dit', async () => {
  const o = makeOdin([{ text: 'réponse du modèle' }]);
  try {
    const r = await o.agent.run('Quelle heure est-il ?', { sessionId: 'web:principal', channel: 'web' });
    assert.equal(o.provider.calls.length, 0, 'aucun appel à un modèle');
    assert.match(r.text, /^Il est \d\d:\d\d, /);
    assert.deepEqual(r.ai, { needed: false, why: 'l\'heure, je la connais' });
    assert.equal(r.tokensIn + r.tokensOut, 0); assert.equal(r.costUsd, 0);
    assert.equal(iaLine(r), 'Sans IA : l\'heure, je la connais');
    // Le journal garde ce tour (c'est ce qui nourrit les économies), et l'historique de la discussion aussi.
    const row = o.muninn.routes({ turnId: r.turnId })[0];
    assert.equal(row.purpose, 'sans-ia'); assert.equal(row.tokensIn, 0); assert.equal(row.request, 'Quelle heure est-il ?');
    assert.equal(o.muninn.savingsData(0).direct, 1);
    assert.deepEqual(o.muninn.history('web:principal').map((m) => m.role), ['user', 'assistant']);
    // Une demande à rédiger : l'IA répond, et Odin dit pourquoi il en fallait une.
    const r2 = await o.agent.run('Écris-moi un petit mot pour ma voisine', { sessionId: 'web:principal', channel: 'web' });
    assert.equal(o.provider.calls.length, 1);
    assert.deepEqual(r2.ai, { needed: true, why: 'il faut rédiger, expliquer ou raisonner' });
    assert.equal(iaLine(r2), 'Modèle de test a répondu · IA nécessaire : il faut rédiger, expliquer ou raisonner');
    // Le réglage coupé : tout repasse par le modèle.
    const off = makeOdin([{ text: 'Il est midi.' }], { config: (c) => ({ ...c, routing: { ...c.routing, directFirst: false } }) });
    try { await off.agent.run('Quelle heure est-il ?', { sessionId: 's' }); assert.equal(off.provider.calls.length, 1); } finally { off.cleanup(); }
  } finally { o.cleanup(); }
});

test('agent : une demande réglée par l\'IA en une seule action est apprise, puis refaite sans IA ; « non » l\'oublie', async () => {
  const o = makeOdin([call('mode_set', { mode: 'sommeil' }), { text: 'Bonne nuit.' }, { text: 'Désolé, j\'annule.' }, call('mode_set', { mode: 'sommeil' }), { text: 'Bonne nuit.' }]);
  try {
    const S = { sessionId: 'web:principal', channel: 'web' };
    const r1 = await o.agent.run('je file au lit', S);
    assert.equal(o.provider.calls.length, 2, 'la première fois : l\'IA (appel de l\'outil, puis réponse)');
    assert.deepEqual(r1.ai?.needed, true);
    assert.match(r1.notices.join(' '), /J'ai appris : la prochaine fois, « je file au lit » se fera sans IA \(Mode du moment · sommeil\)/);
    assert.equal(loadAcquis(o.muninn).length, 1);
    // La même demande : sans IA, même résultat.
    const r2 = await o.agent.run('Je file au lit !', S);
    assert.equal(o.provider.calls.length, 2, 'la deuxième fois : aucun appel de plus');
    assert.deepEqual(r2.ai?.needed, false); assert.match(r2.ai?.why ?? '', /^appris le .* : « je file au lit » → Mode du moment · sommeil$/);
    assert.match(r2.text, /^Mode du moment · sommeil\n/);
    assert.equal(o.muninn.savingsData(0).learned, 1);
    // « Non, pas ça » juste après : l'acquis est oublié, et la demande repasse par l'IA.
    await o.agent.run('non, pas ça', S);
    assert.equal(loadAcquis(o.muninn).length, 0);
    await o.agent.run('je file au lit', S);
    assert.equal(o.provider.calls.length, 5, 'de nouveau l\'IA');
  } finally { o.cleanup(); }
});

test('agent : rien n\'est appris d\'une tâche planifiée, d\'un contenu extérieur, ni d\'une action que l\'IA a corrigée en route', async () => {
  let o = makeOdin([call('mode_set', { mode: 'sommeil' }), { text: 'ok' }]);
  try { await o.agent.run('je file au lit', { sessionId: 'cron:1', unattended: true }); assert.equal(loadAcquis(o.muninn).length, 0, 'tâche planifiée'); } finally { o.cleanup(); }
  o = makeOdin([call('mode_set', { mode: 'sommeil' }), { text: 'ok' }]);
  try { await o.agent.run('je file au lit', { sessionId: 's', trusted: false }); assert.equal(loadAcquis(o.muninn).length, 0, 'message d\'un tiers'); } finally { o.cleanup(); }
  o = makeOdin([call('mode_set', { mode: 'sommeil' }), call('mode_set', { mode: 'disponible' }), { text: 'ok' }]);
  try { await o.agent.run('je file au lit', { sessionId: 's' }); assert.equal(loadAcquis(o.muninn).length, 0, 'deux réglages du même état : l\'IA s\'est reprise, ce n\'est pas une mission'); } finally { o.cleanup(); }
  o = makeOdin([call('mode_set', { mode: 'sommeil' }), { text: 'ok' }], { config: (c) => ({ ...c, learning: { ...c.learning, direct: false } }) });
  try { await o.agent.run('je file au lit', { sessionId: 's' }); assert.equal(loadAcquis(o.muninn).length, 0, 'réglage coupé'); } finally { o.cleanup(); }
});

test('économies : comptées sur le journal, chiffrées seulement quand il y a de quoi comparer', () => {
  const base: SavingsData = { direct: 0, learned: 0, aiTurns: 0, aiCalls: 0, spentUsd: 0, tokens: 0, byProvider: [], reasons: [] };
  assert.match(savingsReport(savings(base, [])), /Rien à compter/);
  // Trop peu de demandes passées par une IA : pas de chiffre inventé.
  const few = savings({ ...base, direct: 4, aiTurns: 2, aiCalls: 3, spentUsd: 0.04, tokens: 9000 }, []);
  assert.equal(few.avoidedUsd, undefined); assert.equal(Math.round(few.share * 100), 67);
  assert.match(savingsReport(few), /4 tâches faites sans IA : 67 % de tes demandes[\s\S]*Je chiffrerai/);
  // Assez de demandes : moyenne mesurée, économie = tâches sans IA × cette moyenne ; et gain du modèle moins cher.
  const s = savings({ direct: 10, learned: 4, aiTurns: 20, aiCalls: 31, spentUsd: 0.4, tokens: 200_000, reasons: [{ reason: 'action reconnue : Maison', n: 6 }, { reason: 'l\'heure, je la connais', n: 4 }],
    byProvider: [{ provider: 'anthropic:opus', label: 'Claude Opus', calls: 5, tokensIn: 40_000, tokensOut: 4_000, costUsd: 0.3 }, { provider: 'deepseek:chat', label: 'DeepSeek', calls: 26, tokensIn: 150_000, tokensOut: 6_000, costUsd: 0.1 }] },
  [{ name: 'anthropic:opus', priceIn: 5, priceOut: 25 }, { name: 'deepseek:chat', priceIn: 0.5, priceOut: 2 }], 7);
  assert.equal(s.avgTurnUsd, 0.02); assert.ok(Math.abs((s.avoidedUsd ?? 0) - 0.2) < 1e-9); assert.equal(s.avoidedTokens, 100_000);
  assert.ok(Math.abs(s.cheaperUsd - (150_000 * 5 / 1e6 + 6_000 * 25 / 1e6 - 0.1)) < 1e-9); assert.equal(s.reference, 'Claude Opus');
  const txt = savingsReport(s);
  assert.match(txt, /10 tâches faites sans IA, dont 4 grâce à ce que j'ai appris : 33 % de tes demandes/);
  assert.match(txt, /évité environ 0,200 \$ et 100 000 jetons \(une demande confiée à une IA te coûte en moyenne 0,020 \$, mesuré sur 20 demandes\)/);
  assert.match(txt, /plutôt que tout à Claude Opus : environ 0,800 \$ gagnés/);
  assert.match(txt, /Maison \(6\)[\s\S]*7 demandes apprises/);
});

test('le moins cher qui convient : à palier et spécialité égaux, le prix décide ; un modèle qui échoue ne passe pas devant', () => {
  const p = (model: string, o: Partial<ProviderConfig> = {}): ProviderConfig => ({ kind: 'mock', model, tier: 'standard', strengths: ['écriture'], ...o });
  const routes = [p('cher', { priceInPerM: 3, priceOutPerM: 15 }), p('moyen', { priceInPerM: 1, priceOutPerM: 4 }), p('eco', { priceInPerM: 0.3, priceOutPerM: 1.2 }), p('inconnu'), p('codeur', { priceInPerM: 2, priceOutPerM: 8, strengths: ['code'] }), p('fort', { tier: 'strong', priceInPerM: 5, priceOutPerM: 25 })]
    .map((cfg) => ({ provider: Object.assign(new MockProvider([]), { name: `mock:${cfg.model}` }), cfg }));
  const r = new Router(routes as never);
  const names = (o: Parameters<Router['order']>[0]) => r.order(o).map((x) => x.cfg.model);
  // Sans le réglage : l'ordre de ta liste.
  assert.deepEqual(names({ minTier: 'standard', need: 'discussion' }).slice(0, 3), ['cher', 'moyen', 'eco']);
  // Avec : le moins cher d'abord ; prix inconnu après ceux qu'on connaît ; le palier supérieur ensuite.
  assert.deepEqual(names({ minTier: 'standard', need: 'discussion', cheapest: true }), ['eco', 'moyen', 'cher', 'inconnu', 'codeur', 'fort']);
  // La spécialité passe avant le prix : pour du code, le modèle dont c'est la spécialité répond.
  assert.equal(names({ minTier: 'standard', need: 'code', cheapest: true })[0], 'codeur');
  // Un modèle qui échoue trop souvent sur ce type de tâche chez toi ne passe pas devant parce qu'il coûte moins.
  assert.deepEqual(names({ minTier: 'standard', need: 'discussion', cheapest: true, avoid: ['mock:eco'] }).slice(0, 2), ['moyen', 'cher']);
  // Tâche complexe : le plus capable, quel que soit son prix.
  assert.equal(names({ minTier: 'strong', need: 'discussion', cheapest: true })[0], 'fort');
  assert.match(r.why(r.order({ minTier: 'standard', need: 'discussion', cheapest: true })[0], { minTier: 'standard', need: 'discussion', cheapest: true }, 0), /le moins cher qui convient/);
  assert.equal(priceOf(p('local', { tier: 'local' })), 0); assert.equal(priceOf({ kind: 'openai-codex', model: 'gpt' }), 0); assert.equal(priceOf(p('x')), Number.POSITIVE_INFINITY);
});

test('la ligne sous la réponse dit si une IA a servi, et pourquoi', () => {
  assert.equal(iaLine({ ai: { needed: false, why: 'action reconnue : Maison' } }), 'Sans IA : action reconnue : Maison');
  assert.equal(iaLine({ answeredBy: 'Claude Sonnet 5.5 (Anthropic) a répondu', ai: { needed: true, why: 'plusieurs demandes en une' } }), 'Claude Sonnet 5.5 (Anthropic) a répondu · IA nécessaire : plusieurs demandes en une');
  assert.equal(iaLine({ answeredBy: 'Claude Sonnet 5.5 (Anthropic) a répondu', ai: { needed: true, why: '' } }), 'Claude Sonnet 5.5 (Anthropic) a répondu');
  assert.equal(iaLine({ answeredBy: 'aucune IA joignable : réponse sans IA', offline: true, ai: { needed: true, why: 'x' } }), 'aucune IA joignable : réponse sans IA');
  assert.equal(iaLine({}), '');
});

// ---------------------------------------------------------------------------------------------
// Odin lui-même : se redémarrer, se mettre à jour, se régler. Sans IA, et sous les mêmes règles.

test('sans IA : « redémarre-toi », « mets-toi à jour », « ta version », « tes réglages », « passe en prudent »', async () => {
  const d = deps({ has: (t) => ['self_restart', 'update_apply', 'update_check', 'settings_get', 'settings_set', 'mode_set'].includes(t) });
  for (const [phrase, call] of [
    ['Redémarre-toi', ['self_restart', {}]], ['redémarre Odin', ['self_restart', {}]], ['Odin, relance-toi stp', ['self_restart', {}]], ['peux-tu te redémarrer ?', ['self_restart', {}]],
    ['mets-toi à jour', ['update_apply', {}]], ['Mets à jour Odin', ['update_apply', {}]], ['installe la mise à jour', ['update_apply', {}]],
    ['y a-t-il une mise à jour ?', ['update_check', {}]], ['quelle version as-tu ?', ['update_check', {}]], ['es-tu à jour ?', ['update_check', {}]],
    ['tes réglages', ['settings_get', {}]], ['montre-moi tes réglages', ['settings_get', {}]],
    ['passe en prudent', ['settings_set', { reglage: 'autonomie', valeur: 'prudent' }]], ['passe en mode autonome', ['settings_set', { reglage: 'autonomie', valeur: 'autonome' }]], ['autonomie équilibrée', ['settings_set', { reglage: 'autonomie', valeur: 'equilibree' }]],
  ] as Array<[string, [string, Record<string, unknown>]]>) {
    const r = await tryDirect(phrase, d);
    assert.ok(r.done, `${phrase} : ${r.why}`); assert.deepEqual(d.calls.at(-1), call, phrase);
  }
  // Ce qui n'est pas pour Odin lui-même reste à comprendre : rien n'est lancé.
  const n = d.calls.length;
  for (const phrase of ['redémarre', 'relance', 'redémarre le serveur de la boutique', 'mets à jour le site', 'redémarre-toi quand tu auras fini la sauvegarde', 'passe en mode avion'])
    assert.equal((await tryDirect(phrase, d)).done, false, phrase);
  assert.equal(d.calls.length, n);
});

test('réglages : Odin se règle lui-même, dans une liste fermée, et ce qui est sensible demande ton accord', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { DEFAULT_CONFIG } = await import('../src/config.ts'); const { SETTINGS, describeSettings, findSetting, parseValue, settingsTools } = await import('../src/tools/reglages.ts');
  const home = mkdtempSync(join(tmpdir(), 'odin-reglages-')), paths = { home, config: join(home, 'config.json') } as never;
  const cfg = structuredClone(DEFAULT_CONFIG); let level = '';
  const [get, set] = settingsTools(() => ({ paths, cfg, heimdall: { setAutonomy: (a) => { level = a; } } }));
  const ctx = (over: Record<string, unknown> = {}) => ({ fullAccess: true, isTainted: () => false, ...over }) as never;
  const saved = () => JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
  try {
    assert.match(String(await get.run({}, ctx())), /Autonomie \[autonomie\] : equilibre[\s\S]*Sans IA d'abord \[sans_ia_d_abord\] : oui/);
    // Un réglage courant : écrit, appliqué tout de suite, expliqué.
    assert.match(String(await set.run({ reglage: 'sans_ia_d_abord', valeur: 'non' }, ctx())), /✓ Sans IA d'abord : oui → non/);
    assert.equal(cfg.routing.directFirst, false); assert.equal(saved().routing.directFirst, false);
    assert.match(String(await set.run({ reglage: 'Sans IA d\'abord', valeur: 'activé' }, ctx())), /non → oui/, 'par son nom aussi');
    assert.match(String(await set.run({ reglage: 'budget_mensuel', valeur: '10 dollars' }, ctx())), /0 → 10/); assert.equal(saved().routing.monthlyBudgetUsd, 10);
    assert.match(String(await set.run({ reglage: 'autonomie', valeur: 'prudent' }, ctx())), /equilibre → prudent/); assert.equal(level, 'prudent'); assert.equal(cfg.mimir.autonomy, 'prudent');
    assert.match(String(await set.run({ reglage: 'autonomie', valeur: 'prudent' }, ctx())), /déjà sur prudent/);
    // Ce qui baisse la sécurité ou engage de l'argent est « grave » : Heimdall demandera toujours ton accord.
    assert.match(set.grave!({ reglage: 'autonomie', valeur: 'breaker' }) ?? '', /agir seul davantage/);
    assert.equal(set.grave!({ reglage: 'autonomie', valeur: 'prudent' }), undefined, 'baisser l\'autonomie n\'est pas grave');
    assert.match(set.grave!({ reglage: 'mises_a_jour', valeur: 'auto' }) ?? '', /tout seul/);
    assert.match(set.grave!({ reglage: 'double_verification', valeur: 'non' }) ?? '', /deuxième IA/);
    assert.match(set.grave!({ reglage: 'budget_mensuel', valeur: '0' }) ?? '', /retirer la limite/);
    assert.match(set.grave!({ reglage: 'budget_mensuel', valeur: '50' }) ?? '', /monter la limite/);
    assert.equal(set.grave!({ reglage: 'budget_mensuel', valeur: '5' }), undefined);
    assert.equal(set.grave!({ reglage: 'sans_ia_d_abord', valeur: 'non' }), undefined);
    // Valeurs fausses, réglages hors liste : rien n'est écrit.
    assert.match(String(await set.run({ reglage: 'autonomie', valeur: 'total' }, ctx())), /valeurs possibles prudent, equilibre, autonome, breaker/);
    assert.match(String(await set.run({ reglage: 'mot de passe', valeur: 'x' }, ctx())), /Je ne connais pas ce réglage/);
    assert.match(String(await set.run({ reglage: 'providers', valeur: '[]' }, ctx())), /Je ne connais pas ce réglage/);
    assert.equal(findSetting('policy'), undefined); assert.ok(!Object.keys(SETTINGS).some((k) => /cle|secret|pass|token|policy/.test(k)), 'aucun secret ni règle de sécurité dans la liste');
    assert.deepEqual(parseValue(SETTINGS.budget_mensuel, 'beaucoup'), { error: '« Limite de dépense en IA par mois (dollars) » attend un nombre positif.' });
    // Jamais pour quelqu'un d'autre que le propriétaire, jamais après lecture d'un contenu extérieur.
    assert.match(String(await set.run({ reglage: 'autonomie', valeur: 'breaker' }, ctx({ fullAccess: false }))), /Seul le propriétaire/);
    assert.match(String(await set.run({ reglage: 'autonomie', valeur: 'breaker' }, ctx({ isTainted: () => true }))), /contenu extérieur/);
    assert.equal(cfg.mimir.autonomy, 'prudent'); assert.match(describeSettings(cfg), /ne touche pas aux clés ni aux mots de passe/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
