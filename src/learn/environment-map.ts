// Odin apprend son environnement : chaque heure, il note quels appareils sont allumés. Au fil des
// semaines, il sait ce qui est « toujours allumé » (box, serveurs, NAS), ce qui suit un rythme (le PC
// du bureau en semaine, la télé le soir, les téléphones quand vous êtes là), et il le résume dans
// ~/.odin/ENVIRONMENT.md. Il te prévient de ce qui sort de l'habitude : un appareil « toujours
// allumé » qui s'éteint, un appareil allumé à une heure où il ne l'est jamais.
// Tout reste sur la machine ; aucun modèle n'est appelé (calcul simple, gratuit).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Kv { getKv(k: string): string | undefined | null; setKv(k: string, v: string): void }
export interface Dev { id: number | string; ip: string; mac: string; hostname: string; name: string; label: string; kind: string; status: string; services: string[]; ports: number[]; first_seen: number; last_seen: number; os?: string }

/** Présence d'un appareil : pour chaque heure de la semaine (0 = dimanche 0 h), nombre d'observations et de fois en ligne. */
export interface Presence { seen: number[]; on: number[]; since: number }
export const PRESENCE_KEY = 'env-presence';
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const weekHour = (t: number) => { const d = new Date(t); return d.getDay() * 24 + d.getHours(); };

