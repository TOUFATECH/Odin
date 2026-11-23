// Amphore — la sauvegarde de tes bases de données, comme Portabase : PostgreSQL, MySQL / MariaDB,
// MongoDB ; plans (chaque heure, toutes les 6 h, chaque nuit, chaque semaine), durée de garde (jours,
// semaines, mois), chaque sauvegarde relue pour être sûre, historique, restauration avec ton accord
// (dans une nouvelle base à côté, conseillé, ou par-dessus après une sauvegarde de l'état actuel).
// Les bases viennent d'Alexandrie ; les archives restent sur la machine d'Odin (dossier protégé) et, si un 2e site est
// réglé (disque, partage réseau ou serveur SFTP), chacune y est copiée puis relue (empreinte SHA-256 comparée).
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bases, findBase, password, saveBases, setPassword, type Base } from '../urdr/bases.ts';
import { dump, extOf, keep, restore, verify, type Tools } from '../skuld/dump.ts';
import { engine } from './naglfar.ts';
import type { ModCtx, Module, RythmeAppli, Section, TacheAppli } from '../types.ts';
import { tacheEnPause } from '../automatismes.ts';
import { fuseauOdin, murale } from '../../draupnir/rythme.ts';
import { Journal, fichierJsonl } from '../base/journal.ts';
import { decrire, essayer, lireDestination, sha256Fichier, transportDe, type Destination } from '../sindri/transport.ts';

const s = (v: unknown) => String(v ?? '').trim();
export type Every = 'heure' | '6h' | 'nuit' | 'semaine';
export interface Plan { base: string; toutes: Every; heure: number; garde: { jours: number; semaines: number; mois: number }; actif: boolean }
export interface Entry { at: string; base: string; ok: boolean; fichier?: string; taille?: number; verif?: string; erreur?: string; raison?: string; ms: number; /** copie au 2e site : où, vérifiée */ copie?: string; /** la copie au 2e site a échoué (la sauvegarde, elle, est bonne) */ copieErreur?: string }

const DEFAULT_TOOLS = (ctx: ModCtx): Tools => ({ inContainer: (ct, argv) => engine().execArgs(ct, argv), has: (c) => ctx.has(c) });
let tools: (ctx: ModCtx) => Tools = DEFAULT_TOOLS;
export function useTools(f?: (ctx: ModCtx) => Tools) { tools = f ?? DEFAULT_TOOLS; }

