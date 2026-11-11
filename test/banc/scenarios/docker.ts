// Naglfar contre un VRAI Docker : pile déployée, liste, journaux, arrêt, redémarrage, alerte
// quand un conteneur tombe tout seul, et aucune fausse alerte quand c'est toi qui l'arrêtes.

import { existsSync, mkdirSync, copyFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { naglfar } from '../../../src/valhalla/modules/naglfar.ts';
import { sh, until, type Scenario, type T } from '../lib.ts';

const IMAGE = 'odin-banc/busybox:1';

/** Une image minuscule pour les essais : déjà là, sinon fabriquée avec busybox, sinon téléchargée. */
async function ensureImage(t: T): Promise<void> {
  if ((await sh('docker', ['image', 'inspect', IMAGE])).code === 0) return;
  for (const bb of ['/bin/busybox', '/usr/bin/busybox']) {
    if (!existsSync(bb)) continue;
    if (!/statically linked|not a dynamic/.test((await sh('sh', ['-c', `file ${bb} 2>/dev/null; ldd ${bb} 2>&1`])).out + (await sh('sh', ['-c', `ldd ${bb} 2>&1`])).err)) continue;
    const root = t.tmp('banc-image-'); mkdirSync(join(root, 'bin'));
    copyFileSync(bb, join(root, 'bin', 'busybox'));
    for (const a of ['sh', 'sleep', 'echo', 'cat', 'ls']) symlinkSync('busybox', join(root, 'bin', a));
    const r = await sh('sh', ['-c', `tar -C ${root} -c . | docker import - ${IMAGE}`], { timeoutMs: 60_000 });
    if (r.code === 0) { t.note('Image d\'essai fabriquée sur place avec busybox (aucun téléchargement).'); return; }
  }
  const pull = await sh('docker', ['pull', 'busybox:stable'], { timeoutMs: 90_000 });
  if (pull.code === 0 && (await sh('docker', ['tag', 'busybox:stable', IMAGE])).code === 0) return;
  t.skip('aucune image disponible : pas de busybox statique sur la machine et registre Docker injoignable');
}

export const docker: Scenario = {
  id: 'docker', title: 'Naglfar ↔ Docker', mode: 'réel',
  what: 'Un vrai moteur Docker : déployer une pile, lister, lire les journaux, arrêter, relancer, alerte si un conteneur tombe.',
  async run(t) {
    await t.need('docker');
    if ((await sh('docker', ['info'], { timeoutMs: 20_000 })).code !== 0) t.skip('le moteur Docker ne répond pas (service arrêté ?)');
    await ensureImage(t);
    const { v, alerts, events } = t.valhalla([naglfar]);
    const act = (a: string, i: Record<string, unknown> = {}, o = {}) => v.act('naglfar', a, i, o);
    const pile = `odinbanc${Date.now().toString(36)}`;
    t.onEnd(() => sh('docker', ['compose', '-p', pile, 'down', '-t', '1', '--remove-orphans'], { timeoutMs: 60_000 }));

    // Une action grave ne part jamais d'une automatisation.
    const auto = await act('deployer', { nom: pile, compose: 'services: {}' }, { auto: true });
    t.ok(auto.ok === false && /accord/.test(auto.text), 'déployer une pile est refusé sans ton accord (automatisation)');
    t.ok((await act('nettoyer', {}, { auto: true })).ok === false, 'le nettoyage est refusé sans ton accord');

    const compose = `services:\n  web:\n    image: ${IMAGE}\n    command: ["/bin/sh", "-c", "while true; do echo vivant; sleep 1; done"]\n    stop_grace_period: 1s\n  tache:\n    image: ${IMAGE}\n    command: ["/bin/sleep", "3600"]\n    stop_grace_period: 1s\n`;
    const dep = await act('deployer', { nom: pile, compose });
    t.ok(dep.ok, 'pile déployée avec un fichier compose', dep.text);
    const web = `${pile}-web-1`, tache = `${pile}-tache-1`;

    const list = await act('lister');
    t.ok(list.text.includes(web) && list.text.includes(tache), 'les deux conteneurs apparaissent dans la liste', list.text);
    const view = await naglfar.view(v.ctx('naglfar'), new URLSearchParams());
    const row = view.sections[0].kind === 'table' ? view.sections[0].rows.find((r) => r.cells[0] === web) : undefined;
    t.ok(row && row.cells[1] === pile && row.tone === 'bon', 'la page montre le conteneur, sa pile et son état « en marche »', JSON.stringify(row));
    t.ok(await until(async () => /vivant/.test((await act('journaux', { conteneur: web })).text), 8000), 'les journaux du conteneur sont lus');

    // Surveillance : un conteneur qui tombe tout seul → alerte haute + événement.
    await naglfar.watch!.run(v.ctx('naglfar'));
    await sh('docker', ['kill', tache]);
    await until(async () => !/Up/.test((await sh('docker', ['ps', '-a', '--filter', `name=${tache}`, '--format', '{{.Status}}'])).out), 5000);
    await naglfar.watch!.run(v.ctx('naglfar'));
    t.ok(alerts.some((a) => a.level === 'haute' && a.title.includes(tache)), 'alerte haute quand un conteneur s\'arrête tout seul', JSON.stringify(alerts));
    t.ok(events.some((e) => e.type === 'conteneur_arrete' && e.data.conteneur === tache), 'événement « conteneur arrêté » émis (pour Draupnir)');

    const start = await act('demarrer', { conteneur: tache });
    t.ok(start.ok && /Up/.test((await sh('docker', ['ps', '--filter', `name=${tache}`, '--format', '{{.Status}}'])).out), 'le conteneur est relancé par Naglfar', start.text);

    // Arrêt demandé par toi → pas d'alerte.
    await naglfar.watch!.run(v.ctx('naglfar'));
    const before = alerts.length;
    const stop = await act('arreter', { conteneur: web });
    t.ok(stop.ok && !/Up/.test((await sh('docker', ['ps', '-a', '--filter', `name=${web}`, '--format', '{{.Status}}'])).out), 'arrêt d\'un conteneur', stop.text);
    await naglfar.watch!.run(v.ctx('naglfar'));
    t.ok(alerts.length === before, 'pas de fausse alerte quand c\'est toi qui arrêtes le conteneur', JSON.stringify(alerts.slice(before)));

    const re = await act('redemarrer', { conteneur: web });
    t.ok(re.ok && /Up/.test((await sh('docker', ['ps', '--filter', `name=${web}`, '--format', '{{.Status}}'])).out), 'redémarrage', re.text);

    const bad = await act('journaux', { conteneur: `${web}; touch /tmp/odin-banc-injection` });
    t.ok(bad.ok === false && /invalide/.test(bad.text) && !existsSync('/tmp/odin-banc-injection'), 'un nom piégé est refusé (aucune commande injectée)', bad.text);

    await act('arreter', { conteneur: tache });
    const rm = await act('supprimer', { conteneur: tache });
    t.ok(rm.ok && !(await sh('docker', ['ps', '-a', '--format', '{{.Names}}'])).out.includes(tache), 'suppression d\'un conteneur arrêté', rm.text);
  },
};
