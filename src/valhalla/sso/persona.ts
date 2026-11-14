// Ce que la connexion unique ajoute à la page de Persona : les droits par appli (cases à cocher par groupe et par
// personne, et par commande), les applis clientes (Pégase, Vénus préinscrites ; en ajouter une ; un logiciel du proxy qui
// sait faire OpenID, comme Penpot), les appareils connectés (couper), les sites du proxy encore sans connexion unique,
// le lien avec le compte du propriétaire. Et la carte « Sauvegarde sur Odin » des pages d'applis (Vénus).

import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import type { Action, ModCtx, Param, Section } from '../types.ts';
import { valhallaOf } from '../odin.ts';
import { sha256hex } from './jwt.ts';
import {
  POSTE_INACTIF, RENOUV_INACTIF, aDroit, changerDroit, cleDroit, client, clients, delierProprietaire, droits, groupesDe, lierProprietaire, nomAppli, personnes, preinscrites,
  relierProprietaire, revoquerPoste, revoquerSession, sauverClient, sessionsApplis, sessionsPostes, vivante, type Client,
} from './etat.ts';
import { demanderRestauration, jeux } from './sauvegardes.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
const quand = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const taille = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : n >= 1024 ? `${Math.round(n / 1024)} Ko` : `${n} octets`);

/** Toutes les applis à qui l'on peut donner un droit : les applis d'Odin et les applis clientes (Vénus = son appli d'Odin). */
export function applisConnues(ctx: ModCtx): Array<{ id: string; nom: string }> {
  const out = new Map<string, string>();
  for (const c of clients(ctx)) out.set(c.id, c.nom);
  for (const m of valhallaOf()?.modules() ?? []) { const k = cleDroit(m.id); if (!out.has(k)) out.set(k, m.name); }
  return [...out].map(([id, nom]) => ({ id, nom })).sort((a, b) => (a.id === 'odin' ? -1 : b.id === 'odin' ? 1 : a.nom.localeCompare(b.nom, 'fr')));
}
export function groupesConnus(ctx: ModCtx): string[] {
  const g = new Set<string>(['famille', 'invite']);
  for (const p of personnes(ctx)) for (const x of p.groups) g.add(x);
  for (const l of Object.values(droits(ctx))) for (const x of l) if (!x.startsWith('@') && x !== '*') g.add(x);
  g.delete('admin'); return [...g].sort();
}
const quiValide = (ctx: ModCtx, q: string): string => {
  const x = s(q).toLowerCase().replace(/^groupe\s+/, '');
  if (x === '*' || x === 'tout le monde') return '*';
  if (x.startsWith('@')) { if (!personnes(ctx).some((p) => p.login === x.slice(1))) throw new Error(`personne « ${x.slice(1)} » inconnue`); return x; }
  if (personnes(ctx).some((p) => p.login === x) && !groupesConnus(ctx).includes(x)) return `@${x}`;
  if (!/^[\w-]{1,30}$/.test(x)) throw new Error('groupe invalide (ex. famille, invite, ou @identifiant pour une personne)');
  return x;
};
const appliValide = (ctx: ModCtx, a: string): string => {
  const x = s(a).toLowerCase(), l = applisConnues(ctx);
  const f = l.find((y) => y.id === x) ?? l.find((y) => y.nom.toLowerCase() === x) ?? l.find((y) => y.id === cleDroit(x));
  if (!f) throw new Error(`appli « ${s(a)} » inconnue`); return f.id;
};
const lanIp = () => Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1';
const retoursDe = (v: unknown) => s(v).split(/[\s,;]+/).filter(Boolean).map((r) => { try { const u = new URL(r); if (!/^(https?:|[a-z][a-z0-9+.-]*:)$/.test(u.protocol) || u.hash) throw new Error(); return u.toString(); } catch { throw new Error(`adresse de retour invalide : ${r}`); } });

