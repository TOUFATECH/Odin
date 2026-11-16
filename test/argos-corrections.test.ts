// Corrections de la console EDR (Argos), de l'anti-malware (Méduse) et des réponses sur un poste.
// Rien ici ne contacte un vrai service ni n'isole un vrai poste : on travaille sur un dossier temporaire et sur les
// fonctions pures (consignes, corrélation). Aucun vrai malware : les signaux sont des données fabriquées.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { allModules } from '../src/valhalla/odin.ts';
import { makeOdin } from './helpers.ts';
import { ingererTelemetrie } from '../src/valhalla/argos/endpoints.ts';
import { chargerIncidentsParc, corrélerPoste, signauxTelemetrie } from '../src/valhalla/argos/incidents-parc.ts';
import { normaliserTelemetrie, type Telemetrie } from '../src/valhalla/compagnon/telemetrie.ts';
import { Correlator, type Signal } from '../src/valhalla/ullr/incidents.ts';
import { commandeDeConsigne, isolerPosix, isolerWindows, verifierConsigne, type ConsigneReponse } from '../src/valhalla/compagnon/reponse.ts';
import { construireConsigne } from '../src/valhalla/argos/reponse.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'argos-corr-'));
const apps = (id: string) => id;
function telemetrie(poste: string, o: Partial<Telemetrie> = {}): Telemetrie {
  return normaliserTelemetrie(poste, { sys: o.sys ?? 'windows', processus: o.processus ?? [{ pid: 10, ppid: 1, nom: 'explorer.exe', chemin: 'C:\\Windows\\explorer.exe' }], connexions: o.connexions ?? [], persistance: o.persistance ?? [], ...(o.rafale ? { rafale: o.rafale } : {}) });
}

// ---- Défaut 2 : les connexions sortantes des postes sont comparées aux adresses malveillantes ----
test('défaut 2 — sans jugement d\'adresse, une connexion vers un C2 ne fait aucun signal ; avec, elle en fait un', () => {
  const t = telemetrie('Satellite-salon', { connexions: [{ rip: '203.0.113.66', rport: 4444, prog: 'svc.exe' }] as never });
  // Reproduit le défaut : sans `malveillante`, aucun signal geri.malveillant.
  assert.equal(signauxTelemetrie(t).filter((s) => s.app === 'geri').length, 0, 'aucun signal réseau sans jugement');
  // Corrigé : une fonction qui connaît l\'adresse → un signal geri.malveillant qui porte l\'IP et le poste.
  const sigs = signauxTelemetrie(t, { malveillante: (ip) => ip === '203.0.113.66' });
  const g = sigs.find((s) => s.app === 'geri' && s.type === 'malveillant');
  assert.ok(g && g.ip === '203.0.113.66' && g.poste === 'Satellite-salon', 'le signal porte l\'IP et le poste');
});

