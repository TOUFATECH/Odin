// Les groupes d'accès de Persona : on les crée, les renomme, les supprime ; on y met des personnes ; on donne à un
// groupe le droit d'ouvrir une appli d'Odin (ou une appli cliente) et d'entrer sur un site du proxy ; on peut exiger la
// double authentification pour tout un groupe.
//
// Un seul endroit garde chaque chose, et tout le reste le lit :
//   - les groupes d'une personne : sa fiche (people[].groups) → proxy Valgrind (check), connexion unique, interface ;
//   - le droit d'une appli : ssoDroits (etat.ts → aDroit) → ports des applis, interface d'Odin, Valhalla.act, SSO ;
//   - le droit d'un site : les règles du portail (rules) → proxy Valgrind.
// Renommer un groupe le renomme partout à la fois ; le supprimer le retire partout. Ce qui n'est plus permis est coupé
// tout de suite (connexions des applis ouvertes avec un droit perdu).
// Le groupe « admin » a toujours tout : on ne le renomme pas, on ne le supprime pas.

import type { Action, ModCtx, Param, Section } from '../types.ts';
import { aDroit, droits, nomAppli, personnes, revoquerSession, sessionsApplis, type Personne } from './etat.ts';
import { applisConnues, avantApres, siDonne } from './persona.ts';

export interface Groupe { id: string; description?: string; cree: number }
interface Regle { domain: string; groups: string[] }

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
const NOM = /^[a-z0-9][a-z0-9_-]{0,29}$/;
/** Le nom d'un groupe : minuscules, chiffres, _ et - (30 au plus). Lève l'erreur à montrer. Pur. */
export function nomGroupe(v: unknown): string {
  const g = s(v).toLowerCase().replace(/^groupe\s+/, '').replace(/\s+/g, '-');
  if (!NOM.test(g)) throw new Error('nom de groupe : 1 à 30 lettres minuscules, chiffres, _ ou - (ex. famille, invites, bureau)');
  return g;
}
const declares = (ctx: ModCtx): Groupe[] => (ctx.settings.groupes as Groupe[] | undefined) ?? [];
const regles = (ctx: ModCtx): Regle[] => (ctx.settings.rules as Regle[] | undefined) ?? [];
const exige2fa = (ctx: ModCtx): string[] => (ctx.settings.require2fa as string[] | undefined) ?? [];

/** Tous les groupes : ceux qu'on a créés, et ceux qui servent déjà (fiches, droits, sites). « admin » en premier. */
export function groupes(ctx: ModCtx): Groupe[] {
  const out = new Map<string, Groupe>([['admin', { id: 'admin', description: 'tout Odin (toujours)', cree: 0 }]]);
  for (const g of declares(ctx)) out.set(g.id, g);
  const vu = (g: string) => { if (g && g !== '*' && !g.startsWith('@') && !out.has(g)) out.set(g, { id: g, cree: 0 }); };
  for (const p of personnes(ctx)) p.groups.forEach(vu);
  for (const l of Object.values(droits(ctx))) l.forEach(vu);
  for (const r of regles(ctx)) r.groups.forEach(vu);
  exige2fa(ctx).forEach(vu);
  return [...out.values()];
}
export const groupeExiste = (ctx: ModCtx, g: string) => groupes(ctx).some((x) => x.id === g);

/**
 * Coupe tout ce qui n'est plus permis : les connexions des applis (jetons) dont la personne a perdu le droit. Le reste
 * (ports des applis, interface d'Odin, proxy) relit les droits à chaque requête. Rend le nombre de connexions coupées.
 */
export function reappliquer(ctx: ModCtx): number {
  let n = 0; const ps = personnes(ctx);
  for (const x of sessionsApplis(ctx)) if (!x.revoque) { const p = ps.find((y) => y.id === x.sub); if (!aDroit(ctx, p, x.appli)) { revoquerSession(ctx, x.id); n++; } }
  return n;
}