const plans = (ctx: ModCtx): Plan[] => (ctx.settings.plans as Plan[] | undefined) ?? [];
const archDir = (ctx: ModCtx, b: Base) => join(ctx.dir, 'archives', b.id);
const histFile = (ctx: ModCtx) => join(ctx.dir, 'historique.jsonl');
// L'historique des sauvegardes : dans la base d'Odin dès qu'elle est prête (journal « arche »), sinon historique.jsonl.
const journaux = new WeakMap<ModCtx, Journal<Entry>>();
const hist = (ctx: ModCtx) => { let j = journaux.get(ctx); if (!j) { mkdirSync(ctx.dir, { recursive: true, mode: 0o700 }); j = new Journal<Entry>('arche', ctx.dir, { garder: 2000, rangement: fichierJsonl(histFile(ctx)) }); journaux.set(ctx, j); } return j; };
export function history(ctx: ModCtx, n = 200): Entry[] { return hist(ctx).tout().slice(-n).reverse(); }
function record(ctx: ModCtx, e: Entry) { hist(ctx).ajouter(e); }
const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const archives = (ctx: ModCtx, b: Base) => { const d = archDir(ctx, b); try { return readdirSync(d).filter((f) => !f.endsWith('.tmp')).sort().reverse().map((f) => ({ f, path: join(d, f), at: f.slice(0, 19).replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})$/, '$1:$2:$3') + 'Z', size: statSync(join(d, f)).size })); } catch { return []; } };
const mo = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} Go` : n > 1e6 ? `${(n / 1e6).toFixed(0)} Mo` : `${Math.max(1, Math.round(n / 1e3))} ko`);
const when = (e: Every, h: number) => ({ heure: 'chaque heure', '6h': 'toutes les 6 h', nuit: `chaque nuit à ${h} h`, semaine: `chaque dimanche à ${h} h` })[e];

/** La sauvegarde est-elle due ? (plan, dernière réussie, maintenant) */
export function due(p: Plan, last: Date | undefined, now: Date): boolean {
  if (!p.actif) return false; if (!last) return true;
  const age = now.getTime() - last.getTime(), h = 3600_000;
  if (p.toutes === 'heure') return age >= h - 60_000;
  if (p.toutes === '6h') return age >= 6 * h - 60_000;
  // L'heure murale du lieu d'Odin (celle que Talos écrit), pas celle de la machine.
  const w = murale(now.getTime(), fuseauOdin()), atHour = w.h === p.heure;
  if (p.toutes === 'nuit') return age >= 20 * h && atHour;
  return age >= 6 * 24 * h && atHour && w.wd === 0;
}

// ---------------- Talos : une tâche par plan (« Sauvegarde de <base> »), réglable et qu'on peut mettre en pause ----------------
/** L'identifiant Talos de la tâche d'un plan (sans « : », qui sépare les morceaux d'un identifiant de ligne). */
export const tacheDuPlanBase = (base: string) => `plan-${base.replace(/[^\w-]/g, '_').slice(0, 80)}`;
const deux = (n: number) => String(n).padStart(2, '0');
export function rythmePlanBase(p: Plan): RythmeAppli {
  if (p.toutes === 'heure') return { genre: 'heures', n: 1 };
  if (p.toutes === '6h') return { genre: 'heures', n: 6 };
  if (p.toutes === 'nuit') return { genre: 'jour', heure: `${deux(p.heure)}:00` };
  return { genre: 'semaine', jours: [0], heure: `${deux(p.heure)}:00` };
}
function planDepuisRythme(p: Plan, r: RythmeAppli): Plan {
  if (r.genre === 'heures' && (r.n === 1 || r.n === 6) && !r.minute) return { ...p, toutes: r.n === 1 ? 'heure' : '6h' };
  const heure = 'heure' in r ? /^(\d\d):00$/.exec(r.heure)?.[1] : undefined;
  if (r.genre === 'jour' && heure) return { ...p, toutes: 'nuit', heure: Number(heure) };
  if (r.genre === 'semaine' && heure && r.jours.length === 1 && r.jours[0] === 0) return { ...p, toutes: 'semaine', heure: Number(heure) };
  throw new Error('Une sauvegarde de base se règle toutes les heures, toutes les 6 heures, chaque jour à une heure pile, ou le dimanche à une heure pile.');
}
function tachesSkuld(ctx: ModCtx): TacheAppli[] {
  const h = history(ctx, 2000);
  return plans(ctx).filter((p) => p.actif).map((p) => {
    let nom = p.base, bid = p.base; try { const b = findBase(ctx.home, p.base); nom = b.nom; bid = b.id; } catch { /* base retirée */ }
    return {
      id: tacheDuPlanBase(p.base), nom: `Sauvegarde de ${nom}`, quoi: `Sauvegarde, relit et garde ${p.garde.jours} j, ${p.garde.semaines} sem., ${p.garde.mois} mois.`,
      rythme: () => rythmePlanBase(p), permis: ['heures', 'jour', 'semaine'],
      regler: (c: ModCtx, r: RythmeAppli) => { const n = planDepuisRythme(p, r); c.saveSettings({ plans: plans(c).map((x) => (x.base === p.base ? n : x)) }); },
      lancer: { action: 'sauvegarder', input: { base: p.base, raison: 'lancée depuis Talos' } },
      dernier: () => { const e = h.find((x) => x.base === bid); return e ?{ at: e.at, ok: e.ok, ...(e.ok ? {} : { texte: e.erreur }) } : undefined; },
    };
  });
}

// ---------------- 2e site ----------------
const site = (ctx: ModCtx) => ctx.settings.secondSite as Destination | undefined;
const dossierBase = (b: Base) => b.id.replace(/[^\w.@+-]/g, '_').slice(0, 80) || 'base';
/**
 * Copie une archive au 2e site, puis la relit là-bas (empreinte SHA-256 comparée à celle d'ici) ; enlève du 2e site
 * les archives qui ne sont plus gardées ici (même durée de garde des deux côtés). Rend où elle est, vérifiée.
 */
export async function copierAuSite(ctx: ModCtx, b: Base, fichier: string, d = site(ctx)): Promise<string> {
  if (!d) throw new Error('aucun 2e site réglé');
  const t = transportDe(ctx.home, d), nom = fichier.split(/[\\/]/).pop()!, rel = `${dossierBase(b)}/${nom}`;
  const ici = await sha256Fichier(fichier);
  await t.envoyer([{ local: fichier, rel }]);
  const la = await t.empreinte(rel);
  if (la !== ici) { await t.effacer([rel]).catch(() => undefined); throw new Error(`la copie sur ${t.nom} est différente de l'original (empreintes différentes) : retirée`); }
  const garde = new Set(archives(ctx, b).map((a) => a.f)), loin = await t.liste(), vieux = [...loin.keys()].filter((r) => r.startsWith(`${dossierBase(b)}/`) && !garde.has(r.slice(dossierBase(b).length + 1)));
  if (vieux.length) await t.effacer(vieux);
  return `copiée et vérifiée sur ${t.nom}`;
}

