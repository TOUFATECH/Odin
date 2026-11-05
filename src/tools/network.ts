// Outils réseau et maintenance : inventaire, balayage, mises à jour de la machine.
import { spawn } from 'node:child_process';
import { checkUpdates, deviceLabel, formatReport, linksFor, UPDATE_MANAGERS } from '../hlidskjalf/inventory.ts';
import { serviceName } from '../hlidskjalf/identify.ts';
import { deepIdentify, formatDeep, smbList } from '../hlidskjalf/deep.ts';
import { isPrivateV4 } from '../hlidskjalf/discover.ts';
import { normMac, routerAction, routerMachine, validMac } from '../hlidskjalf/router.ts';
import { networkInterfaces } from 'node:os';
const localIps = () => Object.values(networkInterfaces()).flat().filter(Boolean).map((x) => x!.address);
import { auditNetwork } from '../guard/watch.ts';
import { CATEGORIES, vendorOf } from '../hlidskjalf/vendors.ts';
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
      return `${deviceLabel(d)} — ${d.kind} — ${d.status}\nIP ${d.ip} · MAC ${d.mac || '?'} · réseau ${d.network}\nPorts ouverts : ${d.ports.map((p) => `${p} (${serviceName(p)})`).join(', ') || 'aucun connu (balayage complet : net_scan full)'}${d.hostname ? `\nNom réseau : ${d.hostname}` : ''}\nServices : ${d.services.join(', ') || 'aucun'}\nModèle / serveur : ${[d.model, d.server].filter(Boolean).join(' · ') || '?'}\nVu la première fois : ${new Date(d.first_seen).toLocaleString('fr-FR')}, dernière fois : ${new Date(d.last_seen).toLocaleString('fr-FR')}\n\nCe qu'Odin peut faire :\n${links}\n\nHistorique :\n${ev}`;
    }
    const list = inv.list({ status: i.include_removed ? 'all' : undefined });
    const last = inv.lastScan();
    if (!list.length) return `Aucun appareil connu${last ? '' : ' : aucun balayage n\'a encore eu lieu (outil net_scan)'}.`;
    const head = last ? `Dernier balayage : ${new Date(last.at).toLocaleString('fr-FR')} (${last.full ? 'complet' : 'rapide'}).\n` : '';
    // Classé par catégorie, puis par adresse IP : nom, IP, fabricant, ports nommés, liens.
    const line = (d: typeof list[number]) => `${d.status === 'online' ? '●' : d.status === 'offline' ? '○' : '×'} ${deviceLabel(d)} · ${d.ip}${vendorOf(d.mac) ? ` · ${vendorOf(d.mac)}` : ''}${d.status !== 'online' ? ` · ${d.status === 'offline' ? 'déconnecté' : 'retiré'}` : ''}${d.ports.length ? `\n   ports : ${d.ports.map((p) => `${p} ${serviceName(p)}`).join(', ')}` : ''}${d.web.length ? `\n   liens : ${d.web.map((w) => `${w.url}${w.title ? ` (${w.title})` : ''}`).join(' · ')}` : ''}`;
    const ipNum = (ip: string) => ip.split('.').reduce((a, n) => a * 256 + Number(n), 0);
    const groups = CATEGORIES.map((c) => ({ ...c, items: list.filter((d) => d.kind === c.kind).sort((a, b) => ipNum(a.ip) - ipNum(b.ip)) }));
    const other = list.filter((d) => !CATEGORIES.some((c) => c.kind === d.kind));
    if (other.length) groups.push({ kind: 'autres', icon: '•', items: other });
    return head + groups.filter((g) => g.items.length).map((g) => `\n${g.icon} ${g.kind.toUpperCase()} (${g.items.length})\n${g.items.map(line).join('\n')}`).join('\n');
  },
};