const P_ACCES: Param[] = [{ key: 'appli', label: 'Appli (ex. venus, pegase, garmr)', kind: 'text', required: true }, { key: 'qui', label: 'Groupe (ex. famille) ou @identifiant', kind: 'text', required: true }];
export const ssoActions: Action[] = [
  { id: 'donner_acces', label: 'Donner l\'accès à une appli', what: 'Un groupe (ou une personne : @identifiant) peut ouvrir cette appli', params: P_ACCES, words: ['donne l accès à', 'donner l accès à', 'donne accès à', 'autorise le groupe'], run: (ctx, i) => {
    const a = appliValide(ctx, s(i.appli)), q = quiValide(ctx, s(i.qui)), l = changerDroit(ctx, a, q, true);
    return { text: `✅ ${q === '*' ? 'Toute personne connectée' : q.startsWith('@') ? q.slice(1) : `Le groupe ${q}`} a accès à ${nomAppli(ctx, a)} (autorisés : ${l.join(', ')}, et toujours le groupe admin).` };
  }, undo: (i) => ({ action: 'retirer_acces', input: { appli: i.appli, qui: i.qui }, label: 'Retirer l\'accès' }) },
  { id: 'retirer_acces', label: 'Retirer l\'accès à une appli', what: 'Ce groupe (ou cette personne) ne peut plus l\'ouvrir', params: P_ACCES, quick: false, words: ['retire l accès à', 'retirer l accès à', 'enlève l accès à'], run: (ctx, i) => {
    const a = appliValide(ctx, s(i.appli)), q = quiValide(ctx, s(i.qui)), l = changerDroit(ctx, a, q, false);
    for (const x of sessionsApplis(ctx)) if (x.appli === a && !x.revoque) { const p = personnes(ctx).find((y) => y.id === x.sub); if (!aDroit(ctx, p, a)) revoquerSession(ctx, x.id); }
    return { text: `🚫 ${q.startsWith('@') ? q.slice(1) : `Le groupe ${q}`} n'a plus accès à ${nomAppli(ctx, a)} (autorisés : ${l.join(', ') || 'admin seulement'}). Ses connexions ouvertes à cette appli sont coupées.` };
  }, undo: (i) => ({ action: 'donner_acces', input: { appli: i.appli, qui: i.qui }, label: 'Redonner l\'accès' }) },
  { id: 'acces_cases', label: 'Accès aux applis (cases)', what: 'Les cases cochées d\'un groupe ou d\'une personne', quick: false, params: [{ key: 'qui', label: 'Groupe ou @identifiant', kind: 'text', required: true }], run: (ctx, i) => {
    const q = quiValide(ctx, s(i.qui)); let plus = 0, moins = 0;
    for (const a of applisConnues(ctx)) { if (!(a.id in i)) continue; const on = i[a.id] === true || i[a.id] === 'true', has = groupesDe(ctx, a.id).includes(q); if (on && !has) { changerDroit(ctx, a.id, q, true); plus++; } if (!on && has) { changerDroit(ctx, a.id, q, false); moins++; } }
    for (const x of sessionsApplis(ctx)) if (!x.revoque) { const p = personnes(ctx).find((y) => y.id === x.sub); if (!aDroit(ctx, p, x.appli)) revoquerSession(ctx, x.id); }
    return { text: `✅ ${q.startsWith('@') ? q.slice(1) : `Groupe ${q}`} : ${plus} accès donné(s), ${moins} retiré(s).` };
  } },
  { id: 'acces_aux_applis', label: 'Qui a accès à quoi', what: 'Les applis ouvertes à chaque groupe', read: true, words: ['qui a accès à quoi', 'accès aux applis', 'droits des applis'], run: (ctx) => {
    const l = applisConnues(ctx).map((a) => `- ${a.nom} : ${groupesDe(ctx, a.id).join(', ')}`);
    return { text: `Le groupe admin a toutes les applis.\n${l.join('\n')}`, data: { droits: Object.fromEntries(applisConnues(ctx).map((a) => [a.id, groupesDe(ctx, a.id)])) } };
  } },
  { id: 'ajouter_appli', label: 'Ajouter une appli cliente', what: 'Une appli qui se connecte avec le compte Odin (OpenID) : son identifiant, son nom, ses adresses de retour', quick: false, params: [{ key: 'id', label: 'Identifiant (ex. jellyfin)', kind: 'text', required: true }, { key: 'nom', label: 'Nom affiché', kind: 'text', required: true }, { key: 'retours', label: 'Adresses de retour (séparées par des espaces)', kind: 'textarea', required: true }, { key: 'groupes', label: 'Groupes autorisés', kind: 'text', default: 'famille' }], run: (ctx, i) => {
    const id = s(i.id).toLowerCase(); if (!/^[a-z][a-z0-9_-]{1,30}$/.test(id)) throw new Error('identifiant : 2 à 31 lettres minuscules, chiffres, _ -'); if (client(ctx, id)) throw new Error('cette appli existe déjà');
    const c: Client = { id, nom: s(i.nom).slice(0, 40) || id, retours: retoursDe(i.retours), ajoute: Date.now() }; if (!c.retours.length) throw new Error('au moins une adresse de retour');
    sauverClient(ctx, c); for (const g of s(i.groupes || 'famille').split(/[\s,;]+/).filter(Boolean)) changerDroit(ctx, id, quiValide(ctx, g), true);
    return { text: `🔑 ${c.nom} peut se connecter avec le compte Odin (client_id « ${id} », PKCE obligatoire). Adresses de retour : ${c.retours.join(', ')}.` };
  } },
  { id: 'ajouter_retour', label: 'Ajouter une adresse de retour', what: 'Une adresse de plus où une appli reçoit la connexion (ex. Vénus servi à une autre adresse)', quick: false, params: [{ key: 'appli', label: 'Appli', kind: 'text', required: true }, { key: 'adresse', label: 'Adresse (ex. http://192.168.1.20:8096/auth/odin/retour)', kind: 'text', required: true }], run: (ctx, i) => {
    const c = client(ctx, appliValide(ctx, s(i.appli))); if (!c || c.id === 'odin') throw new Error('appli cliente inconnue');
    const r = retoursDe(i.adresse); sauverClient(ctx, { ...c, retours: [...new Set([...c.retours, ...r])] });
    return { text: `↩ ${c.nom} : adresse de retour ajoutée (${r.join(', ')}).` };
  } },
  { id: 'retirer_appli', label: 'Retirer une appli cliente', what: 'Elle ne peut plus se connecter ; ses connexions sont coupées', quick: false, params: [{ key: 'id', label: 'Identifiant', kind: 'text', required: true }], grave: () => 'retirer cette appli (ses connexions ouvertes sont coupées)', run: (ctx, i) => {
    const id = s(i.id).toLowerCase(); if (preinscrites().some((p) => p.id === id)) throw new Error('Pégase, Vénus et Odin sont préinscrites : on ne les retire pas (retire plutôt l\'accès aux groupes)');
    ctx.saveSettings({ ssoApplis: ((ctx.settings.ssoApplis as Client[] | undefined) ?? []).filter((x) => x.id !== id) });
    for (const x of sessionsApplis(ctx)) if (x.appli === id) revoquerSession(ctx, x.id);
    return { text: `🗑 Appli « ${id} » retirée.` };
  } },
  { id: 'taille_sauvegardes', label: 'Taille max des sauvegardes', what: 'La plus grosse sauvegarde qu\'une appli peut envoyer à Odin', quick: false, params: [{ key: 'appli', label: 'Appli', kind: 'text', required: true }, { key: 'mo', label: 'Taille max (Mo)', kind: 'number', default: 500 }], run: (ctx, i) => {
    const c = client(ctx, appliValide(ctx, s(i.appli))); const mo = Number(i.mo); if (!c || c.id === 'odin') throw new Error('appli cliente inconnue'); if (!(mo >= 1 && mo <= 50_000)) throw new Error('entre 1 Mo et 50 000 Mo');
    sauverClient(ctx, { ...c, tailleMax: Math.round(mo * 1048576) }); return { text: `💾 ${c.nom} : sauvegardes de ${mo} Mo au plus.` };
  } },
  { id: 'couper_appareil', label: 'Couper un appareil', what: 'Une connexion d\'appli ou de poste (ses jetons ne marchent plus)', quick: false, params: [{ key: 'id', label: 'Identifiant de la connexion', kind: 'text', required: true }], run: (ctx, i) => {
    const id = s(i.id), po = sessionsPostes(ctx).find((x) => x.id === id);
    if (po) { const n = revoquerPoste(ctx, id); return { text: `✂ Poste « ${po.appareil.nom} » de ${po.login} coupé (${n} connexion(s)).` }; }
    if (revoquerSession(ctx, id)) return { text: '✂ Connexion coupée : l\'appli devra se reconnecter.' };
    throw new Error('connexion inconnue (déjà coupée ?)');
  } },
  { id: 'inscrire_logiciel', label: 'Connexion Odin pour un logiciel', what: 'Un logiciel du proxy qui sait faire OpenID (Penpot…) : Odin l\'inscrit et donne sa configuration ; le secret va dans le coffre', quick: false, params: [{ key: 'logiciel', label: 'Logiciel', kind: 'select', options: ['penpot', 'autre'], default: 'penpot' }, { key: 'domaine', label: 'Son adresse (ex. penpot.exemple.fr)', kind: 'text', required: true }, { key: 'retour', label: 'Adresse de retour (seulement pour « autre »)', kind: 'text', default: '' }, { key: 'odin', label: 'Adresse d\'Odin vue par ce logiciel et par le navigateur (vide : réseau local)', kind: 'text', default: '' }, { key: 'groupes', label: 'Groupes autorisés', kind: 'text', default: 'famille' }], run: async (ctx, i) => {
    const log = s(i.logiciel) || 'penpot', dom = s(i.domaine).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]+(:\d+)?$/.test(dom)) throw new Error('adresse du logiciel invalide');
    const retour = log === 'penpot' ? `https://${dom}/api/auth/oidc/callback` : retoursDe(i.retour)[0];
    if (!retour) throw new Error('adresse de retour du logiciel ?');
    const id = `${log === 'penpot' ? 'penpot' : 'logiciel'}-${dom.replace(/[^a-z0-9]/g, '-')}`.slice(0, 31), secret = randomBytes(32).toString('base64url');
    const r = await ctx.call('brisingamen', 'ajouter', { nom: `OpenID · ${log === 'penpot' ? 'Penpot' : dom}`, identifiant: id, mot_de_passe: secret, site: `https://${dom}`, coffre: 'Personnel' }, 'ranger le secret OpenID du logiciel').catch((e) => ({ ok: false, text: (e as Error).message }));
    if (r.ok === false) throw new Error(`le coffre Thésauros n'a pas pu garder le secret (${r.text}) : rien n'est inscrit`);
    sauverClient(ctx, { id, nom: log === 'penpot' ? 'Penpot' : dom, retours: [retour], secret: sha256hex(secret), logiciel: log, ajoute: Date.now() });
    for (const g of s(i.groupes || 'famille').split(/[\s,;]+/).filter(Boolean)) changerDroit(ctx, id, quiValide(ctx, g), true);
    const iss = s(i.odin).replace(/\/+$/, '') || `https://${lanIp()}:7777`;
    const conf = log === 'penpot'
      ? ['PENPOT_FLAGS=… enable-login-with-oidc (ajoute-le aux drapeaux existants)', `PENPOT_OIDC_CLIENT_ID=${id}`, `PENPOT_OIDC_CLIENT_SECRET=<dans le coffre Thésauros : « OpenID · Penpot »>`, `PENPOT_OIDC_BASE_URI=${iss}`, 'PENPOT_OIDC_SCOPES=openid profile email groups', 'PENPOT_OIDC_NAME=Odin', `PENPOT_SSRF_ALLOWED_HOSTS=${new URL(iss).hostname}`]
      : [`Fournisseur (issuer / découverte) : ${iss}/.well-known/openid-configuration`, `client_id : ${id}`, 'client_secret : dans le coffre Thésauros', `adresse de retour : ${retour}`, 'scopes : openid profile email groups'];
    return { text: `🔑 ${log === 'penpot' ? 'Penpot' : dom} peut se connecter avec le compte Odin.\nConfiguration (backend) :\n${conf.join('\n')}\nSi Odin a un certificat auto-signé, le logiciel doit lui faire confiance (autorité d'Odin : ${iss}/odin-cert.crt).` };
  } },
  { id: 'proteger_tout', label: 'Connexion unique pour tous les sites', what: 'Chaque site du proxy Valgrind demande la connexion d\'Odin (toute personne connectée)', quick: false, words: ['protège tous les sites', 'connexion unique partout'], run: async (ctx) => {
    const sans = sitesSansSso(); if (!sans.length) return { text: '✅ Tous les sites du proxy demandent déjà la connexion d\'Odin.' };
    if (!s(ctx.settings.portal)) throw new Error('règle d\'abord le portail (Réglages du portail : son nom, ex. connexion.exemple.fr)');
    const faits: string[] = [], rates: string[] = [];
    for (const d of sans) { const r = await ctx.call('valgrind', 'connexion_unique', { domaine: d, actif: true }, `réserver ${d} aux personnes connectées`).catch((e) => ({ ok: false, text: (e as Error).message })); if (r.ok === false) rates.push(`${d} (${r.text})`); else { faits.push(d); const rules = (ctx.settings.rules as Array<{ domain: string; groups: string[] }> | undefined) ?? []; if (!rules.some((x) => x.domain === d)) ctx.saveSettings({ rules: [...rules, { domain: d, groups: ['*'] }] }); } }
    return { ok: !rates.length, text: `🛡 ${faits.length} site(s) protégé(s)${faits.length ? ` : ${faits.join(', ')}` : ''}.${rates.length ? `\n⚠ Pas pu : ${rates.join(' ; ')}` : ''}` };
  } },
  { id: 'delier_proprietaire', label: 'Délier le compte du propriétaire', what: 'Retire sa fiche de Persona (son compte d\'Odin et son mot de passe ne changent pas)', quick: false, grave: () => 'retirer la fiche Persona du propriétaire (ses connexions par Persona sont coupées)', run: (ctx) => ({ text: delierProprietaire(ctx) ? '↩ Fiche du propriétaire retirée de Persona. Son compte d\'Odin est intact ; « Relier le compte du propriétaire » la recrée.' : 'Rien à délier.' }) },
  { id: 'relier_proprietaire', label: 'Relier le compte du propriétaire', what: 'Le compte d\'Odin redevient la personne admin de Persona', quick: false, run: (ctx) => { const p = relierProprietaire(ctx); return { text: p ? `🔗 ${p.name} est la personne « ${p.login} » (groupe admin) de Persona.` : 'Pas encore de compte d\'Odin.' }; } },
];

