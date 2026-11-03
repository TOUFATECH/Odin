// Outils réseau et maintenance : inventaire, balayage, mises à jour de la machine.
import { spawn } from 'node:child_process';
import { checkUpdates, deviceLabel, formatReport, linksFor, UPDATE_MANAGERS } from '../hlidskjalf/inventory.ts';
import { scanNetwork } from '../hlidskjalf/scan.ts';
import { safeEnv } from './builtin.ts';
import { bool, obj, str, type Tool } from './registry.ts';

const s = (v: unknown) => String(v ?? '');

export const netInventory: Tool = {
  name: 'net_inventory',
  description: 'Liste les appareils connus du réseau local (type, IP, état, ce qu\'Odin peut faire avec). Avec `device`, détaille un appareil et son historique.',
  risk: 'read',
  schema: obj({ device: str('IP, MAC ou identifiant (facultatif)'), include_removed: bool('inclure les appareils retirés') }),
  async run(i, ctx) {
    const inv = ctx.inventory;
    if (!inv) return 'Inventaire indisponible.';
    if (i.device) {
      const d = inv.get(s(i.device));
      if (!d) return `Appareil inconnu : ${s(i.device)}`;
      const links = linksFor(d).map((l) => `- ${l.action} → ${l.how} [${l.risk}]`).join('\n') || '- aucune action connue';
      const ev = inv.events(10, d.id).map((e) => `- ${new Date(e.at).toLocaleString('fr-FR')} : ${e.kind} ${e.detail}`).join('\n');
      return `${deviceLabel(d)} — ${d.kind} — ${d.status}\nIP ${d.ip} · MAC ${d.mac || '?'} · réseau ${d.network}\nPorts ouverts : ${d.ports.join(', ') || 'aucun connu'}\nServices : ${d.services.join(', ') || 'aucun'}\nModèle / serveur : ${[d.model, d.server].filter(Boolean).join(' · ') || '?'}\nVu la première fois : ${new Date(d.first_seen).toLocaleString('fr-FR')}, dernière fois : ${new Date(d.last_seen).toLocaleString('fr-FR')}\n\nCe qu'Odin peut faire :\n${links}\n\nHistorique :\n${ev}`;
    }
    const list = inv.list({ status: i.include_removed ? 'all' : undefined });
    const last = inv.lastScan();
    if (!list.length) return `Aucun appareil connu${last ? '' : ' : aucun balayage n\'a encore eu lieu (outil net_scan)'}.`;
    const head = last ? `Dernier balayage : ${new Date(last.at).toLocaleString('fr-FR')} (${last.full ? 'complet' : 'rapide'}).\n` : '';
    return head + list.map((d) => `${d.status === 'online' ? '●' : d.status === 'offline' ? '○' : '×'} ${deviceLabel(d)} · ${d.kind} · ${d.ip}${d.status !== 'online' ? ` · ${d.status === 'offline' ? 'déconnecté' : 'retiré'}` : ''}`).join('\n');
  },
};

export const netScan: Tool = {
  name: 'net_scan',
  description: 'Balaye les réseaux locaux PRIVÉS de la machine (jamais Internet) et met l\'inventaire à jour. `full` teste aussi les ports (plus long, ~30 s).',
  risk: 'network',
  schema: obj({ full: bool('balayage complet avec ports') }),
  summarize: (i) => `balayer le réseau local${i.full ? ' (complet)' : ''}`,
  async run(i, ctx) {
    if (!ctx.inventory || !ctx.netConfig) return 'Inventaire indisponible.';
    const r = await scanNetwork(ctx.inventory, ctx.netConfig, Boolean(i.full));
    return formatReport(r);
  },
};

export const systemUpdates: Tool = {
  name: 'system_updates',
  description: 'Vérifie les mises à jour disponibles sur la machine d\'Odin (apt, dnf, pacman, Homebrew, softwareupdate, winget) sans rien installer.',
  risk: 'read',
  schema: obj({}),
  async run() {
    const checks = await checkUpdates();
    if (!checks.length) return 'Aucun gestionnaire de mises à jour reconnu sur cette machine.';
    return checks.map((c) => `${c.manager} : ${c.count} mise(s) à jour disponible(s)${c.count ? `\nPour installer : system_update_apply avec manager="${c.manager}" (validation requise)\n${c.output.split('\n').slice(0, 15).join('\n')}` : ''}`).join('\n\n');
  },
};

export const systemUpdateApply: Tool = {
  name: 'system_update_apply',
  description: 'Installe les mises à jour d\'un gestionnaire de paquets. Toujours soumis à validation humaine ; peut demander le mot de passe administrateur dans un terminal.',
  risk: 'exec',
  schema: obj({ manager: str('apt, dnf, pacman, macOS, Homebrew ou winget') }, ['manager']),
  summarize: (i) => `installer les mises à jour (${s(i.manager)}) : ${findManager(s(i.manager))?.apply ?? '?'}`,
  command: (i) => findManager(s(i.manager))?.apply ?? `inconnu:${s(i.manager)}`,
  run(i, ctx) {
    const m = findManager(s(i.manager));
    if (!m) return Promise.resolve(`Gestionnaire inconnu sur ce système : ${s(i.manager)}`);
    return new Promise((res) => {
      const [bin, args] = process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-Command', m.apply]] : ['/bin/sh', ['-c', m.apply.replace(/sudo /g, 'sudo -n ')]];
      const child = spawn(bin, args, { env: safeEnv(), signal: ctx.signal, windowsHide: true });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      child.on('error', (e) => res(`Erreur : ${e.message}`));
      child.on('close', (code) => res(`${out.slice(-6000)}\n[code de sortie : ${code}]${/sudo: a (terminal|password) is required/.test(out) ? '\nIl faut le mot de passe administrateur : lance la commande toi-même dans un terminal.' : ''}`));
    });
  },
};

function findManager(name: string) {
  return (UPDATE_MANAGERS[process.platform] ?? []).find((m) => m.manager.toLowerCase() === name.toLowerCase());
}

export const NETWORK_TOOLS: Tool[] = [netInventory, netScan, systemUpdates, systemUpdateApply];
