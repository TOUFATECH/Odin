// Agora — le store d'Odin. Tu mets une personne dans un groupe de Persona : les éléments du store autorisés à ce groupe
// apparaissent dans son espace Odin (applis d'Odin, par le droit de la connexion unique) et dans le store de ses
// ordinateurs et téléphones. Pour chaque élément et chaque groupe, un mode : Proposée (la personne installe si elle
// veut), Installée d'office (installée seule, pas désinstallable par la personne), Retirée (désinstallée, et
// disparaît de l'espace Odin). L'admin peut forcer une installation ou une désinstallation sur un appareil précis
// (action grave : accord, journal).
//
// Pages d'admin (Catalogue, Groupes, Appareils, Journal) : réservées au propriétaire et au groupe admin. Une autre
// personne qui ouvre Agora voit seulement SON store. Les routes des stores des appareils : src/web/agora-api.ts.
// Le droit (qui a droit à quoi) reste celui de la connexion unique (`ssoDroits` de Persona) : rien n'est dupliqué.

import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, createReadStream, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { Action as Act, Module, ModCtx, Param, Section, Tone } from '../types.ts';
import type { Verdict } from '../ullr/engine.ts';
import { cleDroit, clients, groupesDe, nomAppli, personnes, changerDroit, type Personne } from '../sso/etat.ts';
import { agissant } from '../sso/acces.ts';
import { FORMATS, MODES, OUVERT, formatDe, nouvelId, oublier, paquetPour, PLATEFORMES, type Element, type Mode, type Paquet, type Plateforme } from '../agora/store.ts';
import { ACTIONS, changerMode, depot, estAdmin, groupesElement, modePour, personaDe, quiAgit, reconcilier, reveillerPersona, storeDe } from '../agora/regles.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
const T = { C: 'Catalogue', G: 'Groupes', A: 'Appareils', J: 'Journal' } as const;
const quand = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const ilYa = (ms: number, now: number) => { const d = Math.max(0, now - ms) / 1000; return d < 60 ? 'à l\'instant' : d < 3600 ? `il y a ${Math.round(d / 60)} min` : d < 86400 ? `il y a ${Math.round(d / 3600)} h` : `il y a ${Math.round(d / 86400)} j`; };
const taille = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : n >= 1024 ? `${Math.round(n / 1024)} Ko` : `${n} octets`);
const NOM_PF: Record<string, string> = { windows: 'Windows', mac: 'Mac', linux: 'Linux', android: 'Android', ios: 'iPhone', autre: 'autre' };
const LIBELLES: Record<string, Mode | 'aucun'> = { 'Proposée': 'proposee', 'Installée d\'office': 'office', 'Retirée': 'retiree', 'Pas pour ce groupe': 'aucun' };
const CHOIX_MODE = Object.keys(LIBELLES);
const slug = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const refus = (): { ok: false; text: string } => ({ ok: false, text: 'Cette partie d\'Agora est réservée aux admins (le propriétaire d\'Odin et le groupe admin). Ton store est dans l\'onglet « Mon store ».' });
/** Garde des actions d'admin : une personne qui n'est pas admin reçoit un refus clair. */
const admin = (f: Act['run']): Act['run'] => (ctx, i) => (estAdmin() ? f(ctx, i) : refus());
/** Les applis d'Odin (pour « Ajouter au store » une appli web). */
const applisOdin = (ctx: ModCtx) => ctx.modules().filter((m) => m.id !== 'agora');
function appliOdin(ctx: ModCtx, x: string): { id: string; nom: string } | undefined {
  const t = s(x).toLowerCase(); if (!t) return undefined;
  const m = applisOdin(ctx).find((y) => y.id === t || y.name.toLowerCase() === t || slug(y.name) === slug(t)); return m ? { id: m.id, nom: m.name } : undefined;
}
function elementDe(ctx: ModCtx, x: unknown): Element { const e = depot(ctx).element(s(x)); if (!e) throw new Error(`« ${s(x)} » n'est pas dans le store (regarde l'onglet Catalogue)`); return e; }
function appareilDe(ctx: ModCtx, x: unknown) { const a = depot(ctx).appareil(s(x)); if (!a || a.retire) throw new Error(`appareil « ${s(x)} » inconnu (regarde l'onglet Appareils)`); return a; }
const groupeValide = (x: unknown): string => { const g = s(x).toLowerCase().replace(/^groupe\s+/, ''); if (!/^@?[\w-]{1,30}$/.test(g)) throw new Error('groupe : lettres, chiffres, - et _ (ex. famille), ou @identifiant pour une personne'); return g; };

/** Les groupes connus : ceux de Persona, ceux qui ont un droit ou un mode, et ceux créés ici. */
export function groupesAgora(ctx: ModCtx): string[] {
  const pctx = personaDe(ctx), g = new Set<string>(['admin', ...((ctx.settings.groupes as string[] | undefined) ?? [])]);
  if (pctx) for (const p of personnes(pctx)) for (const x of p.groups) g.add(x);
  for (const e of depot(ctx).elements) for (const x of [...Object.keys(e.modes), ...(pctx ? groupesDe(pctx, e.droit) : [])]) if (!x.startsWith('@') && x !== '*') g.add(x);
  return [...g].sort((a, b) => (a === 'admin' ? -1 : b === 'admin' ? 1 : a.localeCompare(b)));
}

