// Ce que DIT la clé d'accès : Odin répond, mais aucun geste ne part sans la validation du propriétaire.
// Décision du propriétaire (24/11) : « Validation avant d'agir » — « Sa phrase est traitée comme un appel extérieur :
// Odin répond, mais te demande avant tout geste. »
//  - une phrase directe (mode de réponse, mode du moment, masquer la conversation, « stop ») ne vaut pas pour la clé ;
//  - une action d'appli, une action grave, une mémoire, un rappel : rien ne part, une validation attend chez le
//    propriétaire et nomme la clé ; sa session valide → c'est fait ; elle refuse, ou personne ne répond → rien ;
//  - un réglage : refusé tout de suite (Odin ne change pas ses réglages pour un texte venu de dehors) ;
//  - une simple lecture part sans validation ;
//  - la clé ne valide rien elle-même ; son message ne va pas dans la conversation du propriétaire ;
//  - la même demande faite par la session marche comme avant.
// Rien n'est reconnu par des mots : c'est le serveur qui marque le message (il porte la clé), dans toutes les langues.
// Un vrai Odin d'essai, dans un dossier temporaire, sur un port libre. Adresses d'exemple seulement.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { DEMANDE_PAR_LA_CLE } from '../src/bifrost/gateway.ts';
import { PAIR_CLE } from '../src/web/cle-acces.ts';
import { lectureLibre } from '../src/core/parole-cle.ts';
import { assembler, sessionsDuFil } from '../src/muninn/fil.ts';
import { getMode } from '../src/tools/everyday.ts';
import { lireTours } from '../src/muninn/tours.ts';
import type { AgentEvent, CompletionRequest } from '../src/types.ts';

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin;
/** Les demandes de validation parties vers l'interface web, et tout ce qu'Odin a écrit à quelqu'un. */
const parties: Array<{ peer: string; id: string; reason: string; severity?: string; summary: string }> = [];
const envois: Array<{ peer: string; text: string }> = [];
const lances: Array<{ peer: string; outil: string }> = [];
const dorm = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function attendre(f: () => boolean, ms = 8000): Promise<boolean> { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await dorm(40); } return true; }

/** Ce que le faux modèle fait quand le message porte « [essai:<code>] » : un seul appel d'outil, puis « fait ». */
const PLAN: Record<string, { name: string; input: Record<string, unknown> }> = {
  radio: { name: 'valhalla', input: { action: 'action', appli: 'aegir', quoi: 'radio', entree: JSON.stringify({ nom: 'Radio du lagon', adresse: 'http://127.0.0.1:9/flux' }) } },
  grave: { name: 'shell', input: { command: 'rm -rf essai-cle-dossier-absent' } },
  memoire: { name: 'memory_save', input: { content: 'Le portail du jardin se ferme à 19 h', kind: 'fact' } },
  reglage: { name: 'settings_set', input: { reglage: 'autonomie', valeur: 'autonome' } },
  rappel: { name: 'reminder_set', input: { at: 'dans 2 heures', text: 'arroser le manguier' } },
  automatisation: { name: 'draupnir', input: { action: 'creer', description: 'chaque matin, envoyer la météo' } },
  mode: { name: 'mode_set', input: { mode: 'conduite' } },
  lecture: { name: 'memory_search', input: { query: 'portail' } },
  applis: { name: 'valhalla', input: { action: 'lister' } },
  marche: { name: 'memory_save', input: { content: 'Le marché est le samedi matin', kind: 'fact' } },
  ecrit: { name: 'fs_write', input: { path: 'essai-session.txt', content: 'écrit par la session' } },
};
let n = 0;
function modele(req: CompletionRequest): { text?: string; toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }> } {
  const dernier = req.messages.at(-1);
  if (dernier?.role === 'tool') return { text: 'fait' };
  const dit = [...req.messages].reverse().find((m) => m.role === 'user');
  const code = /\[essai:([a-z]+)\]/.exec(String(dit?.content ?? ''))?.[1];
  const c = code ? PLAN[code] : undefined;
  return c ? { toolCalls: [{ id: `c_${++n}`, name: c.name, input: c.input }] } : { text: 'bien reçu' };
}

