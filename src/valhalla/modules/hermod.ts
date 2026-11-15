// Satellites — le parc d'ordinateurs : inventaire (système, disque, mémoire, mises à jour), en ligne ou non,
// commandes à distance, réveil à distance (Wake-on-LAN), redémarrage, et prise en main d'un bureau
// (mode « Phaéton ») quand la machine a un serveur VNC ou RDP. Utilise les machines enregistrées d'Odin.

import { createSocket } from 'node:dgram';
import { probe } from '../../hlidskjalf/discover.ts';
import { findMachine, listMachines, runOnMachine, type Machine } from '../../machines/access.ts';
import { capsules, desinscrire, empreinteOdin, inscrire, lireEtat } from '../rodd/capsule.ts';
import { apresInstallation, gestesCapsule, surPoste } from '../rodd/capsule-windows.ts';
import { actionsAgentPhenix } from '../sindri/agent.ts';
import { compagnonActions, compagnonSections, compagnonSide } from '../compagnon/actions.ts';
import { MODES } from './rodd.ts';
import type { ActionResult, ModCtx, Module } from '../types.ts';

const s = (v: unknown) => String(v ?? '');
/** Paquet magique Wake-on-LAN : 6 × FF puis 16 × l'adresse MAC. */
export function magicPacket(mac: string): Buffer {
  const hex = mac.replace(/[^a-f0-9]/gi, ''); if (hex.length !== 12) throw new Error('adresse MAC invalide');
  const m = Buffer.from(hex, 'hex'); return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => m)]);
}
export function wake(mac: string, broadcast = '255.255.255.255'): Promise<void> {
  return new Promise((res, rej) => { const u = createSocket('udp4'); u.once('error', rej); u.bind(() => { u.setBroadcast(true); u.send(magicPacket(mac), 9, broadcast, (e) => { u.close(); if (e) rej(e); else res(); }); }); });
}
const INVENTORY = `echo "os=$( (. /etc/os-release 2>/dev/null && echo $PRETTY_NAME) || uname -s)"; echo "kernel=$(uname -r)"; echo "uptime=$(cut -d. -f1 /proc/uptime 2>/dev/null)"; echo "mem=$(awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{printf "%d/%d", (t-a)/1024, t/1024}' /proc/meminfo 2>/dev/null)"; echo "disk=$(df -P / | awk 'NR==2{print $5}')"; echo "updates=$( (apt list --upgradable 2>/dev/null | grep -c upgradable) || echo ?)"; echo "mac=$(cat /sys/class/net/$(ip route show default 2>/dev/null | awk '{print $5; exit}')/address 2>/dev/null)"`;
export function parseInventory(out: string): Record<string, string> { return Object.fromEntries(out.split('\n').map((l) => { const i = l.indexOf('='); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : ['', '']; }).filter(([k]) => k)); }
type Inv = Record<string, string> & { at: string; online: string };
const inv = (ctx: ModCtx): Record<string, Inv> => (ctx.settings.inventory as Record<string, Inv> | undefined) ?? {};
/** L'état rendu par une capsule, en une ligne. */
function etatCapsule(e: Record<string, unknown> | undefined): string {
  if (!e) return 'réponse illisible';
  if (e.ok === false) return String(e.erreur ?? 'erreur');
  return `version ${s(e.version)} · micro : ${e.enregistreur ? s(e.enregistreur) : 'aucun programme (installe arecord, parecord, ffmpeg ou sox)'} · écrit avec : ${s(e.frappe)}${e.mode ? ` · mise en forme : ${s(e.mode)}` : ''}${e.demarrage ? ` · démarrage : ${s(e.demarrage)}` : ''}${e.veille === true ? ' · Ctrl+Espace actif' : ''}`;
}
/**
 * Écho sur un poste du parc : Satellites installe la capsule de dictée par SSH (Linux, macOS) ou par SSH / WinRM
 * (Windows : profil de la personne, veille sur Ctrl+Espace à l'ouverture de session), avec un jeton à elle
 * (Odin n'en garde que l'empreinte) et l'empreinte du certificat d'Odin (elle ne parle qu'à lui).
 */