/** Asclépios regarde un installateur avant qu'il entre dans le store (lien Agora → Asclépios). */
export async function avisAsclepios(ctx: ModCtx, f: string, nom: string): Promise<{ bloque: boolean; texte: string }> {
  if (!ctx.modules().some((m) => m.id === 'ullr')) return { bloque: false, texte: 'pas analysé (Asclépios n\'est pas installé)' };
  const r = await ctx.call('ullr', 'fichier', { chemin: f }, `Agora fait analyser ${nom} avant de le mettre dans le store`, { interne: true }).catch((e) => ({ ok: false, text: (e as Error).message, data: undefined }));
  const v = r.data as Verdict | undefined;
  if (!v) return { bloque: false, texte: `pas analysé (${r.text.slice(0, 120)})` };
  const tout: Array<{ threat?: string; klass?: string }> = []; const walk = (x?: Verdict) => { if (!x) return; tout.push(...x.findings); for (const y of x.inside ?? []) walk(y); }; walk(v);
  const menaces = [...new Set(tout.map((x) => s(x.threat)).filter(Boolean))];
  if (tout.length && (v.level === 'critique' || v.level === 'haute' || tout.some((x) => x.klass === 'test'))) return { bloque: true, texte: `bloqué par Asclépios : ${menaces.join(', ') || 'menace connue'}` };
  return { bloque: false, texte: tout.length ? `douteux pour Asclépios : ${menaces.join(', ')}` : 'rien de connu (Asclépios)' };
}
const sha256Fichier = (f: string) => new Promise<string>((ok, ko) => { const h = createHash('sha256'); createReadStream(f).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', ko); });

/** Ajoute un installateur (fichier rangé sur Odin, ou lien) à un élément ; crée l'élément s'il n'existe pas. */
export async function ajouterAuStore(ctx: ModCtx, i: Record<string, unknown>, qui: string): Promise<{ e: Element; p?: Paquet; texte: string }> {
  const d = depot(ctx), now = ctx.now().getTime();
  const nomDonne = s(i.nom).slice(0, 60), web = s(i.appli_odin) ? appliOdin(ctx, s(i.appli_odin)) : undefined;
  if (s(i.appli_odin) && !web) throw new Error(`« ${s(i.appli_odin)} » n'est pas une appli d'Odin`);
  let fichier = s(i.fichier), lien = s(i.lien);
  if (fichier.startsWith('depot:')) fichier = join(ctx.dir, 'depots', basename(fichier.slice(6)));
  if (fichier.startsWith('~/')) fichier = join(process.env.HOME ?? '', fichier.slice(2));
  if (lien && !/^https:\/\/[^\s]+$/i.test(lien)) throw new Error('le lien doit commencer par https://');
  const nomFichier = basename(fichier || (lien ? new URL(lien).pathname : '')) || '';
  let p: Paquet | undefined;
  if (fichier || lien) {
    const format = (s(i.format) as keyof typeof FORMATS) || formatDe(nomFichier);
    if (!format || !FORMATS[format]) throw new Error(`format d'installateur inconnu pour « ${nomFichier || '?'} » : .AppImage, .deb, .exe, .msi, .dmg ou .apk`);
    const version = s(i.version) || /(\d+\.\d+(?:\.\d+)?)/.exec(nomFichier)?.[1] || '';
    if (!/^[\w.+-]{1,40}$/.test(version)) throw new Error('version ? (ex. 1.0.0)');
    let sha = s(i.empreinte).toLowerCase().replace(/^sha256:/, ''), tailleF = 0, local = '';
    if (sha && !/^[a-f0-9]{64}$/.test(sha)) throw new Error('empreinte SHA-256 : 64 caractères hexadécimaux');
    if (fichier) {
      if (!existsSync(fichier) || !statSync(fichier).isFile()) throw new Error(`fichier introuvable : ${basename(fichier)}`);
      local = fichier;
    } else {
      // Odin télécharge l'installateur une fois pour le faire analyser et calculer (ou vérifier) son empreinte.
      const tmp = join(ctx.dir, 'depots', `lien-${nouvelId()}`); mkdirSync(join(ctx.dir, 'depots'), { recursive: true });
      const r = await ctx.fetch(lien, { signal: AbortSignal.timeout(10 * 60_000), redirect: 'follow' });
      if (!r.ok || !r.body) throw new Error(`le lien répond ${r.status} : vérifie-le`);
      writeFileSync(tmp, Buffer.from(await r.arrayBuffer()), { mode: 0o600 }); local = tmp;
    }
    try {
      const vrai = await sha256Fichier(local); tailleF = statSync(local).size;
      if (sha && sha !== vrai) throw new Error(`l'empreinte donnée ne correspond pas au fichier (calculée : ${vrai}) : rien n'est ajouté`);
      sha = vrai;
      const avis = await avisAsclepios(ctx, local, nomFichier);
      if (avis.bloque) { ctx.alert({ level: 'haute', title: `Agora : installateur refusé (${nomFichier.slice(0, 60)})`, detail: `${avis.texte}. Il n'entre pas dans le store.`, key: `agora:bloque:${sha}` }); throw new Error(`${avis.texte} : il n'entre pas dans le store`); }
      p = { plateforme: FORMATS[format].plateforme, format, version, sha256: sha, taille: tailleF, nomFichier: nomFichier.replace(/[^\w.+-]/g, '_').slice(0, 120), ajoute: now, avis: avis.texte, ...(s(i.ident) ? { ident: s(i.ident).slice(0, 120) } : {}) };
      if (fichier) { const dest = join(d.fichiers, sha); if (!existsSync(dest)) copyFileSync(local, dest); p.fichier = sha; } else p.lien = lien;
    } finally { if (local.startsWith(join(ctx.dir, 'depots'))) rmSync(local, { force: true }); }
  }
  const id = s(i.element) ? elementDe(ctx, i.element).id : slug(nomDonne || web?.nom || nomFichier.replace(/[-_ ]?v?\d.*$/, '').replace(/\.\w+$/, ''));
  if (!id) throw new Error('donne un nom (ex. Bloc-notes)');
  let e = d.element(id);
  if (!e) {
    if (!p && !web) throw new Error('donne un installateur (fichier ou lien) ou une appli d\'Odin');
    const pctx = personaDe(ctx), cl = pctx ? clients(pctx).find((c) => c.id === id || slug(c.nom) === id) : undefined;
    e = { id, nom: nomDonne || web?.nom || id, desc: s(i.description).slice(0, 80), droit: web ? cleDroit(web.id) : cl ? cl.id : `agora-${id}`, ...(web ? { web: web.id } : {}), paquets: [], modes: {}, ajoute: now };
    d.elements.push(e);
  } else { if (web) e.web = web.id; if (s(i.description)) e.desc = s(i.description).slice(0, 80); }
  if (p) e.paquets = [...e.paquets.filter((x) => !(x.plateforme === p!.plateforme && x.format === p!.format)), p];
  d.sauverCatalogue();
  const texte = p ? `${e.nom} ${p.version} (${NOM_PF[p.plateforme]}, ${FORMATS[p.format].nom}, ${taille(p.taille)}) est dans le store. Empreinte ${p.sha256.slice(0, 12)}… ; ${p.avis}.` : `${e.nom} (Odin web) est dans le store.`;
  d.noter(now, qui, texte); reconcilier(ctx);
  return { e, ...(p ? { p } : {}), texte };
}

const P_ELEMENT: Param = { key: 'element', label: 'Élément du store', kind: 'text', required: true };
const P_GROUPE: Param = { key: 'groupe', label: 'Groupe (ex. famille) ou @identifiant', kind: 'text', required: true };
const P_APPAREIL: Param = { key: 'appareil', label: 'Appareil', kind: 'text', required: true };
const P_AJOUT: Param[] = [
  { key: 'nom', label: 'Nom (ex. Bloc-notes)', kind: 'text', default: '' },
  { key: 'description', label: 'En quelques mots (ex. Films et séries)', kind: 'text', default: '' },
  { key: 'fichier', label: 'Installateur (.AppImage, .deb, .exe, .msi, .dmg, .apk)', kind: 'text', default: '', depot: {}, help: 'Son chemin sur la machine d\'Odin, ou un fichier de cet appareil : il est rangé sur Odin.' },
  { key: 'lien', label: 'Ou son lien (https://…)', kind: 'text', default: '' },
  { key: 'version', label: 'Version (vide : lue dans le nom du fichier)', kind: 'text', default: '' },
  { key: 'empreinte', label: 'Empreinte SHA-256 (vide : calculée par Odin)', kind: 'text', default: '' },
  { key: 'ident', label: 'Pour désinstaller : nom du paquet, identifiant Android ou nom affiché sous Windows', kind: 'text', default: '' },
  { key: 'appli_odin', label: 'Ou une appli d\'Odin (web), ex. Chronos', kind: 'text', default: '' },
  { key: 'element', label: 'Ajouter à un élément existant (vide : nouvel élément)', kind: 'text', default: '' },
];
const P_MODE: Param[] = [P_ELEMENT, P_GROUPE, { key: 'mode', label: 'Mode', kind: 'select', options: CHOIX_MODE, default: 'Proposée' }];

/** Le store vu par une personne qui n'est pas admin (dans son espace Odin). */
function vueMembre(ctx: ModCtx): Section[] {
  const q = agissant(), pctx = personaDe(ctx), p = q && pctx ? personnes(pctx).find((x) => x.login === q.login) : undefined;
  if (!p) return [{ kind: 'text', title: 'Mon store', text: 'Connecte-toi avec ton compte Odin pour voir ton store.' }];
  const l = storeDe(ctx, p), d = depot(ctx), mes = d.appareils.filter((a) => a.sub === p.id && !a.retire);
  return [
    { kind: 'cards', title: 'Mon store', empty: 'Rien pour l\'instant : demande à un admin de t\'ajouter au bon groupe.', items: l.filter((x) => x.mode !== 'retiree').map((x) => {
      const e = d.element(x.id)!, pfs = [...new Set(e.paquets.map((k) => NOM_PF[k.plateforme]))];
      return { title: x.nom, sub: [x.desc, [...(e.web ? ['Odin (web)'] : []), ...pfs].join(' · ')].filter(Boolean).join(' — '), badge: x.mode === 'office' ? `Imposée${x.par ? ` par ${x.par}` : ''}` : `Proposée${x.par ? ` par ${x.par}` : ''}`, tone: x.mode === 'office' ? 'bon' as Tone : 'neutre' as Tone, meta: e.web ? 'Dans ton espace Odin (rubrique Applis).' : 'S\'installe par le store de ton ordinateur ou de ton téléphone.' };
    }) },
    { kind: 'table', title: 'Mes appareils', columns: ['Appareil', 'Système', 'Vu'], empty: 'Aucun : installe le store d\'Odin (Agora) sur ton ordinateur ou ton téléphone et connecte-toi avec ton compte Odin.', rows: mes.map((a) => ({ cells: [a.nom, `${NOM_PF[a.plateforme] ?? a.plateforme} ${a.systeme}`.trim(), d.enLigne.has(a.id) ? 'en ligne' : ilYa(a.vu, ctx.now().getTime())] })) },
  ];
}

let minuteries = new Map<string, ReturnType<typeof setInterval>>();
/** Ce qui, dans Persona, change le store des gens : les groupes des personnes, les comptes coupés, les droits. */
function signaturePersona(pctx: ModCtx | undefined): string {
  if (!pctx) return '';
  return JSON.stringify([personnes(pctx).map((p) => [p.id, p.groups, p.active]), pctx.settings.ssoDroits ?? null]);
}

export const agora: Module = {
  id: 'agora', name: 'Agora', family: 'Accès',
  what: 'Le store d\'Odin : qui a droit à quoi, sur Odin, ses ordinateurs et ses téléphones. Une personne mise dans un groupe reçoit les applis du groupe, proposées ou installées d\'office ; retirée du groupe, elles lui sont retirées.',
  does: [
    'catalogue : applis d\'Odin (web) et installateurs d\'ordinateur et de téléphone (Pégase, Asclépios poste, Vénus…), avec version, plateformes, fichier ou lien, empreinte SHA-256',
    'par groupe de Persona et par élément : Proposée, Installée d\'office ou Retirée ; le droit suit la connexion unique (rien en double)',
    'appareils inscrits par la connexion unique : propriétaire, système, en ligne, applis installées et leur état',
    'ordres imposés (installer, désinstaller, mettre à jour) envoyés à la seconde par le flux de chaque appareil, comptes rendus et progression',
    'forcer une installation ou une désinstallation sur un appareil précis (avec ton accord, noté au journal)',
    'installateurs analysés par Asclépios avant d\'entrer dans le store ; l\'appareil vérifie l\'empreinte avant d\'installer',
    'alertes dans Forseti : installation échouée, appareil inconnu, nouvel appareil',
  ],
  from: [], upstream: [],
  words: ['agora', 'store d odin', 'le store', 'mon store', 'magasin d applis'],
  depot: (ctx) => ({ dossier: join(ctx.dir, 'depots'), ref: (nom) => `depot:${nom}` }),
  actions: [
    { id: 'ajouter', label: 'Ajouter au store', what: 'Un installateur (fichier ou lien) ou une appli d\'Odin (web)', params: P_AJOUT, words: ['ajoute au store', 'ajouter au store', 'mets dans le store'], quick: false,
      run: admin(async (ctx, i) => ({ text: `🛒 ${(await ajouterAuStore(ctx, i, quiAgit(ctx))).texte}` })) },
    { id: 'retirer_element', label: 'Retirer du store', what: 'L\'élément quitte le catalogue (les appareils gardent ce qui est déjà installé)', params: [P_ELEMENT], quick: false,
      grave: (i) => `retirer « ${s(i.element)} » du store (ses ordres en cours sont annulés)`,
      run: admin((ctx, i) => {
        const d = depot(ctx), e = elementDe(ctx, i.element), now = ctx.now().getTime(), pctx = personaDe(ctx);
        for (const o of d.ordres) if (o.element === e.id && OUVERT.includes(o.etat)) { o.etat = 'annule'; o.maj = now; d.bus.emit('annule', o.appareil, o.id); }
        if (pctx && e.droit.startsWith('agora-')) for (const g of groupesDe(pctx, e.droit)) if (g !== 'admin') changerDroit(pctx, e.droit, g, false);
        d.elements = d.elements.filter((x) => x.id !== e.id); d.sauverCatalogue(); d.sauverOrdres();
        for (const k of e.paquets) if (k.fichier && !d.elements.some((x) => x.paquets.some((y) => y.fichier === k.fichier))) rmSync(join(d.fichiers, k.fichier), { force: true });
        d.noter(now, quiAgit(ctx), `${e.nom} retiré du store`, true); reconcilier(ctx);
        return { text: `🗑 ${e.nom} n'est plus dans le store. Ce qui est déjà installé reste sur les appareils.` };
      }) },
    { id: 'definir_mode', label: 'Choisir le mode d\'un groupe', what: 'Proposée, Installée d\'office, Retirée ou Pas pour ce groupe ; le droit de la connexion unique suit', params: P_MODE, words: ['installe d office', 'installée d office', 'propose à la famille', 'retire du groupe'],
      run: admin(async (ctx, i) => {
        await reveillerPersona(ctx);
        const e = elementDe(ctx, i.element), g = groupeValide(i.groupe), m = LIBELLES[s(i.mode)] ?? (['proposee', 'office', 'retiree', 'aucun'].includes(s(i.mode)) ? s(i.mode) as Mode | 'aucun' : undefined);
        if (!m) return { ok: false, text: `Mode inconnu : choisis ${CHOIX_MODE.join(', ')}.` };
        changerMode(ctx, e, g, m, quiAgit(ctx));
        return { text: `✅ ${e.nom} · ${g.startsWith('@') ? g.slice(1) : `groupe ${g}`} : ${m === 'aucun' ? 'pas pour ce groupe' : MODES[m].toLowerCase()}. ${m === 'office' ? 'Les appareils en ligne l\'installent tout de suite.' : m === 'retiree' ? 'Il est désinstallé des appareils et disparaît de l\'espace Odin.' : m === 'proposee' ? 'Il apparaît dans leur store et leur espace Odin.' : ''}`.trim() };
      }),
      undo: (i) => ({ action: 'definir_mode', input: { ...i, mode: 'Pas pour ce groupe' }, label: 'Enlever ce mode' }) },
    { id: 'modes_groupe', label: 'Store du groupe', what: 'Le mode de chaque élément pour un groupe (formulaire de l\'onglet Groupes)', quick: false, params: [P_GROUPE],
      run: admin(async (ctx, i) => {
        await reveillerPersona(ctx);
        const g = groupeValide(i.groupe), qui = quiAgit(ctx); let n = 0;
        for (const e of depot(ctx).elements) {
          if (!(e.id in i)) continue; const m = LIBELLES[s(i[e.id])]; if (!m) continue;
          const cur = e.modes[g]?.mode ?? 'aucun'; if (cur === m) continue;
          changerMode(ctx, e, g, m, qui); n++;
        }
        return { text: n ? `✅ Groupe ${g} : ${n} changement(s) enregistré(s) ; les appareils en ligne les reçoivent tout de suite.` : 'Rien n\'a changé.' };
      }) },
    { id: 'ajouter_personne', label: 'Mettre quelqu\'un dans un groupe', what: 'Ses applis apparaissent dans son espace Odin et dans le store de ses appareils (par Persona)', params: [{ key: 'login', label: 'Personne (identifiant)', kind: 'text', required: true }, P_GROUPE], quick: false,
      run: admin(async (ctx, i) => {
        const pctx = await reveillerPersona(ctx), g = groupeValide(i.groupe).replace(/^@/, ''), p = pctx ? personnes(pctx).find((x) => x.login === s(i.login).toLowerCase() || x.name.toLowerCase() === s(i.login).toLowerCase()) : undefined;
        if (!p) return { ok: false, text: `Personne « ${s(i.login)} » inconnue dans Persona : ajoute-la d'abord dans Persona.` };
        if (p.groups.includes(g)) return { text: `${p.name} est déjà dans le groupe ${g}.` };
        const r = await ctx.call('var', 'modifier', { login: p.login, groupes: [...p.groups, g].join(', ') }, `Agora met ${p.name} dans le groupe ${g}`, { interne: true });
        if (r.ok === false) return { ok: false, text: r.text };
        depot(ctx).noter(ctx.now().getTime(), quiAgit(ctx), `${p.name} ajouté(e) au groupe ${g}`); reconcilier(ctx);
        return { text: `👥 ${p.name} est dans le groupe ${g} : son store et son espace Odin sont à jour.` };
      }),
      undo: (i) => ({ action: 'enlever_personne', input: i, label: 'L\'enlever du groupe' }) },
    { id: 'enlever_personne', label: 'Enlever quelqu\'un d\'un groupe', what: 'Les applis du groupe lui sont retirées (désinstallées de ses appareils)', params: [{ key: 'login', label: 'Personne (identifiant)', kind: 'text', required: true }, P_GROUPE], quick: false,
      run: admin(async (ctx, i) => {
        const pctx = await reveillerPersona(ctx), g = groupeValide(i.groupe).replace(/^@/, ''), p = pctx ? personnes(pctx).find((x) => x.login === s(i.login).toLowerCase()) : undefined;
        if (!p) return { ok: false, text: `Personne « ${s(i.login)} » inconnue.` };
        if (!p.groups.includes(g)) return { text: `${p.name} n'est pas dans le groupe ${g}.` };
        const reste = p.groups.filter((x) => x !== g);
        const r = await ctx.call('var', 'modifier', { login: p.login, groupes: (reste.length ? reste : ['invite']).join(', ') }, `Agora enlève ${p.name} du groupe ${g}`, { interne: true });
        if (r.ok === false) return { ok: false, text: r.text };
        depot(ctx).noter(ctx.now().getTime(), quiAgit(ctx), `${p.name} enlevé(e) du groupe ${g}`); reconcilier(ctx);
        return { text: `👥 ${p.name} n'est plus dans le groupe ${g}${reste.length ? '' : ' (il reste dans le groupe invite)'} : ce que le groupe lui donnait lui est retiré.` };
      }) },
    { id: 'nouveau_groupe', label: 'Nouveau groupe', what: 'Un groupe de plus (on y met ensuite des personnes et des applis)', params: [{ key: 'groupe', label: 'Nom du groupe (ex. equipe)', kind: 'text', required: true }], quick: false,
      run: admin((ctx, i) => { const g = groupeValide(i.groupe).replace(/^@/, ''); ctx.saveSettings({ groupes: [...new Set([...((ctx.settings.groupes as string[] | undefined) ?? []), g])] }); return { text: `👥 Groupe ${g} créé : choisis ses applis dans l'onglet Groupes.` }; }) },
    { id: 'forcer', label: 'Forcer sur un appareil', what: 'Installer ou désinstaller un élément sur UN appareil, sans rien demander à la personne', params: [P_APPAREIL, P_ELEMENT, { key: 'sens', label: 'Quoi', kind: 'select', options: ['installer', 'desinstaller'], default: 'installer' }], quick: false,
      grave: (i, ctx) => { let nom = s(i.appareil); try { if (ctx) nom = depot(ctx).appareil(s(i.appareil))?.nom ?? nom; } catch { /* nom tel quel */ } return `${s(i.sens) === 'desinstaller' ? 'désinstaller' : 'installer'} « ${s(i.element)} » sur l'appareil « ${nom} » sans demander à la personne`; },
      run: admin((ctx, i) => {
        const d = depot(ctx), a = appareilDe(ctx, i.appareil), e = elementDe(ctx, i.element), sens = s(i.sens) === 'desinstaller' ? 'absente' : 'installee', now = ctx.now().getTime();
        if (sens === 'installee' && !paquetPour(e, a.plateforme)) return { ok: false, text: `${e.nom} n'a pas d'installateur pour ${NOM_PF[a.plateforme] ?? a.plateforme} : ajoute-le d'abord dans le catalogue.` };
        a.forces[e.id] = sens; d.sauverAppareils();
        d.noter(now, quiAgit(ctx), `FORCÉ : ${sens === 'installee' ? 'installation' : 'désinstallation'} de ${e.nom} sur ${a.nom} (${a.nomPersonne})`, true);
        const n = reconcilier(ctx);
        return { text: `⚠ ${sens === 'installee' ? 'Installation' : 'Désinstallation'} de ${e.nom} imposée sur ${a.nom}. ${d.enLigne.has(a.id) ? 'L\'appareil est en ligne : l\'ordre part maintenant.' : 'L\'appareil est hors ligne : l\'ordre partira à sa prochaine connexion.'}${n ? '' : ' (Rien à faire : c\'est déjà le cas.)'}` };
      }),
      undo: (i) => ({ action: 'annuler_force', input: { appareil: i.appareil, element: i.element }, label: 'Annuler le forçage' }) },
    { id: 'annuler_force', label: 'Annuler', what: 'L\'appareil revient au mode du groupe (l\'ordre en attente est annulé)', params: [P_APPAREIL, P_ELEMENT], quick: false,
      run: admin((ctx, i) => {
        const d = depot(ctx), a = appareilDe(ctx, i.appareil), e = elementDe(ctx, i.element), now = ctx.now().getTime();
        delete a.forces[e.id]; d.sauverAppareils();
        const o = d.ouvert(a.id, e.id); if (o) { o.etat = 'annule'; o.maj = now; d.bus.emit('annule', a.id, o.id); d.sauverOrdres(); }
        d.noter(now, quiAgit(ctx), `Forçage annulé : ${e.nom} sur ${a.nom}`); reconcilier(ctx);
        return { text: `↩ ${e.nom} sur ${a.nom} suit de nouveau le mode de son groupe.` };
      }) },
    { id: 'reessayer', label: 'Réessayer', what: 'Relance une installation qui a échoué sur un appareil', params: [P_APPAREIL, P_ELEMENT], quick: false,
      run: admin((ctx, i) => {
        const d = depot(ctx), a = appareilDe(ctx, i.appareil), e = elementDe(ctx, i.element);
        for (const o of d.ordres) if (o.appareil === a.id && o.element === e.id && o.etat === 'echec') o.maj = 0;
        d.sauverOrdres(); const n = reconcilier(ctx);
        return { text: n ? `🔁 ${e.nom} : nouvel essai envoyé à ${a.nom}.` : `${e.nom} : rien à relancer sur ${a.nom}.` };
      }) },
    { id: 'retirer_appareil', label: 'Retirer un appareil', what: 'Il n\'est plus suivi par le store (ses ordres sont annulés) ; il pourra se réinscrire avec un compte autorisé', params: [P_APPAREIL], quick: false,
      run: admin((ctx, i) => {
        const d = depot(ctx), a = appareilDe(ctx, i.appareil), now = ctx.now().getTime();
        a.retire = now; for (const o of d.ordres) if (o.appareil === a.id && OUVERT.includes(o.etat)) { o.etat = 'annule'; o.maj = now; }
        d.sauverAppareils(); d.sauverOrdres(); d.bus.emit('retire', a.id); d.noter(now, quiAgit(ctx), `Appareil retiré : ${a.nom} (${a.nomPersonne})`);
        return { text: `🗑 ${a.nom} n'est plus suivi par le store.` };
      }) },
    { id: 'importer_pegase', label: 'Reprendre les installateurs de Pégase', what: 'Les dernières versions de Pégase publiées (Windows, Mac, Linux, Android) entrent dans le store, empreinte calculée et analysée', quick: false, words: ['installateurs de pegase dans le store'],
      run: admin(async (ctx) => {
        if (!ctx.modules().some((m) => m.id === 'pegase')) return { ok: false, text: 'L\'appli Pégase n\'est pas dans cet Odin.' };
        const r = await ctx.call('pegase', 'installateurs', {}, 'Agora cherche les installateurs de Pégase', { interne: true });
        const l = (r.data as Array<{ nom: string; url: string; version: string }> | undefined) ?? [];
        if (r.ok === false) return { ok: false, text: r.text };
        const e = depot(ctx).element('pegase'), faits: string[] = [], rates: string[] = [];
        for (const x of l) {
          const v = s(x.version).replace(/^v/i, '');
          if (e?.paquets.some((k) => k.lien === x.url && k.version === v)) continue;
          try { const a = await ajouterAuStore(ctx, { element: e ? 'pegase' : '', nom: 'Pégase', description: 'Le navigateur', lien: x.url, version: v }, 'Agora (Pégase)'); faits.push(`${x.nom} (${a.p?.version})`); } catch (err) { rates.push(`${x.nom} : ${(err as Error).message}`); }
        }
        ctx.saveSettings({ pegaseVu: ctx.now().getTime() });
        return { ok: !rates.length, text: `${faits.length ? `🛒 Dans le store : ${faits.join(', ')}.` : 'Rien de nouveau chez Pégase.'}${rates.length ? `\n⚠ Pas pu : ${rates.join(' ; ')}` : ''}` };
      }) },
    { id: 'mon_store', label: 'Mon store', what: 'Ce qui m\'est proposé ou imposé', read: true, words: ['mon store', 'mes applis du store'],
      run: async (ctx) => {
        const pctx = await reveillerPersona(ctx), q = agissant(), p = pctx ? (q ? personnes(pctx).find((x) => x.login === q.login) : personnes(pctx).find((x) => x.proprio)) : undefined;
        if (!p) return { ok: false, text: 'Persona ne te connaît pas encore.' };
        const l = storeDe(ctx, p).filter((x) => x.mode !== 'retiree');
        return { text: l.length ? l.map((x) => `- ${x.nom} : ${x.mode === 'office' ? 'installée d\'office' : 'proposée'}`).join('\n') : 'Ton store est vide.', data: l };
      } },
    { id: 'catalogue', label: 'Le catalogue du store', what: 'Les éléments, leurs plateformes et qui y a droit', read: true, words: ['catalogue du store', 'qu y a t il dans le store'],
      run: admin(async (ctx) => {
        const pctx = await reveillerPersona(ctx), d = depot(ctx);
        return { text: d.elements.map((e) => `- ${e.nom} (${[...(e.web ? ['Odin web'] : []), ...e.paquets.map((p) => `${NOM_PF[p.plateforme]} ${p.version}`)].join(', ')}) : ${groupesElement(pctx, e).join(', ')}`).join('\n') || 'Le store est vide.', data: d.elements.map((e) => ({ id: e.id, nom: e.nom, groupes: groupesElement(pctx, e) })) };
      }) },
    { id: 'appareils', label: 'Les appareils du store', what: 'Ordinateurs et téléphones inscrits, en ligne ou non', read: true, words: ['appareils du store', 'appareils inscrits au store'],
      run: admin((ctx) => { const d = depot(ctx), now = ctx.now().getTime(); return { text: d.appareils.filter((a) => !a.retire).map((a) => `- ${a.nom} (${a.nomPersonne}, ${NOM_PF[a.plateforme] ?? a.plateforme}) : ${d.enLigne.has(a.id) ? 'en ligne' : `vu ${ilYa(a.vu, now)}`}`).join('\n') || 'Aucun appareil inscrit.' }; }) },
    { id: 'journal', label: 'Journal du store', what: 'Qui a changé quoi, les ordres et les comptes rendus', read: true, words: ['journal du store', 'historique du store'],
      run: admin((ctx) => ({ text: depot(ctx).journal.slice(-30).reverse().map((l) => `${quand(l.t)} · ${l.qui} · ${l.quoi}`).join('\n') || 'Rien pour l\'instant.' })) },
  ],
  async view(ctx) {
    await reveillerPersona(ctx);
    if (!estAdmin()) return { subtitle: 'Ton store : ce qu\'Odin te propose ou installe pour toi.', sections: vueMembre(ctx) };
    const d = depot(ctx), pctx = personaDe(ctx), now = ctx.now().getTime(), ps = pctx ? personnes(pctx) : [], gs = groupesAgora(ctx);
    const actifs = d.appareils.filter((a) => !a.retire), enLigne = actifs.filter((a) => d.enLigne.has(a.id)).length;
    const ouverts = d.ordres.filter((o) => OUVERT.includes(o.etat)), rates = d.ordres.filter((o) => o.etat === 'echec' && now - o.maj < 86_400_000);
    const ou = (e: Element) => [...(e.web ? ['Odin (web)'] : []), ...[...new Set(e.paquets.map((p) => NOM_PF[p.plateforme]))]].join(' · ') || '—';
    const modeResume = (e: Element) => { const l = [...new Set(Object.values(e.modes).map((m) => m.mode))]; return l.length === 1 ? MODES[l[0]] : l.length ? 'selon le groupe' : 'Proposée'; };
    const surApp = (e: Element) => { const cibles = actifs.filter((a) => paquetPour(e, a.plateforme)), n = cibles.filter((a) => a.applis[e.id]?.etat === 'installee').length; return cibles.length ? `${n} / ${cibles.length}` : e.web ? 'web' : '—'; };
    const nomEl = (id: string) => d.element(id)?.nom ?? id, nomAp = (id: string) => d.appareil(id)?.nom ?? id;
    const sections: Section[] = [];
    // ---- Catalogue
    sections.push({ kind: 'table', onglet: T.C, title: 'Dans le store', columns: ['Dans le store', 'Où', 'Groupes qui y ont droit', 'Mode', 'Sur les appareils', 'Version'], empty: 'Le store est vide : « Ajouter au store » ci-dessous.',
      rows: d.elements.map((e) => ({ cells: [`${e.nom}${e.desc ? ` · ${e.desc}` : ''}`, ou(e), groupesElement(pctx, e).join(' ') || 'admin', modeResume(e), surApp(e), [...new Set(e.paquets.map((p) => p.version))].join(', ') || '—'], tone: Object.values(e.modes).some((m) => m.mode === 'retiree') ? 'attention' as Tone : undefined,
        actions: [{ action: 'retirer_element', label: 'Retirer du store', input: { element: e.id } }] })) });
    sections.push({ kind: 'form', onglet: T.C, title: 'Ajouter au store', action: 'ajouter', submit: 'Ajouter au store', params: P_AJOUT, aide: 'Odin calcule l\'empreinte SHA-256 et fait analyser l\'installateur par Asclépios ; chaque appareil revérifie l\'empreinte avant d\'installer.' });
    sections.push({ kind: 'form', onglet: T.C, title: 'Qui y a droit', action: 'definir_mode', submit: 'Enregistrer', params: [{ ...P_ELEMENT, kind: 'select', options: d.elements.map((e) => e.id), default: d.elements[0]?.id ?? '' }, { ...P_GROUPE, kind: 'select', options: gs, default: gs.find((g) => g !== 'admin') ?? 'admin' }, P_MODE[2]] });
    sections.push({ kind: 'list', onglet: T.C, title: 'Les modes', items: [
      { title: 'Proposée', detail: 'Visible dans le store de la personne ; elle l\'installe si elle veut.' },
      { title: 'Installée d\'office', detail: 'Le store l\'installe tout seul ; la personne ne peut pas l\'enlever.', tone: 'bon' },
      { title: 'Retirée', detail: 'Le store la désinstalle ; elle disparaît aussi de l\'espace Odin.', tone: 'attention' }] });
    // ---- Groupes
    for (const g of gs) {
      const membres = ps.filter((p) => p.groups.includes(g) || (g === 'admin' && p.proprio));
      sections.push({ kind: 'form', onglet: T.G, title: `Groupe ${g} · ${membres.length} personne(s)`, action: 'modes_groupe', submit: 'Enregistrer', fixe: { groupe: g },
        aide: `${membres.map((p) => p.name).join(', ') || 'Personne pour l\'instant.'}${g === 'admin' ? ' Les admins ont droit à tout ; le mode dit seulement ce qui s\'installe d\'office.' : ''}`,
        params: d.elements.map((e) => ({ key: e.id, label: `${e.nom} · ${ou(e)}`, kind: 'select' as const, options: CHOIX_MODE, default: e.modes[g] ? Object.keys(LIBELLES).find((k) => LIBELLES[k] === e.modes[g].mode) : (pctx && groupesDe(pctx, e.droit).includes(g)) || g === 'admin' ? 'Proposée' : 'Pas pour ce groupe' })) });
    }
    sections.push({ kind: 'text', onglet: T.G, title: 'Comment ça marche', text: 'Mettre quelqu\'un dans un groupe : ces applis apparaissent tout de suite dans son espace Odin, et dans le store de ses ordinateurs et téléphones. L\'enlever du groupe les lui retire.' });
    sections.push({ kind: 'form', onglet: T.G, title: 'Mettre quelqu\'un dans un groupe', action: 'ajouter_personne', submit: 'Ajouter', params: [{ key: 'login', label: 'Personne', kind: 'select', options: ps.map((p) => p.login), default: ps.find((p) => !p.proprio)?.login ?? '' }, { ...P_GROUPE, kind: 'select', options: gs.filter((g) => g !== 'admin').concat('admin'), default: gs.find((g) => g !== 'admin') ?? 'famille' }] });
    sections.push({ kind: 'form', onglet: T.G, title: 'Enlever quelqu\'un d\'un groupe', action: 'enlever_personne', submit: 'Enlever', params: [{ key: 'login', label: 'Personne', kind: 'select', options: ps.map((p) => p.login), default: ps.find((p) => !p.proprio)?.login ?? '' }, { ...P_GROUPE, kind: 'select', options: gs, default: gs.find((g) => g !== 'admin') ?? 'famille' }] });
    sections.push({ kind: 'form', onglet: T.G, title: 'Nouveau groupe', action: 'nouveau_groupe', submit: 'Créer', params: [{ key: 'groupe', label: 'Nom du groupe', kind: 'text', required: true }] });
    // ---- Appareils
    sections.push({ kind: 'table', onglet: T.A, title: 'Appareils', columns: ['Appareil', 'Personne', 'Système', 'État', 'Store'], empty: 'Aucun appareil : installe le store d\'Odin (Agora) sur un ordinateur ou un téléphone et connecte-toi avec un compte Odin.',
      rows: actifs.map((a) => ({ cells: [a.nom, a.nomPersonne, `${NOM_PF[a.plateforme] ?? a.plateforme} ${a.systeme}`.trim(), d.enLigne.has(a.id) ? 'En ligne' : a.plateforme === 'ios' ? 'Web seulement' : `Hors ligne · ${ilYa(a.vu, now)}`, `${a.version ? `Agora ${a.version}` : '—'}${a.gere ? ' · géré par Odin' : ''}`], tone: d.enLigne.has(a.id) ? 'bon' as Tone : 'neutre' as Tone,
        actions: [{ action: 'retirer_appareil', label: 'Retirer', input: { appareil: a.id } }] })) });
    const lignes: Array<{ cells: string[]; tone?: Tone; actions?: Array<{ action: string; label: string; input: Record<string, unknown> }> }> = [];
    for (const a of actifs) for (const e of d.elements) {
      const cur = a.applis[e.id], o = d.ouvert(a.id, e.id), f = a.forces[e.id];
      if (!cur && !o && !f) continue;
      const etat = o ? `${o.action === 'desinstaller' ? 'Désinstallation' : 'Installation'} imposée${o.etat === 'attente' ? (d.enLigne.has(a.id) ? '…' : ' : au prochain démarrage') : o.progression !== undefined ? `… ${o.progression} %` : '…'}`
        : cur?.etat === 'installee' ? `Installée · ${cur.version ?? '?'}${cur.par === 'personne' ? ` · par ${a.nomPersonne}` : ''}` : cur?.etat === 'erreur' ? `Échec : ${cur.erreur ?? '?'}` : cur?.etat === 'absente' ? 'Pas installée' : cur?.etat ?? '—';
      const acts = o || f ? [{ action: 'annuler_force', label: 'Annuler', input: { appareil: a.id, element: e.id } }] : cur?.etat === 'installee' ? [{ action: 'forcer', label: 'Forcer la désinstallation', input: { appareil: a.id, element: e.id, sens: 'desinstaller' } }] : cur?.etat === 'erreur' ? [{ action: 'reessayer', label: 'Réessayer', input: { appareil: a.id, element: e.id } }] : [];
      lignes.push({ cells: [a.nom, e.nom, etat, f ? `forcé (${f === 'installee' ? 'installer' : 'désinstaller'})` : modePour(pctx!, e, ps.find((p) => p.id === a.sub) ?? ({ groups: [], login: '', active: false } as unknown as Personne)) ? 'mode du groupe' : '—'], tone: cur?.etat === 'erreur' ? 'mauvais' : o ? 'attention' : undefined, actions: acts });
    }
    sections.push({ kind: 'table', onglet: T.A, title: 'Store sur les appareils', columns: ['Appareil', 'Élément', 'État', 'Pourquoi'], empty: 'Rien d\'installé par le store pour l\'instant.', rows: lignes });
    sections.push({ kind: 'form', onglet: T.A, title: 'Forcer une installation', action: 'forcer', submit: 'Forcer', params: [{ ...P_APPAREIL, kind: 'select', options: actifs.map((a) => a.id), default: actifs[0]?.id ?? '' }, { ...P_ELEMENT, kind: 'select', options: d.elements.map((e) => e.id), default: d.elements[0]?.id ?? '' }, { key: 'sens', label: 'Quoi', kind: 'select', options: ['installer', 'desinstaller'], default: 'installer' }], aide: `Appareils : ${actifs.map((a) => `${a.id} = ${a.nom}`).join(', ') || 'aucun'}.` });
    sections.push({ kind: 'text', onglet: T.A, title: 'Ce qui est possible selon l\'appareil', text: 'Ordinateurs (Windows, Mac, Linux) : installation et désinstallation imposées faites par le store d\'Odin, sans rien demander. Android : le store prépare l\'installation, la personne la confirme d\'un toucher (sans toucher seulement si le téléphone est déclaré « géré » par Odin). iPhone : Apple ne permet pas d\'installer sans l\'App Store ou un serveur de gestion d\'Apple ; les applis d\'Odin y passent par le web. Chaque action imposée te demande ton accord et est notée dans le Journal.' });
    // ---- Journal
    sections.push({ kind: 'log', onglet: T.J, title: 'Journal du store', lines: d.journal.slice(-200).reverse().map((l) => `${quand(l.t)} · ${l.grave ? '⚠ ' : ''}${l.qui} · ${l.quoi}`) });
    sections.push({ kind: 'table', onglet: T.J, title: 'Ordres', columns: ['Quand', 'Appareil', 'Élément', 'Ordre', 'État'], empty: 'Aucun ordre.',
      rows: d.ordres.slice(-60).reverse().map((o) => ({ cells: [quand(o.cree), nomAp(o.appareil), nomEl(o.element), `${ACTIONS[o.action]}${o.version ? ` ${o.version}` : ''}${o.par === 'force' ? ' (forcé)' : ''}`, { attente: 'en attente', envoye: 'envoyé', en_cours: `en cours${o.progression !== undefined ? ` ${o.progression} %` : ''}`, fait: 'fait', echec: `échec : ${o.erreur ?? '?'}`, annule: 'annulé' }[o.etat]], tone: o.etat === 'echec' ? 'mauvais' as Tone : o.etat === 'fait' ? 'bon' as Tone : undefined })) });
    return {
      subtitle: 'Le store d\'Odin : qui a droit à quoi, sur Odin, ses ordinateurs et ses téléphones. Réservé aux admins.',
      onglets: [T.C, T.G, T.A, T.J],
      kpis: [
        { label: 'Dans le store', value: String(d.elements.length) },
        { label: 'Appareils', value: `${enLigne} / ${actifs.length}`, hint: 'en ligne / inscrits' },
        { label: 'Ordres en cours', value: String(ouverts.length), tone: ouverts.length ? 'attention' : 'bon' },
        { label: 'Échecs (24 h)', value: String(rates.length), tone: rates.length ? 'mauvais' : 'bon' },
      ],
      sections, refreshMs: ouverts.length ? 3000 : undefined,
    };
  },
  start(ctx) {
    const d = depot(ctx);
    // Premier démarrage : Pégase et Vénus (applis clientes préinscrites de la connexion unique) sont dans le catalogue.
    if (!d.elements.length && !ctx.settings.amorce) {
      const now = ctx.now().getTime();
      d.elements.push({ id: 'pegase', nom: 'Pégase', desc: 'Le navigateur', droit: 'pegase', paquets: [], modes: {}, ajoute: now }, { id: 'venus', nom: 'Vénus', desc: 'Films et séries', droit: 'venus', web: 'freyja', paquets: [], modes: {}, ajoute: now });
      if (!ctx.modules().some((m) => m.id === 'freyja')) delete d.elements[1].web;
      d.sauverCatalogue(); ctx.saveSettings({ amorce: true });
    }
    // Les changements de groupes faits dans Persona arrivent aux appareils en moins d'une seconde.
    let sig = '';
    const t = setInterval(() => { try { const n = signaturePersona(personaDe(ctx)); if (n !== sig) { sig = n; reconcilier(ctx); } } catch (e) { console.error(`[agora] ${(e as Error).message}`); } }, 500);
    (t as { unref?: () => void }).unref?.(); minuteries.get(ctx.dir) && clearInterval(minuteries.get(ctx.dir)!); minuteries.set(ctx.dir, t);
  },
  stop() { for (const [dir, t] of minuteries) { clearInterval(t); oublier(dir); } minuteries = new Map(); },
  watch: { every: 60, run(ctx) {
    // Un ordre envoyé à un appareil hors ligne depuis plus d'une journée : tu le sais (rien n'est perdu, il attend).
    const d = depot(ctx), now = ctx.now().getTime();
    for (const o of d.ordres) if (OUVERT.includes(o.etat) && now - o.cree > 86_400_000 && !d.enLigne.has(o.appareil)) ctx.alert({ level: 'info', title: `Agora : ${d.appareil(o.appareil)?.nom ?? o.appareil} n'a pas reçu un ordre depuis un jour`, detail: `${ACTIONS[o.action]} ${d.element(o.element)?.nom ?? o.element} attend que l'appareil se connecte.`, key: `agora:attente:${o.id}` });
    reconcilier(ctx);
    // Une fois par jour : les nouvelles versions de Pégase entrent dans le store (lien Agora → Pégase).
    if (ctx.modules().some((m) => m.id === 'pegase') && now - Number(ctx.settings.pegaseVu ?? 0) > 86_400_000) { ctx.saveSettings({ pegaseVu: now }); void ctx.call('agora', 'importer_pegase', {}, 'nouvelles versions de Pégase', { interne: true }).catch(() => undefined); }
  } },
};

// Pour les essais et l'API : quelques outils.
export { PLATEFORMES, type Plateforme };
/** Le fichier d'un installateur rangé sur Odin (ou undefined). */
export const cheminFichier = (ctx: ModCtx, p: Paquet): string | undefined => (p.fichier && /^[a-f0-9]{64}$/.test(p.fichier) && existsSync(join(depot(ctx).fichiers, p.fichier)) ? join(depot(ctx).fichiers, p.fichier) : undefined);
/** Le nom d'une appli (cliente ou d'Odin) pour les textes. */
export const nomDroit = (ctx: ModCtx, id: string) => nomAppli(personaDe(ctx), id);
