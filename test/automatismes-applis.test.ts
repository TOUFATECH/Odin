// Plus aucun minuteur caché : chaque appli qui a un travail automatique (`watch`) est classée dans le registre et
// visible dans Talos ; chaque tâche déclarée lance une vraie action, se met en pause pour de bon (l'appli lit
// tacheEnPause) et se règle dans les réglages de l'appli ; les événements des applis sont tous proposés à « Faire un lien ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { CLASSEMENT, tacheEnPause } from '../src/valhalla/automatismes.ts';
import { EVENEMENTS } from '../src/draupnir/liens.ts';

const fakeOdin = (h: string) => ({ paths: { home: h, workspace: join(h, 'ws') }, cfg: DEFAULT_CONFIG }) as never;
const src = (f: string) => readFileSync(new URL(`../src/valhalla/${f}`, import.meta.url), 'utf8');

test('chaque appli qui travaille toute seule est classée et visible dans Talos, sans entrée en trop', () => {
  const home = mkdtempSync(join(tmpdir(), 'auto-applis-'));
  try {
    const mods = allModules(fakeOdin(home)), v = new Valhalla(home, mods);
    const avec = mods.filter((m) => m.watch).map((m) => m.id).sort();
    assert.ok(avec.length >= 46, `46 surveillances au moins (${avec.length})`);
    for (const id of avec) assert.ok(CLASSEMENT[id], `${id} : une entrée dans CLASSEMENT`);
    for (const id of Object.keys(CLASSEMENT)) assert.ok(avec.includes(id), `CLASSEMENT.${id} : l'appli n'a pas de surveillance`);
    const lignes = v.automatismes.lignes(), ids = new Set(lignes.map((l) => l.id));
    for (const id of avec) assert.ok(ids.has(`veille:${id}`), `veille:${id} visible`);
    for (const l of lignes) {
      assert.ok(l.phrase.length > 3 && l.nom.length > 2, l.id);
      if (l.sorte === 'veille') assert.deepEqual(l.reglable, [], `${l.id} : une veille continue ne se règle pas au mois par erreur`);
    }
    for (const id of ['forseti', 'garmr', 'geri', 'himinbjorg', 'hlid', 'mimisbrunnr', 'ran', 'skogul', 'ullr', 'valgrind', 'vidarr']) assert.equal(CLASSEMENT[id].securite, true, `${id} : veille de sécurité`);
    v.stop();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('les tâches déclarées : vraie action, pause lue par l\'appli, rythme rangé dans les réglages de l\'appli', () => {
  const home = mkdtempSync(join(tmpdir(), 'auto-taches-'));
  try {
    const mods = allModules(fakeOdin(home)), v = new Valhalla(home, mods);
    v.ctx('sindri').saveSettings({ plans: [{ name: 'Maison', paths: ['/srv'], repo: '/sauvegardes', at: '02:00', keep: { last: 3, daily: 7, weekly: 4, monthly: 12 } }] });
    const taches = v.automatismes.lignes().filter((l) => l.id.startsWith('tache:'));
    const ids = taches.map((l) => l.id);
    for (const id of ['tache:ymir:verification_iso', 'tache:fjalar:verification_logiciels', 'tache:fjalar:tournee', 'tache:eitri:tournee', 'tache:ullr:sources', 'tache:sindri:plan-maison']) assert.ok(ids.includes(id), `${id} déclarée`);
    for (const m of mods) for (const t of m.taches?.(v.ctx(m.id)) ?? []) assert.ok(m.actions.some((a) => a.id === t.lancer.action), `${m.id}/${t.id} : l'action ${t.lancer.action} existe`);
    // La pause de chaque tâche est lue par l'appli (tacheEnPause), et l'appli la consulte avant son passage planifié.
    for (const l of taches) {
      const [, m, t] = l.id.split(':');
      assert.equal(tacheEnPause(m, t), false);
      const r = v.automatismes.pause(l.id, true, { confirme: true }) as { ok: boolean };
      assert.equal(r.ok, true, l.id); assert.equal(tacheEnPause(m, t), true, `${l.id} en pause`);
      v.automatismes.pause(l.id, false);
    }
    const lit = (f: string, morceau: string) => assert.ok(src(f).includes(morceau), `${f} : le passage planifié lit tacheEnPause (${morceau})`);
    lit('ymir/bibliotheque.ts', "&& !tacheEnPause('ymir', 'verification_iso')) await verifierIsos(ctx)");
    lit('forge/bibliotheque.ts', '&& !tacheEnPause(...tacheDuGenre(g))) await b.verifier(nouvelles)');
    lit('forge/forge.ts', "&& !tacheEnPause(o.id, 'tournee')) { const t = await cycle(ctx, 'programmé')");
    lit('modules/ullr.ts', "&& !tacheEnPause('ullr', 'sources')) void update(ctx)");
    lit('modules/sindri.ts', "if (p.at === hm && !tacheEnPause('sindri', tacheDuPlan(p))");
    // Hydre : « chaque semaine le lundi à 5 h » est rangé dans verifIso.
    const r = v.automatismes.rythme('tache:ymir:verification_iso', { genre: 'semaine', jours: [1], heure: '05:00' }) as { ok: boolean };
    assert.equal(r.ok, true);
    assert.deepEqual({ ...(v.ctx('ymir').settings.verifIso as object) }, { frequence: 'semaine', jour: 1, heure: '05:00' });
    assert.equal(v.automatismes.ligne('tache:ymir:verification_iso')!.phrase, 'Chaque semaine, le lundi à 5 h');
    const le31 = v.automatismes.rythme('tache:ymir:verification_iso', { genre: 'mois', jour: 31, heure: '04:00' }) as { ok: boolean; code?: string; error?: string };
    assert.equal(le31.ok, false); assert.equal(le31.code, 'invalide'); assert.match(le31.error!, /1 à 28/);
    // Phénix : l'heure du plan.
    assert.equal((v.automatismes.rythme('tache:sindri:plan-maison', { genre: 'jour', heure: '03:15' }) as { ok: boolean }).ok, true);
    assert.equal((v.ctx('sindri').settings.plans as Array<{ at: string }>)[0].at, '03:15');
    // Asclépios : non réglable, de sécurité.
    const u = v.automatismes.ligne('tache:ullr:sources')!;
    assert.equal(u.securite, true); assert.deepEqual(u.reglable, []);
    v.stop();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('EVENEMENTS couvre tous les ctx.emit(\'…\') des applis', () => {
  const dir = new URL('../src/valhalla/modules/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const id = f.replace(/\.ts$/, ''), texte = readFileSync(new URL(f, dir), 'utf8');
    for (const m of texte.matchAll(/ctx\.emit\(\s*'([^']+)'/g)) assert.ok(EVENEMENTS[id]?.includes(m[1]), `${id} : l'événement « ${m[1]} » manque dans EVENEMENTS`);
  }
});

test('plus aucun minuteur caché hors des surveillances : chaque setInterval de src/valhalla est interne ou inscrit dans Talos', () => {
  // Les minuteries purement internes (aucun travail que le propriétaire planifie) : écriture différée, files, pings,
  // relances de connexion, horloge d'un écran. Toute autre minuterie doit passer par le registre.
  const INTERNES: Record<string, string> = {
    'automatismes.ts': 'l\'horloge du registre lui-même',
    'base/index.ts': 'l\'état de la base d\'Odin (prête ou pas), pas un travail planifié',
    'directports.ts': 'relance des ports directs qui n\'ont pas pu s\'ouvrir',
    'hringhorni/repartiteur.ts': 'la boucle du répartiteur de charge (processus à part)',
    'journal.ts': 'écriture différée du journal',
    'modules/agora.ts': 'suivi des groupes de Persona (moins d\'une seconde)',
    'modules/appareils.ts': 'écriture différée des relevés',
    'modules/loki.ts': 'un piège qui fait patienter l\'attaquant',
    'modules/ullr.ts': 'arrêt d\'une analyse en cours',
    'ran.ts': 'la lecture en direct (30 min au plus)',
    'sso/fiches.ts': 'ping d\'une connexion ouverte',
    'sso/garde.ts': 'ping d\'une connexion ouverte',
    'sso/sauvegardes.ts': 'ping d\'une connexion ouverte',
    'thjalfi/ecran-page.ts': 'horloge de l\'écran d\'installation',
    'wireguard/engine.ts': 'la boucle du VPN',
  };
  const racine = new URL('../src/valhalla/', import.meta.url), trouves: string[] = [];
  for (const f of readdirSync(racine, { recursive: true }) as string[]) {
    const rel = f.replace(/\\/g, '/');
    if (!rel.endsWith('.ts') || !src(rel).includes('setInterval(')) continue;
    trouves.push(rel);
  }
  for (const f of trouves) {
    if (INTERNES[f]) continue;
    const t = src(f);
    assert.ok(t.includes('tacheEnPause(') && t.includes('automatismes.inscrire('), `${f} : une minuterie cachée (ajoute-la au registre de Talos ou à la liste des minuteries internes, avec sa raison)`);
  }
  assert.ok(trouves.includes('base/demarrage.ts'), 'la sauvegarde chiffrée de la base d\'Odin est bien vérifiée ici');
});

test('Arche, Héraclès et la base d\'Odin : leurs plans sont des tâches réglables dans Talos', () => {
  const home = mkdtempSync(join(tmpdir(), 'auto-plans-'));
  try {
    const mods = allModules(fakeOdin(home)), v = new Valhalla(home, mods);
    v.ctx('skuld').saveSettings({ plans: [{ base: 'compta', toutes: 'nuit', heure: 3, garde: { jours: 7, semaines: 4, mois: 6 }, actif: true }] });
    v.ctx('gefjon').saveSettings({ plansNettoyage: [{ id: 'ici', poste: '', nomPoste: 'ce serveur', categories: ['temporaires'], quand: 'semaine', heure: 4 }] });
    v.automatismes.inscrire('urdr', { id: 'sauvegarde_base', nom: 'Sauvegarde chiffrée de la base d\'Odin', quoi: 'essai', rythme: () => ({ genre: 'libre', texte: 'Une fois par jour' }), lancer: { action: 'sauvegarde_base' }, faire: async () => ({ text: 'faite' }) });
    const ids = v.automatismes.lignes().map((l) => l.id);
    for (const id of ['tache:skuld:plan-compta', 'tache:gefjon:nettoyage-ici', 'tache:urdr:sauvegarde_base']) assert.ok(ids.includes(id), `${id} visible`);
    assert.equal(v.automatismes.ligne('tache:skuld:plan-compta')!.phrase, 'Tous les jours à 3 h');
    assert.equal((v.automatismes.rythme('tache:skuld:plan-compta', { genre: 'semaine', jours: [0], heure: '05:00' }) as { ok: boolean }).ok, true);
    assert.deepEqual((v.ctx('skuld').settings.plans as Array<{ toutes: string; heure: number }>).map((p) => [p.toutes, p.heure]), [['semaine', 5]]);
    assert.equal((v.automatismes.rythme('tache:skuld:plan-compta', { genre: 'jour', heure: '05:30' }) as { ok: boolean }).ok, false, 'heure pile seulement');
    assert.equal(v.automatismes.ligne('tache:gefjon:nettoyage-ici')!.phrase, 'Chaque semaine, le dimanche à 4 h');
    assert.equal((v.automatismes.rythme('tache:gefjon:nettoyage-ici', { genre: 'mois', jour: 1, heure: '02:00' }) as { ok: boolean }).ok, true);
    assert.equal((v.ctx('gefjon').settings.plansNettoyage as Array<{ quand: string }>)[0].quand, 'mois');
    v.automatismes.pause('tache:skuld:plan-compta', true);
    assert.equal(tacheEnPause('skuld', 'plan-compta'), true);
    const lit = (f: string, morceau: string) => assert.ok(src(f).includes(morceau), `${f} : le passage planifié lit tacheEnPause (${morceau})`);
    lit('modules/skuld.ts', "tacheEnPause('skuld', tacheDuPlanBase(p.base))");
    lit('modules/gefjon.ts', "tacheEnPause('gefjon', tacheDuNettoyage(p))");
    lit('base/demarrage.ts', "tacheEnPause('urdr', 'sauvegarde_base')");
    for (const m of mods.filter((x) => x.id === 'skuld' || x.id === 'gefjon')) for (const t of m.taches?.(v.ctx(m.id)) ?? []) assert.ok(m.actions.some((a) => a.id === t.lancer.action), `${m.id}/${t.id} : l'action ${t.lancer.action} existe`);
    v.stop();
  } finally { rmSync(home, { recursive: true, force: true }); }
});