export const netIdentify: Tool = {
  name: 'net_identify',
  description: 'Identifie UN appareil du réseau à fond : nom d\'hôte, système et version (Windows avec n° de build, Linux et distribution, macOS, iOS), modèle (iPhone 15 Pro…), ports ouverts, partages réseau (SMB, NFS, AFP) et dossiers partagés. À utiliser dès qu\'on te demande ce qu\'est un appareil, son nom, son système ou ce qu\'il partage. Prend 5 à 20 s.',
  risk: 'network',
  schema: obj({ ip: str('adresse IP privée de l\'appareil') }, ['ip']),
  async run(i, ctx) {
    const ip = s(i.ip).trim();
    if (!isPrivateV4(ip)) return 'Adresse privée attendue (192.168…, 10…, 172.16–31…).';
    const d = ctx.inventory?.get(ip);
    const m = ctx.home ? listMachines(ctx.home).find((x) => x.host === ip) : undefined;
    const r = await deepIdentify(ip, { user: m?.user, password: m?.password });
    let host = '';
    if (m && ctx.home) { try { host = (await runOnMachine(ctx.home, m, 'hostname; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || sw_vers -productVersion 2>/dev/null || ver', { timeoutMs: 15_000 })).out.trim(); } catch { /* inaccessible */ } }
    if (d && ctx.inventory) ctx.inventory.enrich(d.id, { hostname: r.hostnames[0], model: r.model, os: host.split('\n')[1] || r.os });
    return formatDeep(r, d?.kind) + (host ? `\nSur la machine elle-même (SSH) : ${host.replace(/\n/g, ' · ')}` : '') + (r.shares?.some((x) => x.type === 'dossier') ? '\nPour voir les fichiers d\'un dossier partagé : net_share_files.' : '');
  },
};

export const netRename: Tool = {
  name: 'net_rename',
  description: 'Donne un nom clair à un appareil du réseau (après l\'avoir identifié avec net_identify), ex. « NAS salon », « iPhone de Djin », « CT 7800 Odin ».',
  risk: 'write',
  schema: obj({ ip: str('adresse IP de l\'appareil'), name: str('nouveau nom (court et clair)') }, ['ip', 'name']),
  summarize: (i) => `renommer l'appareil ${s(i.ip)} en « ${s(i.name)} »`,
  async run(i, ctx) {
    const d = ctx.inventory?.get(s(i.ip)); if (!d) return `Appareil inconnu : ${s(i.ip)}`;
    ctx.inventory!.setLabel(d.id, s(i.name).slice(0, 60));
    return `Appareil ${d.ip} renommé « ${s(i.name).slice(0, 60)} ».`;
  },
};

