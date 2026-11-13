// Ymir · les actions des machines de CE PC (LXC et VM) : créer, démarrer, arrêter, aperçu, ressources, ranger,
// cloner, exporter / importer en .ody, quarantaine (isoler, analyser, libérer) ; la surveillance qui isole une
// machine touchée par une alerte critique (règle « rouge = isoler ») et prévient si une machine s'arrête seule.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Action, ModCtx } from '../types.ts';
import { famille, Local, MODELES, nomAuto, newMac, slug, type Genre, type Machine } from './local.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const n = (v: unknown, d: number, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.max(lo, Math.min(hi, Math.round(x))) : d; };
const list = (v: unknown) => s(v).split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
const machineParam = { key: 'machine', label: 'Machine (nom ou adresse)', kind: 'text' as const, required: true };
/** Les applis d'Odin branchées sur une nouvelle machine (chacune fait vraiment quelque chose). */
export const APPS: Array<{ id: string; nom: string; quoi: string; reco: boolean; lxc: boolean; vm: boolean }> = [
  { id: 'ullr', nom: 'Antivirus', quoi: 'analyse son disque chaque nuit', reco: true, lxc: true, vm: false },
  { id: 'vordr', nom: 'Vörðr', quoi: 'surveillance (prévient si elle ne répond plus)', reco: true, lxc: true, vm: true },
  { id: 'vidarr', nom: 'Víðarr', quoi: 'son nom sur le réseau (.maison)', reco: true, lxc: true, vm: true },
  { id: 'sindri', nom: 'Sindri', quoi: 'sauvegarde chaque nuit', reco: true, lxc: true, vm: false },
];
export interface Categorie { nom: string; couleur: string }
const categories = (ctx: ModCtx): Categorie[] => (ctx.settings.categories as Categorie[] | undefined) ?? [{ nom: 'Bureau', couleur: '#d97706' }, { nom: 'Maison', couleur: '#1f9d55' }, { nom: 'Médias', couleur: '#8b5cf6' }, { nom: 'Cloud maison', couleur: '#22b3e6' }, { nom: 'Réseau', couleur: '#f97316' }];
async function eitriDir(ctx: ModCtx): Promise<string> {
  try { const r = await ctx.call('eitri', 'etat', {}, 'ISO pour une machine virtuelle'); const d = (r.data as { dossier?: string } | undefined)?.dossier; if (d) return d; } catch { /* Eitri absent */ }
  return join(ctx.home, 'ISO');
}
async function brancher(ctx: ModCtx, L: Local, m: Machine): Promise<string[]> {
  const out: string[] = [], why = `nouvelle machine ${m.nom}`;
  for (const a of m.apps) {
    const app = APPS.find((x) => x.id === a); if (!app) continue;
    if (!(m.genre === 'lxc' ? app.lxc : app.vm)) { out.push(`${app.nom} : pas pour une VM (Odin ne lit pas encore son disque)`); continue; }
    const r = await (a === 'vidarr' ? ctx.call('vidarr', 'nom_local', { nom: `${m.nom}.maison`, valeur: m.ip }, why)
      : a === 'vordr' ? ctx.call('vordr', 'ajouter', { nom: m.nom, genre: 'ping', cible: m.ip, groupe: 'Machines' }, why)
        : a === 'ullr' ? ctx.call('ullr', 'plan', { nom: `Machine ${m.nom}`, dossier: join(L.lxcDir, m.nom, 'rootfs'), quand: 'jour', heure: '03:30' }, why)
          : ctx.call('sindri', 'creer', { nom: `Machine ${m.nom}`, dossiers: join(L.lxcDir, m.nom), depot: s(ctx.settings.depotMachines) || join(ctx.home, 'Sauvegardes', 'machines'), heure: '02:30' }, why)).catch((e) => ({ ok: false, text: (e as Error).message }));
    out.push(`${r.ok === false ? '⚠' : '✓'} ${app.nom} : ${r.ok === false ? r.text.split('\n')[0].slice(0, 140) : app.quoi}`);
  }
  return out;
}