function brut(methode: string, chemin: string, corps: unknown, entetes: Record<string, string>): Promise<{ status: number; texte: string }> {
  return new Promise((ok, ko) => {
    const data = corps === undefined ? '' : JSON.stringify(corps);
    const r = request({ host: '127.0.0.1', port: v.port, method: methode, path: chemin, headers: { 'content-type': 'application/json', 'x-odin': '1', 'content-length': String(Buffer.byteLength(data)), ...entetes } }, (res) => {
      const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => ok({ status: res.statusCode ?? 0, texte: Buffer.concat(p).toString('utf8') }));
    });
    r.on('error', ko); r.end(data);
  });
}
const cle = () => ({ authorization: `Bearer ${v.token}` });
/** La clé parle par la page (/api/message) ; rend quand le serveur a pris le message. */
const cleDit = (text: string) => brut('POST', '/api/message', { text }, cle());
/** La session du propriétaire parle. */
const sessionDit = async (text: string) => { const r = await v.json('/api/message', { text }); assert.equal(r.status, 202); };
const repondre = (id: string, oui: boolean) => v.json('/api/message', { text: `/${oui ? 'yes' : 'no'} ${id}` });
/** Attend qu'Odin ait fini de répondre à ce pair (une réponse de plus qu'avant). */
async function reponseDe(peer: string, avant: number): Promise<string> {
  assert.ok(await attendre(() => envois.filter((e) => e.peer === peer && !/\/yes \S+/.test(e.text)).length > avant, 15_000), `Odin répond à ${peer}`);
  return envois.filter((e) => e.peer === peer && !/\/yes \S+/.test(e.text)).at(-1)!.text;
}
const reponses = (peer: string) => envois.filter((e) => e.peer === peer && !/\/yes \S+/.test(e.text)).length;
const radios = async () => String((await valhallaOf()!.module('aegir')!.view(valhallaOf()!.ctx('aegir'), new URLSearchParams())).subtitle ?? '');
const memoires = () => v.o.muninn.listMemories(200).filter((m) => m.content.includes('portail du jardin'));
const rappels = () => v.o.muninn.listJobs().filter((j) => /manguier/.test(j.prompt));

/** La clé demande (avec le code d'un outil) : une validation part vers le propriétaire. Rend cette demande. */
async function cleDemande(code: string, phrase: string): Promise<(typeof parties)[number]> {
  const avant = parties.length;
  assert.equal((await cleDit(`${phrase} [essai:${code}]`)).status, 202);
  assert.ok(await attendre(() => parties.length === avant + 1), `${code} : une validation attend le propriétaire`);
  const q = parties.at(-1)!;
  assert.equal(q.peer, v.web.defaultPeer, `${code} : la demande va au propriétaire, pas à la clé`);
  assert.ok(q.reason.startsWith(DEMANDE_PAR_LA_CLE), `${code} : la demande nomme la clé (« ${q.reason.slice(0, 80)} »)`);
  assert.ok(envois.some((e) => e.peer === v.web.defaultPeer && e.text.includes(`/yes ${q.id}`) && e.text.includes(DEMANDE_PAR_LA_CLE)), `${code} : le message de validation nomme la clé`);
  assert.ok(v.web.validationsEnAttente().some((x) => x.id === q.id && x.reason.startsWith(DEMANDE_PAR_LA_CLE)), `${code} : « À faire » nomme la clé`);
  return q;
}