async function installerCapsule(ctx: ModCtx, i: Record<string, unknown>): Promise<ActionResult> {
  const m = machine(ctx, s(i.machine)), mode = (MODES as readonly string[]).includes(s(i.mode)) ? s(i.mode) : 'corrigé';
  const odin = (s(i.adresse_odin) || s(ctx.settings.odinUrl)).trim().replace(/\/$/, '');
  if (!/^https?:\/\/[^\s'"]+$/.test(odin)) throw new Error('donne l\'adresse d\'Odin vue depuis ce poste (ex. https://192.168.1.10:8888)');
  const jeton = inscrire(ctx.home, m.label, mode, ctx.now());
  const r = await surPoste(ctx, m, gestesCapsule.installer({ odin, jeton, poste: m.label, mode, empreinte: /^https:/.test(odin) ? empreinteOdin(ctx.home) : '' }), i).catch((e: Error) => ({ code: 1, out: JSON.stringify({ ok: false, erreur: e.message }), systeme: 'posix' as const }));
  const e = lireEtat(r.out);
  if (r.code !== 0 || !e || e.ok === false) { desinscrire(ctx.home, m.label); throw new Error(`capsule non installée sur ${m.label} : ${etatCapsule(e)}`); }
  ctx.saveSettings({ odinUrl: odin });
  ctx.emit('capsule_installee', { poste: m.label });
  return { text: `🎙 Capsule d'Écho installée sur ${m.label} (${etatCapsule(e)}).\n${apresInstallation(r.systeme, e)}`, data: e };
}
function machine(ctx: ModCtx, name: string): Machine { const m = findMachine(ctx.home, name); if (!m) throw new Error(`machine inconnue : ${name} (ajoute-la dans Réglages → Machines)`); return m; }

export const hermod: Module = {
  id: 'hermod', name: 'Satellites', family: 'Accès',
  what: 'Ton parc d\'ordinateurs : qui est allumé, l\'état de chacun, commandes à distance, réveil et prise en main.',
  does: ['inventaire : système, mémoire, disque, mises à jour en attente', 'en ligne ou non (vérifié toutes les 5 minutes)', 'commande à distance (avec ton accord)', 'réveil à distance (Wake-on-LAN)', 'redémarrage à distance (avec ton accord)', 'mode Phaéton : prise en main du bureau quand la machine a un accès VNC ou bureau à distance', 'distribue et pilote la capsule de dictée d\'Écho sur les postes (installation, état, réglage, retrait) : Linux et Mac par SSH, Windows par SSH ou WinRM (profil de la personne, Ctrl+Espace dès l\'ouverture de session, retrait propre)', 'installe l\'agent de sauvegarde de Phénix sur les postes (Linux, Mac, Windows : sauvegarde toutes les heures, VSS sous Windows), le lance, le retire','alerte si une machine disparaît ou si son disque se remplit', 'compagnon d\'Odin sur chaque poste (Windows, Linux, Mac) : icône et bulles d\'Odin, antivirus d\'Asclépios (à la demande et planifié), mises à jour du système dans sa version, failles des logiciels installés, conseils à la personne'],
  from: ['MeshCentral', 'RustDesk'], upstream: ['Ylianst/MeshCentral', 'rustdesk/rustdesk'],
  modes: ['Phaéton · prise en main'],
  words: ['parc', 'ordinateurs', 'ordinateur', 'pc', 'machine distante', 'a distance', 'à distance', 'reveiller', 'réveiller', 'wake on lan', 'prise en main', 'bureau a distance', 'bureau à distance', 'redemarrer le pc'],
  actions: [
    { id: 'parc', label: 'État du parc', what: 'Machines, en ligne, disque, mises à jour', read: true, words: ['parc', 'etat', 'état', 'allume'], run: (ctx) => { const i = inv(ctx); return { text: listMachines(ctx.home).map((m) => { const x = i[m.id]; return `- ${m.label} (${m.host}) · ${x?.online ?? '?'}${x?.os ? ` · ${x.os} · disque ${x.disk} · ${x.updates} mise(s) à jour` : ''}`; }).join('\n') || 'Aucune machine enregistrée (Réglages → Machines).' }; } },
    { id: 'inventaire', label: 'Rafraîchir l\'inventaire', what: 'Interroge chaque machine', read: true, words: ['inventaire du parc', 'rafraichis l\'inventaire', 'rafraîchis l\'inventaire'], run: async (ctx) => { const out: string[] = []; const i = inv(ctx); for (const m of listMachines(ctx.home)) { const r = await runOnMachine(ctx.home, m, INVENTORY, { timeoutMs: 20_000 }).catch(() => ({ code: 1, out: '' })); i[m.id] = { ...(i[m.id] ?? {}), ...(r.code === 0 ? parseInventory(r.out) : {}), online: r.code === 0 ? 'en ligne' : 'injoignable', at: ctx.now().toISOString() } as Inv; out.push(`${m.label} : ${i[m.id].online}`); } ctx.saveSettings({ inventory: i }); return { text: out.join('\n') || 'Aucune machine.' }; } },
    { id: 'commande', label: 'Commande à distance', what: 'Exécute une commande sur une machine', params: [{ key: 'machine', label: 'Machine', kind: 'text', required: true }, { key: 'commande', label: 'Commande', kind: 'text', required: true }], grave: (i) => `exécuter « ${s(i.commande)} » sur ${s(i.machine)}`, run: async (ctx, i) => { const m = machine(ctx, s(i.machine)); const r = await runOnMachine(ctx.home, m, s(i.commande), { timeoutMs: 120_000 }); return { text: `${r.out.trim().slice(-8000) || '(aucune sortie)'}\n[${m.label} · code ${r.code}]` }; } },
    { id: 'reveiller', label: 'Réveiller', what: 'Allume une machine à distance (Wake-on-LAN)', params: [{ key: 'machine', label: 'Machine ou adresse MAC', kind: 'text', required: true }], words: ['reveille', 'réveille', 'allume le pc'], run: async (ctx, i) => { const q = s(i.machine); const mac = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(q) ? q : inv(ctx)[machine(ctx, q).id]?.mac; if (!mac) throw new Error('adresse MAC inconnue : rafraîchis l\'inventaire quand la machine est allumée'); await wake(mac); return { text: `⏰ Signal de réveil envoyé à ${q} (${mac}).` }; } },
    { id: 'redemarrer', label: 'Redémarrer', what: 'Redémarre une machine', params: [{ key: 'machine', label: 'Machine', kind: 'text', required: true }], grave: (i) => `redémarrer ${s(i.machine)}`, run: async (ctx, i) => { const m = machine(ctx, s(i.machine)); await runOnMachine(ctx.home, m, 'sudo shutdown -r +1 "Redémarrage demandé par Odin"', { timeoutMs: 30_000 }); return { text: `↻ ${m.label} redémarre dans une minute.` }; } },
    { id: 'capsules', label: 'Capsules de dictée', what: 'Les postes du parc où la dictée d\'Écho est installée', read: true, words: ['capsules de dictee', 'capsules de dictée'], run: (ctx) => { const l = capsules(ctx.home); return { text: l.map((c) => `- ${c.poste} · ${c.mode} · installée le ${c.at.slice(0, 10)} (v${c.version})`).join('\n') || 'Aucune capsule de dictée sur le parc : « installe la capsule de dictée sur <poste> ».', data: l }; } },
    { id: 'capsule_installer', label: 'Installer la dictée (Écho)', what: 'Installe la capsule de dictée d\'Écho sur un poste Linux, Mac ou Windows du parc (SSH ou WinRM, dans son dossier personnel ; Windows : Ctrl+Espace dès l\'ouverture de session)', params: [{ key: 'machine', label: 'Machine', kind: 'text', required: true }, { key: 'acces', label: 'Accès (Windows)', kind: 'select', options: ['ssh', 'winrm'], default: 'ssh', help: 'SSH : le serveur OpenSSH de Windows ; WinRM : PowerShell à distance (port 5985).' }, { key: 'adresse_odin', label: 'Adresse d\'Odin vue depuis ce poste', kind: 'text', default: '', help: 'Ex. https://192.168.1.10:8888 (retenue pour les postes suivants).' }, { key: 'mode', label: 'Mise en forme', kind: 'select', options: [...MODES], default: 'corrigé' }], words: ['installe la capsule de dictee', 'installe la capsule de dictée', 'installe la dictee sur', 'installe la dictée sur'], grave: (i) => `installer la capsule de dictée d\'Écho sur ${s(i.machine)}`, run: installerCapsule },
    { id: 'capsule_etat', label: 'État de la capsule', what: 'Demande son état à la capsule de dictée d\'un poste', read: true, params: [{ key: 'machine', label: 'Machine', kind: 'text', required: true }], words: ['etat de la capsule', 'état de la capsule'], run: async (ctx, i) => { const m = machine(ctx, s(i.machine)); const r = await surPoste(ctx, m, gestesCapsule.etat(), {}, 30_000); return { text: `${m.label} : ${etatCapsule(lireEtat(r.out))}`, data: lireEtat(r.out) }; } },
    { id: 'capsule_regler', label: 'Régler la capsule', what: 'Change la mise en forme par défaut de la capsule d\'un poste', quick: false, params: [{ key: 'machine', label: 'Machine', kind: 'text', required: true }, { key: 'mode', label: 'Mise en forme', kind: 'select', options: [...MODES], default: 'corrigé' }], run: async (ctx, i) => { const m = machine(ctx, s(i.machine)), mode = (MODES as readonly string[]).includes(s(i.mode)) ? s(i.mode) : 'corrigé'; const r = await surPoste(ctx, m, gestesCapsule.regler(mode), {}, 30_000); const e = lireEtat(r.out); if (r.code !== 0 || !e?.ok) throw new Error(`réglage refusé par ${m.label}`); return { text: `${m.label} : mise en forme « ${mode} ».` }; } },
    { id: 'capsule_retirer', label: 'Retirer la capsule', what: 'Retire la capsule de dictée d\'un poste (son jeton ne vaut plus rien)', params: [{ key: 'machine', label: 'Machine', kind: 'text', required: true }], words: ['retire la capsule', 'desinstalle la capsule', 'désinstalle la capsule'], grave: (i) => `retirer la capsule de dictée de ${s(i.machine)}`, run: async (ctx, i) => { const m = machine(ctx, s(i.machine)); desinscrire(ctx.home, m.label); const r = await surPoste(ctx, m, gestesCapsule.retirer(), {}, 30_000).catch(() => ({ code: 1, out: '' })); const e = lireEtat(r.out); return { text: r.code === 0 && e?.ok !== false ? `Capsule retirée de ${m.label}${'systeme' in r && r.systeme === 'windows' ? ' (veille arrêtée, démarrage automatique et dossier effacés)' : ''}.` : `Jeton de ${m.label} révoqué ; le poste n'a pas tout effacé (${Array.isArray(e?.reste) ? (e.reste as string[]).join(', ') : 'pas de réponse'}) : son dossier .odin-capsule reste à effacer.` }; } },
    { id: 'bureau', label: 'Prise en main (Phaéton)', what: 'Vérifie l\'accès au bureau à distance (VNC 5900 / RDP 3389) et donne l\'adresse', read: true, params: [{ key: 'machine', label: 'Machine', kind: 'text', required: true }], run: async (ctx, i) => { const m = machine(ctx, s(i.machine)); const vnc = (await probe(m.host, 5900, 1500)) === 'open', rdp = (await probe(m.host, 3389, 1500)) === 'open'; return { text: vnc ? `🖥 ${m.label} accepte le partage d'écran : vnc://${m.host}:5900` : rdp ? `🖥 ${m.label} accepte le bureau à distance Windows : ${m.host}:3389` : `${m.label} n'a ni VNC ni bureau à distance ouvert. Je peux l'activer : demande « active le partage d'écran sur ${m.label} ».` }; } },
    ...actionsAgentPhenix,
    ...compagnonActions,
  ],
  view(ctx) {
    const ms = listMachines(ctx.home), i = inv(ctx), on = ms.filter((m) => i[m.id]?.online === 'en ligne').length;
    return {
      subtitle: `${ms.length} machine(s) enregistrée(s)`,
      tabs: ['Satellites · parc', 'Phaéton · prise en main'],
      kpis: [{ label: 'En ligne', value: `${on} / ${ms.length}`, tone: on === ms.length ? 'bon' : 'attention' }, { label: 'Mises à jour en attente', value: String(ms.reduce((a, m) => a + (Number(i[m.id]?.updates) || 0), 0)) }],
      sections: [{ kind: 'table', title: 'Machines', columns: ['Machine', 'Adresse', 'Système', 'Disque', 'Mémoire (Mo)', 'Mises à jour', 'État'], empty: 'Aucune machine : Réglages → Machines pour en ajouter.', rows: ms.map((m) => { const x = i[m.id]; return { cells: [m.label, m.host, x?.os ?? '—', x?.disk ?? '—', x?.mem ?? '—', x?.updates ?? '—', x?.online ?? 'inconnu'], tone: x?.online === 'en ligne' ? 'bon' : x ? 'mauvais' : undefined, actions: [{ action: 'bureau', label: 'Prendre la main', input: { machine: m.label } }, { action: 'reveiller', label: 'Réveiller', input: { machine: m.label } }, { action: 'redemarrer', label: 'Redémarrer', input: { machine: m.label } }] }; }) }, ...compagnonSections(ctx)],
      side: [{ kind: 'form', title: 'Commande à distance', action: 'commande', submit: 'Exécuter', params: hermod.actions.find((a) => a.id === 'commande')?.params ?? [] }, ...compagnonSide()],
    };
  },
  watch: { every: 300, async run(ctx) {
    const i = inv(ctx);
    for (const m of listMachines(ctx.home)) {
      const up = (await probe(m.host, m.port || 22, 2500)) === 'open', was = i[m.id]?.online;
      i[m.id] = { ...(i[m.id] ?? {}), online: up ? 'en ligne' : 'injoignable', at: ctx.now().toISOString() } as Inv;
      if (was === 'en ligne' && !up) { ctx.alert({ level: 'moyenne', title: `${m.label} ne répond plus`, key: `down:${m.id}` }); ctx.emit('machine_hors_ligne', { machine: m.label }); }
      if (Number(String(i[m.id].disk ?? '').replace('%', '')) >= 90) ctx.alert({ level: 'haute', title: `Disque de ${m.label} presque plein (${i[m.id].disk})`, key: `disk:${m.id}` });
    }
    ctx.saveSettings({ inventory: i });
  } },
};
