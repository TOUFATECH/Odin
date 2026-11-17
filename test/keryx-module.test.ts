// Kéryx — la page doit être JOIGNABLE dans un vrai Odin. Régression du défaut : keryx n'était pas un module, donc
// /api/valhalla/view?id=keryx répondait « appli inconnue » et la page (OdinPages.keryx) n'était jamais ni dans la
// grille des applis ni ouverte. Ici on vérifie que keryx est bien un module enregistré, avec une vue qui s'affiche.
// UN FICHIER À LA FOIS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allModules } from '../src/valhalla/odin.ts';
import { rename, NAME_STORY, SIMILAIRES, similairesDe } from '../src/valhalla/names.ts';

const modules = (): ReturnType<typeof allModules> => {
  const h = mkdtempSync(join(tmpdir(), 'keryx-mod-'));
  try { return allModules({ paths: { home: h, workspace: h }, cfg: { venus: {}, voice: {} } } as never).map(rename); }
  finally { rmSync(h, { recursive: true, force: true }); }
};

test('keryx est un module enregistré (sinon /api/valhalla/view?id=keryx → « appli inconnue »)', () => {
  const m = modules().find((x) => x.id === 'keryx');
  assert.ok(m, 'keryx figure dans allModules : la grille le montre et openApp le trouve');
  assert.equal(m!.name, 'Kéryx');
  assert.ok(['Données', 'Machines', 'Accès', 'Sécurité', 'Maison'].includes(m!.family), 'famille valide');
  assert.ok(m!.what.trim(), 'a un « ce qu\'elle fait »');
  assert.ok(NAME_STORY.keryx?.trim(), 'a l\'histoire de son nom');
});

test('keryx : sa vue s\'affiche (la page custom OdinPages.keryx prend ensuite la main) ; « Alternative à » = Instinct', async () => {
  const m = modules().find((x) => x.id === 'keryx')!;
  const v = await m.view({ home: '', dir: '', settings: {} } as never, new URLSearchParams());
  assert.ok(Array.isArray(v.sections), 'la vue rend une liste de sections (même vide : la page custom gère le reste)');
  // « Alternative à » : Instinct, et seulement là (jamais « copié » / « inspiré de »).
  assert.deepEqual(SIMILAIRES.keryx, ['Instinct']);
  assert.ok(similairesDe(m).some((x) => x.nom === 'Instinct'), 'Instinct apparaît comme alternative');
});

// ---------------------------------------------------------------- Les actions et la page (rendu commun)
import { Valhalla } from '../src/valhalla/service.ts';
import { keryxModule } from '../src/valhalla/keryx/module.ts';
import { lireReglages } from '../src/valhalla/keryx/reglages.ts';
import { secretPose } from '../src/valhalla/keryx/auth.ts';
import { configurerTrace, tracer, lire } from '../src/valhalla/keryx/trace.ts';
import { readFileSync } from 'node:fs';

function monter() {
  const home = mkdtempSync(join(tmpdir(), 'keryx-act-'));
  const v = new Valhalla(home, [keryxModule], { notify: async () => {} });
  return { home, v, fin: () => rmSync(home, { recursive: true, force: true }) };
}
const grave = (id: string, i: Record<string, unknown>, ctx?: unknown) => keryxModule.actions.find((a) => a.id === id)!.grave?.(i, ctx as never);

test('keryx : de vraies actions, branchées sur les mêmes fonctions que les routes', async () => {
  const { home, v, fin } = monter();
  try {
    assert.ok(keryxModule.actions.length >= 8);
    assert.match((await v.act('keryx', 'etat', {})).text, /Code secret : pas encore posé[\s\S]*Liste blanche : vide/);
    assert.equal((await v.act('keryx', 'ajouter_numero', { numero: '+33 6 12 34 56 78' })).ok, true);
    assert.deepEqual(lireReglages(home).numeros, ['+33612345678']);
    assert.doesNotMatch(readFileSync(join(home, 'valhalla', 'keryx', 'reglages.json'), 'utf8'), /612345678/, 'numéro chiffré au repos');
    assert.match((await v.act('keryx', 'etat', {})).text, /••••••••78/, 'numéro masqué à l\'écran');
    await v.act('keryx', 'code_secret', { code: '7391' });
    assert.equal(secretPose(home), true);
    await v.act('keryx', 'regler', { ligne: 'sip', autonomie: 'equilibre', rappelRdv: true, rappelMinutes: 45 });
    const r = lireReglages(home);
    assert.equal(r.ligne, 'sip'); assert.equal(r.autonomieApresSecret, 'equilibre');
    assert.deepEqual(r.surveillances.map((x) => [x.quoi, x.reglage, x.actif]), [['rappel_rdv', '45', true]]);
    configurerTrace(home);
    await tracer({ quand: new Date().toISOString(), canal: 'telegram', pair: '+33612345678', sens: 'entrant', texte: 'quels sont mes rendez-vous demain' });
    assert.match((await v.act('keryx', 'historique', {})).text, /entrant · telegram · quels sont mes rendez-vous demain/);
    assert.match((await v.act('keryx', 'essayer', { quoi: 'sip' })).text, /codé, pas essayé sur du vrai matériel/);
    assert.equal((await v.act('keryx', 'effacer_historique', {})).ok, true);
    assert.equal((await lire({})).length, 0);
    await v.act('keryx', 'retirer_numero', { numero: '+33612345678' });
    assert.deepEqual(lireReglages(home).numeros, []);
    await v.act('keryx', 'retirer_code', {});
    assert.equal(secretPose(home), false);
  } finally { fin(); }
});