before(async () => {
  console.log = () => {}; console.error = () => {}; console.warn = () => {};
  v = await vraiOdin(tt, { compte: true, script: modele, modules: (o) => allModules(o).filter((m) => ['aegir', 'var'].includes(m.id)) });
  v.o.cfg.web.portsParAppli = false;
  const ev = v.web.event.bind(v.web), envoyer = v.web.send.bind(v.web);
  v.web.event = (peer: string, e: AgentEvent) => {
    if (e.type === 'approval') { const a = e as unknown as { id: string; reason: string; severity?: string; summary: string }; parties.push({ peer, id: a.id, reason: a.reason, severity: a.severity, summary: a.summary }); }
    if (e.type === 'tool_start') lances.push({ peer, outil: String((e as unknown as { name: string }).name) });
    ev(peer, e);
  };
  v.web.send = async (peer: string, text: string, opts?: never) => { envois.push({ peer, text }); return envoyer(peer, text, opts); };
});
after(async () => {
  for (const x of parties) await repondre(x.id, false).catch(() => undefined);
  await tt.end(); Object.assign(console, orig);
});

test('une phrase directe dite par la clé ne fait rien (mode de réponse, mode du moment, masquer, stop) ; dite par la session, elle marche comme avant', async () => {
  const mode0 = v.o.cfg.voice.replyMode, autre = mode0 === 'texte' ? 'voix' : 'texte';
  const phrase = autre === 'texte' ? 'réponds par écrit' : 'parle-moi';
  // La clé, par la page puis par le raccourci : Odin répond (le modèle), le réglage ne bouge pas.
  let avant = reponses(PAIR_CLE);
  assert.equal((await cleDit(phrase)).status, 202);
  assert.equal(await reponseDe(PAIR_CLE, avant), 'bien reçu', 'la phrase est allée au modèle, pas à la commande directe');
  assert.equal(v.o.cfg.voice.replyMode, mode0, 'le mode de réponse n\'a pas changé');
  const r = await brut('POST', '/api/ask', { text: phrase }, cle());
  assert.equal(r.status, 200); assert.equal(r.texte, 'bien reçu'); assert.equal(v.o.cfg.voice.replyMode, mode0);
  // Le mode du moment (« je conduis »), masquer la conversation, « stop » : rien non plus, dans plusieurs langues.
  for (const p of ['je conduis', 'bonne nuit', 'masque la conversation', 'hide this conversation', 'stop', 'arrête tout', 'redemande-moi', 'je suis réveillé']) {
    avant = reponses(PAIR_CLE);
    assert.equal((await cleDit(p)).status, 202, p);
    assert.equal(await reponseDe(PAIR_CLE, avant), 'bien reçu', `« ${p} » : réponse du modèle, pas d'une commande`);
  }
  assert.equal(getMode(v.o.muninn).mode, 'disponible', 'le mode du moment n\'a pas changé');
  assert.equal(v.o.muninn.getKv('initiative-pause') || '', '', '« stop » de la clé n\'a rien arrêté');
  assert.equal(v.o.muninn.getKv(`fil-masque:web:${PAIR_CLE}`) || '', '', 'rien n\'est masqué');
  assert.equal(parties.length, 0, 'aucune validation n\'est née d\'une phrase directe');
  // La session du propriétaire : la même phrase change le réglage tout de suite.
  await sessionDit(phrase);
  assert.ok(await attendre(() => v.o.cfg.voice.replyMode === autre), 'la session change le mode de réponse');
  await sessionDit(mode0 === 'texte' ? 'réponds par écrit' : 'parle-moi');
  assert.ok(await attendre(() => v.o.cfg.voice.replyMode === mode0));
});