/** Note l'état de chaque appareil pour l'heure en cours (une fois par heure). Pur sur ses entrées. */
export function observe(prev: Record<string, Presence>, devices: Dev[], now: number): Record<string, Presence> {
  const out = { ...prev }, h = weekHour(now);
  for (const d of devices) {
    if (d.status === 'removed') continue;
    const k = String(d.id);
    const p = out[k] ? { seen: out[k].seen.slice(), on: out[k].on.slice(), since: out[k].since } : { seen: Array(168).fill(0), on: Array(168).fill(0), since: now };
    p.seen[h]++; if (d.status === 'online') p.on[h]++;
    out[k] = p;
  }
  return out;
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** Rythme d'un appareil en français (pur) : « toujours allumé », « en semaine, 8 h – 18 h », « le soir »… */
export function rhythm(p: Presence): { label: string; alwaysOn: boolean; known: boolean } {
  const n = sum(p.seen);
  if (n < 24) return { label: 'pas encore assez observé', alwaysOn: false, known: false };
  const ratio = sum(p.on) / n;
  if (ratio >= 0.95) return { label: 'toujours allumé', alwaysOn: true, known: true };
  if (ratio <= 0.03) return { label: 'presque jamais allumé', alwaysOn: false, known: true };
  // Heures de la journée où il est le plus souvent là (≥ 50 %), en semaine et le week-end
  const span = (days: number[]) => {
    const hours: number[] = [];
    for (let h = 0; h < 24; h++) { let s = 0, o = 0; for (const d of days) { s += p.seen[d * 24 + h]; o += p.on[d * 24 + h]; } if (s && o / s >= 0.5) hours.push(h); }
    if (!hours.length) return '';
    if (hours.length >= 22) return 'toute la journée';
    const runs: Array<[number, number]> = [];
    for (const h of hours) { const r = runs.at(-1); if (r && h === r[1] + 1) r[1] = h; else runs.push([h, h]); }
    return runs.map(([a, b]) => `${a} h – ${(b + 1) % 24} h`).join(', ');
  };
  const wk = span([1, 2, 3, 4, 5]), we = span([0, 6]);
  const label = wk && wk === we ? `chaque jour, ${wk}` : [wk && `en semaine ${wk}`, we && `le week-end ${we}`].filter(Boolean).join(' ; ') || `allumé ${Math.round(ratio * 100)} % du temps, sans horaire régulier`;
  return { label, alwaysOn: false, known: true };
}

/** Rôle probable (pur) : ce que l'appareil est pour la maison. */
export function role(d: Dev, r: { alwaysOn: boolean }): string {
  const k = d.kind.toLowerCase(), s = `${d.services.join(' ')} ${d.hostname} ${d.name} ${d.label}`.toLowerCase();
  if (k === 'routeur' || /gateway|livebox|freebox|bbox/.test(s)) return 'box / routeur';
  if (/proxmox|pve/.test(s)) return 'hyperviseur (Proxmox)';
  if (/nas|synology|qnap|truenas/.test(s)) return 'stockage (NAS)';
  if (/venus|jellyfin|plex|emby/.test(s)) return 'serveur multimédia';
  if (/home ?assistant|hass/.test(s)) return 'domotique';
  if (/imprim|printer|ipp/.test(`${k} ${s}`)) return 'imprimante';
  if (/phone|téléphone|iphone|android|pixel|galaxy/.test(`${k} ${s}`)) return 'téléphone (indique qui est à la maison)';
  if (/tv|télé|chromecast|roku|shield/.test(`${k} ${s}`)) return 'télé / lecteur';
  if (/camera|caméra|cam\b/.test(`${k} ${s}`)) return 'caméra';
  if (r.alwaysOn && d.ports.some((x) => [22, 80, 443, 8006, 5000, 8080].includes(x))) return 'serveur';
  if (/pc|ordinateur|desktop|laptop|mac|windows/.test(`${k} ${s}`)) return 'ordinateur';
  return d.kind || 'appareil';
}

const nameOf = (d: Dev) => d.label || d.name || d.hostname || d.ip;

/** Ce qui sort de l'habitude maintenant (pur). Ne compte que les appareils bien connus (≥ 2 semaines). */
export function surprises(devs: Dev[], pres: Record<string, Presence>, now: number, watched: string[] = []): Array<{ key: string; text: string }> {
  const out: Array<{ key: string; text: string }> = [], h = weekHour(now);
  for (const d of devs) {
    const p = pres[String(d.id)]; if (!p || now - p.since < 14 * 86_400_000) continue;
    if (watched.includes(String(d.id))) continue; // déjà surveillé par Vörðr
    const r = rhythm(p);
    if (r.alwaysOn && d.status !== 'online') out.push({ key: `off:${d.id}`, text: `- ${nameOf(d)} (${d.ip}) est éteint alors qu'il est toujours allumé d'habitude.` });
    else if (d.status === 'online' && p.seen[h] >= 2 && p.on[h] === 0 && !r.alwaysOn && sum(p.on) / sum(p.seen) < 0.3) out.push({ key: `odd:${d.id}:${h}`, text: `- ${nameOf(d)} (${d.ip}) est allumé ${DAYS[Math.floor(h / 24)]} à ${h % 24} h, ce qui n'arrive jamais d'habitude.` });
  }
  return out;
}

/** ENVIRONMENT.md : la carte de la maison telle qu'Odin l'a apprise (pur). */
export function renderEnvironment(devs: Dev[], pres: Record<string, Presence>, machines: Array<{ label: string; host: string; user: string }>, now: number): string {
  const rows = devs.filter((d) => d.status !== 'removed').map((d) => { const r = rhythm(pres[String(d.id)] ?? { seen: Array(168).fill(0), on: Array(168).fill(0), since: now }); return { d, r, role: role(d, r) }; })
    .sort((a, b) => Number(b.r.alwaysOn) - Number(a.r.alwaysOn) || a.role.localeCompare(b.role));
  const days = (t: number) => Math.max(0, Math.round((now - t) / 86_400_000));
  const out = ['# Environnement d\'Odin', '', `> Appris en observant ton réseau chaque heure (mis à jour le ${new Date(now).toLocaleString('fr-FR')}). Corrige un nom ou un rôle en le disant à Odin (« le 192.168.1.20 c'est la télé du salon »).`, ''];
  const infra = rows.filter((x) => x.r.alwaysOn);
  out.push('## En bref', '', `- ${rows.length} appareils connus, ${rows.filter((x) => x.d.status === 'online').length} en ligne maintenant.`, `- Toujours allumés : ${infra.map((x) => nameOf(x.d)).join(', ') || 'pas encore établi (il faut 1 journée d\'observation)'}.`);
  const phones = rows.filter((x) => /téléphone/.test(x.role));
  if (phones.length) out.push(`- Présence à la maison (téléphones) : ${phones.map((x) => `${nameOf(x.d)} ${x.d.status === 'online' ? 'là' : 'absent'}`).join(', ')}.`);
  if (machines.length) out.push(`- Machines où Odin peut agir : ${machines.map((m) => `${m.label} (${m.user}@${m.host})`).join(', ')}.`);
  out.push('', '## Appareils', '', '| Appareil | Adresse | Rôle | Rythme appris | Connu depuis |', '| --- | --- | --- | --- | --- |');
  for (const x of rows) out.push(`| ${nameOf(x.d).replace(/\|/g, '/')}${x.d.os ? ` (${x.d.os})` : ''} | ${x.d.ip} | ${x.role} | ${x.r.label} | ${days(x.d.first_seen)} j |`);
  return out.join('\n') + '\n';
}

/**
 * Tour d'apprentissage (chaque heure) : observe, réécrit ENVIRONMENT.md, renvoie les nouveautés à
 * signaler (au plus une fois par jour pour chaque appareil).
 */
export function learnEnvironment(odin: { muninn: Kv; inventory: { list(f: { status: 'all' }): Dev[] }; paths: { home: string }; cfg: { watch: { devices: string[] } } }, now = Date.now(), machines: Array<{ label: string; host: string; user: string }> = []): string[] {
  const devs = odin.inventory.list({ status: 'all' });
  if (!devs.length) return [];
  const pres = observe(JSON.parse(odin.muninn.getKv(PRESENCE_KEY) ?? '{}') as Record<string, Presence>, devs, now);
  odin.muninn.setKv(PRESENCE_KEY, JSON.stringify(pres));
  writeFileSync(join(odin.paths.home, 'ENVIRONMENT.md'), renderEnvironment(devs, pres, machines, now), { mode: 0o600 });
  const told = JSON.parse(odin.muninn.getKv('env-told') ?? '{}') as Record<string, number>, out: string[] = [];
  for (const s of surprises(devs, pres, now, odin.cfg.watch.devices.map(String))) {
    const k = s.key.replace(/:\d+$/, '');
    if (now - (told[k] ?? 0) < 86_400_000) continue;
    told[k] = now; out.push(s.text);
  }
  odin.muninn.setKv('env-told', JSON.stringify(told));
  return out;
}