/** Sauvegarde, relit, applique la durée de garde ; note tout dans l'historique. */
export async function backupNow(ctx: ModCtx, b: Base, raison = 'à la main'): Promise<Entry> {
  const t0 = Date.now(), at = ctx.now(), dir = archDir(ctx, b); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${stamp(at)}.${extOf(b)}`), tmp = `${file}.tmp`;
  try {
    const t = tools(ctx); await dump(ctx.home, b, tmp, t);
    const v = await verify(b, tmp, t); renameSync(tmp, file);
    const e: Entry = { at: at.toISOString(), base: b.id, ok: true, fichier: file, taille: statSync(file).size, verif: v, raison, ms: Date.now() - t0 };
    const p = plans(ctx).find((x) => x.base === b.id);
    if (p) { const all = archives(ctx, b), k = keep(all.map((a) => a.at), p.garde, at); for (const a of all) if (!k.has(a.at)) rmSync(a.path, { force: true }); }
    // 2e site : la sauvegarde est bonne même si la copie rate (alerte, et « Rattraper » la refera).
    if (site(ctx)) {
      try { e.copie = await copierAuSite(ctx, b, file); }
      catch (err) { e.copieErreur = (err as Error).message; ctx.alert({ level: 'haute', title: `💾 ${b.nom} : copie au 2e site ratée`, detail: e.copieErreur, key: `skuld-site-${b.id}`, fix: { action: 'rattraper_site', label: 'Rattraper', input: {} } }); }
    }
    record(ctx, e);
    return e;
  } catch (err) { rmSync(tmp, { force: true }); const e: Entry = { at: at.toISOString(), base: b.id, ok: false, erreur: (err as Error).message, raison, ms: Date.now() - t0 }; record(ctx, e); return e; }
}
const pick = (ctx: ModCtx, b: Base, q: string) => { const l = archives(ctx, b); if (!l.length) throw new Error(`aucune sauvegarde de ${b.nom}`); if (!q) return l[0]; const a = l.find((x) => x.f.startsWith(q) || x.at.startsWith(q) || x.at.replace('T', ' ').startsWith(q)); if (!a) throw new Error(`sauvegarde introuvable : ${q} (la plus récente : ${l[0].at})`); return a; };

export const skuld: Module = {
  id: 'skuld', name: 'Amphore', family: 'Données',
  what: 'La sauvegarde de tes bases de données (comme Portabase) : plans, durée de garde, chaque sauvegarde relue et copiée à un 2e site (vérifiée), restauration avec ton accord.',
  does: ['PostgreSQL (pg_dump, dans le conteneur pour une base hébergée par Odin), MySQL / MariaDB (mysqldump), MongoDB (mongodump)', 'plans : chaque heure, toutes les 6 h, chaque nuit, chaque semaine', 'durée de garde : jours, puis une par semaine, puis une par mois', 'chaque sauvegarde est relue (base rouverte ou archive listée)', 'restaurer dans une nouvelle base à côté (conseillé) ou par-dessus, toujours avec ton accord', 'sauvegarde automatique avant toute requête Alexandrie qui modifie une base', 'copie de chaque sauvegarde à un 2e site (disque, partage réseau ou SFTP), relue et comparée (empreinte SHA-256), même durée de garde', 'alerte si une sauvegarde ou sa copie échoue'],
  from: ['Portabase'], upstream: ['Portabase/portabase'],
  words: ['sauvegarde de la base', '2e site', 'deuxième site', 'sauvegarder la base', 'sauvegarde des bases', 'backup base', 'pg_dump', 'restaurer la base', 'portabase', 'skuld'],
  actions: [
    { id: 'sauvegarder', label: 'Sauvegarder maintenant', what: 'Sauvegarde une base tout de suite et relit la sauvegarde', params: [{ key: 'base', label: 'Base', kind: 'text', required: true }, { key: 'raison', label: 'Pourquoi', kind: 'text', default: 'à la main' }], words: ['sauvegarde la base', 'sauvegarde maintenant'], run: async (ctx, i) => {
      const b = findBase(ctx.home, s(i.base)), e = await backupNow(ctx, b, s(i.raison) || 'à la main');
      return e.ok ? { text: `💾 ${b.nom} sauvegardée (${mo(e.taille!)}, ${e.verif}).${e.copie ? ` 2e site : ${e.copie}.` : e.copieErreur ? ` ⚠ 2e site : ${e.copieErreur}` : ''}` } : { text: `❌ Sauvegarde de ${b.nom} impossible : ${e.erreur}`, ok: false };
    } },
    { id: 'second_site', label: '2e site', what: 'Où copier chaque sauvegarde en plus (disque, partage réseau ou serveur SFTP) ; l\'endroit est essayé tout de suite (écriture puis relecture). Case « Retirer » cochée : plus de 2e site', quick: false, words: ['2e site', 'deuxième site'],
      params: [{ key: 'genre', label: 'Genre', kind: 'select', options: ['disque', 'partage', 'sftp'], default: 'disque' }, { key: 'retirer', label: 'Retirer le 2e site', kind: 'boolean', default: false }, { key: 'dossier', label: 'Dossier', kind: 'text', default: '', help: 'disque : chemin absolu ; partage : dossier dans le partage ; SFTP : dossier sur le serveur' }, { key: 'poste', label: 'Poste ou serveur (partage, SFTP)', kind: 'text', default: '', help: 'un poste du coffre des machines, ou sftp://compte@adresse' }, { key: 'partage', label: 'Nom du partage', kind: 'text', default: '' }],
      run: async (ctx, i) => {
        const d = lireDestination(i);
        // Sans dossier, rien ne change (une phrase « 2e site » ne retire jamais le réglage) : seule la case « Retirer » le fait.
        if (!d && i.retirer !== true) { const cur = ctx.settings.secondSite as Parameters<typeof decrire>[0] | undefined; return { text: cur ? `🏝 2e site : ${decrire(cur)}. Pour le changer, donne un autre dossier ; pour ne plus copier ailleurs, coche « Retirer le 2e site ».` : 'Pas encore de 2e site : donne un dossier (disque, partage réseau ou serveur SFTP) où copier chaque sauvegarde.' }; }
        if (!d) { ctx.saveSettings({ secondSite: undefined }); return { text: 'Plus de 2e site : les sauvegardes restent seulement sur la machine d\'Odin.' }; }
        const essai = await essayer(transportDe(ctx.home, d)); ctx.saveSettings({ secondSite: d });
        return { text: `🏝 2e site : ${decrire(d)} (${essai}). Chaque nouvelle sauvegarde y sera copiée et vérifiée ; « Rattraper » copie celles d'avant.` };
      } },
    { id: 'rattraper_site', label: 'Rattraper le 2e site', what: 'Copie au 2e site les sauvegardes gardées qui n\'y sont pas encore, chacune vérifiée', quick: false, run: async (ctx) => {
      const d = site(ctx); if (!d) throw new Error('aucun 2e site réglé');
      const t = transportDe(ctx.home, d), loin = await t.liste(), out: string[] = []; let n = 0;
      for (const b of bases(ctx.home)) for (const a of archives(ctx, b)) {
        if (loin.get(`${dossierBase(b)}/${a.f}`) === a.size) continue;
        try { await copierAuSite(ctx, b, a.path, d); n++; } catch (e) { out.push(`✗ ${b.nom} ${a.at.slice(0, 16).replace('T', ' ')} : ${(e as Error).message}`); }
      }
      return { text: `${n ? `🏝 ${n} sauvegarde(s) copiée(s) et vérifiée(s) sur ${t.nom}.` : `Le 2e site (${t.nom}) avait déjà tout.`}${out.length ? `\n${out.join('\n')}` : ''}`, ok: !out.length };
    } },
    { id: 'verifier_site', label: 'Vérifier le 2e site', what: 'Relit chaque copie du 2e site et compare son empreinte à l\'original', read: true, quick: false, run: async (ctx) => {
      const d = site(ctx); if (!d) return { text: 'Aucun 2e site réglé.', ok: false };
      const t = transportDe(ctx.home, d), loin = await t.liste(), out: string[] = []; let ok = 0, manque = 0;
      for (const b of bases(ctx.home)) for (const a of archives(ctx, b)) {
        const rel = `${dossierBase(b)}/${a.f}`; if (!loin.has(rel)) { manque++; continue; }
        if ((await t.empreinte(rel)) === await sha256Fichier(a.path)) ok++; else out.push(`✗ ${b.nom} ${a.at.slice(0, 16).replace('T', ' ')} : copie différente de l'original`);
      }
      if (out.length) ctx.alert({ level: 'critique', title: '2e site : des copies de sauvegarde sont abîmées', detail: out.slice(0, 5).join(' ; '), key: 'skuld-site-abime', fix: { action: 'rattraper_site', label: 'Recopier', input: {} } });
      return { text: `${ok} copie(s) identiques à l'original sur ${t.nom}${manque ? `, ${manque} pas encore copiée(s) (« Rattraper »)` : ''}${out.length ? `\n${out.join('\n')}` : ''}.`, ok: !out.length };
    } },
    { id: 'plan', label: 'Planifier', what: 'Sauvegardes automatiques d\'une base et durée de garde', quick: false, params: [{ key: 'base', label: 'Base', kind: 'text', required: true }, { key: 'toutes', label: 'Quand', kind: 'select', options: ['nuit', 'heure', '6h', 'semaine'], default: 'nuit' }, { key: 'heure', label: 'Heure (nuit, semaine)', kind: 'number', default: 3 }, { key: 'jours', label: 'Garder tout pendant (jours)', kind: 'number', default: 7 }, { key: 'semaines', label: 'Puis une par semaine (semaines)', kind: 'number', default: 4 }, { key: 'mois', label: 'Puis une par mois (mois)', kind: 'number', default: 6 }, { key: 'actif', label: 'Actif', kind: 'boolean', default: true }], run: (ctx, i) => {
      const b = findBase(ctx.home, s(i.base)), toutes = (['heure', '6h', 'nuit', 'semaine'].includes(s(i.toutes)) ? s(i.toutes) : 'nuit') as Every, n = (v: unknown, d: number, max: number) => { const x = v === undefined || v === '' ? d : Math.floor(Number(v)); return Number.isFinite(x) ? Math.min(max, Math.max(0, x)) : d; };
      const p: Plan = { base: b.id, toutes, heure: Math.min(23, Math.max(0, Math.floor(Number(i.heure ?? 3)) || 0)), garde: { jours: n(i.jours, 7, 3650), semaines: n(i.semaines, 4, 520), mois: n(i.mois, 6, 240) }, actif: i.actif !== false && s(i.actif) !== 'false' };
      ctx.saveSettings({ plans: [...plans(ctx).filter((x) => x.base !== b.id), p] });
      return { text: `🗓 ${b.nom} : ${p.actif ? when(p.toutes, p.heure) : 'plan en pause'} · garde ${p.garde.jours} j, ${p.garde.semaines} sem., ${p.garde.mois} mois.` };
    } },
    { id: 'historique', label: 'Historique', what: 'Les dernières sauvegardes', read: true, params: [{ key: 'base', label: 'Base (vide : toutes)', kind: 'text', default: '' }], run: (ctx, i) => { const b = s(i.base) ? findBase(ctx.home, s(i.base)).id : ''; const h = history(ctx, 300).filter((e) => !b || e.base === b).slice(0, 30); return { text: h.map((e) => `${e.at.slice(0, 16).replace('T', ' ')} · ${e.base} · ${e.ok ? `✓ ${mo(e.taille ?? 0)} · ${e.verif}` : `✗ ${e.erreur}`}`).join('\n') || 'Aucune sauvegarde pour l\'instant.', data: h }; } },
    { id: 'archives', label: 'Sauvegardes gardées', what: 'Les sauvegardes encore présentes d\'une base', read: true, params: [{ key: 'base', label: 'Base', kind: 'text', required: true }], run: (ctx, i) => { const b = findBase(ctx.home, s(i.base)), l = archives(ctx, b); return { text: l.map((a) => `- ${a.at.slice(0, 16).replace('T', ' ')} · ${mo(a.size)}`).join('\n') || `Aucune sauvegarde de ${b.nom}.`, data: l.map((a) => ({ at: a.at, taille: a.size })) }; } },
    { id: 'restaurer', label: 'Restaurer', what: 'Restaure une sauvegarde : dans une nouvelle base à côté (conseillé) ou par-dessus (une sauvegarde de l\'état actuel est faite avant)', quick: false, params: [{ key: 'base', label: 'Base', kind: 'text', required: true }, { key: 'quand', label: 'Sauvegarde (date, vide : la plus récente)', kind: 'text', default: '' }, { key: 'ou', label: 'Où', kind: 'select', options: ['nouvelle base', 'par-dessus'], default: 'nouvelle base' }],
      grave: (i) => (s(i.ou) === 'par-dessus' ? `restaurer ${s(i.base)} PAR-DESSUS la base actuelle (sauvegarde ${s(i.quand) || 'la plus récente'})` : `restaurer ${s(i.base)} dans une nouvelle base (sauvegarde ${s(i.quand) || 'la plus récente'})`), run: async (ctx, i) => {
      const b = findBase(ctx.home, s(i.base)), a = pick(ctx, b, s(i.quand)), over = s(i.ou) === 'par-dessus', t = tools(ctx);
      if (over) { const pre = await backupNow(ctx, b, 'avant une restauration'); if (!pre.ok) throw new Error(`je n'écrase pas ${b.nom} sans sauvegarde de l'état actuel : ${pre.erreur}`); }
      const name = over ? (b.base ?? b.nom) : `${(b.base ?? b.id).replace(/[^\w]/g, '_')}_restauree_${a.at.slice(0, 10).replace(/-/g, '')}`.slice(0, 60);
      const got = await restore(ctx.home, b, a.path, { new: !over, name }, t);
      if (!over) { const l = bases(ctx.home); let id = `${b.id}-restauree`; while (l.some((x) => x.id === id)) id += '-2'; saveBases(ctx.home, [...l, { ...b, id, nom: `${b.nom} (restaurée ${a.at.slice(0, 10)})`, base: name, ajoutee: ctx.now().toISOString() }]); const pw = password(ctx.home, b.id); if (pw) setPassword(ctx.home, id, pw); }
      record(ctx, { at: ctx.now().toISOString(), base: b.id, ok: true, fichier: a.path, raison: over ? 'restaurée par-dessus' : `restaurée dans ${got}`, ms: 0 });
      return { text: over ? `♻ ${b.nom} restaurée par-dessus avec la sauvegarde du ${a.at.slice(0, 16).replace('T', ' ')} (l'état d'avant est sauvegardé).` : `♻ Sauvegarde du ${a.at.slice(0, 16).replace('T', ' ')} restaurée dans une nouvelle base : ${got}. Ouvre-la dans Alexandrie pour comparer.` };
    } },
  ],
  view(ctx) {
    const l = bases(ctx.home), h = history(ctx, 500), ps = plans(ctx);
    const last = (id: string) => h.find((e) => e.base === id), fails = l.filter((b) => last(b.id)?.ok === false).length;
    const sections: Section[] = [
      { kind: 'cards', title: 'Bases suivies', items: l.map((b) => { const p = ps.find((x) => x.base === b.id), e = last(b.id), arch = archives(ctx, b); return { title: b.nom, sub: `${({ postgres: 'PostgreSQL', sqlite: 'SQLite', mysql: 'MySQL / MariaDB', mongodb: 'MongoDB' })[b.type]} · ${p ? (p.actif ? `${when(p.toutes, p.heure)} · garde ${p.garde.jours} j · ${p.garde.semaines} sem. · ${p.garde.mois} mois` : 'plan en pause') : 'pas de plan'}`, badge: e ? (e.ok ? `ok · ${e.at.slice(5, 16).replace('T', ' ')}` : 'échec') : 'jamais', tone: e ? (e.ok ? 'bon' as const : 'mauvais' as const) : 'attention' as const, meta: `${arch.length} sauvegarde${arch.length > 1 ? 's' : ''} · ${mo(arch.reduce((n, a) => n + a.size, 0))}`, actions: [{ action: 'sauvegarder', label: 'Sauvegarder', input: { base: b.id } }, ...(arch.length ? [{ action: 'restaurer', label: 'Restaurer', input: { base: b.id, ou: 'nouvelle base' } }] : []), ...(p ? [] : [{ action: 'plan', label: 'Chaque nuit', input: { base: b.id, toutes: 'nuit' } }])] }; }), empty: 'Aucune base : ajoute-les dans Alexandrie (créer ou relier).' },
      { kind: 'table', title: 'Historique', columns: ['Quand', 'Base', 'État', 'Taille', 'Détail'], rows: h.slice(0, 20).map((e) => ({ cells: [e.at.slice(0, 16).replace('T', ' '), l.find((b) => b.id === e.base)?.nom ?? e.base, e.ok ? 'ok' : 'échec', e.taille ? mo(e.taille) : '—', e.ok ? `${e.verif ?? e.raison ?? ''}` : e.erreur ?? ''], tone: e.ok ? undefined : 'mauvais' as const })), empty: 'Aucune sauvegarde pour l\'instant.' },
    ];
    const d = site(ctx), derniere = h.find((e) => e.ok && (e.copie || e.copieErreur));
    sections.push({ kind: 'form', title: d ? `2e site : ${decrire(d)}` : '2e site (copie de chaque sauvegarde ailleurs)', action: 'second_site', submit: d ? 'Changer' : 'Régler', params: skuld.actions.find((a) => a.id === 'second_site')?.params ?? [], aide: 'Disque (USB, NAS monté), partage réseau ou serveur SFTP : chaque sauvegarde y est copiée puis relue (empreinte comparée).' });
    if (d) sections.push({ kind: 'actions', title: '2e site', boutons: [{ action: 'rattraper_site', label: 'Rattraper', primary: true }, { action: 'verifier_site', label: 'Vérifier les copies' }], aide: derniere ? (derniere.copie ? `Dernière copie : ${derniere.at.slice(0, 16).replace('T', ' ')}, ${derniere.copie}.` : `Dernière copie ratée : ${derniere.copieErreur}`) : 'Aucune copie pour l\'instant.' });
    return { subtitle: 'Sauvegarde des bases de données', kpis: [{ label: 'Bases', value: String(l.length) }, { label: 'Avec un plan', value: String(ps.filter((p) => p.actif).length) }, { label: 'En échec', value: String(fails), tone: fails ? 'mauvais' : 'bon' }, { label: '2e site', value: d ? (derniere?.copieErreur ? 'en échec' : 'copie vérifiée') : 'aucun', tone: !d ? 'attention' : derniere?.copieErreur ? 'mauvais' : 'bon' }], sections };
  },
  taches: tachesSkuld,
  watch: { every: 60, async run(ctx) {
    const now = ctx.now(), h = history(ctx, 2000);
    for (const p of plans(ctx)) {
      let b: Base; try { b = findBase(ctx.home, p.base); } catch { continue; }
      const lastOk = h.find((e) => e.base === b.id && e.ok && e.raison !== 'restaurée par-dessus'), lastTry = h.find((e) => e.base === b.id);
      if (!due(p, lastOk ? new Date(lastOk.at) : undefined, now) || tacheEnPause('skuld', tacheDuPlanBase(p.base))) continue;
      if (lastTry && !lastTry.ok && now.getTime() - Date.parse(lastTry.at) < 3600_000) continue; // un essai par heure après un échec
      const e = await backupNow(ctx, b, 'plan');
      if (!e.ok) ctx.alert({ level: 'haute', title: `💾 Sauvegarde de ${b.nom} ratée`, detail: e.erreur, key: `skuld-${b.id}`, lien: 'skuld-alerte-sauvegarde-base', steps: ['Regarde l\'erreur dans Amphore', 'Mot de passe changé ? redonne-le dans Alexandrie (« relier » à nouveau)', 'Puis « Sauvegarder maintenant »'], fix: { action: 'sauvegarder', label: 'Réessayer', input: { base: b.id } } });
    }
  } },
};