/** Les sites du proxy qui ne demandent pas encore la connexion d'Odin. */
export function sitesSansSso(): string[] {
  const v = valhallaOf(); if (!v?.module('valgrind')) return [];
  const hosts = (v.ctx('valgrind').settings.hosts as Array<{ domains: string[]; enabled?: boolean; sso?: boolean }> | undefined) ?? [];
  return hosts.filter((h) => h.enabled !== false && !h.sso).map((h) => h.domains[0]).filter(Boolean);
}

/** Les sections de la page Persona (onglets « Applis » et « Accès »). */
export function ssoSections(ctx: ModCtx): Section[] {
  lierProprietaire(ctx);
  const now = Date.now(), ps = personnes(ctx), cs = clients(ctx).filter((c) => c.id !== 'odin'), apps = applisConnues(ctx), gs = groupesConnus(ctx);
  const nomDe = (sub: string) => ps.find((p) => p.id === sub)?.name ?? '?';
  const ses = sessionsApplis(ctx).filter((x) => vivante(x, RENOUV_INACTIF, now)), postes = sessionsPostes(ctx).filter((x) => vivante(x, POSTE_INACTIF, now)), sans = sitesSansSso();
  const cases = (qui: string, titre: string): Section => ({ kind: 'form', onglet: 'Accès', title: titre, action: 'acces_cases', submit: 'Enregistrer', fixe: { qui }, params: apps.map((a) => ({ key: a.id, label: a.nom, kind: 'boolean' as const, default: groupesDe(ctx, a.id).includes(qui) })) });
  return [
    { kind: 'table', onglet: 'Applis', title: 'Applis clientes (connexion avec le compte Odin)', columns: ['Appli', 'Identifiant', 'Adresses de retour', 'Groupes autorisés'], rows: cs.map((c) => ({ cells: [c.nom, c.id, c.retours.join(' ') || '—', groupesDe(ctx, c.id).join(', ')], actions: c.prereg ? [] : [{ action: 'retirer_appli', label: 'Retirer', input: { id: c.id } }] })) },
    { kind: 'table', onglet: 'Applis', title: 'Appareils connectés', columns: ['Personne', 'Appli', 'Appareil', 'Par', 'Vu'], empty: 'Aucune appli connectée pour l\'instant.',
      rows: [...postes.map((x) => ({ cells: [nomDe(x.sub), 'poste (SSO)', `${x.appareil.nom} · ${x.utilisateur}`, 'connexion du poste', quand(x.vu)], actions: [{ action: 'couper_appareil', label: 'Couper', input: { id: x.id } }] })),
        ...ses.map((x) => ({ cells: [nomDe(x.sub), nomAppli(ctx, x.appli), `${x.appareil.nom} (${x.appareil.plateforme})`, x.via, quand(x.vu)], actions: [{ action: 'couper_appareil', label: 'Couper', input: { id: x.id } }] }))] },
    ...(sans.length ? [{ kind: 'actions' as const, onglet: 'Applis', title: 'Sites du proxy sans connexion unique', boutons: [{ action: 'proteger_tout', label: 'Protéger tous les sites', primary: true }], aide: `${sans.join(', ')} : on y entre sans le compte Odin.` }] : []),
    { kind: 'form', onglet: 'Applis', title: 'Ajouter une appli cliente', action: 'ajouter_appli', submit: 'Ajouter', params: ssoActions.find((a) => a.id === 'ajouter_appli')!.params! },
    { kind: 'form', onglet: 'Applis', title: 'Connexion Odin pour un logiciel (Penpot…)', action: 'inscrire_logiciel', submit: 'Inscrire', params: ssoActions.find((a) => a.id === 'inscrire_logiciel')!.params!, aide: 'Le secret part dans le coffre Thésauros, jamais affiché.' },
    { kind: 'form', onglet: 'Applis', title: 'Ajouter une adresse de retour', action: 'ajouter_retour', submit: 'Ajouter', params: ssoActions.find((a) => a.id === 'ajouter_retour')!.params! },
    { kind: 'table', onglet: 'Accès', title: 'Accès aux applis', columns: ['Appli', 'admin', ...gs, 'tout le monde', 'personnes'], rows: apps.map((a) => { const g = groupesDe(ctx, a.id); return { cells: [a.nom, '✓', ...gs.map((x) => (g.includes(x) ? '✓' : '—')), g.includes('*') ? '✓' : '—', g.filter((x) => x.startsWith('@')).map((x) => x.slice(1)).join(', ') || '—'] }; }) },
    ...gs.map((g) => cases(g, `Groupe ${g}`)),
    ...ps.filter((p) => !p.proprio && !p.groups.includes('admin')).map((p) => cases(`@${p.login}`, `${p.name} (en plus de ses groupes)`)),
    { kind: 'form', onglet: 'Accès', title: 'Donner l\'accès (par commande)', action: 'donner_acces', submit: 'Donner', params: P_ACCES },
  ];
}