export const netShareFiles: Tool = {
  name: 'net_share_files',
  description: 'Liste les fichiers d\'un dossier partagé (SMB : Windows, Mac, NAS, Samba) sur le réseau local, en lecture seule. Utilise le compte de la machine si elle est dans Réglages → Droits et machines, sinon l\'accès invité.',
  risk: 'network',
  schema: obj({ ip: str('adresse IP'), share: str('nom du partage (voir net_identify)'), path: str('sous-dossier (facultatif)') }, ['ip', 'share']),
  async run(i, ctx) {
    const ip = s(i.ip).trim();
    if (!isPrivateV4(ip)) return 'Adresse privée attendue.';
    const m = ctx.home ? listMachines(ctx.home).find((x) => x.host === ip) : undefined;
    return smbList(ip, s(i.share), s(i.path), m?.user, m?.password);
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

const gatewayOf = (inv: NonNullable<Parameters<Tool['run']>[1]['inventory']>) => inv.list({ status: 'online' }).find((d) => d.kind === 'routeur') ?? inv.list({ status: 'all' }).find((d) => d.kind === 'routeur');
const NO_ROUTER = (gw?: string) => `Je n'ai pas d'accès à la box${gw ? ` (${gw})` : ''}. Pour que je puisse bloquer un appareil : ajoute la box dans Réglages → Droits et machines (son IP, un compte SSH administrateur). Je reconnais OpenWrt, MikroTik et les routeurs Linux. Les box d'opérateur (Livebox, SFR, Bbox, Freebox) n'ont pas d'accès SSH : je peux alors le faire par leur page d'administration avec le navigateur, si tu me donnes le mot de passe de la box.`;

export const netBlock: Tool = {
  name: 'net_block',
  description: 'Bloque un appareil du réseau sur la box/routeur, par son adresse MAC (il ne passe plus par le routeur : plus d\'Internet). Réversible avec net_unblock. À n\'utiliser que si le propriétaire le demande, ou en mode Breaker pour un appareil manifestement hostile. Jamais la box elle-même ni la machine d\'Odin.',
  risk: 'external',
  schema: obj({ device: str('IP, adresse MAC ou nom de l\'appareil'), reason: str('pourquoi (noté dans l\'historique)') }, ['device']),
  summarize: (i) => `bloquer l'appareil ${s(i.device)} sur la box${i.reason ? ` (${s(i.reason)})` : ''}`,
  async run(i, ctx) {
    const inv = ctx.inventory; if (!inv || !ctx.home) return 'Inventaire du réseau indisponible.';
    const q = s(i.device).trim(), d = inv.find(q);
    const mac = d?.mac || (validMac(q) ? normMac(q) : '');
    if (!mac) return d ? `Je ne connais pas l'adresse MAC de ${deviceLabel(d)} (${d.ip}) : relance un balayage du réseau depuis la même box.` : `Appareil introuvable : ${q}`;
    const gw = gatewayOf(inv);
    if (d && (d.kind === 'routeur' || d.id === gw?.id)) return 'Je ne bloque pas la box elle-même.';
    if (d && localIps().includes(d.ip)) return 'Je ne bloque pas la machine sur laquelle je tourne.';
    const m = routerMachine(ctx.home, gw?.ip); if (!m) return NO_ROUTER(gw?.ip);
    const r = await routerAction(ctx.home, m, 'block', mac);
    if (!r.ok) return `Échec du blocage sur la box (${r.kind}) : ${r.out || 'pas de réponse'}`;
    if (d) inv.setBlocked(d.id, true, s(i.reason) || 'demandé par le propriétaire');
    return `Appareil ${d ? `${deviceLabel(d)} (${d.ip}, ${mac})` : mac} bloqué sur la box (${r.kind}). Pour le réautoriser : net_unblock.`;
  },
};

export const netUnblock: Tool = {
  name: 'net_unblock',
  description: 'Réautorise sur la box un appareil bloqué par net_block.',
  risk: 'external',
  schema: obj({ device: str('IP, adresse MAC ou nom de l\'appareil') }, ['device']),
  summarize: (i) => `débloquer l'appareil ${s(i.device)} sur la box`,
  async run(i, ctx) {
    const inv = ctx.inventory; if (!inv || !ctx.home) return 'Inventaire du réseau indisponible.';
    const q = s(i.device).trim(), d = inv.find(q), mac = d?.mac || (validMac(q) ? normMac(q) : '');
    if (!mac) return `Appareil introuvable ou sans adresse MAC : ${q}`;
    const gw = gatewayOf(inv), m = routerMachine(ctx.home, gw?.ip); if (!m) return NO_ROUTER(gw?.ip);
    const r = await routerAction(ctx.home, m, 'unblock', mac);
    if (!r.ok) return `Échec du déblocage (${r.kind}) : ${r.out || 'pas de réponse'}`;
    if (d) inv.setBlocked(d.id, false, 'réautorisé');
    return `Appareil ${d ? deviceLabel(d) : mac} réautorisé sur la box.`;
  },
};

export const netBlocked: Tool = {
  name: 'net_blocked',
  description: 'Liste les appareils bloqués par Odin sur la box (inventaire + règles réellement présentes sur le routeur).',
  risk: 'network', lookup: () => true,
  schema: obj({}, []),
  async run(_i, ctx) {
    const inv = ctx.inventory; if (!inv || !ctx.home) return 'Inventaire du réseau indisponible.';
    const known = inv.list({ status: 'all' }).filter((d) => d.blocked);
    const lines = known.map((d) => `- ${deviceLabel(d)} (${d.ip}, ${d.mac}) bloqué le ${new Date(d.blocked!).toLocaleString('fr-FR')}`);
    const gw = gatewayOf(inv), m = routerMachine(ctx.home, gw?.ip);
    if (m) { const r = await routerAction(ctx.home, m, 'list').catch((e) => ({ ok: false, kind: '?', out: (e as Error).message })); lines.push(`Règles sur la box (${r.kind}) : ${r.out || 'aucune'}`); }
    else lines.push('Pas d\'accès à la box enregistré : liste tirée de l\'inventaire seulement.');
    return known.length || m ? lines.join('\n') : 'Aucun appareil bloqué.';
  },
};

export const NETWORK_TOOLS: Tool[] = [netBlock, netUnblock, netBlocked, netInventory, netIdentify, netRename, netShareFiles, netScan, systemUpdates, systemUpdateApply, machineList, machineExec, machineCopy];

export const netSecurity: Tool = {
  name: 'net_security',
  description: 'Audit de sécurité du réseau local d\'après l\'inventaire : ports à risque, administrations non chiffrées, appareils inconnus récents, avec un conseil pour chaque point. N\'attaque rien.',
  risk: 'read',
  schema: obj({}),
  async run(_i, ctx) {
    if (!ctx.inventory) return 'Inventaire indisponible.';
    const f = auditNetwork(ctx.inventory.list({ status: 'all' }));
    if (!f.length) return 'Aucun problème repéré sur les appareils connus (lance un balayage complet pour voir les ports).';
    const icon = { grave: '🔴', attention: '🟠', info: '🔵' } as const;
    return f.map((x) => `${icon[x.level]} ${x.title}${x.device ? ` — ${x.device} (${x.ip})` : ''}\n   → ${x.advice}`).join('\n');
  },
};
