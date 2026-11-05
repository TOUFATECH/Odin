// Avant un changement risqué : analyse d'impact (ce qui dépend de la machine, comment revenir en
// arrière, quoi vérifier après) ; et plan de reprise écrit dans l'espace de travail.

import { recoveryPlan } from '../guard/insight.ts';
import { deviceLabel } from '../hlidskjalf/inventory.ts';
import { listMachines } from '../machines/access.ts';
import { obj, str, type Tool } from './registry.ts';

const s = (v: unknown) => String(v ?? '');

export const changePlan: Tool = {
  name: 'change_plan',
  description: 'AVANT un changement risqué (mise à jour, configuration réseau, redémarrage, suppression) sur une machine ou un appareil : liste ce qui en dépend, comment revenir en arrière (instantané Proxmox, copie des fichiers), et quoi vérifier après. Suis ensuite ce plan.',
  risk: 'read',
  schema: obj({ target: str('machine ou appareil (nom, IP, ou n° Proxmox)'), change: str('ce que tu comptes changer') }, ['target', 'change']),
  async run(i, ctx) {
    const q = s(i.target).toLowerCase(), cfg = ctx.careCfg;
    const devs = ctx.inventory?.list({ status: 'all' }) ?? [];
    const d = devs.find((x) => [x.ip, x.hostname, x.name, x.label, x.id].some((v) => v && v.toLowerCase() === q)) ?? devs.find((x) => deviceLabel(x).toLowerCase().includes(q));
    const ip = d?.ip ?? (/^\d+\.\d+\.\d+\.\d+$/.test(q) ? q : '');
    const deps = (cfg?.services ?? []).filter((x) => (ip && x.check.includes(ip)) || x.where === q || x.name.toLowerCase().includes(q));
    const machine = ctx.home ? listMachines(ctx.home).find((m) => m.host === ip || m.label.toLowerCase() === q) : undefined;
    const vm = /^\d+$/.test(q) ? q : '';
    const lines = [`Plan de changement — ${s(i.change)} sur ${d ? `${deviceLabel(d)} (${d.ip}, ${d.kind})` : s(i.target)}`];
    lines.push(`Ce qui en dépend : ${deps.length ? deps.map((x) => `${x.name} (${x.check})`).join(', ') : 'aucun service surveillé connu'}${d?.web?.length ? ` ; interfaces : ${d.web.map((w) => w.url).join(', ')}` : ''}.`);
    lines.push('Avant :');
    if (vm || d?.kind === 'machine virtuelle' || d?.kind === 'serveur') lines.push(`- Faire un instantané Proxmox${vm ? ` de ${vm}` : ' de la VM ou du conteneur'} (proxmox_action snapshot) — c'est le retour arrière le plus sûr.`);
    lines.push(`- Copier les fichiers de configuration que tu vas modifier (cp fichier fichier.odin-${new Date().toISOString().slice(0, 10)}) ; sur la machine d'Odin, fs_write/fs_edit gardent l'ancienne version automatiquement.`);
    if (machine) lines.push(`- Accès : ${machine.user}@${machine.host} (machine_exec).`);
    lines.push('Après :', `- Vérifier que la machine répond${ip ? ` (ping / port ${d?.ports?.[0] ?? 22} de ${ip})` : ''}.`, ...deps.map((x) => `- Vérifier ${x.name} : ${x.check}`), '- Si quelque chose ne va pas : revenir à l\'instantané ou remettre les copies, puis prévenir le propriétaire.');
    return lines.join('\n');
  },
};

export const recoveryPlanTool: Tool = {
  name: 'recovery_plan',
  description: 'Écrit (ou met à jour) le plan de reprise : machines importantes, sauvegardes, étapes pour tout remettre en route si une machine tombe pour de bon. Fichier plan-de-reprise.md dans l\'espace de travail.',
  risk: 'write',
  schema: obj({}),
  summarize: () => 'mettre à jour le plan de reprise',
  async run(_i, ctx) {
    if (!ctx.careCfg || !ctx.paths) return 'Indisponible.';
    return recoveryPlan({ cfg: ctx.careCfg, paths: ctx.paths, devices: ctx.inventory?.list({ status: 'all' }) ?? [], machines: ctx.home ? listMachines(ctx.home) : [] });
  },
};
