// Hliðskjálf — l'inventaire : chaque appareil vu sur le réseau, son type, son état
// (en ligne / déconnecté / retiré), son historique, et ce qu'Odin peut faire avec lui.

import type { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { type Found, isRandomMac } from './discover.ts';
import { vendorOf, WEB_HINTS } from './vendors.ts';
import { nameFromTitle, serviceName, type WebEndpoint } from './identify.ts';

export type DeviceStatus = 'online' | 'offline' | 'removed';

export interface Device {
  id: string;
  ip: string;
  mac: string;
  hostname: string;
  name: string;
  model: string;
  kind: string;
  ports: number[];
  services: string[];
  server: string;
  network: string;
  status: DeviceStatus;
  first_seen: number;
  last_seen: number;
  label: string;
  /** Interfaces web (port, adresse, titre, serveur). */
  web: WebEndpoint[];
  /** Système et version (identification approfondie). */
  os?: string;
}

export interface ScanReport {
  at: number;
  networks: string[];
  seen: number;
  added: Device[];
  reconnected: Device[];
  disconnected: Device[];
  removed: Device[];
  changed: Array<{ device: Device; what: string }>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices(
  id TEXT PRIMARY KEY, ip TEXT NOT NULL, mac TEXT NOT NULL DEFAULT '', hostname TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'inconnu', ports TEXT NOT NULL DEFAULT '[]', services TEXT NOT NULL DEFAULT '[]',
  server TEXT NOT NULL DEFAULT '', network TEXT NOT NULL, status TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '', web TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS device_events(id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS scans(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, networks TEXT NOT NULL, seen INTEGER NOT NULL, full INTEGER NOT NULL);
`;

const has = (f: { ports: number[]; services: string[] }, ...needles: Array<number | string>) =>
  needles.some((n) => (typeof n === 'number' ? f.ports.includes(n) : f.services.some((s) => s.includes(n))));

/** Devine le type d'appareil : fabricant (MAC), titres de ses pages web, ports et services annoncés. */
export function classify(f: Pick<Found, 'ports' | 'services' | 'server' | 'mac' | 'isGateway' | 'model'> & { web?: WebEndpoint[]; name?: string }): string {
  const vendor = vendorOf(f.mac);
  const srv = `${f.server ?? ''} ${f.model ?? ''} ${f.name ?? ''} ${vendor}`.toLowerCase();
  const titles = (f.web ?? []).map((w) => `${w.title} ${w.server}`).join(' ');
  if (f.isGateway || has(f, 'internetgatewaydevice', 'wanipconnection')) return 'routeur';
  for (const [re, kind] of WEB_HINTS) if (re.test(titles)) return kind;
  if (/proxmox|qemu|vmware|hyper-v|virtualbox|docker/.test(vendor.toLowerCase())) return has(f, 8006) ? 'serveur' : 'machine virtuelle';
  if (has(f, 631, 9100, '_ipp', '_printer') || /printer|laserjet|epson|brother|canon|kyocera/.test(srv)) return 'imprimante';
  if (has(f, 554, '_rtsp') || /camera|ipcam|hikvision|dahua|reolink/.test(srv)) return 'caméra';
  if (has(f, 8123, 1883, '_hap', '_homeassistant') || /hue|homey|zigbee|espressif|tuya|shelly|objet connecté/.test(srv)) return 'domotique';
  if (has(f, 8009, '_googlecast', '_airplay', '_raop', 'mediarenderer') || /\btv\b|chromecast|roku|sonos|appletv|shield/.test(srv)) return 'multimédia';
  if ((has(f, 445, '_smb') && has(f, 5000, 548)) || /synology|qnap|\bnas\b|western digital/.test(srv)) return 'stockage (NAS)';
  if (has(f, 8006)) return 'serveur';
  if (has(f, 62078)) return 'téléphone / tablette';
  if (has(f, 22, 3389, 139, 445, 5900)) return 'ordinateur / serveur';
  if (/raspberry/.test(srv)) return 'ordinateur / serveur';
  if (f.mac && isRandomMac(f.mac) && !f.ports.length) return 'téléphone / tablette';
  if (/apple|samsung|xiaomi|huawei|google|oneplus|oppo/.test(srv) && !f.ports.length) return 'téléphone / tablette';
  return 'inconnu';
}

export interface Link { action: string; how: string; risk: 'read' | 'write' | 'exec' | 'external' }

/** Ce qu'Odin peut faire avec un appareil (les « liens »). Chaque action reste soumise à Heimdall. */
export function linksFor(d: Pick<Device, 'ip' | 'ports' | 'services' | 'kind'> & { web?: WebEndpoint[] }): Link[] {
  const L: Link[] = [];
  if (d.web?.length) for (const w of d.web) L.push({ action: `Interface web${w.title ? ` « ${w.title} »` : ''} (${serviceName(w.port)})`, how: w.url, risk: 'read' });
  else {
    const web = d.ports.find((p) => [443, 80, 8080, 5000].includes(p));
    if (web) L.push({ action: 'Ouvrir son interface d\'administration', how: `${web === 443 ? 'https' : 'http'}://${d.ip}${[80, 443].includes(web) ? '' : `:${web}`}`, risk: 'read' });
  }
  if (has(d, 631, 9100, '_ipp', '_printer')) L.push({ action: 'Imprimer un document', how: `IPP : ipp://${d.ip}/ipp/print`, risk: 'external' });
  if (has(d, 22, '_ssh')) L.push({ action: 'L\'administrer à distance', how: `ssh ${d.ip} (shell, validation requise)`, risk: 'exec' });
  if (has(d, 445, 139, '_smb')) L.push({ action: 'Lire ou déposer des fichiers partagés', how: `smb://${d.ip}`, risk: 'write' });
  if (has(d, 554, '_rtsp')) L.push({ action: 'Lire le flux vidéo', how: `rtsp://${d.ip}:554`, risk: 'read' });
  if (has(d, 8123, '_homeassistant')) L.push({ action: 'Piloter la domotique', how: `API Home Assistant http://${d.ip}:8123`, risk: 'external' });
  if (has(d, 1883)) L.push({ action: 'Lire et publier des messages MQTT', how: `mqtt://${d.ip}:1883`, risk: 'external' });
  if (has(d, 8009, '_googlecast')) L.push({ action: 'Diffuser un média', how: 'Google Cast', risk: 'external' });
  if (has(d, '_airplay', '_raop')) L.push({ action: 'Diffuser un média', how: 'AirPlay', risk: 'external' });
  if (['routeur', 'stockage (NAS)', 'caméra', 'imprimante'].includes(d.kind)) L.push({ action: 'Vérifier si un micrologiciel plus récent existe', how: 'interface d\'administration ou site du fabricant', risk: 'read' });
  return L;
}

const rowToDevice = (r: Record<string, unknown>): Device => ({
  ...(r as unknown as Device),
  ports: JSON.parse(r.ports as string) as number[],
  services: JSON.parse(r.services as string) as string[],
  web: JSON.parse((r.web as string) || '[]') as WebEndpoint[],
});

export class Inventory {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(SCHEMA);
    try { this.db.exec("ALTER TABLE devices ADD COLUMN web TEXT NOT NULL DEFAULT '[]'"); } catch { /* colonne déjà présente */ }
    try { this.db.exec("ALTER TABLE devices ADD COLUMN os TEXT NOT NULL DEFAULT ''"); } catch { /* colonne déjà présente */ }
  }

  list(filter: { status?: DeviceStatus | 'all'; kind?: string } = {}): Device[] {
    const rows = this.db.prepare("SELECT * FROM devices ORDER BY CASE status WHEN 'online' THEN 0 WHEN 'offline' THEN 1 ELSE 2 END, kind, ip").all() as Array<Record<string, unknown>>;
    return rows.map(rowToDevice)
      .filter((d) => (filter.status === 'all' ? true : filter.status ? d.status === filter.status : d.status !== 'removed'))
      .filter((d) => !filter.kind || d.kind.includes(filter.kind));
  }

  get(idOrIp: string): Device | undefined {
    const r = this.db.prepare('SELECT * FROM devices WHERE id = ? OR ip = ? ORDER BY last_seen DESC').get(idOrIp, idOrIp) as Record<string, unknown> | undefined;
    return r ? rowToDevice(r) : undefined;
  }

  events(limit = 50, deviceId?: string): Array<{ device_id: string; kind: string; detail: string; at: number }> {
    return (deviceId
      ? this.db.prepare('SELECT * FROM device_events WHERE device_id = ? ORDER BY id DESC LIMIT ?').all(deviceId, limit)
      : this.db.prepare('SELECT * FROM device_events ORDER BY id DESC LIMIT ?').all(limit)) as Array<{ device_id: string; kind: string; detail: string; at: number }>;
  }

  lastScan(): { at: number; seen: number; full: number } | undefined {
    return this.db.prepare('SELECT at, seen, full FROM scans ORDER BY id DESC LIMIT 1').get() as { at: number; seen: number; full: number } | undefined;
  }

  /** Complète un appareil après identification approfondie (sans écraser un nom donné par toi). */
  enrich(id: string, f: { hostname?: string; model?: string; os?: string }): void {
    const cut = (v?: string) => (v ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 80);
    if (f.hostname) this.db.prepare("UPDATE devices SET hostname = ? WHERE id = ? AND hostname = ''").run(cut(f.hostname), id);
    if (f.model) this.db.prepare('UPDATE devices SET model = ? WHERE id = ?').run(cut(f.model), id);
    if (f.os) this.db.prepare('UPDATE devices SET os = ? WHERE id = ?').run(cut(f.os), id);
  }

  setLabel(id: string, label: string): boolean {
    return Number(this.db.prepare('UPDATE devices SET label = ? WHERE id = ?').run(label.slice(0, 80), id).changes) > 0;
  }

  private event(id: string, kind: string, detail: string, at: number): void {
    this.db.prepare('INSERT INTO device_events(device_id, kind, detail, at) VALUES (?,?,?,?)').run(id, kind, detail, at);
  }

  /**
   * Fusionne un balayage avec l'inventaire.
   * Identité : l'adresse MAC si connue (l'IP peut changer), sinon l'IP.
   * Un appareil absent d'un réseau balayé passe « déconnecté » ; absent depuis
   * `removeAfterDays` jours, il passe « retiré ». Les appareils d'un autre réseau
   * (ordinateur portable déplacé) ne sont pas touchés.
   */
  applyScan(found: Found[], networks: string[], now = Date.now(), removeAfterDays = 7, full = false): ScanReport {
    const rep: ScanReport = { at: now, networks, seen: found.length, added: [], reconnected: [], disconnected: [], removed: [], changed: [] };
    const seenIds = new Set<string>();
    for (const f of found) {
      const kind = classify(f);
      let cur = f.mac ? this.get(f.mac) : undefined;
      if (!cur) {
        const byIp = this.db.prepare("SELECT * FROM devices WHERE ip = ? AND (mac = '' OR mac = ?)").get(f.ip, f.mac ?? '') as Record<string, unknown> | undefined;
        if (byIp) cur = rowToDevice(byIp);
      }
      const id = cur?.id && (cur.mac || !f.mac) ? cur.id : f.mac ?? `ip:${f.ip}`;
      if (cur && cur.id !== id) this.db.prepare('UPDATE devices SET id = ? WHERE id = ?').run(id, cur.id); // l'IP a désormais une MAC connue
      seenIds.add(id);
      // En balayage rapide (sans ports), on garde les ports connus.
      const ports = full || !cur ? f.ports : cur.ports;
      const services = [...new Set([...(f.services ?? []), ...(full ? [] : cur?.services ?? [])])];
      const next = {
        id, ip: f.ip, mac: f.mac ?? cur?.mac ?? '', hostname: f.hostname ?? cur?.hostname ?? '', name: f.name ?? f.netbios ?? cur?.name ?? '',
        model: [f.manufacturer, f.model].filter(Boolean).join(' ') || cur?.model || '', kind: kind === 'inconnu' && cur ? cur.kind : kind, ports, services, server: f.server ?? cur?.server ?? '', network: f.network,
      };
      if (!cur) {
        this.db.prepare(`INSERT INTO devices(id, ip, mac, hostname, name, model, kind, ports, services, server, network, status, first_seen, last_seen, web)
          VALUES (?,?,?,?,?,?,?,?,?,?,?, 'online', ?, ?, ?)`).run(id, next.ip, next.mac, next.hostname, next.name, next.model, next.kind, JSON.stringify(ports), JSON.stringify(services), next.server, next.network, now, now, JSON.stringify(f.web ?? []));
        if (f.os) this.db.prepare('UPDATE devices SET os = ? WHERE id = ?').run(f.os.slice(0, 80), id);
        this.event(id, 'nouveau', `${next.kind} ${next.ip}`, now);
        rep.added.push(this.get(id)!);
        continue;
      }
      if (cur.status !== 'online') { this.event(id, 'reconnecté', next.ip, now); }
      if (cur.ip !== next.ip) { this.event(id, 'ip changée', `${cur.ip} → ${next.ip}`, now); rep.changed.push({ device: cur, what: `IP ${cur.ip} → ${next.ip}` }); }
      const newPorts = ports.filter((p) => !cur!.ports.includes(p));
      if (full && newPorts.length) { this.event(id, 'nouveaux ports', newPorts.join(','), now); rep.changed.push({ device: cur, what: `ports ouverts : ${newPorts.join(', ')}` }); }
      const web = full && f.web ? f.web : cur.web;
      this.db.prepare(`UPDATE devices SET ip=?, mac=?, hostname=?, name=?, model=?, kind=?, ports=?, services=?, server=?, network=?, status='online', last_seen=?, web=? WHERE id=?`)
        .run(next.ip, next.mac, next.hostname, next.name, next.model, next.kind, JSON.stringify(ports), JSON.stringify(services), next.server, next.network, now, JSON.stringify(web), id);
      if (f.os) this.db.prepare('UPDATE devices SET os = ? WHERE id = ?').run(f.os.slice(0, 80), id);
      if (cur.status !== 'online') rep.reconnected.push(this.get(id)!);
    }
    for (const d of this.list({ status: 'all' })) {
      if (seenIds.has(d.id) || !networks.includes(d.network) || d.status === 'removed') continue;
      if (now - d.last_seen > removeAfterDays * 86_400_000) {
        this.db.prepare("UPDATE devices SET status='removed' WHERE id=?").run(d.id);
        this.event(d.id, 'retiré', `absent depuis ${removeAfterDays} jours`, now);
        rep.removed.push({ ...d, status: 'removed' });
      } else if (d.status === 'online') {
        this.db.prepare("UPDATE devices SET status='offline' WHERE id=?").run(d.id);
        this.event(d.id, 'déconnecté', d.ip, now);
        rep.disconnected.push({ ...d, status: 'offline' });
      }
    }
    this.db.prepare('INSERT INTO scans(at, networks, seen, full) VALUES (?,?,?,?)').run(now, JSON.stringify(networks), found.length, full ? 1 : 0);
    return rep;
  }
}

/** Nom lisible : celui que tu as donné, puis celui annoncé, puis le modèle, puis « fabricant + type ». */
export const deviceLabel = (d: Device) => {
  const titled = (d.web ?? []).find((w) => w.title && !w.title.startsWith('→'))?.title;
  const node = titled ? nameFromTitle(titled) : undefined;
  const named = d.label || d.name || d.hostname || d.model || (node ? `${node} (${/proxmox/i.test(titled!) ? 'Proxmox' : titled!.split(/\s+[-|–]\s+/).at(-1)})` : titled);
  if (named) return named;
  const v = vendorOf(d.mac).replace(/ \(objet connecté\)$/, '');
  if (v) return `${v}${d.kind && d.kind !== 'inconnu' ? ` (${d.kind})` : ''}`;
  if (d.mac && isRandomMac(d.mac)) return 'Appareil mobile (adresse privée)';
  return d.ip;
};

/** Résumé lisible d'un balayage, pour le terminal ou un message Telegram. */
export function formatReport(r: ScanReport): string {
  const line = (d: Device) => `${deviceLabel(d)} (${d.kind}, ${d.ip})`;
  const parts = [`Réseau${r.networks.length > 1 ? 'x' : ''} ${r.networks.join(', ') || 'aucun'} : ${r.seen} appareil(s) en ligne.`];
  if (r.added.length) parts.push(`Nouveaux : ${r.added.map(line).join(' · ')}`);
  if (r.reconnected.length) parts.push(`Reconnectés : ${r.reconnected.map(line).join(' · ')}`);
  if (r.disconnected.length) parts.push(`Déconnectés : ${r.disconnected.map(line).join(' · ')}`);
  if (r.removed.length) parts.push(`Retirés de l'inventaire : ${r.removed.map(line).join(' · ')}`);
  if (r.changed.length) parts.push(`Changements : ${r.changed.map((c) => `${deviceLabel(c.device)} ${c.what}`).join(' · ')}`);
  return parts.join('\n');
}

export const hasChanges = (r: ScanReport) => r.added.length + r.disconnected.length + r.removed.length + r.reconnected.length + r.changed.length > 0;

// ---------- Mises à jour de la machine d'Odin ----------

export interface UpdateCheck { manager: string; checkCmd: string[]; applyCmd: string; output: string; count: number }

/** Gestionnaires de paquets par système : vérification (lecture seule) et commande d'application. */
export const UPDATE_MANAGERS: Record<string, Array<{ manager: string; check: string[]; apply: string; count: (out: string) => number }>> = {
  linux: [
    { manager: 'apt', check: ['apt', 'list', '--upgradable'], apply: 'sudo apt update && sudo apt upgrade -y', count: (o) => o.split('\n').filter((l) => l.includes('/') && l.includes('[upgradable')).length },
    { manager: 'dnf', check: ['dnf', 'check-update', '-q'], apply: 'sudo dnf upgrade -y', count: (o) => o.split('\n').filter((l) => /^\S+\.\S+\s+\S+\s+\S+/.test(l)).length },
    { manager: 'pacman', check: ['checkupdates'], apply: 'sudo pacman -Syu --noconfirm', count: (o) => o.split('\n').filter(Boolean).length },
  ],
  darwin: [
    { manager: 'macOS', check: ['softwareupdate', '-l'], apply: 'sudo softwareupdate -ia', count: (o) => (o.match(/^\s*\* Label:/gm) ?? []).length },
    { manager: 'Homebrew', check: ['brew', 'outdated'], apply: 'brew upgrade', count: (o) => o.split('\n').filter(Boolean).length },
  ],
  win32: [
    { manager: 'winget', check: ['winget', 'upgrade', '--accept-source-agreements'], apply: 'winget upgrade --all --accept-source-agreements --accept-package-agreements', count: (o) => Math.max(0, o.split('\n').filter((l) => /\S+\s+\S+\s+[\d.]+\s+[\d.]+/.test(l)).length - 1) },
  ],
};

/** Vérifie les mises à jour disponibles SANS rien installer. */
export async function checkUpdates(platform = process.platform): Promise<UpdateCheck[]> {
  const out: UpdateCheck[] = [];
  for (const m of UPDATE_MANAGERS[platform] ?? []) {
    const text = await new Promise<string | undefined>((res) => execFile(m.check[0], m.check.slice(1), { timeout: 120_000, windowsHide: true }, (e, stdout) => {
      res(e && (e as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : String(stdout ?? ''));
    }));
    if (text === undefined) continue; // gestionnaire absent
    out.push({ manager: m.manager, checkCmd: m.check, applyCmd: m.apply, output: text.slice(0, 4000), count: m.count(text) });
  }
  return out;
}