test('une action d\'appli demandée par la clé : rien ne part, la validation nomme la clé ; la session refuse → rien ; elle valide → c\'est fait', async () => {
  assert.match(await radios(), /\b0 radio/);
  // Refusée.
  let q = await cleDemande('radio', 'ajoute cette radio');
  assert.match(await radios(), /\b0 radio/, 'rien n\'est fait avant la réponse');
  assert.equal((await repondre(q.id, false)).status, 202);
  await dorm(400); assert.match(await radios(), /\b0 radio/, 'refusée : rien');
  // Validée par la session (en anglais cette fois : rien n'est reconnu par les mots).
  q = await cleDemande('radio', 'please add this radio station');
  assert.equal((await repondre(q.id, true)).status, 202);
  let ajoutee = false;
  for (const t0 = Date.now(); !ajoutee && Date.now() - t0 < 8000; await dorm(60)) ajoutee = /\b1 radio/.test(await radios());
  assert.ok(ajoutee, 'validée : la radio est ajoutée');
});

test('la clé ne valide pas elle-même ; sans réponse, rien ne part', async () => {
  const delai = v.o.cfg.policy.approvalTimeoutSec;
  const q = await cleDemande('rappel', 'ukumbushe kumwagilia mwembe');
  for (const mot of [`/yes ${q.id}`, 'oui', 'yes', 'ok', 'toujours']) {
    assert.equal((await cleDit(mot)).status, 403, `la clé répond « ${mot} »`);
    assert.equal((await brut('POST', '/api/ask', { text: mot }, cle())).status, 403);
  }
  await dorm(300);
  assert.equal(rappels().length, 0, 'la demande attend toujours');
  assert.ok(v.web.validationsEnAttente().some((x) => x.id === q.id));
  assert.equal((await repondre(q.id, false)).status, 202);
  // Personne ne répond : au bout du délai, c'est non.
  v.o.cfg.policy.approvalTimeoutSec = 1;
  try {
    const avant = reponses(PAIR_CLE);
    await cleDemande('rappel', 'rappelle-moi d\'arroser le manguier');
    await reponseDe(PAIR_CLE, avant);
    assert.equal(rappels().length, 0, 'sans réponse : aucun rappel programmé');
  } finally { v.o.cfg.policy.approvalTimeoutSec = delai; }
});

test('un rappel et une mémoire demandés par la clé : validation d\'abord ; validés par la session, ils sont faits', async () => {
  let q = await cleDemande('rappel', 'リマインダーを設定して');
  assert.equal(rappels().length, 0);
  assert.equal((await repondre(q.id, true)).status, 202);
  assert.ok(await attendre(() => rappels().length === 1), 'validé : le rappel est programmé');
  // La mémoire : un outil classé « lecture » (il écrit en quarantaine) ; pour la clé, c'est un geste.
  q = await cleDemande('memoire', 'retiens ceci');
  assert.equal(memoires().length, 0, 'rien n\'est retenu avant la réponse');
  assert.equal((await repondre(q.id, false)).status, 202);
  await dorm(400); assert.equal(memoires().length, 0, 'refusée : rien n\'est retenu');
  q = await cleDemande('memoire', 'تذكّر هذا');
  assert.equal((await repondre(q.id, true)).status, 202);
  assert.ok(await attendre(() => memoires().length === 1), 'validée : c\'est retenu');
  assert.equal(memoires()[0].origin, 'untrusted', 'et gardé « à vérifier » (venu de dehors)');
  // Le mode du moment par l'outil (classé « lecture » lui aussi) : validation.
  q = await cleDemande('mode', 'modo conducción');
  assert.equal(getMode(v.o.muninn).mode, 'disponible');
  assert.equal((await repondre(q.id, false)).status, 202);
  await dorm(300); assert.equal(getMode(v.o.muninn).mode, 'disponible');
});

test('une action grave demandée par la clé : validation « grave » qui nomme la clé ; refusée, rien n\'est lancé ; validée, elle part', async () => {
  let q = await cleDemande('grave', 'supprime ce dossier');
  assert.equal(q.severity, 'grave');
  const avant = lances.filter((l) => l.outil === 'shell').length;
  assert.equal((await repondre(q.id, false)).status, 202);
  await dorm(400); assert.equal(lances.filter((l) => l.outil === 'shell').length, avant, 'refusée : la commande n\'est pas lancée');
  q = await cleDemande('grave', 'delete that folder');
  assert.equal((await repondre(q.id, true)).status, 202);
  assert.ok(await attendre(() => lances.filter((l) => l.outil === 'shell').length === avant + 1), 'validée par la session : la commande est lancée');
});

