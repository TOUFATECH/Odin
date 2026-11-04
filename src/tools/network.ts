// Outils réseau et maintenance : inventaire, balayage, mises à jour de la machine.
import { spawn } from 'node:child_process';
import { checkUpdates, deviceLabel, formatReport, linksFor, UPDATE_MANAGERS } from '../hlidskjalf/inventory.ts';
import { scanNetwork } from '../hlidskjalf/scan.ts';
import { safeEnv } from './builtin.ts';
import { bool, num, obj, str, type Tool } from './registry.ts';
import { findMachine, listMachines, runOnMachine, withAdmin } from '../machines/access.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

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
      const admin = ctx.home ? withAdmin(m.apply, ctx.home) : { command: m.apply.replace(/sudo /g, 'sudo -n '), env: {} };
      const [bin, args] = process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-Command', m.apply]] : ['/bin/sh', ['-c', admin.command]];
      const child = spawn(bin, args, { env: { ...safeEnv(), ...admin.env }, signal: ctx.signal, windowsHide: true });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      child.on('error', (e) => res(`Erreur : ${e.message}`));
      child.on('close', (code) => res(`${out.slice(-6000)}\n[code de sortie : ${code}]${/sudo: a (terminal|password) is required/.test(out) ? '\nIl faut le mot de passe administrateur : donne-le à Odin dans Réglages → Droits et machines (ou « odin admin password »).' : ''}`));
    });
  },
};

function findManager(name: string) {
  return (UPDATE_MANAGERS[process.platform] ?? []).find((m) => m.manager.toLowerCase() === name.toLowerCase());
}

// ---------------- Machines du réseau (SSH) ----------------

const machineList: Tool = {
  name: 'machine_list',
  description: 'Liste les machines du réseau auxquelles Odin peut se connecter (nom, adresse, utilisateur). Les mots de passe ne sont jamais montrés.',
  risk: 'read',
  schema: obj({}),
  async run(_i, ctx) {
    if (!ctx.home) return 'Coffre des machines indisponible.';
    const list = listMachines(ctx.home);
    if (!list.length) return 'Aucune machine enregistrée. Le propriétaire peut en ajouter dans Réglages → Droits et machines (ou « odin machines add »).';
    return list.map((m) => `- ${m.label} : ${m.user}@${m.host}:${m.port}${m.keyInstalled ? ' (clé SSH d\'Odin)' : ''}${m.lastOk ? `, dernière connexion ${new Date(m.lastOk).toLocaleString('fr-FR')}` : ''}`).join('\n');
  },
};

const machineExec: Tool = {
  name: 'machine_exec',
  description: 'Exécute une commande sur une machine du réseau enregistrée (SSH). « sudo » fonctionne : le mot de passe est fourni tout seul. Désigne la machine par son nom ou son adresse (voir machine_list).',
  risk: 'exec',
  schema: obj({ machine: str('nom ou adresse de la machine'), command: str('commande à exécuter là-bas'), timeout_sec: num('délai max en secondes (120 par défaut, 1800 max)') }, ['machine', 'command']),
  summarize: (i) => `[${s(i.machine)}] $ ${s(i.command)}`,
  command: (i) => s(i.command),
  async run(i, ctx) {
    if (!ctx.home) return 'Coffre des machines indisponible.';
    const m = findMachine(ctx.home, s(i.machine));
    if (!m) return `Machine inconnue : ${s(i.machine)}. Machines enregistrées : ${listMachines(ctx.home).map((x) => x.label).join(', ') || 'aucune'}.`;
    const r = await runOnMachine(ctx.home, m, s(i.command), { signal: ctx.signal, timeoutMs: Math.min(1800, Math.max(1, Number(i.timeout_sec ?? 120))) * 1000 });
    return `${ctx.redactor.redact(r.out.trim()).slice(-20_000) || '(aucune sortie)'}\n[${m.label} · code de sortie : ${r.code}]`;
  },
};

const machineCopy: Tool = {
  name: 'machine_copy',
  description: 'Copie un fichier entre l\'espace de travail d\'Odin et une machine du réseau (send = vers la machine, get = depuis la machine).',
  risk: 'exec',
  schema: obj({ machine: str('nom ou adresse'), direction: str('send ou get'), local: str('chemin dans l\'espace de travail'), remote: str('chemin sur la machine') }, ['machine', 'direction', 'local', 'remote']),
  summarize: (i) => `[${s(i.machine)}] copie ${s(i.direction) === 'get' ? `${s(i.remote)} → ${s(i.local)}` : `${s(i.local)} → ${s(i.remote)}`}`,
  command: (i) => `scp ${s(i.local)} ${s(i.remote)}`,
  async run(i, ctx) {
    if (!ctx.home) return 'Coffre des machines indisponible.';
    const m = findMachine(ctx.home, s(i.machine));
    if (!m) return `Machine inconnue : ${s(i.machine)}.`;
    const local = resolve(ctx.workspace, s(i.local));
    if (relative(ctx.workspace, local).startsWith('..')) return 'Chemin local hors de l\'espace de travail : refusé.';
    const rq = `'${s(i.remote).replace(/'/g, `'\\''`)}'`;
    if (s(i.direction) === 'get') {
      const r = await runOnMachine(ctx.home, m, `cat ${rq}`, { signal: ctx.signal, timeoutMs: 600_000, binary: true });
      if (r.code !== 0) return `Échec : ${r.out.slice(0, 300)}`;
      mkdirSync(dirname(local), { recursive: true }); writeFileSync(local, r.data ?? Buffer.alloc(0));
      return `Copié depuis ${m.label} : ${s(i.remote)} → ${s(i.local)} (${Math.round((r.data?.length ?? 0) / 1024)} Ko).`;
    }
    if (!existsSync(local)) return `Fichier local introuvable : ${s(i.local)}`;
    const r = await runOnMachine(ctx.home, m, `cat > ${rq}`, { signal: ctx.signal, timeoutMs: 600_000, stdin: readFileSync(local) });
    return r.code === 0 ? `Copié vers ${m.label} : ${s(i.local)} → ${s(i.remote)}.` : `Échec : ${r.out.slice(0, 300)}`;
  },
};

export const NETWORK_TOOLS: Tool[] = [netInventory, netScan, systemUpdates, systemUpdateApply, machineList, machineExec, machineCopy];
