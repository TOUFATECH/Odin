// Ce qu'Odin a appris de tes habitudes : le voir, l'oublier, lui redemander de te demander.

import { forgetHabit, habitWhen, knownHabits, revokeTrust, trusts } from '../learn/habits.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { obj, str, type Tool } from './registry.ts';

const s = (v: unknown) => String(v ?? '').trim();

export const habitsList: Tool = {
  name: 'habits_list',
  description: 'Ce qu\'Odin a appris des habitudes du propriétaire : routines qu\'il prépare tout seul (ou propose), et actions qu\'il fait désormais sans demander parce que le propriétaire les accepte toujours.',
  risk: 'read',
  schema: obj({}),
  async run(_i, ctx) {
    const k = knownHabits(ctx.muninn), t = trusts(ctx.muninn).filter((x) => x.learned);
    const lines: string[] = [];
    if (k.length) lines.push('Routines :', ...k.map((h) => `- [${h.key}] « ${h.habit.sample.slice(0, 90)} » ${habitWhen(h.habit)} — ${h.state === 'active' ? 'je le prépare tout seul' : h.state === 'proposed' ? 'proposé, en attente de ta réponse' : 'refusé (je ne le propose plus)'}`));
    if (t.length) lines.push('Je fais seul (tu l\'acceptes toujours) :', ...t.map((x) => `- [${x.key}] ${x.example} (accepté ${x.yes} fois)`));
    return lines.length ? lines.join('\n') : 'Je n\'ai pas encore repéré d\'habitude : il me faut voir une même demande au moins 3 jours.';
  },
};

export const habitForget: Tool = {
  name: 'habit_forget',
  description: 'Oublie une habitude apprise : arrête une routine préparée seule (clé de habits_list), ou redemande l\'accord pour une action qu\'Odin faisait seul (« redemande-moi avant de … »). Sans clé : la dernière apprise.',
  risk: 'write',
  schema: obj({ key: str('clé entre crochets dans habits_list (facultatif)') }),
  summarize: (i) => `oublier l'habitude ${s(i.key) || '(la dernière)'}`,
  async run(i, ctx) {
    const key = s(i.key);
    const h = key ? forgetHabit(ctx.muninn, key) : undefined;
    if (h) { if (h.jobId) ctx.muninn.removeJob(h.jobId); return `Routine oubliée : « ${h.habit.sample.slice(0, 80)} ». Je ne la proposerai plus.`; }
    const t = revokeTrust(ctx.muninn, key || undefined);
    return t ? `D'accord : je te redemanderai avant de faire « ${t.example.slice(0, 80)} ».` : 'Aucune habitude à oublier.';
  },
};

export const environmentMap: Tool = {
  name: 'environment_map',
  description: 'La carte de la maison telle qu\'Odin l\'a apprise en observant le réseau chaque heure : rôle de chaque appareil, rythme (toujours allumé, en semaine 8 h – 18 h…), qui est à la maison (téléphones), machines où il peut agir. Filtre facultatif (nom, adresse, rôle).',
  risk: 'read',
  schema: obj({ filter: str('nom, adresse ou rôle (facultatif)') }),
  async run(i, ctx) {
    const p = join(ctx.home ?? '', 'ENVIRONMENT.md');
    if (!ctx.home || !existsSync(p)) return 'Je n\'ai pas encore observé le réseau : il faut que l\'inventaire réseau soit actif (Réglages → Réseau), puis une heure.';
    const text = readFileSync(p, 'utf8'), f = s(i.filter).toLowerCase();
    return f ? text.split('\n').filter((l) => !l.startsWith('|') || l.toLowerCase().includes(f) || /^\| (Appareil|---)/.test(l)).join('\n') : text;
  },
};

export const HABIT_TOOLS: Tool[] = [habitsList, habitForget, environmentMap];