test('un réglage et une automatisation demandés par la clé : rien ne change', async () => {
  const autonomie = v.o.heimdall.getAutonomy();
  const nb = parties.length, avant = reponses(PAIR_CLE);
  assert.equal((await cleDit('passe en autonome [essai:reglage]')).status, 202);
  await reponseDe(PAIR_CLE, avant);
  assert.equal(v.o.heimdall.getAutonomy(), autonomie, 'le réglage n\'a pas changé');
  assert.equal(parties.length, nb, 'un réglage n\'est même pas proposé à la validation : refusé tout de suite');
  assert.ok(!lances.some((l) => l.outil === 'settings_set'));
  // Créer une automatisation : une validation attend ; refusée, rien n'est lancé.
  const q = await cleDemande('automatisation', 'crée une automatisation');
  assert.equal((await repondre(q.id, false)).status, 202);
  await dorm(300); assert.ok(!lances.some((l) => l.outil === 'draupnir'));
});

test('une simple lecture demandée par la clé part sans validation ; la liste des lectures est fermée', async () => {
  const nb = parties.length;
  for (const code of ['lecture', 'applis']) {
    const avant = reponses(PAIR_CLE), lus = lances.length;
    assert.equal((await cleDit(`dis-moi [essai:${code}]`)).status, 202);
    assert.equal(await reponseDe(PAIR_CLE, avant), 'fait');
    assert.equal(lances.length, lus + 1, `${code} : l'outil de lecture a été lancé`);
  }
  assert.equal(parties.length, nb, 'aucune validation pour une lecture');
  // La règle : une lecture écrite ici passe ; tout le reste (même classé « lecture » ailleurs, même nouveau) est un geste.
  for (const [nom, entree, libre] of [
    ['memory_search', {}, true], ['note_find', {}, true], ['schedule_list', {}, true], ['settings_get', {}, true],
    // Relecture du 24/11 : lire un fichier de la machine ou sortir vers Internet n'est pas une lecture libre.
    ['fs_read', {}, false], ['fs_list', {}, false], ['doc_read', {}, false], ['web_search', {}, false], ['web_fetch', {}, false], ['web_research', {}, false], ['skill_read', {}, false],
    ['memory_save', {}, false], ['mode_set', {}, false], ['skill_propose', {}, false], ['doc_index', {}, false], ['delegate', {}, false], ['browser_open', {}, false], ['net_scan', {}, false], ['outil_de_demain', {}, false],
    ['valhalla', { action: 'lister' }, true], ['valhalla', { action: 'etat' }, true], ['valhalla', { action: 'action' }, false], ['valhalla', { action: 'auto' }, false], ['valhalla', { action: 'manip' }, false], ['valhalla', {}, false], ['valhalla', { action: ['lister'] }, false],
    ['draupnir', { action: 'lister' }, true], ['draupnir', { action: 'voir' }, false], ['draupnir', { action: 'creer' }, false], ['__proto__', {}, false], ['constructor', { action: 'lister' }, false],
  ] as Array<[string, Record<string, unknown>, boolean]>) assert.equal(lectureLibre(nom, entree), libre, `${nom} ${JSON.stringify(entree)}`);
});

