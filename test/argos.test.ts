// Argos, l'appli EDR : elle est bien enregistrée (console, famille Sécurité, port), elle range la télémétrie des postes
// en chronologie, et elle fait des incidents actionnables par poste en réutilisant le moteur d'Asclépios (sans le
// dupliquer). On travaille sur un dossier temporaire, sans aucun vrai poste.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_DIRECT } from '../src/valhalla/ports.ts';
import { ingererTelemetrie, poste as posteDe, postes as postesDe } from '../src/valhalla/argos/endpoints.ts';
import { chargerIncidentsParc, corrélerPoste, réglerIncidentParc, signauxTelemetrie } from '../src/valhalla/argos/incidents-parc.ts';
import { normaliserTelemetrie, type Telemetrie } from '../src/valhalla/compagnon/telemetrie.ts';
import { makeOdin } from './helpers.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'argos-'));
const apps = (id: string) => id;

function telemetrie(poste: string, o: Partial<Telemetrie> = {}): Telemetrie {
  return normaliserTelemetrie(poste, {
    sys: o.sys ?? 'windows',
    processus: o.processus ?? [{ pid: 10, ppid: 1, nom: 'explorer.exe', chemin: 'C:\\Windows\\explorer.exe' }],
    connexions: o.connexions ?? [],
    persistance: o.persistance ?? [],
    ...(o.rafale ? { rafale: o.rafale } : {}),
  });
}

test('Argos est enregistrée : console de sécurité, famille Sécurité, port 8112, veille et tâche quotidienne', () => {
  const o = makeOdin([{ text: 'ok' }]);
  try {
    const m = allModules(o as never).find((x) => x.id === 'argos');
    assert.ok(m, 'Argos est dans allModules');
    assert.equal(m!.family, 'Sécurité');
    assert.equal(DEFAULT_DIRECT.argos, 8112);
    assert.ok(m!.watch, 'une veille');
    const taches = m!.taches?.({ settings: {}, now: () => new Date() } as never) ?? [];
    const t = taches.find((x) => x.id === 'maj_quotidienne');
    assert.ok(t, 'la tâche quotidienne de mises à jour');
    assert.ok(m!.actions.some((a) => a.id === t!.lancer.action), 'son action existe');
    assert.ok(m!.actions.some((a) => a.id === 'etat') && m!.actions.some((a) => a.id === 'incidents'), 'actions état et incidents');
    // Les réponses graves demandent l'accord et savent se défaire.
    for (const id of ['tuer', 'quarantaine_poste', 'isoler_poste']) { const a = m!.actions.find((x) => x.id === id)!; assert.ok(a.grave, `${id} est grave`); }
  } finally { o.cleanup(); }
});

test('la télémétrie d\'un poste est rangée en chronologie, et ce qui est louche est signalé', () => {
  const home = tmp();
  try {
    const t1 = telemetrie('Portable-Pierre');
    const { nouveaux } = ingererTelemetrie(home, t1);
    assert.ok(nouveaux.some((e) => e.genre === 'telemetrie'), 'premier relevé noté');
    // Un nouveau processus louche apparaît : il rejoint la chronologie en « attention ».
    const t2 = telemetrie('Portable-Pierre', { processus: [{ pid: 10, ppid: 1, nom: 'explorer.exe', chemin: 'C:\\Windows\\explorer.exe' }, { pid: 50, ppid: 10, nom: 'maj.exe', chemin: 'C:\\Users\\p\\AppData\\Local\\Temp\\maj.exe' }] });
    const r2 = ingererTelemetrie(home, t2);
    assert.ok(r2.nouveaux.some((e) => e.genre === 'processus' && e.tone === 'attention'), 'processus louche signalé');
    const p = posteDe(home, 'Portable-Pierre');
    assert.ok(p.chronologie.length >= 2 && p.telemetrie?.processus.length === 2);
    assert.ok(postesDe(home).some((x) => x.poste === 'Portable-Pierre'));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('incidents par poste : une rafale de rançongiciel sur un poste ouvre un incident actionnable, réutilisant le moteur d\'Asclépios', () => {
  const home = tmp();
  try {
    const t = telemetrie('NAS-maison', { rafale: { nombre: 80, secondes: 20, dossier: '\\\\NAS\\partage' } });
    // Le signal porte bien le poste (corrélation par poste, sans se mêler à la machine d'Odin).
    const sigs = signauxTelemetrie(t);
    assert.ok(sigs.length >= 1 && sigs.every((s) => s.poste === 'NAS-maison'));
    const { annonces, incidents } = corrélerPoste(home, t, apps);
    assert.ok(annonces.length >= 1, 'un incident est annoncé');
    const inc = incidents.find((i) => i.state === 'ouvert')!;
    assert.ok(inc && /rançongiciel/i.test(inc.title), inc?.title);
    assert.equal(chargerIncidentsParc(home).length, incidents.length);
    // Actionnable : on peut le marquer traité.
    const x = réglerIncidentParc(home, inc.id, 'traité');
    assert.equal(x?.state, 'traité');
    assert.equal(chargerIncidentsParc(home).find((i) => i.id === inc.id)?.state, 'traité');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('les signaux d\'un poste ne se mêlent pas à ceux d\'un autre poste (corrélation par poste)', () => {
  const home = tmp();
  try {
    corrélerPoste(home, telemetrie('poste-A', { rafale: { nombre: 80, secondes: 20, dossier: '/a' } }), apps);
    corrélerPoste(home, telemetrie('poste-B', { rafale: { nombre: 80, secondes: 20, dossier: '/b' } }), apps);
    const ouverts = chargerIncidentsParc(home).filter((i) => i.state === 'ouvert');
    assert.equal(ouverts.length, 2, 'un incident distinct par poste');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
