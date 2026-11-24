// Talos, « Faire un lien » : les vrais comptes, appli par appli.
// - « Quand » : les événements que chaque appli signale (table EVENEMENTS de src/draupnir/liens.ts) ;
// - « Quoi faire » : les fonctions qu'on peut relier (toute fonction non grave, actionLiable).
// L'essai échoue si un événement émis en clair par une appli (n'importe où dans src/valhalla/**) manque dans la table,
// si la table cite un événement qu'aucune appli n'émet, ou si un événement émis par une variable (liste écrite à la
// main ci-dessous) n'y est pas.
// Les modules sont importés APRÈS avoir posé ODIN_HOME : rien n'est écrit dans le vrai dossier d'Odin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const home = mkdtempSync(join(tmpdir(), 'talos-comptes-'));
process.env.ODIN_HOME = home;

const RACINE = fileURLToPath(new URL('../src/valhalla/', import.meta.url));

/**
 * Qui émet, pour les fichiers hors de modules/ (le contexte reçu est celui d'une appli). `qui` (compagnon/api.ts) vaut
 * Asclépios s'il tourne, sinon Satellites (compagnon/api.ts:81). Un fichier nouveau qui émet doit être ajouté ici.
 */
const EMETTEURS: Record<string, Record<string, string[]>> = {
  'compagnon/actions.ts': { ctx: ['hermod'] },
  'compagnon/api.ts': { 'hermod?': ['hermod'], qui: ['ullr', 'hermod'] },
  'forge/forge.ts': { ctx: ['eitri', 'fjalar'] },
  'frigg/perso.ts': { ctx: ['frigg'] },
  'sindri/agent.ts': { ctx: ['sindri'] },
  'sindri/image.ts': { ctx: ['sindri'] },
  'sso/comptes.ts': { ctx: ['var'] },
  'sso/sauvegardes.ts': { ctx: ['var'] },
  'thjalfi/suivi.ts': { ctx: ['thjalfi'] },
  'ymir/bibliotheque.ts': { ctx: ['ymir'] },
  'ymir/creation.ts': { ctx: ['ymir'] },
  'ymir/machines.ts': { ctx: ['ymir'] },
  'ymir/retrait.ts': { ctx: ['ymir'] },
};
/** modules/<fichier>.ts dont l'appli a un autre identifiant. La clé `venus` reste aussi dans la table : l'essai
 * test/automatismes-applis.test.ts la lit par le nom du fichier. */
const FICHIER_VERS_APPLI: Record<string, string[]> = { venus: ['freyja', 'venus'] };

/** Les événements émis par une VARIABLE : relevés à la main dans le code (fichier:ligne). */
const PAR_VARIABLE: Record<string, string[]> = {
  // Arachné : record(ctx, { type… }) → ctx.emit(e.type, …) (modules/idunn.ts:67) ; types aux lignes 166-566.
  idunn: ['hors_ligne', 'de_retour', 'lent', 'titre_change', 'contenu_change', 'certificat', 'certificat_invalide', 'envoi_de_code', 'tests_ok', 'tests_echec',
    'demande_de_fusion', 'version', 'deploiement_ok', 'deploiement_echec', 'deploiement_annule', 'zone', 'dns_change', 'niveau_securite', 'essai_ok', 'essai_echec',
    'relance', 'deploiement_demande', 'retour_arriere', 'promotion', 'mises_a_jour_actives', 'fusion', 'cache_vide', 'mode_attaque', 'proposition', 'proposition_refusee', 'proposition_abandonnee'],
  // Chronos : ctx.emit(status === 'annulé' ? … : …) (modules/frigg.ts:62).
  frigg: ['reservation_annulee', 'reservation_confirmee'],
};

function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? fichiers(p) : p.endsWith('.ts') ? [p] : []; });
}
/** Les émissions en clair vers les événements d'Odin : appli → événements (avec l'endroit). */
function emissions(): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>(), inconnus: string[] = [];
  for (const p of fichiers(RACINE)) {
    const rel = relative(RACINE, p).replace(/\\/g, '/'), texte = readFileSync(p, 'utf8');
    for (const m of texte.matchAll(/(?<![\w.])(ctx|this\.ctx|hermod\?|qui)\.emit\(\s*'([^']+)'/g)) {
      const recepteur = m[1] === 'this.ctx' ? 'ctx' : m[1], ligne = texte.slice(0, m.index).split('\n').length;
      const mod = /^modules\/([\w-]+)\.ts$/.exec(rel);
      const applis = mod ? (FICHIER_VERS_APPLI[mod[1]] ?? [mod[1]]) : EMETTEURS[rel]?.[recepteur];
      if (!applis) { inconnus.push(`${rel}:${ligne} (${m[1]}.emit('${m[2]}'))`); continue; }
      for (const a of applis) { if (!out.has(a)) out.set(a, new Map()); out.get(a)!.set(m[2], `${rel}:${ligne}`); }
    }
  }
  assert.deepEqual(inconnus, [], 'émission dans un fichier hors de modules/ : dire à quelle appli elle appartient (EMETTEURS)');
  return out;
}