test('le message de la clé ne va pas dans la conversation du propriétaire, et ne la marque pas', async () => {
  const principal = () => v.o.muninn.allMessages(`web:${v.web.defaultPeer}`).filter((m) => m.role === 'user').map((m) => String(m.content));
  const avant = reponses(PAIR_CLE), marque = 'phrase-de-la-cle-7f3a';
  const r = await cleDit(`raconte-moi ma journée ${marque}`);
  assert.equal(r.status, 202); assert.equal(JSON.parse(r.texte).peer, PAIR_CLE, 'le serveur dit où lire la réponse');
  await reponseDe(PAIR_CLE, avant);
  assert.ok(!principal().some((t) => t.includes(marque)), 'rien dans la conversation du propriétaire');
  assert.ok(v.o.muninn.allMessages(`web:${PAIR_CLE}`).some((m) => m.role === 'user' && String(m.content).includes(marque)), 'la phrase est dans la conversation de la clé');
  assert.notEqual(v.o.muninn.getSession(`web:${v.web.defaultPeer}`)?.tainted, 1, 'la conversation du propriétaire n\'est pas marquée');
  assert.equal(v.o.muninn.getSession(`web:${PAIR_CLE}`)?.tainted, 1, 'celle de la clé l\'est (texte venu de dehors)');
  // Le journal des tours ne dit pas « le propriétaire a demandé » pour ce que la clé a dit (page et raccourci).
  const tours = lireTours(v.o.muninn.dir!).filter((t) => t.fil === `web:${PAIR_CLE}` || t.fil === 'web:raccourci');
  assert.ok(tours.some((t) => t.fil === `web:${PAIR_CLE}`) && tours.some((t) => t.fil === 'web:raccourci'), 'les tours de la clé sont notés');
  for (const t of tours) assert.notEqual(t.qui, 'propriétaire', `tour ${t.fil} noté au nom de ${t.qui}`);
  // Un pair envoyé dans le corps ne compte pas : la clé ne choisit pas sa conversation.
  assert.equal(JSON.parse((await brut('POST', '/api/message', { text: `encore ${marque}`, peer: v.web.defaultPeer }, cle())).texte).peer, PAIR_CLE);
  // Le fil du propriétaire : la conversation de la clé n'y est pas ; le raccourci du téléphone y reste, sans l'enveloppe.
  const sessions = v.o.muninn.listSessions(200).map((s) => ({ id: s.id, channel: s.channel, title: s.title }));
  assert.ok(sessions.some((s) => s.id === `web:${PAIR_CLE}`));
  assert.ok(!sessionsDuFil({ proprio: true }, sessions, { ecrans: true }).includes(`web:${PAIR_CLE}`), 'pas dans le fil du propriétaire');
  const bulles = assembler([{ id: 'web:raccourci', channel: 'web', title: '' }], (id) => v.o.muninn.allMessages(id));
  const dites = bulles.filter((b) => b.role === 'user');
  assert.ok(dites.length > 0, 'le raccourci a parlé (premier essai)');
  for (const b of dites) assert.doesNotMatch(b.texte, /<\/?untrusted/, 'le fil montre le texte, pas l\'enveloppe');
});

test('la même demande faite par la session du propriétaire marche comme avant (aucune validation en plus)', async () => {
  const nb = parties.length, avant = reponses(v.web.defaultPeer);
  await sessionDit('écris ce fichier [essai:ecrit]');
  assert.equal(await reponseDe(v.web.defaultPeer, avant), 'fait');
  assert.ok(lances.some((l) => l.peer === v.web.defaultPeer && l.outil === 'fs_write'), 'la session écrit sans validation');
  const avant2 = reponses(v.web.defaultPeer);
  await sessionDit('retiens que le marché est le samedi [essai:marche]');
  await reponseDe(v.web.defaultPeer, avant2);
  const retenu = v.o.muninn.listMemories(200).filter((m) => m.content.includes('samedi matin'));
  assert.equal(retenu.length, 1, 'la session retient sans validation'); assert.equal(retenu[0].origin, 'agent', 'et pas « à vérifier »');
  assert.equal(parties.length, nb, 'aucune validation pour la session');
  assert.equal(parties.filter((p) => !p.reason.startsWith(DEMANDE_PAR_LA_CLE)).length, 0);
});