/** La carte « Sauvegarde sur Odin » d'une appli cliente (dans la page de son appli d'Odin). */
export function carteSauvegarde(appli: string, onglet?: string): Section[] {
  const js = jeux(appli), nom = appli === 'venus' ? 'Vénus' : appli;
  if (!js.length) return [{ kind: 'text', ...(onglet ? { onglet } : {}), title: 'Sauvegarde sur Odin', text: `Aucune sauvegarde reçue. Dans ${nom} : Réglages → Odin (adresse d'Odin, ton e-mail et ton mot de passe) ; ${nom} envoie alors toute sa base à chaque changement important, et Odin la garde chiffrée.` }];
  return [
    { kind: 'cards', ...(onglet ? { onglet } : {}), title: 'Sauvegarde sur Odin', items: js.map((j) => { const d = j.versions[0]; return { title: `Dernière : ${quand(d.date)}`, sub: `${taille(d.taille)} · ${j.versions.length} version(s) · compte ${j.login}${d.raison ? ` · ${d.raison}` : ''}`, badge: j.restaurer ? 'restauration demandée' : Date.now() - d.date < 86_400_000 ? 'à jour' : 'ancienne', tone: j.restaurer ? 'attention' as const : Date.now() - d.date < 86_400_000 ? 'bon' as const : 'attention' as const, actions: [{ action: 'restaurer_sauvegarde', label: 'Restaurer la dernière', input: { personne: j.login, version: j.versions.find((v) => v.sorte === 'complete')?.id ?? d.id } }] }; }) },
    { kind: 'table', ...(onglet ? { onglet } : {}), title: 'Versions gardées', columns: ['Date', 'Compte', 'Sorte', 'Taille', 'Pourquoi'], rows: js.flatMap((j) => j.versions.slice(0, 15).map((v) => ({ cells: [quand(v.date), j.login, v.sorte === 'complete' ? 'complète' : 'changements', taille(v.taille), v.raison || '—'], actions: v.sorte === 'complete' ? [{ action: 'restaurer_sauvegarde', label: 'Restaurer', input: { personne: j.login, version: v.id } }] : [] }))) },
  ];
}
export function actionRestaurer(appli: string): Action {
  return { id: 'restaurer_sauvegarde', label: 'Restaurer depuis Odin', what: 'L\'appli remet cette version de sa base à sa prochaine vérification (5 minutes au plus)', quick: false, params: [{ key: 'personne', label: 'Compte', kind: 'text', required: true }, { key: 'version', label: 'Version', kind: 'text', required: true }],
    grave: () => 'remplacer la base actuelle de l\'appli par cette sauvegarde', run: (_ctx, i) => { const v = demanderRestauration(appli, s(i.personne), s(i.version)); return { text: `♻ Restauration de ${v} demandée : l'appli la fera à sa prochaine vérification (5 minutes au plus).` }; } };
}
