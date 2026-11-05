// Fonctions facultatives d'Odin (Proxmox, Maison, Mail, Agenda, Documents, Entretien, Personnalité,
// accès extérieur) : elles ne s'affichent pas d'emblée. Odin les propose quand ton usage s'y prête
// — un serveur Proxmox vu sur le réseau, des questions sur tes rendez-vous… — ou dès qu'elles sont reliées.

import type { OdinConfig } from './config.ts';
import type { Device } from './hlidskjalf/inventory.ts';

export type FeatureId = 'proxmox' | 'maison' | 'mail' | 'agenda' | 'documents' | 'entretien' | 'personnalite' | 'exterieur';
export interface Feature { id: FeatureId; label: string; on: boolean; why?: string }

const LABEL: Record<FeatureId, string> = {
  proxmox: 'Proxmox', maison: 'Maison (Home Assistant)', mail: 'Mail', agenda: 'Agenda', documents: 'Documents',
  entretien: 'Entretien (réparations, mises à jour, journal)', personnalite: 'Personnalité', exterieur: 'Accès depuis l\'extérieur',
};

/** Mots qui montrent un besoin dans tes messages. */
const NEEDS: Partial<Record<FeatureId, RegExp>> = {
  mail: /\b(e-?mails?|mails?|courriels?|gmail|outlook|bo[iî]te de r[ée]ception|newsletter)\b/i,
  agenda: /\b(agenda|rendez-vous|rdv|r[ée]union|calendrier|planning|rappelle-moi (le|mardi|lundi|mercredi|jeudi|vendredi|samedi|dimanche))\b/i,
  documents: /\b(factures?|documents?|pdf|contrats?|retrouve(r)? (le|la|les|mon|ma|mes) (fichier|doc)|ranger mes)\b/i,
  maison: /\b(lumi[eè]res?|lampes?|prises?|volets?|chauffage|thermostat|temp[ée]rature (du|au|de la) (salon|chambre|maison)|domotique|home assistant)\b/i,
  exterieur: /\b(de l'ext[ée]rieur|hors de (la )?maison|[àa] distance|depuis mon t[ée]l[ée]phone dehors|en d[ée]placement|tailscale|cloudflare)\b/i,
  personnalite: /\b(ton (plus|moins)|sois plus (s[ée]rieux|dr[oô]le|concis|d[ée]tendu)|change (ta|de) (voix|personnalit[ée])|personnalit[ée])\b/i,
  entretien: /\b(mets? [àa] jour (mes|les) machines|mise [àa] jour (automatique|la nuit)|red[ée]marre(r)? (le|mon) service|r[ée]pare|surveille (le|mon) service)\b/i,
};

/** Quelles fonctions montrer, et pourquoi Odin les propose (pur, testable). */
export function features(o: { cfg: OdinConfig; env?: NodeJS.ProcessEnv; devices: Device[]; recentUserText: string[]; dismissed: Set<string>; machines: number }): Feature[] {
  const { cfg, devices } = o, env = o.env ?? process.env;
  const online = devices.filter((d) => d.status !== 'removed');
  const find = (re: RegExp, port: number) => online.find((d) => d.ports.includes(port) || (d.web ?? []).some((w) => re.test(w.title)));
  const said = (id: FeatureId) => { const re = NEEDS[id]; return re ? o.recentUserText.find((t) => re.test(t)) : undefined; };
  const name = (d?: Device) => (d ? `${d.label || d.name || d.hostname || d.ip} (${d.ip})` : '');
  const quote = (t?: string) => (t ? `tu en as parlé : « ${t.replace(/\s+/g, ' ').slice(0, 60)}${t.length > 60 ? '…' : ''} »` : undefined);
  const out: Feature[] = [];
  const add = (id: FeatureId, on: boolean, why?: string) => out.push({ id, label: LABEL[id], on, why: on ? undefined : why && !o.dismissed.has(id) ? why : undefined });

  const pve = find(/proxmox/i, 8006);
  add('proxmox', Boolean(cfg.proxmox.url && env.PROXMOX_TOKEN), pve ? `j'ai vu un serveur Proxmox sur ton réseau : ${name(pve)}` : undefined);
  const ha = find(/home assistant/i, 8123);
  add('maison', Boolean(cfg.homeAssistant.url && env.HA_TOKEN), ha ? `j'ai vu Home Assistant sur ton réseau : ${name(ha)}` : quote(said('maison')));
  add('mail', Boolean(cfg.mail.user && env.MAIL_PASSWORD), quote(said('mail')));
  add('agenda', Boolean(env.CALENDAR_ICS_URL || cfg.calendar.caldavUrl), quote(said('agenda')));
  const nas = online.find((d) => d.kind === 'stockage (NAS)');
  add('documents', cfg.docs.dirs.length > 0, quote(said('documents')) ?? (nas ? `tu as un NAS (${name(nas)}) : je peux indexer tes documents pour les retrouver en un mot` : undefined));
  const servers = online.filter((d) => ['serveur', 'machine virtuelle', 'stockage (NAS)'].includes(d.kind)).length;
  add('entretien', cfg.services.length > 0 || cfg.updates.enabled, quote(said('entretien')) ?? (o.machines > 0 || servers >= 2 ? `tu as ${o.machines || servers} machine(s) à entretenir : je peux les réparer et les mettre à jour la nuit` : undefined));
  const customProfiles = cfg.profiles.auto || cfg.profiles.list.some((p) => p.voiceId) || cfg.profiles.active !== 'maison';
  add('personnalite', customProfiles, quote(said('personnalite')));
  add('exterieur', (cfg.tunnel?.kind ?? 'none') !== 'none', quote(said('exterieur')));
  return out;
}

/** Ligne du prompt : ce qu'Odin peut proposer de relier, s'il en voit l'utilité (jamais d'insistance). */
export function featuresPrompt(fs: Feature[]): string {
  const off = fs.filter((f) => !f.on);
  if (!off.length) return '';
  return `## Fonctions que tu peux proposer\nCes fonctions ne sont pas encore reliées : ${off.map((f) => f.label).join(', ')}. Ne les mentionne QUE si la demande en cours en a vraiment besoin (ex. une question sur un rendez-vous → proposer de relier l'agenda) : explique en une phrase ce que ça apporterait, et où le faire (Réglages, ou l'Accueil d'Odin). Jamais d'insistance.`;
}