test('keryx : ce qui affaiblit une protection ou efface est grave, et refusé à une automatisation', async () => {
  const { home, v, fin } = monter();
  try {
    const ctx = v.ctx('keryx');
    assert.match(grave('ajouter_numero', { numero: '0612345678' }) ?? '', /autoriser/);
    assert.match(grave('code_secret', { code: '1234' }, ctx) ?? '', /poser le code secret/);
    assert.match(grave('regler', { ligne: 'modem' }, ctx) ?? '', /allumer le modem GSM/);
    assert.match(grave('regler', { autonomie: 'autonome' }, ctx) ?? '', /monter l'autonomie/);
    assert.match(grave('regler', { graveParAppel: 'second_canal' }, ctx) ?? '', /action grave demandée par appel/);
    assert.match(grave('effacer_historique', {}) ?? '', /effacer tout l'historique/);
    // renforcer n'est pas grave
    assert.equal(grave('regler', { ligne: 'aucune', autonomie: 'prudent', graveParAppel: 'interdite' }, ctx), undefined);
    for (const id of ['retirer_numero', 'retirer_code']) assert.equal(keryxModule.actions.find((a) => a.id === id)!.grave, undefined, id);
    for (const [id, i] of [['ajouter_numero', { numero: '0612345678' }], ['code_secret', { code: '1234' }], ['regler', { ligne: 'sip' }], ['effacer_historique', {}]] as const) {
      const r = await v.act('keryx', id, i, { auto: true });
      assert.equal(r.ok, false, id); assert.match(r.text, /action grave/);
    }
    assert.deepEqual(lireReglages(home).numeros, []); assert.equal(secretPose(home), false); assert.equal(lireReglages(home).ligne, 'aucune');
  } finally { fin(); }
});

test('keryx : la page (rendu commun) montre l\'état, la liste blanche masquée, les réglages et l\'historique', async () => {
  const { home, v, fin } = monter();
  try {
    await v.act('keryx', 'ajouter_numero', { numero: '+33612345678' });
    const page = await keryxModule.view(v.ctx('keryx'), new URLSearchParams());
    const s = JSON.stringify(page);
    assert.equal(page.kpis?.length, 4);
    assert.match(s, /••••••••78/); assert.doesNotMatch(s, /612345678/, 'jamais le numéro en clair');
    assert.ok(page.sections.some((x) => x.kind === 'form' && x.action === 'regler'));
    assert.ok(page.sections.some((x) => x.kind === 'log' && x.title === 'Derniers échanges'));
    assert.match(s, /aucune capture d'écran/);
    void home;
  } finally { fin(); }
});

test('keryx : un numéro ajouté ou retiré par Odin n\'est jamais en clair dans le journal des manips', async () => {
  const { home, v, fin } = monter();
  try {
    const { readFileSync } = await import('node:fs');
    await v.act('keryx', 'ajouter_numero', { numero: '+262 639 12 34 56' }, { by: 'odin', why: 'demandé par message' });
    await v.act('keryx', 'retirer_numero', { numero: '+262 639 12 34 56' }, { by: 'odin', why: 'demandé par message' });
    const journal = readFileSync(join(home, 'valhalla', 'manips.json'), 'utf8');
    assert.match(journal, /ajouter_numero|Ajouter un numéro/, 'les manips sont bien notées');
    assert.doesNotMatch(journal.replace(/\s+/g, ''), /262639123456|639123456/, 'jamais le numéro en clair');
    assert.match(journal, /"numero":"•••"/);
  } finally { fin(); }
});
