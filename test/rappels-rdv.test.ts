// « Planifie un rendez-vous mardi à 15 h » : Chronos range le rendez-vous et programme son rappel par la passerelle
// (Telegram d'abord, sans IA) ; le rappel se voit dans Talos (appli Chronos) ; annuler le rendez-vous retire son rappel ;
// l'onglet Agenda de Chronos montre tous les plannings au propriétaire, seulement les rendez-vous à un membre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { setValhalla } from '../src/valhalla/odin.ts';
import { frigg, type Booking } from '../src/valhalla/modules/frigg.ts';
import { brancherSources, type SourceJobs } from '../src/valhalla/automatismes.ts';
import { regionDe, setLieuCourant } from '../src/valhalla/lieu.ts';
import { auNomDe } from '../src/valhalla/sso/acces.ts';
import { Talos } from '../src/draupnir/service.ts';
import { setDraupnir } from '../src/tools/draupnir.ts';
import { agendaPourChronos, contexteTalos, lignesTalos, talosGet, talosPost } from '../src/web/talos-api.ts';
import type { JobRow } from '../src/muninn/store.ts';
import type { Module } from '../src/valhalla/types.ts';

test('rendez-vous, rappel sur Telegram, Talos et l\'agenda', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rdv-'));
  setLieuCourant({ nom: 'Mamoudzou', fuseau: 'Indian/Mayotte', region: regionDe('YT') });
  const now = new Date('2026-11-16T10:00:00Z'); // lundi 13 h à Mayotte
  // Une veille (jamais dans l'agenda) et Chronos.
  const veille: Module = { id: 'himinbjorg', name: 'Cyclope', family: 'Sécurité', what: 'x', does: [], from: [], upstream: [], words: [], actions: [], view: () => ({ sections: [] }), watch: { every: 10, run: () => {} } };
  const v = new Valhalla(home, [frigg, veille], { now: () => now });
  setValhalla(v);
  // La passerelle simulée : les rappels deviennent des tâches « @reminder » sur Telegram.
  const jobs: JobRow[] = [], envoyes: Array<{ texte: string; quand: Date }> = [];
  const src: SourceJobs = {
    listJobs: () => [...jobs].sort((a, b) => a.next_run - b.next_run),
    removeJob: (id) => { const i = jobs.findIndex((j) => j.id === id); if (i >= 0) jobs.splice(i, 1); return i >= 0; },
    setJobEnabled: (id, on) => { const j = jobs.find((x) => x.id === id); if (j) j.enabled = on ? 1 : 0; },
    setJobNext: (id, n) => { const j = jobs.find((x) => x.id === id); if (j) j.next_run = n; },
    setJobCron: (id, c, n) => { const j = jobs.find((x) => x.id === id); if (j) { j.cron = c; j.next_run = n; } },
    addJob: (j) => { jobs.push({ ...j, enabled: 1, last_run: 0 }); },
  };
  let k = 0;
  const d = new Talos(home, {}); setDraupnir(d);
  brancherSources({
    jobs: src, flows: () => d, moyen: () => 'Telegram', agenda: agendaPourChronos(),
    rappels: { programmer: (texte, quand) => { envoyes.push({ texte, quand }); const id = `rem_${++k}`; jobs.push({ id, cron: '@reminder', prompt: texte, channel: 'telegram', peer: '42', enabled: 1, last_run: 0, next_run: quand.getTime() }); return id; }, annuler: (id) => src.removeJob(id) },
  });
  // Une tâche planifiée d'Odin et une automatisation planifiée.
  jobs.push({ id: 'job_matin', cron: '0 8 * * *', prompt: '[routine:matin] Fais le point du matin', channel: 'telegram', peer: '42', enabled: 1, last_run: 0, next_run: Date.parse('2026-11-17T05:00:00Z') });
  d.save({ name: 'Vérif du soir', active: true, nodes: [{ name: 'Tous les jours à 19 h', type: 'déclencheur.planning', params: { mode: 'simple', rythme: { genre: 'jour', heure: '19:00' } } }, { name: 'Fin', type: 'logique.fin', params: {} }], connections: { 'Tous les jours à 19 h': [[{ node: 'Fin' }]] } });
  try {
    const r = await v.act('frigg', 'rendez_vous', { titre: 'Dentiste', quand: 'mardi 15 h', lieu: 'Cabinet du centre' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /Dentiste : demain à 15 h/); assert.match(r.text, /rappel 1 h avant sur Telegram/);
    const b = (v.ctx('frigg').settings.bookings as Booking[])[0];
    assert.equal(b.perso, true); assert.equal(b.service, 'Personnel'); assert.equal(b.status, 'confirmé'); assert.equal(b.debut, '2026-11-17T12:00:00.000Z');
    assert.equal(b.rappelJob, 'rem_1');
    assert.equal(envoyes[0].quand.toISOString(), '2026-11-17T11:00:00.000Z', '1 h avant'); assert.match(envoyes[0].texte, /Rendez-vous : Dentiste aujourd'hui à 15 h \(Cabinet du centre\)/);
    assert.equal((await v.act('frigg', 'rendez_vous', { titre: 'Hier', quand: '2026-11-01 10:00' })).ok, false, 'une date passée est refusée');

    // Dans Talos : la ligne du rappel, de l'appli Chronos, qui part sur Telegram.
    const c = contexteTalos();
    const l = lignesTalos(c).find((x) => x.id === 'rappel:rem_1')!;
    assert.ok(l); assert.equal(l.sorte, 'rappel'); assert.equal(l.appli, 'frigg'); assert.deepEqual(l.applis, ['frigg']); assert.equal(l.moyen, 'Telegram');
    assert.equal(l.quand, '2026-11-17T12:00:00.000Z'); assert.equal(l.prochaine, '2026-11-17T11:00:00.000Z');
    assert.deepEqual(l.peut, { lancer: true, pause: true, rythme: false, decaler: true, supprimer: true });
    const tout = await talosGet(undefined, '/api/draupnir/automatismes', new URLSearchParams()) as { ok: true; lignes: Array<{ id: string; sorte: string }>; compte: Record<string, number> };
    assert.equal(tout.compte.rappel, 1); assert.equal(tout.compte.tache_odin, 1); assert.equal(tout.compte.automatisation, 1); assert.equal(tout.compte.veille, 1);
    // L'onglet « Auto » de Chronos montre son rappel.
    const auto = await talosGet(undefined, '/api/draupnir/appli', new URLSearchParams({ id: 'frigg' })) as { ok: true; montrer: boolean; lignes: Array<{ id: string }> };
    assert.equal(auto.montrer, true); assert.ok(auto.lignes.some((x) => x.id === 'rappel:rem_1'));

    // « Lancer maintenant » sur le rappel : une copie part tout de suite, l'original garde son heure.
    const lance = await talosPost(undefined, '/api/draupnir/automatisme/lancer', { id: 'rappel:rem_1' }) as { ok: boolean; resultat?: { texte: string } };
    assert.equal(lance.ok, true); assert.match(lance.resultat!.texte, /Telegram/);
    assert.equal(jobs.find((j) => j.id === 'rem_1')!.next_run, Date.parse('2026-11-17T11:00:00Z'), 'le rappel du rendez-vous partira toujours à son heure');
    const copie = jobs.find((j) => j.id !== 'rem_1' && j.cron === '@reminder')!;
    assert.ok(copie); assert.ok(Math.abs(copie.next_run - Date.now()) < 60_000, 'la copie part tout de suite'); assert.equal(copie.prompt, jobs.find((j) => j.id === 'rem_1')!.prompt); assert.equal(copie.channel, 'telegram');
    src.removeJob(copie.id); // la passerelle l'efface après l'envoi

    // Un membre qui a droit à Chronos : ni rendez-vous perso (il écrirait sur le Telegram du propriétaire), ni vue sur
    // ceux du propriétaire, ni moyen de les confirmer ou de les annuler.
    const awa = { login: 'awa', name: 'Awa', groups: ['famille'] };
    // (les actions sont appelées directement : la garde des membres, elle, laisse passer toute action de Chronos)
    const essaie = (id: string, i: Record<string, unknown>) => auNomDe(awa, async () => { try { await frigg.actions.find((a) => a.id === id)!.run(v.ctx('frigg'), i); return 'fait'; } catch (e) { return (e as Error).message; } });
    assert.match(await essaie('rendez_vous', { titre: 'Message', quand: 'mardi 15 h', rappel: 'au moment' }), /réservés au propriétaire/);
    assert.equal(envoyes.length, 1, 'aucun rappel programmé pour le membre');
    const vueMembre = await auNomDe(awa, () => frigg.view(v.ctx('frigg'), new URLSearchParams()));
    const aVenir = vueMembre.sections.find((x) => x.title === 'À venir') as { rows: Array<{ cells: string[] }> };
    assert.ok(!aVenir.rows.some((x) => x.cells[1] === 'Dentiste'), 'le rendez-vous perso n\'est pas montré au membre');
    assert.ok(!vueMembre.sections.some((x) => x.title === 'Nouveau rendez-vous'), 'pas de formulaire de rendez-vous perso pour un membre');
    assert.match(vueMembre.subtitle ?? '', /^0 rendez-vous/);
    assert.match(await essaie('confirmer', { id: b.id }), /introuvable/, 'un membre ne touche pas aux rendez-vous perso');
    assert.match(await essaie('annuler', { id: b.id }), /introuvable/);
    assert.equal((v.ctx('frigg').settings.bookings as Booking[])[0].status, 'confirmé');
    const vueProprio = await frigg.view(v.ctx('frigg'), new URLSearchParams());
    assert.ok((vueProprio.sections.find((x) => x.title === 'À venir') as { rows: Array<{ cells: string[] }> }).rows.some((x) => x.cells[1] === 'Dentiste'));

    // « Une seule fois » déjà passée, planning qui ne tombe jamais : refusés avec un message.
    const passe = await talosPost(undefined, '/api/draupnir/rythme/apercu', { rythme: { genre: 'une_fois', date: '2025-01-01', heure: '10:00' } }) as { ok: boolean; code?: string; error?: string };
    assert.equal(passe.ok, false); assert.equal(passe.code, 'invalide'); assert.equal(passe.error, 'Cette date est déjà passée.');
    assert.equal((await talosPost(undefined, '/api/draupnir/rythme/apercu', { cron: '0 0 31 2 *' }) as { error?: string }).error, 'Ce planning ne tombe jamais.');
    const lienPasse = await talosPost(undefined, '/api/draupnir/lien', { quand: { sorte: 'rythme', rythme: { genre: 'une_fois', date: '2025-01-01', heure: '10:00' } }, etapes: [{ appli: 'frigg', action: 'agenda' }], activer: true }) as { ok: boolean; code?: string };
    assert.equal(lienPasse.ok, false); assert.equal(lienPasse.code, 'invalide');

    // Un lien dont on change le rythme : son nom et son nœud Planning suivent la nouvelle phrase.
    const lien = await talosPost(undefined, '/api/draupnir/lien', { quand: { sorte: 'rythme', rythme: { genre: 'semaine', jours: [1, 4], heure: '07:30' } }, etapes: [{ appli: 'frigg', action: 'agenda' }] }) as { ok: true; flow: { id: string; name: string } };
    assert.equal(lien.flow.name, 'Chaque semaine, le lundi et le jeudi à 7 h 30 → Chronos · Rendez-vous à venir');
    const re = await talosPost(undefined, '/api/draupnir/automatisme/rythme', { id: `flow:${lien.flow.id}`, rythme: { genre: 'mois', jour: 1, heure: '07:30' } }) as { ok: boolean };
    assert.equal(re.ok, true);
    const apres = d.get(lien.flow.id)!;
    assert.equal(apres.name, 'Chaque mois, le 1er à 7 h 30 → Chronos · Rendez-vous à venir');
    assert.equal(apres.nodes[0].name, 'Chaque mois, le 1er à 7 h 30');
    assert.deepEqual(apres.connections['Chaque mois, le 1er à 7 h 30'], [[{ node: 'Chronos · Rendez-vous à venir' }]]);
    // « Lancer maintenant » pendant qu'elle tourne déjà : refusé (en_cours).
    const enRoute = d.run(lien.flow.id, undefined, 'déclencheur', apres.nodes[0].name);
    assert.equal(d.enCours(lien.flow.id), true);
    const deux = await talosPost(undefined, '/api/draupnir/automatisme/lancer', { id: `flow:${lien.flow.id}` }) as { ok: boolean; code?: string };
    assert.equal(deux.ok, false); assert.equal(deux.code, 'en_cours');
    await enRoute;
    d.trash(lien.flow.id);
    // Une tâche d'Odin toutes les heures : un seul élément « en continu » dans l'agenda, pas 60.
    jobs.push({ id: 'job_heure', cron: '0 * * * *', prompt: 'Relevé des compteurs', channel: 'telegram', peer: '42', enabled: 1, last_run: 0, next_run: Date.parse('2026-11-16T11:00:00Z') });
    const ag14 = await talosGet(undefined, '/api/draupnir/agenda', new URLSearchParams({ de: '2026-11-16', jours: '14' })) as { elements: Array<{ titre: string }> };
    const releves = ag14.elements.filter((e) => /Relevé des compteurs/.test(e.titre));
    assert.equal(releves.length, 1); assert.match(releves[0].titre, /en continu/);
    src.removeJob('job_heure');

    // L'agenda : le rendez-vous, son rappel, la tâche d'Odin et l'automatisation planifiée ; jamais de veille.
    const ag = await talosGet(undefined, '/api/draupnir/agenda', new URLSearchParams({ de: '2026-11-16', jours: '3' })) as { ok: true; elements: Array<{ sorte: string; titre: string; quand: string; moyen?: string }> };
    const sortes = new Set(ag.elements.map((e) => e.sorte));
    for (const x of ['rendez_vous', 'rappel', 'tache_odin', 'automatisation']) assert.ok(sortes.has(x), `${x} dans l'agenda`);
    assert.ok(!sortes.has('veille'));
    assert.ok(ag.elements.some((e) => e.sorte === 'rendez_vous' && e.quand === '2026-11-17T12:00:00.000Z'));
    assert.equal(ag.elements.filter((e) => e.titre === 'Vérif du soir').length, 3, 'tous les jours à 19 h, trois jours');

    // Chronos, onglet Agenda : tout pour le propriétaire, seulement les rendez-vous des clients pour un membre.
    const vue = await frigg.view(v.ctx('frigg'), new URLSearchParams());
    assert.deepEqual(vue.onglets, ['Agenda', 'Rendez-vous', 'Réglages']);
    const table = (x: typeof vue) => x.sections.find((s) => s.title === 'Les 14 prochains jours') as { rows: Array<{ cells: string[] }> };
    assert.ok(table(vue).rows.some((r2) => r2.cells[1] === 'Vérif du soir'), 'le propriétaire voit les automatisations');
    assert.ok(table(vue).rows.some((r2) => /Dentiste/.test(r2.cells[1]) && r2.cells[2] === 'Chronos'));
    const membre = await auNomDe({ login: 'awa', name: 'Awa', groups: ['famille'] }, () => frigg.view(v.ctx('frigg'), new URLSearchParams()));
    assert.deepEqual(table(membre).rows, [], 'un membre ne voit ni les rappels, ni les automatisations, ni les rendez-vous perso');

    // Décaler puis supprimer depuis Talos.
    const dec = await talosPost(undefined, '/api/draupnir/automatisme/decaler', { id: 'rappel:rem_1', quand: '2026-11-17T10:30:00.000Z' }) as { ok: boolean };
    assert.equal(dec.ok, true); assert.equal(jobs.find((j) => j.id === 'rem_1')!.next_run, Date.parse('2026-11-17T10:30:00.000Z'));
    assert.equal((await talosPost(undefined, '/api/draupnir/automatisme/supprimer', { id: 'veille:himinbjorg' }) as { code: string }).code, 'interdit');

    // Annuler le rendez-vous retire son rappel.
    const an = await v.act('frigg', 'annuler', { id: b.id });
    assert.equal(an.ok, true);
    assert.ok(!jobs.some((j) => j.id === 'rem_1'), 'le rappel est retiré');
    assert.equal((v.ctx('frigg').settings.bookings as Booking[])[0].rappelJob, undefined);
    assert.ok(!lignesTalos(contexteTalos()).some((x) => x.id === 'rappel:rem_1'));

    // Supprimer depuis Talos le rappel d'un autre rendez-vous : la réservation passe à « aucun ».
    await v.act('frigg', 'rendez_vous', { titre: 'Garage', quand: '2026-11-20 09:00', rappel: 'la veille à 18 h' });
    assert.equal(envoyes[1].quand.toISOString(), '2026-11-19T15:00:00.000Z', 'la veille à 18 h, heure de Mayotte');
    const acc = await talosPost(undefined, '/api/draupnir/automatisme/supprimer', { id: 'rappel:rem_2' }) as { ok: boolean; code?: string };
    assert.equal(acc.code, 'accord');
    assert.equal((await talosPost(undefined, '/api/draupnir/automatisme/supprimer', { id: 'rappel:rem_2', confirme: true }) as { ok: boolean }).ok, true);
    const g = (v.ctx('frigg').settings.bookings as Booking[]).find((x) => x.name === 'Garage')!;
    assert.equal(g.rappel, 'aucun'); assert.equal(g.rappelJob, undefined);
  } finally {
    d.stop(); v.stop(); setValhalla(undefined); setDraupnir(undefined); brancherSources({ jobs: undefined, flows: undefined, rappels: undefined, moyen: undefined, agenda: undefined }); setLieuCourant(undefined);
    rmSync(home, { recursive: true, force: true });
  }
});