/** Remplace un groupe par un autre (ou le retire : `vers` vide) dans les fiches, les droits, les sites et la double authentification. */
function remplacer(ctx: ModCtx, de: string, vers: string): { personnes: number; applis: number; sites: number } {
  const ch = (l: string[]) => [...new Set(l.flatMap((g) => (g === de ? (vers ? [vers] : []) : [g])))];
  let np = 0, na = 0, ns = 0;
  const people = personnes(ctx).map((p) => (p.groups.includes(de) ? (np++, { ...p, groups: ch(p.groups) }) : p));
  const dr = Object.fromEntries(Object.entries((ctx.settings.ssoDroits as Record<string, string[]> | undefined) ?? {}).map(([k, l]) => [k, l.includes(de) ? (na++, ch(l)) : l]));
  // Les droits de départ (odin, pegase, venus…) qui citent le groupe sont recopiés pour être changés eux aussi.
  for (const [k, l] of Object.entries(droits(ctx))) if (!(k in dr) && l.includes(de)) { dr[k] = ch(l); na++; }
  const rs = regles(ctx).map((r) => (r.groups.includes(de) ? (ns++, { ...r, groups: ch(r.groups) }) : r));
  ctx.saveSettings({ people, ssoDroits: dr, rules: rs, require2fa: ch(exige2fa(ctx)), groupes: declares(ctx).flatMap((g) => (g.id === de ? (vers ? [{ ...g, id: vers }] : []) : [g])) });
  return { personnes: np, applis: na, sites: ns };
}
const parLogin = (ctx: ModCtx, l: unknown): Personne => { const p = personnes(ctx).find((x) => x.login === s(l).toLowerCase().replace(/^@/, '')); if (!p) throw new Error(`personne « ${s(l)} » inconnue`); return p; };
const sauverPersonne = (ctx: ModCtx, p: Personne) => ctx.saveSettings({ people: personnes(ctx).map((x) => (x.id === p.id ? p : x)) });
const groupeConnu = (ctx: ModCtx, v: unknown): string => { const g = nomGroupe(v); if (!groupeExiste(ctx, g)) throw new Error(`le groupe « ${g} » n'existe pas (crée-le d'abord)`); return g; };