test('la table EVENEMENTS est exactement ce que les applis émettent', async () => {
  const { EVENEMENTS } = await import('../src/draupnir/liens.ts');
  const emis = emissions();
  for (const [a, l] of Object.entries(PAR_VARIABLE)) { if (!emis.has(a)) emis.set(a, new Map()); for (const e of l) emis.get(a)!.set(e, '(par une variable)'); }
  // Tout ce qui est émis est dans la table.
  const manquants: string[] = [];
  for (const [a, evs] of emis) for (const [e, ou] of evs) if (!EVENEMENTS[a]?.includes(e)) manquants.push(`${a} · ${e} (${ou})`);
  assert.deepEqual(manquants, [], 'événements émis absents de EVENEMENTS');
  // La table ne promet rien qu'aucune appli n'émet (un lien sur un tel événement ne partirait jamais).
  const fantomes: string[] = [];
  for (const [a, evs] of Object.entries(EVENEMENTS)) for (const e of evs) if (!emis.get(a)?.has(e)) fantomes.push(`${a} · ${e}`);
  assert.deepEqual(fantomes, [], 'événements de la table qu\'aucune appli n\'émet');
});

test('les comptes, appli par appli : qui peut être le « quand », qui peut être le « quoi faire »', { timeout: 300_000 }, async (t) => {
  const { allModules } = await import('../src/valhalla/odin.ts');
  const { DEFAULT_CONFIG } = await import('../src/config.ts');
  const { EVENEMENTS, actionLiable } = await import('../src/draupnir/liens.ts');
  const mods = allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never);
  const ids = new Set(mods.map((m) => m.id));
  // Chaque clé de la table est une appli (sauf l'alias `venus` de Vénus, voir FICHIER_VERS_APPLI).
  for (const k of Object.keys(EVENEMENTS)) assert.ok(ids.has(k) || k === 'venus', `clé ${k} : aucune appli de ce nom`);
  const lignes = mods.map((m) => {
    const liables = m.actions.map(actionLiable), ok = liables.filter((a) => !a.grave);
    return { id: m.id, nom: m.name, evenements: EVENEMENTS[m.id]?.length ?? 0, fonctions: m.actions.length, reliables: ok.length, lectures: ok.filter((a) => a.read).length };
  });
  const quand = lignes.filter((l) => l.evenements > 0), quoi = lignes.filter((l) => l.reliables > 0);
  t.diagnostic(`applis : ${lignes.length} ; « quand » (au moins un événement nommé) : ${quand.length} ; « quoi faire » (au moins une fonction non grave) : ${quoi.length}`);
  t.diagnostic(`événements nommés : ${lignes.reduce((n, l) => n + l.evenements, 0)} ; fonctions : ${lignes.reduce((n, l) => n + l.fonctions, 0)}, dont reliables ${lignes.reduce((n, l) => n + l.reliables, 0)} (lectures ${lignes.reduce((n, l) => n + l.lectures, 0)})`);
  for (const l of lignes) t.diagnostic(`${l.id} (${l.nom}) : ${l.evenements} événement(s), ${l.reliables}/${l.fonctions} fonction(s) reliable(s)`);
  t.diagnostic(`sans événement nommé : ${lignes.filter((l) => !l.evenements).map((l) => l.id).join(', ')}`);
  // Toute appli a au moins une fonction qu'on peut relier.
  assert.deepEqual(lignes.filter((l) => !l.reliables).map((l) => l.id), []);
  // Les applis qui émettent sont toutes des « quand ».
  const emis = emissions();
  for (const a of [...emis.keys(), ...Object.keys(PAR_VARIABLE)]) if (a !== 'venus') assert.ok(quand.some((l) => l.id === a), `${a} émet : elle doit pouvoir être le « quand »`);
});

test.after(() => { try { rmSync(home, { recursive: true, force: true }); } catch { /* fichiers encore ouverts : dossier temporaire */ } });