export function machinesActions(): Action[] {
  return [
    { id: 'locales', label: 'Machines de ce PC', what: 'Les LXC et VM créés par Odin sur ce PC, avec leur état', read: true, words: ['machines de ce pc', 'mes lxc', 'mes conteneurs lxc', 'mes vm locales'], run: async (ctx) => {
      const L = new Local(ctx), l = L.list(), st = await Promise.all(l.map((m) => L.etat(m)));
      return { text: l.length ? l.map((m, i) => `- ${m.quarantaine ? '🔒 ' : ''}${m.nom} (${m.genre === 'lxc' ? 'LXC' : 'VM'}, ${m.systeme} ${m.version}) · ${st[i].state} · ${m.ip} · ${m.cpu} cœur(s), ${m.ram} Mo`).join('\n') : 'Aucune machine sur ce PC : « crée une machine ».', data: l.map((m, i) => ({ ...m, etat: st[i] })) };
    } },
    { id: 'tableau_machines', label: 'Tableau des machines', what: 'Tout pour l\'écran Machines : machines et état, ce PC, catégories, modèles, ISO, applis', read: true, run: async (ctx) => {
      const L = new Local(ctx), l = L.list(), st = await Promise.all(l.map((m) => L.etat(m).catch(() => ({ state: 'inconnue' as const }))));
      return { text: `${l.length} machine(s)`, data: {
        machines: l.map((m, i) => ({ ...m, etat: st[i] })), hote: await L.hote(), categories: categories(ctx), reseau: L.reseau(), modeles: MODELES, isos: L.isos(await eitriDir(ctx)), apps: APPS,
        manque: { lxc: await L.manque('lxc'), vm: await L.manque('vm') }, kvm: L.kvm(), autoIsoler: ctx.settings.autoIsoler !== false,
      } };
    } },
    { id: 'verifier_ip', label: 'Adresse libre ?', what: 'Vérifie qu\'une adresse n\'est prise par personne (machines d\'Odin, et rien ne répond dessus)', read: true, params: [{ key: 'ip', label: 'Adresse IP', kind: 'text', default: '' }], run: async (ctx, i) => {
      const L = new Local(ctx); const ip = s(i.ip).trim() || (await L.prochaineIp()) || '';
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error('adresse IP invalide');
      const ok = await L.ipDispo(ip);
      return { text: ok ? `L'adresse ${ip} est libre.` : `L'adresse ${ip} est déjà prise.`, ok, data: { ip, libre: ok } };
    } },
    { id: 'creer_machine', label: 'Créer une machine', what: 'Un LXC (léger, depuis une image officielle signée) ou une VM (depuis une ISO d\'Eitri) : nom automatique, ressources, adresse vérifiée, applis d\'Odin branchées', external: true,
      params: [{ key: 'genre', label: 'Genre', kind: 'select', options: ['lxc', 'vm'], default: 'lxc' }, { key: 'modele', label: 'Modèle LXC (ex. debian trixie)', kind: 'text', default: 'debian trixie' }, { key: 'iso', label: 'ISO d\'Eitri (VM)', kind: 'text', default: '' },
        { key: 'fin', label: 'Fin du nom (ex. Nextcloud famille)', kind: 'text', default: '' }, { key: 'nom', label: 'Nom complet (remplace le nom automatique)', kind: 'text', default: '' },
        { key: 'coeurs', label: 'Cœurs', kind: 'number', default: 2 }, { key: 'memoire', label: 'Mémoire (Go)', kind: 'number', default: 2 }, { key: 'disque', label: 'Disque (Go)', kind: 'number', default: 32 },
        { key: 'ip', label: 'Adresse IP (vide : la première libre)', kind: 'text', default: '' }, { key: 'categorie', label: 'Catégorie', kind: 'text', default: '' },
        { key: 'apps', label: 'Applis d\'Odin (ullr, vordr, vidarr, sindri)', kind: 'text', default: 'ullr, vordr, vidarr, sindri' }, { key: 'paquets', label: 'Logiciels en plus (paquets, ex. nextcloud, postgresql)', kind: 'text', default: '' }, { key: 'uefi', label: 'VM en UEFI', kind: 'boolean', default: true }],
      words: ['crée une machine', 'cree une machine', 'nouvelle machine', 'crée un lxc', 'crée une vm', 'nouveau conteneur lxc'], run: async (ctx, i) => {
        const L = new Local(ctx), genre = (s(i.genre) === 'vm' ? 'vm' : 'lxc') as Genre, now = ctx.now();
        let systeme = '', version = '', modele: Machine['modele'], iso: string | undefined;
        if (genre === 'lxc') {
          const q = s(i.modele || 'debian trixie').toLowerCase(), md = MODELES.find((x) => `${x.dist} ${x.release}` === q) ?? MODELES.find((x) => q.includes(x.dist) && (q.includes(x.release) || q.includes(x.version) && x.version)) ?? MODELES.find((x) => q.includes(x.dist) || q.includes(x.titre.toLowerCase()));
          if (!md) throw new Error(`modèle inconnu : « ${s(i.modele)} » (${MODELES.map((x) => `${x.dist} ${x.release}`).join(', ')})`);
          modele = { dist: md.dist, release: md.release }; systeme = md.titre; version = md.version;
        } else {
          const l = L.isos(await eitriDir(ctx)), q = s(i.iso).toLowerCase(), f = l.find((x) => x.nom.toLowerCase() === q) ?? l.find((x) => q.length >= 3 && x.nom.toLowerCase().includes(q));
          if (!f) throw new Error(q ? `ISO introuvable dans Eitri : « ${s(i.iso)} »` : 'choisis l\'ISO d\'installation');
          iso = f.chemin; const w = /win(?:dows)?[-_ ]?(1[01])/i.exec(f.nom); systeme = w ? `Windows ${w[1]}` : (f.nom.split(/[-_ ]/)[0] ?? 'Système').replace(/^./, (c) => c.toUpperCase()); version = /(\d+(?:\.\d+){0,2})/.exec(f.nom.replace(/win(?:dows)?[-_ ]?1[01]/i, ''))?.[1] ?? '';
        }
        const nom = s(i.nom).trim() ? slug(s(i.nom)) : nomAuto(systeme, version, now, s(i.fin));
        let ip = s(i.ip).trim();
        if (ip) { if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error('adresse IP invalide'); if (!(await L.ipDispo(ip))) throw new Error(`l'adresse ${ip} est déjà prise`); }
        else { ip = (await L.prochaineIp()) ?? ''; if (!ip) throw new Error('plus d\'adresse libre sur le réseau des machines'); }
        const cat = s(i.categorie).trim(), apps = list(i.apps).map((x) => x.toLowerCase()).filter((x) => APPS.some((a) => a.id === x)), paquets = list(i.paquets).map((x) => x.toLowerCase());
        const m: Machine = { id: randomBytes(6).toString('hex'), nom, genre, systeme, version, famille: famille(systeme), ...(cat ? { categorie: cat } : {}), cpu: n(i.coeurs, 2, 1, 64), ram: n(i.memoire, 2, 1, 512) * 1024, disque: n(i.disque, 32, 4, 8192), ip, mac: newMac(), cree: now.getTime(), modele, iso, uefi: genre === 'vm' && i.uefi !== false && i.uefi !== 'false', apps, paquets };
        const notes = await L.creer(m, { installer: iso });
        const b = await brancher(ctx, L, m);
        ctx.emit('machine_creee', { nom: m.nom, genre, ip });
        return { text: `✅ ${m.nom} créée (${genre === 'lxc' ? 'LXC' : 'VM'} ${systeme} ${version}, ${m.cpu} cœur(s), ${m.ram / 1024} Go, ${m.disque} Go) · ${ip}${genre === 'vm' ? ' · l\'installation de l\'ISO commence : regarde son écran dans Machines' : ''}${notes.length ? `\n${notes.join('\n')}` : ''}${b.length ? `\n${b.join('\n')}` : ''}`, data: m };
      } },
    { id: 'demarrer_machine', label: 'Démarrer', what: 'Démarre une machine de ce PC', params: [machineParam], words: ['démarre la machine', 'allume la machine'], run: async (ctx, i) => { const L = new Local(ctx), m = L.find(i.machine); await L.demarrer(m); return { text: `▶ ${m.nom} démarrée${m.quarantaine ? ' (toujours sans réseau : en quarantaine)' : ''}.` }; }, undo: (i) => ({ action: 'arreter_machine', input: { machine: i.machine }, label: 'Arrêter' }) },
    { id: 'arreter_machine', label: 'Arrêter', what: 'Arrêt propre d\'une machine de ce PC', params: [machineParam, { key: 'forcer', label: 'Forcer (comme débrancher)', kind: 'boolean', default: false }], grave: (i) => `${i.forcer === true || i.forcer === 'true' ? 'couper net' : 'éteindre'} la machine ${s(i.machine)}`, words: ['éteins la machine', 'arrête la machine'], run: async (ctx, i) => { const L = new Local(ctx), m = L.find(i.machine); await L.arreter(m, i.forcer === true || i.forcer === 'true'); return { text: `⏹ ${m.nom} : arrêt demandé.` }; }, undo: (i) => ({ action: 'demarrer_machine', input: { machine: i.machine }, label: 'Redémarrer' }) },
    { id: 'apercu_machine', label: 'Aperçu', what: 'L\'écran d\'une VM ou la console d\'un LXC, en direct', read: true, params: [machineParam], run: async (ctx, i) => { const L = new Local(ctx), m = L.find(i.machine), a = await L.apercu(m).catch((e) => ({ erreur: (e as Error).message })); return { text: 'erreur' in a ? `Aperçu indisponible : ${a.erreur}` : a.lignes ? a.lignes.join('\n') || '(console vide)' : a.png ? 'capture de l\'écran' : 'machine éteinte', data: a }; } },
    { id: 'ressources_machine', label: 'Ressources', what: 'Processeur et mémoire d\'une machine (tout de suite pour un LXC)', params: [machineParam, { key: 'coeurs', label: 'Cœurs', kind: 'number', required: true }, { key: 'memoire', label: 'Mémoire (Go)', kind: 'number', required: true }], run: async (ctx, i) => {
      const L = new Local(ctx), m = L.find(i.machine), h = await L.hote(), c = n(i.coeurs, m.cpu, 1, h.coeurs), r = n(i.memoire, m.ram / 1024, 1, Math.floor(h.ramTotal / 1024 ** 3));
      const how = await L.ressources(m, c, r * 1024); return { text: `${m.nom} : ${c} cœur(s), ${r} Go — ${how}.` };
    } },
    { id: 'ranger_machine', label: 'Ranger', what: 'Met une machine dans une de tes catégories (Bureau, Maison, Médias…)', params: [machineParam, { key: 'categorie', label: 'Catégorie (vide : aucune)', kind: 'text', default: '' }], run: (ctx, i) => {
      const L = new Local(ctx), m = L.find(i.machine), c = s(i.categorie).trim();
      if (c && !categories(ctx).some((x) => x.nom === c)) ctx.saveSettings({ categories: [...categories(ctx), { nom: c, couleur: '#64748b' }] });
      if (c) m.categorie = c; else delete m.categorie; L.update(m); return { text: `${m.nom} → ${c || 'sans catégorie'}.` };
    } },
    { id: 'categorie_machines', label: 'Nouvelle catégorie', what: 'Une catégorie pour ranger tes machines', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'couleur', label: 'Couleur (#rrggbb)', kind: 'text', default: '#0b7f7c' }], run: (ctx, i) => {
      const nom = s(i.nom).trim().slice(0, 40); if (!nom) throw new Error('donne un nom'); const c = /^#[0-9a-f]{6}$/i.test(s(i.couleur)) ? s(i.couleur) : '#0b7f7c';
      ctx.saveSettings({ categories: [...categories(ctx).filter((x) => x.nom !== nom), { nom, couleur: c }] }); return { text: `Catégorie « ${nom} » ajoutée.` };
    } },
    { id: 'cloner_machine', label: 'Cloner', what: 'La même machine, avec un autre nom et une autre adresse (machine éteinte)', params: [machineParam, { key: 'nom', label: 'Nom de la copie', kind: 'text', required: true }], run: async (ctx, i) => { const L = new Local(ctx), m = await L.cloner(L.find(i.machine), s(i.nom)); return { text: `📄 ${m.nom} : copie prête (${m.ip}), éteinte.`, data: m }; } },
    { id: 'supprimer_machine', label: 'Supprimer', what: 'Supprime une machine et son disque', params: [machineParam], grave: (i) => `supprimer la machine ${s(i.machine)} et tout son disque (exporte-la en .ody avant si tu veux la garder)`, run: async (ctx, i) => { const L = new Local(ctx), m = L.find(i.machine); await L.supprimer(m); return { text: `🗑 ${m.nom} supprimée.` }; } },
    { id: 'exporter_machine', label: 'Exporter en .ody', what: 'Toute la machine dans un seul fichier vérifié (empreinte), par exemple vers ton NAS', params: [machineParam, { key: 'dossier', label: 'Dossier de destination', kind: 'text', default: '' }], run: async (ctx, i) => {
      const L = new Local(ctx), m = L.find(i.machine), d = s(i.dossier).trim() || s(ctx.settings.dossierOdy) || join(ctx.home, 'Machines');
      const r = await L.exporter(m, d); return { text: `📦 ${r.fichier} (${(r.taille / 1024 ** 3).toFixed(2).replace('.', ',')} Go) · empreinte ${r.sha256.slice(0, 16)}…`, data: r };
    } },
    { id: 'importer_machine', label: 'Importer un .ody', what: 'Odin vérifie le fichier (contenu, empreinte, antivirus) puis crée la machine, éteinte', params: [{ key: 'fichier', label: 'Fichier .ody', kind: 'text', required: true }, { key: 'nom', label: 'Nom (vide : celui du fichier)', kind: 'text', default: '' }], run: async (ctx, i) => {
      const L = new Local(ctx), f = s(i.fichier).trim(); if (!f.endsWith('.ody') || !existsSync(f)) throw new Error('fichier .ody introuvable');
      const o = await L.ouvrirOdy(f);
      const v = await ctx.call('ullr', 'fichier', { chemin: o.payload }, `vérifier la machine importée ${o.man.nom}`).catch(() => undefined), lvl = (v?.data as { level?: string } | undefined)?.level;
      if (lvl && ['moyenne', 'haute', 'critique'].includes(lvl)) { const { rmSync } = await import('node:fs'); rmSync(o.tmp, { recursive: true, force: true }); throw new Error(`l'antivirus juge ce .ody ${lvl} : import refusé`); }
      const m = await L.importer(o, s(i.nom)); return { text: `📥 ${m.nom} importée (${m.genre === 'lxc' ? 'LXC' : 'VM'} ${m.systeme} ${m.version}) · ${m.ip} · empreinte vérifiée${v ? ', antivirus : rien trouvé' : ''}. Elle est éteinte : démarre-la quand tu veux.`, data: m };
    } },
    { id: 'reseau_machines', label: 'Réseau des machines', what: 'Le pont réseau où se branchent les machines et la plage d\'adresses', params: [{ key: 'pont', label: 'Pont (ex. br0 pour le réseau de la maison, lxcbr0 pour un réseau à part)', kind: 'text', default: 'lxcbr0' }, { key: 'reseau', label: 'Réseau (ex. 192.168.1.0/24)', kind: 'text', default: '10.0.3.0/24' }, { key: 'passerelle', label: 'Passerelle', kind: 'text', default: '10.0.3.1' }, { key: 'dns', label: 'DNS (Víðarr)', kind: 'text', default: '' }, { key: 'debut', label: 'Première adresse', kind: 'number', default: 60 }], run: (ctx, i) => {
      const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.0\/(\d{1,2})$/.exec(s(i.reseau).trim()); if (!m || m[2] !== '24') throw new Error('réseau attendu en /24, ex. 192.168.1.0/24');
      const pont = s(i.pont).trim(); if (!/^[\w.-]{1,15}$/.test(pont)) throw new Error('nom de pont invalide');
      const r = { pont, prefixe: m[1], masque: 24, passerelle: s(i.passerelle).trim() || `${m[1]}.1`, dns: s(i.dns).trim() || s(i.passerelle).trim() || `${m[1]}.1`, debut: n(i.debut, 60, 2, 250) };
      ctx.saveSettings({ reseauMachines: r }); return { text: `Réseau des machines : pont ${r.pont}, ${m[1]}.0/24, passerelle ${r.passerelle}, DNS ${r.dns}, à partir de .${r.debut}.` };
    } },
    // ---------------- Quarantaine ----------------
    { id: 'isoler_machine', label: 'Mettre en quarantaine', what: 'Débranche la machine de tout (ni Internet, ni DNS, ni réseau maison) ; seul Odin entre pour analyser', params: [machineParam, { key: 'raison', label: 'Pourquoi', kind: 'text', default: 'à ta demande' }], words: ['isole la machine', 'mets en quarantaine'], run: async (ctx, i) => {
      const L = new Local(ctx), m = L.find(i.machine); if (m.quarantaine) return { text: `${m.nom} est déjà en quarantaine.`, ok: false };
      await L.isoler(m, s(i.raison) || 'à ta demande'); ctx.emit('machine_isolee', { nom: m.nom, ip: m.ip });
      return { text: `🔒 ${m.nom} isolée : plus d'Internet, plus de réseau. Lance l'analyse, puis sors-la de quarantaine si elle est propre.` };
    }, undo: (i) => ({ action: 'liberer_machine', input: { machine: i.machine }, label: 'Sortir de quarantaine' }) },
    { id: 'analyser_machine', label: 'Analyse complète', what: 'L\'antivirus d\'Odin lit tout le disque de la machine (LXC) ; le verdict décide si elle peut sortir de quarantaine', params: [machineParam], run: async (ctx, i) => {
      const L = new Local(ctx), m = L.find(i.machine);
      if (m.genre === 'vm') throw new Error('pour une VM, Odin ne lit pas encore son disque : analyse-la de l\'intérieur, ou exporte-la et analyse le .ody');
      const r = await ctx.call('ullr', 'analyser', { dossier: join(L.lxcDir, m.nom, 'rootfs') }, `analyse complète de ${m.nom}`);
      const det = Number((r.data as { detections?: number } | undefined)?.detections ?? (r.ok === false ? 1 : 0)), propre = r.ok !== false && det === 0;
      if (m.quarantaine) { m.quarantaine.analyse = { at: Date.now(), propre, texte: r.text.split('\n')[0] }; m.quarantaine.journal.push({ at: Date.now(), quoi: propre ? 'Analyse complète : rien trouvé' : `Analyse complète : ${det} détection(s)`, detail: 'antivirus d\'Odin' }); L.update(m); }
      return { text: `${propre ? '✅' : '⚠'} ${m.nom} : ${r.text}`, ok: propre, data: { propre, detections: det } };
    } },
    { id: 'liberer_machine', label: 'Sortir de quarantaine', what: 'Rebranche la machine sur le réseau (seulement après une analyse propre)', params: [machineParam, { key: 'sans_analyse', label: 'Sans analyse propre (à tes risques)', kind: 'boolean', default: false }], grave: (i) => `rebrancher la machine ${s(i.machine)} sur le réseau${i.sans_analyse === true || i.sans_analyse === 'true' ? ' SANS analyse propre' : ''}`, run: async (ctx, i) => {
      const L = new Local(ctx), m = L.find(i.machine), q = m.quarantaine; if (!q) return { text: `${m.nom} n'est pas en quarantaine.`, ok: false };
      const force = i.sans_analyse === true || i.sans_analyse === 'true';
      if (!force && !(q.analyse?.propre && q.analyse.at > q.depuis)) throw new Error('lance d\'abord une analyse complète : la machine sort quand elle est propre');
      await L.liberer(m);
      for (const j of q.journal) if (j.annuler?.module === 'vidarr' && !j.fait) await ctx.call(j.annuler.module, j.annuler.action, j.annuler.input, `fin de quarantaine de ${m.nom}`).catch(() => undefined);
      ctx.emit('machine_liberee', { nom: m.nom, ip: m.ip });
      return { text: `🔓 ${m.nom} est de retour sur le réseau (${m.ip}).` };
    } },
    { id: 'quarantaine_machine', label: 'Quarantaine (détail)', what: 'D\'où vient le souci (alertes liées à la machine), ce qu\'Odin a fait, l\'analyse', read: true, params: [machineParam], run: (ctx, i) => {
      const L = new Local(ctx), m = L.find(i.machine), seen = new Set<string>();
      const al = [...ctx.alerts({ q: m.ip, limit: 40 }), ...ctx.alerts({ q: m.nom, limit: 40 })].filter((a) => !seen.has(a.id) && seen.add(a.id)).sort((a, b) => a.at.localeCompare(b.at)).slice(-12);
      return { text: m.quarantaine ? `${m.nom} en quarantaine depuis ${new Date(m.quarantaine.depuis).toLocaleString('fr-FR')} : ${m.quarantaine.raison}` : `${m.nom} n'est pas en quarantaine.`, data: { machine: m, chemin: al.map((a) => ({ at: a.at, titre: a.title, detail: a.detail ?? '', module: a.module, niveau: a.level })) } };
    } },
    { id: 'auto_isoler', label: 'Règle « rouge = isoler »', what: 'Odin isole tout seul une machine visée par une alerte critique (tu peux annuler)', params: [{ key: 'actif', label: 'Actif', kind: 'boolean', default: true }], run: (ctx, i) => { const on = i.actif !== false && i.actif !== 'false'; ctx.saveSettings({ autoIsoler: on }); return { text: on ? 'Règle active : une alerte critique sur une machine l\'isole tout de suite.' : 'Règle coupée : Odin te prévient seulement.' }; } },
  ];
}