const P_GROUPE: Param = { key: 'groupe', label: 'Groupe', kind: 'text', required: true };
const P_PERSONNE: Param = { key: 'login', label: 'Identifiant de la personne', kind: 'text', required: true };
export const groupesActions: Action[] = [
  { id: 'creer_groupe', label: 'Créer un groupe', what: 'Un groupe d\'accès (famille, invités, bureau…) à qui donner des applis et des sites', words: ['crée le groupe', 'cree le groupe', 'nouveau groupe'], params: [{ key: 'nom', label: 'Nom du groupe (ex. bureau)', kind: 'text', required: true }, { key: 'description', label: 'À quoi il sert (facultatif)', kind: 'text', default: '' }, { key: 'double_auth', label: 'Double authentification obligatoire', kind: 'boolean', default: false }], run: (ctx, i) => {
    const g = nomGroupe(i.nom); if (groupeExiste(ctx, g)) throw new Error(`le groupe « ${g} » existe déjà`);
    ctx.saveSettings({ groupes: [...declares(ctx), { id: g, ...(s(i.description) ? { description: s(i.description).slice(0, 120) } : {}), cree: ctx.now().getTime() }], ...(i.double_auth === true ? { require2fa: [...new Set([...exige2fa(ctx), g])] } : {}) });
    return { text: `👥 Groupe « ${g} » créé${i.double_auth === true ? ' (double authentification obligatoire)' : ''}. Mets-y des personnes, puis donne-lui des applis ou des sites.` };
  }, undo: (i) => ({ action: 'supprimer_groupe', input: { groupe: i.nom }, label: 'Supprimer le groupe' }) },
  { id: 'renommer_groupe', label: 'Renommer un groupe', what: 'Le nouveau nom remplace l\'ancien partout (personnes, applis, sites)', quick: false, params: [P_GROUPE, { key: 'nouveau', label: 'Nouveau nom', kind: 'text', required: true }], run: (ctx, i) => {
    const de = groupeConnu(ctx, i.groupe), vers = nomGroupe(i.nouveau);
    if (de === 'admin') throw new Error('le groupe admin ne se renomme pas');
    if (vers === 'admin' || groupeExiste(ctx, vers)) throw new Error(`le groupe « ${vers} » existe déjà`);
    const n = remplacer(ctx, de, vers);
    return { text: `✏️ Groupe « ${de} » renommé « ${vers} » : ${n.personnes} personne(s), ${n.applis} appli(s), ${n.sites} site(s).` };
  }, undo: (i) => ({ action: 'renommer_groupe', input: { groupe: i.nouveau, nouveau: i.groupe }, label: 'Reprendre l\'ancien nom' }) },
  { id: 'supprimer_groupe', label: 'Supprimer un groupe', what: 'Les personnes restent, mais perdent ce que le groupe leur donnait', quick: false, params: [P_GROUPE], grave: (i) => `supprimer le groupe ${s(i.groupe)} (ses personnes perdent ses applis et ses sites ; leurs connexions à ces applis sont coupées)`, run: (ctx, i) => {
    const g = groupeConnu(ctx, i.groupe); if (g === 'admin') throw new Error('le groupe admin ne se supprime pas');
    const n = remplacer(ctx, g, ''), c = reappliquer(ctx);
    return { text: `🗑 Groupe « ${g} » supprimé : retiré de ${n.personnes} personne(s), ${n.applis} appli(s), ${n.sites} site(s)${c ? ` ; ${c} connexion(s) coupée(s)` : ''}.` };
  } },
  { id: 'mettre_dans_groupe', label: 'Mettre dans un groupe', what: 'La personne reçoit les applis et les sites du groupe', words: ['mets dans le groupe', 'ajoute au groupe'], params: [P_PERSONNE, P_GROUPE], proprietaireSeul: true,
    grave: siDonne((i, ctx) => { const p = parLogin(ctx, i.login), g = groupeConnu(ctx, i.groupe); return p.groups.includes(g) ? undefined : `mettre ${p.name} (« ${p.login} ») dans le groupe ${g} — groupes : ${avantApres(p.groups, [...p.groups, g])}`; }),
    run: (ctx, i) => {
    const p = parLogin(ctx, i.login), g = groupeConnu(ctx, i.groupe);
    if (p.groups.includes(g)) return { text: `${p.name} est déjà dans le groupe ${g}.` };
    if (g === 'admin' && !p.totp && exige2fa(ctx).includes('admin')) throw new Error(`${p.name} doit d'abord activer la double authentification (le groupe admin l'exige)`);
    sauverPersonne(ctx, { ...p, groups: [...p.groups, g] });
    return { text: `➕ ${p.name} est dans le groupe ${g}${exige2fa(ctx).includes(g) && !p.totp ? ' (ce groupe exige la double authentification : active-la pour elle, sinon elle ne pourra plus se connecter)' : ''}.` };
  }, undo: (i) => ({ action: 'sortir_du_groupe', input: { login: i.login, groupe: i.groupe }, label: 'La sortir du groupe' }) },
  { id: 'sortir_du_groupe', label: 'Sortir d\'un groupe', what: 'La personne perd les applis et les sites du groupe ; ses connexions à ces applis sont coupées', quick: false, params: [P_PERSONNE, P_GROUPE], run: (ctx, i) => {
    const p = parLogin(ctx, i.login), g = nomGroupe(i.groupe);
    if (!p.groups.includes(g)) return { text: `${p.name} n'est pas dans le groupe ${g}.` };
    if (p.proprio && g === 'admin') throw new Error('le propriétaire d\'Odin reste dans le groupe admin');
    sauverPersonne(ctx, { ...p, groups: p.groups.filter((x) => x !== g) }); const c = reappliquer(ctx);
    return { text: `➖ ${p.name} n'est plus dans le groupe ${g}${c ? ` ; ${c} connexion(s) coupée(s)` : ''}.` };
  }, undo: (i) => ({ action: 'mettre_dans_groupe', input: { login: i.login, groupe: i.groupe }, label: 'La remettre dans le groupe' }) },
  { id: 'double_auth_groupe', label: 'Double authentification d\'un groupe', what: 'Obligatoire ou non pour toutes les personnes du groupe', quick: false, params: [P_GROUPE, { key: 'obligatoire', label: 'Obligatoire', kind: 'boolean', default: true }], run: (ctx, i) => {
    const g = groupeConnu(ctx, i.groupe), on = i.obligatoire !== false && i.obligatoire !== 'false';
    ctx.saveSettings({ require2fa: on ? [...new Set([...exige2fa(ctx), g])] : exige2fa(ctx).filter((x) => x !== g) });
    const sans = personnes(ctx).filter((p) => p.groups.includes(g) && !p.totp && !p.proprio).map((p) => p.name);
    return { text: `🔐 Groupe ${g} : double authentification ${on ? 'obligatoire' : 'facultative'}.${on && sans.length ? `\n⚠ Sans code pour l'instant (ne pourront plus se connecter par mot de passe seul) : ${sans.join(', ')}. Active-la pour elles (Double authentification), ou qu'elles utilisent une clé d'accès.` : ''}` };
  } },
  { id: 'donner_site', label: 'Donner un site à un groupe', what: 'Le groupe peut entrer sur ce site du proxy (connexion d\'Odin)', params: [P_GROUPE, { key: 'domaine', label: 'Site (nom du proxy)', kind: 'text', required: true }], proprietaireSeul: true,
    // Un site déjà réservé : le groupe s'ajoute à ceux qui y entrent (validation) ; un site encore ouvert devient réservé (il se ferme aux autres).
    grave: siDonne((i, ctx) => { const g = groupeConnu(ctx, i.groupe), d = s(i.domaine).toLowerCase(), r = regles(ctx).find((x) => x.domain === d); return !r || r.groups.includes(g) || r.groups.includes('*') ? undefined : `laisser entrer le groupe ${g} sur ${d} — autorisés : ${avantApres(r.groups, [...r.groups, g])}`; }),
    run: async (ctx, i) => {
    const g = groupeConnu(ctx, i.groupe), d = s(i.domaine).toLowerCase(), r = regles(ctx).find((x) => x.domain === d);
    if (!/^[a-z0-9*][a-z0-9.-]*\.[a-z]{2,}$/.test(d)) throw new Error('nom de site invalide (ex. nas.exemple.fr)');
    if (!r) { const x = await ctx.call('var', 'proteger_site', { domaine: d, groupes: g }, `réserver ${d} au groupe ${g}`, { interne: true }); if (x.ok === false) throw new Error(x.text); return { text: `🛡 ${d} est réservé au groupe ${g} (connexion d'Odin demandée).` }; }
    if (r.groups.includes(g) || r.groups.includes('*')) return { text: `Le groupe ${g} entre déjà sur ${d}.` };
    ctx.saveSettings({ rules: regles(ctx).map((x) => (x.domain === d ? { ...x, groups: [...x.groups, g] } : x)) });
    return { text: `🛡 Le groupe ${g} peut entrer sur ${d}.` };
  }, undo: (i) => ({ action: 'retirer_site', input: { groupe: i.groupe, domaine: i.domaine }, label: 'Retirer le site' }) },
  { id: 'retirer_site', label: 'Retirer un site à un groupe', what: 'Le groupe n\'entre plus sur ce site (le site reste réservé)', quick: false, params: [P_GROUPE, { key: 'domaine', label: 'Site', kind: 'text', required: true }], run: (ctx, i) => {
    const g = nomGroupe(i.groupe), d = s(i.domaine).toLowerCase(), r = regles(ctx).find((x) => x.domain === d);
    if (!r || !r.groups.includes(g)) return { text: `Le groupe ${g} n'avait pas le site ${d}.` };
    ctx.saveSettings({ rules: regles(ctx).map((x) => (x.domain === d ? { ...x, groups: x.groups.filter((y) => y !== g) } : x)) });
    return { text: `🚪 Le groupe ${g} n'entre plus sur ${d}${r.groups.length === 1 ? ' (seul le groupe admin y entre encore)' : ''}.` };
  } },
  { id: 'groupes', label: 'Groupes d\'accès', what: 'Chaque groupe : ses personnes, ses applis, ses sites', read: true, words: ['groupes d acces', 'groupes d\'accès', 'quels groupes', 'liste des groupes'], run: (ctx) => {
    const l = resume(ctx);
    return { text: l.map((g) => `- ${g.id}${g.double ? ' (double authentification)' : ''} : ${g.personnes.join(', ') || 'personne'} · applis : ${g.applis.join(', ') || '—'} · sites : ${g.sites.join(', ') || '—'}`).join('\n'), data: { groupes: l } };
  } },
];

/** Chaque groupe et ce qu'il donne (sans aucun secret). */
export function resume(ctx: ModCtx): Array<{ id: string; description: string; personnes: string[]; applis: string[]; sites: string[]; double: boolean }> {
  const ps = personnes(ctx), dr = droits(ctx), rs = regles(ctx), dbl = exige2fa(ctx), apps = applisConnues(ctx);
  return groupes(ctx).map((g) => ({
    id: g.id, description: g.description ?? '', double: dbl.includes(g.id),
    personnes: ps.filter((p) => p.groups.includes(g.id)).map((p) => p.name),
    applis: g.id === 'admin' ? ['toutes'] : apps.filter((a) => (dr[a.id] ?? ['admin']).includes(g.id)).map((a) => a.nom),
    sites: g.id === 'admin' ? rs.map((r) => r.domain) : rs.filter((r) => r.groups.includes(g.id)).map((r) => r.domain),
  }));
}

/** L'onglet « Groupes » de la page Persona. */
export function groupesSections(ctx: ModCtx): Section[] {
  const l = resume(ctx), f = (id: string) => groupesActions.find((a) => a.id === id)!.params!;
  return [
    { kind: 'table', onglet: 'Groupes', title: 'Groupes d\'accès', columns: ['Groupe', 'Personnes', 'Applis', 'Sites', 'Double auth.'], empty: 'Aucun groupe.',
      rows: l.map((g) => ({ cells: [g.description ? `${g.id} · ${g.description}` : g.id, g.personnes.join(', ') || '—', g.applis.slice(0, 12).join(', ') || '—', g.sites.join(', ') || '—', g.double ? 'obligatoire' : '—'],
        actions: g.id === 'admin' ? [] : [{ action: 'double_auth_groupe', label: g.double ? 'Double auth. facultative' : 'Double auth. obligatoire', input: { groupe: g.id, obligatoire: !g.double } }, { action: 'supprimer_groupe', label: 'Supprimer', input: { groupe: g.id } }] })) },
    { kind: 'form', onglet: 'Groupes', title: 'Créer un groupe', action: 'creer_groupe', submit: 'Créer', params: f('creer_groupe') },
    { kind: 'form', onglet: 'Groupes', title: 'Mettre une personne dans un groupe', action: 'mettre_dans_groupe', submit: 'Ajouter', params: f('mettre_dans_groupe') },
    { kind: 'form', onglet: 'Groupes', title: 'Sortir une personne d\'un groupe', action: 'sortir_du_groupe', submit: 'Sortir', params: f('sortir_du_groupe') },
    { kind: 'form', onglet: 'Groupes', title: 'Renommer un groupe', action: 'renommer_groupe', submit: 'Renommer', params: f('renommer_groupe') },
    { kind: 'form', onglet: 'Groupes', title: 'Donner un site du proxy à un groupe', action: 'donner_site', submit: 'Donner', params: f('donner_site') },
    { kind: 'text', onglet: 'Groupes', title: 'Où les droits s\'appliquent', text: `Les applis d'un groupe se règlent dans l'onglet « Accès » (cases). Partout le même droit : le port de chaque appli, l'interface d'Odin (liste, pages, boutons, phrases), la connexion unique (${nomAppli(ctx, 'pegase')}, ${nomAppli(ctx, 'venus')}, logiciels OpenID) et les sites du proxy Valgrind. Retirer un droit coupe tout de suite les connexions des applis concernées.` },
  ];
}