test('défaut 2 — un incident de poste se forme et mentionne la connexion malveillante', () => {
  const home = tmp();
  try {
    const t = telemetrie('Satellite-salon', {
      processus: [{ pid: 10, ppid: 1, nom: 'explorer.exe', chemin: 'C:\\Windows\\explorer.exe' }, { pid: 77, ppid: 10, nom: 'svc.exe', chemin: 'C:\\Users\\p\\AppData\\Local\\Temp\\svc.exe' }],
      connexions: [{ rip: '203.0.113.66', rport: 4444, prog: 'svc.exe' }] as never,
    });
    const { annonces } = corrélerPoste(home, t, apps, { malveillante: (ip) => ip === '203.0.113.66' });
    assert.ok(annonces.length >= 1, 'un incident est annoncé');
    assert.ok(annonces[0].signals.some((s) => s.app === 'geri' && s.ip === '203.0.113.66'), 'la connexion malveillante est dans l\'incident');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ---- Défaut 7 : pas de « bannir » affirmé sur un incident de poste (rien n'est banni depuis corrélerPoste) ----
test('défaut 7 — un incident de poste n\'inscrit pas « bannir … » (aucun bannissement n\'a lieu)', () => {
  const now = Date.now();
  const sigParc: Signal = { at: now, app: 'geri', type: 'malveillant', keys: ['ip:198.51.100.9', 'prog:svc', 'machine'], weight: 60, text: 'svc parle à 198.51.100.9', anchor: true, ip: '198.51.100.9', poste: 'Satellite-salon' };
  const sigParc2: Signal = { at: now, app: 'skogul', type: 'suspect', keys: ['prog:svc', 'pid:77', 'machine'], weight: 45, text: 'processus suspect', anchor: true, pid: 77, poste: 'Satellite-salon' };
  const corrP = new Correlator();
  corrP.add(sigParc, apps); const rP = corrP.add(sigParc2, apps);
  assert.ok(rP.incident && rP.incident.score >= 60, 'incident de poste formé');
  assert.ok(!rP.incident!.done.some((d) => d.startsWith('bannir ')), 'aucun bannissement affirmé pour un poste');
  assert.equal(rP.responses.length, 0, 'aucune réponse de bannissement');
  // La machine d'Odin (sans poste) garde son comportement : elle, bannit bien.
  const corrO = new Correlator();
  corrO.add({ ...sigParc, poste: undefined }, apps); const rO = corrO.add({ ...sigParc2, poste: undefined }, apps);
  assert.ok(rO.incident!.done.some((d) => d === 'bannir 198.51.100.9'), 'la machine d\'Odin bannit toujours');
});

// ---- Défauts 3 et 6 : l'isolement exige une IP d'Odin, jamais un nom ; aucun « tout passer » ----
test('défauts 3 et 6 — isoler exige une IP d\'Odin (un nom est refusé)', () => {
  assert.ok(verifierConsigne({ id: 'a', genre: 'isoler', at: 0, odin: 'odin' }), 'un nom est refusé');
  assert.ok(verifierConsigne({ id: 'a', genre: 'isoler', at: 0, odin: 'odin.maison' }), 'un nom d\'hôte est refusé');
  assert.equal(verifierConsigne({ id: 'a', genre: 'isoler', at: 0, odin: '192.168.1.10' }), undefined, 'une IP est acceptée');
  assert.throws(() => construireConsigne('isoler', { odin: 'odin' }), /adresse IP d'Odin/);
});

test('défauts 3 et 6 — avec un nom, aucune commande d\'isolement n\'est produite ; avec une IP, elle garde Odin', () => {
  const nom: ConsigneReponse = { id: 'a', genre: 'isoler', at: 0, odin: 'odin' };
  assert.equal(commandeDeConsigne(nom, 'windows'), undefined, 'rien de produit pour un nom (Windows)');
  assert.equal(commandeDeConsigne(nom, 'macos'), undefined, 'rien de produit pour un nom (macOS)');
  // macOS : jamais « to any » (qui laisserait tout sortir) ; l'IP d'Odin est autorisée.
  const pf = isolerPosix('macos', '192.168.1.10');
  assert.ok(!/to any\b(?!\s+port)/.test(pf.replace('to any port 53', '')) && pf.includes('pass out quick to 192.168.1.10'), 'macOS autorise l\'IP, pas « to any »');
  // Linux : l'IP d'Odin est autorisée explicitement (pas un port ouvert vers n'importe qui).
  const nft = isolerPosix('linux', '192.168.1.10');
  assert.ok(nft.includes('ip daddr 192.168.1.10') && !nft.includes('dport 8888'), 'Linux autorise l\'IP, pas le port 8888 vers tous');
  // Windows : la règle d'autorisation d'Odin porte l'IP.
  assert.ok(isolerWindows('192.168.1.10').includes("RemoteAddress '192.168.1.10'"), 'Windows autorise l\'IP d\'Odin');
});

// ---- Défaut 4 : « Analyser un poste » depuis l'EDR mappe le dossier et route selon le compagnon ----
test('défaut 4 — un poste sans compagnon : l\'analyse part vers Asclépios avec le dossier mappé en « où »', async () => {
  const home = tmp();
  try {
    const o = makeOdin([{ text: 'ok' }]);
    try {
      const argos = allModules(o as never).find((x) => x.id === 'argos')!;
      const a = argos.actions.find((x) => x.id === 'analyser_poste')!;
      const vus: Array<{ module: string; action: string; input: Record<string, unknown> }> = [];
      const ctx = { home, now: () => new Date(), call: async (module: string, action: string, input: Record<string, unknown>) => { vus.push({ module, action, input }); return { ok: true, text: 'lancée' }; } } as never;
      const r = await a.run(ctx, { poste: 'Atelier', dossier: 'C:\\Users' });
      assert.equal(r.ok, true);
      assert.equal(vus.length, 1);
      assert.equal(vus[0].module, 'ullr'); assert.equal(vus[0].action, 'analyser_poste');
      assert.equal(vus[0].input.ou, 'C:\\Users', 'le dossier devient « où » (plus perdu)');
      assert.equal(vus[0].input.quoi, 'tout');
    } finally { o.cleanup(); }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ---- Défaut 5 : la fiche d'un incident montre l'arbre des processus du poste ----
test('défaut 5 — la fiche d\'un incident de poste inclut l\'arbre des processus', async () => {
  const home = tmp();
  try {
    const o = makeOdin([{ text: 'ok' }]);
    try {
      // Un poste avec des processus (filiation) + une rafale qui ouvre un incident sur ce poste.
      const t = telemetrie('NAS-maison', {
        processus: [{ pid: 1, ppid: 0, nom: 'init', chemin: '/init' }, { pid: 20, ppid: 1, nom: 'bash', chemin: '/bin/bash' }, { pid: 99, ppid: 20, nom: 'crypt', chemin: '/tmp/crypt' }] as never,
        rafale: { nombre: 80, secondes: 20, dossier: '\\\\NAS\\partage' },
      });
      ingererTelemetrie(home, t);
      const { incidents } = corrélerPoste(home, t, apps);
      const inc = incidents.find((i) => i.state === 'ouvert')!;
      const argos = allModules(o as never).find((x) => x.id === 'argos')!;
      const a = argos.actions.find((x) => x.id === 'incident')!;
      const ctx = { home, now: () => new Date() } as never;
      const r = await a.run(ctx, { id: inc.id });
      assert.match(r.text, /Arbre des processus de NAS-maison/, 'l\'arbre est rendu dans le texte');
      assert.match(r.text, /crypt \(99\)/, 'un processus du poste apparaît dans l\'arbre');
      assert.ok(Array.isArray((r.data as { arbre?: unknown[] }).arbre) && (r.data as { arbre: unknown[] }).arbre.length > 0, 'l\'arbre est aussi dans les données');
    } finally { o.cleanup(); }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ---- Défaut 1 (côté console) : l'état de chaque protection reste présent et coloré par le résultat ----
test('défaut 1 — l\'action « incidents » et « etat » existent, et Méduse a bien une action « etat »', () => {
  const o = makeOdin([{ text: 'ok' }]);
  try {
    const mods = allModules(o as never);
    const argos = mods.find((x) => x.id === 'argos')!;
    const geri = mods.find((x) => x.id === 'geri')!;
    assert.ok(argos.actions.some((a) => a.id === 'etat'), 'Argos a « etat »');
    assert.ok(geri.actions.some((a) => a.id === 'etat'), 'Méduse (geri) a désormais « etat » (plus d\'« Action inconnue »)');
  } finally { o.cleanup(); }
});