/** Surveillance : « rouge = isoler », et une machine qui s'arrête sans qu'on l'ait demandé. */
export async function machinesWatch(ctx: ModCtx): Promise<void> {
  const L = new Local(ctx), l = L.list(); if (!l.length) return;
  const now = ctx.now().getTime();
  if (ctx.settings.autoIsoler !== false) {
    const crit = ctx.alerts({ level: 'critique', limit: 50 }).filter((a) => !a.ack && now - Date.parse(a.at) < 15 * 60_000 && a.module !== 'ymir');
    for (const m of l.filter((x) => !x.quarantaine)) {
      const re = new RegExp(`(^|[^\\d.])${m.ip.replace(/\./g, '\\.')}($|[^\\d])|\\b${m.nom}\\b`);
      const a = crit.find((x) => re.test(`${x.title} ${x.detail ?? ''} ${JSON.stringify(x.data ?? {})}`)); if (!a) continue;
      await L.isoler(m, a.title);
      const cut = await ctx.call('vidarr', 'couper_machine', { ip: m.ip, nom: m.nom }, `quarantaine de ${m.nom}`).catch(() => undefined);
      const mm = L.find(m.id); if (mm.quarantaine) {
        mm.quarantaine.journal.unshift({ at: Date.parse(a.at), quoi: `Alerte : ${a.title}`, detail: a.module });
        if (cut && cut.ok !== false) mm.quarantaine.journal.push({ at: Date.now(), quoi: 'Coupée d\'Internet dans le DNS d\'Odin', detail: 'Víðarr', annuler: { action: 'retablir_machine', input: { ip: m.ip }, label: 'Annuler', module: 'vidarr' } });
        L.update(mm);
      }
      ctx.alert({ level: 'haute', title: `🔒 ${m.nom} isolée par Odin`, detail: `Règle « rouge = isoler » : ${a.title}. Plus d'Internet ni de réseau ; lance l'analyse complète.`, key: `ymir-isolee-${m.id}`, steps: ['Regarde « D\'où vient le souci » dans Machines → Quarantaine.', 'Lance l\'analyse complète.', 'Si elle est propre, sors la machine de quarantaine.'], fix: { action: 'analyser_machine', label: 'Analyse complète', input: { machine: m.id } } });
    }
  }
  const was = (ctx.settings.machinesEnMarche as string[] | undefined) ?? [], on: string[] = [];
  for (const m of L.list()) { const e = await L.etat(m).catch(() => ({ state: 'inconnue' as const })); if (e.state === 'en marche') on.push(m.id); else if (e.state === 'éteinte' && was.includes(m.id) && !m.arretVoulu) ctx.alert({ level: 'haute', title: `La machine ${m.nom} s'est arrêtée toute seule`, detail: `${m.genre === 'lxc' ? 'LXC' : 'VM'} ${m.systeme} · ${m.ip}`, key: `ymir-arret-${m.id}`, fix: { action: 'demarrer_machine', label: 'Redémarrer', input: { machine: m.id } } }); }
  ctx.saveSettings({ machinesEnMarche: on });
}
