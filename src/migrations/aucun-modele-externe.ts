// Migration « aucun modèle qui ne soit pas celui d'Odin » (décision du propriétaire, 17/11/2026).
//
// Temps 1 : le juge. Les juges par modèle (Jev, un grand modèle, la cascade, l'avis croisé de plusieurs modèles) sont
// retirés ; le juge local d'Odin, seul, est parfois PLUS SOUPLE qu'eux. Exemples : l'avis croisé gardait, question par
// question, la réponse la plus prudente (le maximum pour un risque, le minimum pour « demandé ») ; la cascade, en mode
// autonome, pouvait changer un doute en « grave ». Pour que rien ne passe de « demander » à « permis » sans le
// propriétaire, une installation qui utilisait un de ces juges repasse en autonomie « prudent » (les trois chemins de
// Heimdall qui permettent seul une action soumise à validation sont alors fermés ; Odin Breaker aussi). Une fois, et on
// le lui dit ; il la remonte quand il veut (c'est son réglage).
//
// Qui est concerné : on refait le choix de l'ancien juge à partir de la configuration et des clés présentes, AVANT de
// construire le juge (runtime.ts). Dans le doute (coffre verrouillé : les clés ne se lisent pas), on plafonne.
// La marque « migration-juge-local » (mémoire d'Odin) garde le résultat : un démarrage suivant n'y retouche pas.
//
// Ce que le plafond ne couvre pas (à dire au propriétaire) : les actions que sa politique permet déjà (lire, écrire des
// fichiers, consulter le réseau). L'ancien juge pouvait en faire remonter une jusqu'à lui ; le juge local le fera moins
// souvent.
//
// Lecture volontairement souple de la configuration (`brut`) : les champs `mimir.judge`, `mimir.apiKeyEnv`,
// `routing.crossCheckRisky` et `providers` quittent le type plus tard ; cette lecture doit rester juste après.
//
// Plus bas : le rangement de la file des questions gardées pour un modèle (`rangerQuestionsGardees`), toujours APRÈS
// le temps 1. Aucune clé, aucun fournisseur, aucune connexion n'est effacé (décision du propriétaire du 19/11/2026).
import { join } from 'node:path';
import { type OdinConfig, type OdinPaths, setConfigValue } from '../config.ts';
import type { Autonomy } from '../mimir/decisions.ts';
import { pushAll } from '../push/webpush.ts';
import { reviserCopies } from '../undo.ts';
import { readSecretFile, secretFileExists, vaultState } from '../vault.ts';
import { QUEUE_KEY } from '../core/offline.ts';
import { Redactor } from '../heimdall/redact.ts';

export const MARQUE_JUGE_LOCAL = 'migration-juge-local';
const MIMIR_COUPE = 'Mímir était coupé dans tes réglages';

interface Brut {
  mimir?: { judge?: unknown; apiKeyEnv?: unknown; autonomy?: unknown; enabled?: unknown; uses?: { actionReview?: unknown } };
  routing?: { crossCheckRisky?: unknown };
  providers?: Array<{ kind?: unknown; apiKeyEnv?: unknown; baseUrl?: unknown }>;
}

/** Les fournisseurs de modèles qui avaient de quoi répondre (clé présente, connexion, serveur sur la machine). */
function fournisseursPrets(brut: Brut, env: NodeJS.ProcessEnv, home: string): number {
  let n = 0;
  for (const p of Array.isArray(brut.providers) ? brut.providers : []) {
    const cle = typeof p?.apiKeyEnv === 'string' && p.apiKeyEnv ? env[p.apiKeyEnv] : undefined;
    if (p?.kind === 'openai-codex') { if (secretFileExists(join(home, 'codex-auth.json'))) n++; }
    else if (p?.kind === 'anthropic') { if (cle) n++; }
    else if (p?.kind === 'openai') { if (cle || (typeof p.baseUrl === 'string' && /localhost|127\.0\.0\.1|\[::1\]/.test(p.baseUrl))) n++; }
  }
  return n;
}

/** Le fichier des clés existe mais ne se lit pas (coffre à mot de passe, verrouillé) : on ne sait pas quelles clés il garde. */
function clesIllisibles(home: string): boolean {
  const f = join(home, 'env');
  if (!secretFileExists(f)) return false;
  try { return readSecretFile(f) === undefined; } catch { return true; }
}

/**
 * L'ancien juge de cette installation était-il autre chose que « le juge local seul » ? Rejoue le choix de l'ancien
 * code (factory.ts avant le retrait) : Jev si `judge` vaut jev, local+jev ou auto ET que la clé est là ; un grand modèle
 * pour llm et local+llm (la passerelle donnait toujours son routeur) ; l'avis croisé si `routing.crossCheckRisky` et au
 * moins deux fournisseurs prêts. Pur, sauf la lecture du coffre.
 */
export function ancienJuge(cfg: OdinConfig, env: NodeJS.ProcessEnv, home: string): { concerne: boolean; raisons: string[] } {
  const brut = cfg as unknown as Brut;
  const mode = typeof brut.mimir?.judge === 'string' ? brut.mimir.judge : 'auto';
  const nomCle = typeof brut.mimir?.apiKeyEnv === 'string' && brut.mimir.apiKeyEnv ? brut.mimir.apiKeyEnv : 'JEV_API_KEY';
  const croise = brut.routing?.crossCheckRisky !== false; // vrai par défaut dans l'ancienne configuration
  const raisons: string[] = [];
  if ((mode === 'jev' || mode === 'local+jev' || mode === 'auto') && env[nomCle]) raisons.push(mode === 'local+jev' ? 'cascade avec Jev' : 'Jev');
  if (mode === 'llm') raisons.push('un grand modèle');
  if (mode === 'local+llm') raisons.push('cascade avec un grand modèle');
  if (croise && fournisseursPrets(brut, env, home) >= 2) raisons.push('avis croisé de plusieurs modèles');
  // Coffre verrouillé : la clé Jev ou celles des fournisseurs peuvent y être sans qu'on le voie. Dans le doute, prudence.
  const possible = mode === 'jev' || mode === 'local+jev' || mode === 'auto' || (croise && (brut.providers?.length ?? 0) >= 2);
  if (!raisons.length && possible && clesIllisibles(home)) raisons.push('coffre verrouillé : impossible de vérifier quelles clés il garde');
  // Mímir coupé (ou sans relecture des actions) : l'ancien juge ne relisait rien pour l'instant, mais aurait repris dès
  // que le propriétaire le rallume ; ce sera alors le juge local seul. On plafonne quand même, et le message le dit.
  if (raisons.length && (brut.mimir?.enabled === false || brut.mimir?.uses?.actionReview === false)) raisons.push(MIMIR_COUPE);
  return { concerne: raisons.length > 0, raisons };
}

// Le message au propriétaire, dans sa langue (réglée dans Réglages → Voix). Une langue sans texte reçoit l'anglais, puis
// le français. Japonais : à faire relire.
const NIVEAUX: Record<string, Record<Autonomy, string>> = {
  fr: { prudent: 'prudent', equilibre: 'équilibre', autonome: 'autonome', breaker: 'Odin Breaker' },
  en: { prudent: 'careful', equilibre: 'balanced', autonome: 'autonomous', breaker: 'Odin Breaker' },
  es: { prudent: 'prudente', equilibre: 'equilibrio', autonome: 'autónomo', breaker: 'Odin Breaker' },
  de: { prudent: 'vorsichtig', equilibre: 'ausgewogen', autonome: 'autonom', breaker: 'Odin Breaker' },
  ja: { prudent: '慎重', equilibre: 'バランス', autonome: '自律', breaker: 'Odin Breaker' },
};
const MESSAGE: Record<string, string> = {
  fr: '🛡️ Sûreté : j\'ai remis mon autonomie sur « {prudent} » (elle était sur « {avant} »). Le juge qui relisait mes actions risquées ({raisons}) n\'existe plus : je n\'utilise plus aucun modèle qui ne soit pas le mien, et mon juge local, seul, est parfois plus souple. Désormais je te demande pour chaque action soumise à validation, et le mode Odin Breaker est coupé. Tu peux remonter l\'autonomie quand tu veux (Réglages → Autonomie). À savoir : ce que ta politique permet déjà (lire, écrire des fichiers, consulter le réseau) ne te sera pas demandé, et mon juge local te fera remonter ces actions-là moins souvent que l\'ancien.',
  en: '🛡️ Safety: I set my autonomy back to “{prudent}” (it was “{avant}”). The judge that reviewed my risky actions ({raisons}) is gone: I no longer use any model that isn\'t my own, and my local judge alone is sometimes less strict. From now on I ask you for every action that needs approval, and Odin Breaker mode is off. You can raise my autonomy whenever you like (Settings → Autonomy). Note: what your policy already allows (reading, writing files, browsing the network) still won\'t be asked, and my local judge will flag those actions to you less often than the old one did.',
  es: '🛡️ Seguridad: he vuelto a poner mi autonomía en «{prudent}» (estaba en «{avant}»). El juez que revisaba mis acciones arriesgadas ({raisons}) ya no existe: ya no uso ningún modelo que no sea el mío, y mi juez local, solo, a veces es menos estricto. A partir de ahora te pregunto por cada acción que necesita validación, y el modo Odin Breaker está desactivado. Puedes subir la autonomía cuando quieras (Ajustes → Autonomía). Ten en cuenta: lo que tu política ya permite (leer, escribir archivos, consultar la red) no se te preguntará, y mi juez local te señalará esas acciones con menos frecuencia que el anterior.',
  de: '🛡️ Sicherheit: Ich habe meine Autonomie wieder auf „{prudent}“ gestellt (sie stand auf „{avant}“). Der Prüfer, der meine riskanten Aktionen gegenlas ({raisons}), existiert nicht mehr: Ich nutze kein Modell mehr, das nicht mein eigenes ist, und mein lokaler Prüfer allein ist manchmal weniger streng. Ab jetzt frage ich dich bei jeder Aktion, die eine Freigabe braucht, und der Modus Odin Breaker ist aus. Du kannst die Autonomie jederzeit wieder erhöhen (Einstellungen → Autonomie). Hinweis: Was deine Richtlinie schon erlaubt (Lesen, Dateien schreiben, das Netz abfragen), wird weiterhin nicht nachgefragt, und mein lokaler Prüfer meldet dir solche Aktionen seltener als der alte.',
  ja: '🛡️ 安全のため、自律レベルを「{prudent}」に戻しました（以前は「{avant}」）。危険な操作を確認していた判定役（{raisons}）はもうありません。自分のものではないモデルは一切使わなくなり、ローカルの判定役だけでは判断が甘くなることがあるためです。今後は承認が必要な操作のたびに確認し、Odin Breaker モードは停止します。自律レベルはいつでも上げられます（設定 → 自律）。なお、ポリシーですでに許可されている操作（読み取り、ファイルの書き込み、ネットワークの参照）は引き続き確認されず、ローカルの判定役がそれらを知らせる頻度は以前より少なくなります。',
};
const RAISONS: Record<string, Record<string, string>> = {
  en: { Jev: 'Jev', 'cascade avec Jev': 'Jev in cascade', 'un grand modèle': 'a large model', 'cascade avec un grand modèle': 'a large model in cascade', 'avis croisé de plusieurs modèles': 'cross-check by several models', 'coffre verrouillé : impossible de vérifier quelles clés il garde': 'vault locked: I couldn\'t check which keys it holds', 'Mímir était coupé dans tes réglages': 'Mímir was switched off in your settings' },
  es: { Jev: 'Jev', 'cascade avec Jev': 'Jev en cascada', 'un grand modèle': 'un gran modelo', 'cascade avec un grand modèle': 'un gran modelo en cascada', 'avis croisé de plusieurs modèles': 'revisión cruzada por varios modelos', 'coffre verrouillé : impossible de vérifier quelles clés il garde': 'caja fuerte bloqueada: no pude comprobar qué claves guarda', 'Mímir était coupé dans tes réglages': 'Mímir estaba desactivado en tus ajustes' },
  de: { Jev: 'Jev', 'cascade avec Jev': 'Jev in Kaskade', 'un grand modèle': 'ein großes Modell', 'cascade avec un grand modèle': 'ein großes Modell in Kaskade', 'avis croisé de plusieurs modèles': 'Gegenprüfung durch mehrere Modelle', 'coffre verrouillé : impossible de vérifier quelles clés il garde': 'Tresor gesperrt: Ich konnte nicht prüfen, welche Schlüssel er enthält', 'Mímir était coupé dans tes réglages': 'Mímir war in deinen Einstellungen ausgeschaltet' },
  ja: { Jev: 'Jev', 'cascade avec Jev': 'Jev による二段階判定', 'un grand modèle': '大規模モデル', 'cascade avec un grand modèle': '大規模モデルによる二段階判定', 'avis croisé de plusieurs modèles': '複数モデルによる相互確認', 'coffre verrouillé : impossible de vérifier quelles clés il garde': '金庫がロックされていて、保存されている鍵を確認できませんでした', 'Mímir était coupé dans tes réglages': 'Mímir は設定でオフになっていました' },
};

/** Une copie de la configuration, avec l'autonomie « prudent ». Null si ce n'est pas un objet JSON. */
function plafonnerCopie(texte: string): string | null {
  try {
    const o = JSON.parse(texte.replace(/^﻿/, '')) as unknown;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const c = o as Record<string, unknown>;
    const m = c.mimir && typeof c.mimir === 'object' && !Array.isArray(c.mimir) ? c.mimir as Record<string, unknown> : {};
    c.mimir = { ...m, autonomy: 'prudent' };
    return JSON.stringify(c, null, 2);
  } catch { return null; }
}

/** Le message du plafond, dans la langue donnée (sinon l'anglais, puis le français). Pur. */
export function messagePlafond(langue: string | undefined, avant: Autonomy, raisons: string[]): string {
  const code = (langue ?? '').toLowerCase().replace(/[-_].*$/, '').replace(/^auto$/, ''); // « auto » : la langue par défaut
  const l = MESSAGE[code] ? code : code ? 'en' : 'fr';
  const traduire = (r: string) => (l === 'fr' ? r : RAISONS[l]?.[r] ?? r);
  return MESSAGE[l].replace('{prudent}', NIVEAUX[l].prudent).replace('{avant}', NIVEAUX[l][avant] ?? avant).replace('{raisons}', raisons.map(traduire).join(', '));
}

export interface PlafondDeps {
  paths: OdinPaths;
  cfg: OdinConfig;
  kv: { getKv(k: string): string | undefined; setKv(k: string, v: string): void };
  env?: NodeJS.ProcessEnv;
  /** Trace dans le journal d'audit de Heimdall. */
  noter?(e: Record<string, unknown>): void;
}

/**
 * Temps 1 : plafond « prudent » pour une installation qui utilisait un juge par modèle. À appeler AVANT de construire le
 * juge et de donner l'autonomie à Heimdall. Idempotent (marque en mémoire). Le changement est fait en mémoire (`cfg`)
 * même si l'écriture de la configuration échoue ; dans ce cas, pas de marque : le démarrage suivant recommence.
 */
export function plafonnerAutonomie(d: PlafondDeps): { pose: boolean; avant?: Autonomy; raisons: string[] } {
  if (d.kv.getKv(MARQUE_JUGE_LOCAL)) return { pose: false, raisons: [] };
  const { concerne, raisons } = ancienJuge(d.cfg, d.env ?? process.env, d.paths.home);
  const avant = d.cfg.mimir.autonomy;
  const at = new Date().toISOString();
  if (!concerne || avant === 'prudent') {
    d.kv.setKv(MARQUE_JUGE_LOCAL, JSON.stringify({ at, pose: false, avant, raisons }));
    return { pose: false, avant, raisons };
  }
  d.cfg.mimir = { ...d.cfg.mimir, autonomy: 'prudent' };
  try { setConfigValue(d.paths, ['mimir', 'autonomy'], 'prudent'); } catch (e) {
    console.error(`[mímir] autonomie remise sur « prudent » pour ce démarrage, mais la configuration n'a pas pu être écrite : ${(e as Error).message}`);
    return { pose: true, avant, raisons };
  }
  // « Annule tout » ne doit pas défaire le plafond : chaque copie d'annulation de la configuration (celle que le plafond
  // vient de créer, et les plus anciennes) garde désormais « prudent ». Une copie illisible est oubliée.
  try { reviserCopies(d.paths.home, d.paths.config, plafonnerCopie); } catch (e) {
    console.error(`[mímir] copies d'annulation de la configuration non revues : ${(e as Error).message}`);
  }
  const texte = messagePlafond(d.cfg.voice?.stt?.language, avant, raisons);
  // La marque garde le message : « dit » passe à vrai quand une bulle l'a montré (passerelle, Réglages).
  d.kv.setKv(MARQUE_JUGE_LOCAL, JSON.stringify({ at, pose: true, avant, raisons, message: texte, dit: false }));
  // Le message part au propriétaire par trois chemins : ses appareils abonnés aux notifications (tout de suite, même
  // sans messagerie), le prochain message d'Odin ou le rapport du matin (la file « deferred »), et la marque.
  void pushAll(d.paths.home, { title: '🛡️ Odin', body: texte, view: 'settings', tag: 'odin-plafond' }).catch(() => { /* appareil injoignable : la file et la marque restent */ });
  try {
    const l = JSON.parse(d.kv.getKv('deferred') || '[]') as unknown;
    const file = Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : [];
    d.kv.setKv('deferred', JSON.stringify([...file, texte].slice(-30)));
  } catch { d.kv.setKv('deferred', JSON.stringify([texte])); }
  try { d.noter?.({ evenement: 'autonomie-plafonnee', avant, apres: 'prudent', raisons }); } catch { /* journal facultatif */ }
  console.error(`[mímir] autonomie remise sur « prudent » (avant : ${avant}) : le juge ${raisons.join(', ')} est retiré, le juge local seul est parfois plus souple`);
  return { pose: true, avant, raisons };
}

/** La bulle à montrer, telle que la passerelle la donne à `postNotice` (src/valhalla/notices.ts). */
export interface BullePlafond { level: 'souci'; module: string; app: string; title: string; detail: string; page: { view: string }; source: 'info' }

/** Une marque « à dire » (message gardé, `dit: false`) → une bulle, puis `dit: true`. Ne lève jamais. */
function direMarque(kv: { getKv(k: string): string | undefined; setKv(k: string, v: string): void }, cle: string, condition: (m: Record<string, unknown>) => boolean, bulle: (message: string) => BullePlafond, poster: (b: BullePlafond) => unknown): boolean {
  try {
    const brut = kv.getKv(cle);
    if (!brut) return false;
    const m = JSON.parse(brut) as Record<string, unknown>;
    if (!condition(m) || m.dit !== false || typeof m.message !== 'string' || !m.message) return false;
    if (!poster(bulle(m.message))) return false;
    kv.setKv(cle, JSON.stringify({ ...m, dit: true }));
    return true;
  } catch { return false; }
}

/**
 * Au démarrage de la passerelle : si le plafond a été posé et que son message n'a pas encore été montré, une bulle le
 * dit, dans la langue du message (la file « deferred » et la notification ne suffisent pas à un Odin sans messagerie ni
 * appareil abonné). Même chose pour le message du rangement des questions gardées (plus bas). Chaque marque passe à
 * « dit » seulement quand sa bulle est vraiment partie (`poster` rend quelque chose) : sans bulles (applis pas
 * démarrées), elle sera redite au démarrage suivant. Ne lève jamais. Vrai si au moins une bulle est partie.
 */
export function direPlafondUneFois(kv: { getKv(k: string): string | undefined; setKv(k: string, v: string): void }, poster: (b: BullePlafond) => unknown): boolean {
  const plafond = direMarque(kv, MARQUE_JUGE_LOCAL, (m) => m.pose === true, (detail) => ({ level: 'souci', module: 'odin', app: 'Mímir', title: '🛡️ Mímir', detail, page: { view: 'settings' }, source: 'info' }), poster);
  const file = direMarque(kv, MARQUE_FILE, () => true, (detail) => ({ level: 'souci', module: 'odin', app: 'Odin', title: '🧹 Odin', detail, page: { view: 'settings' }, source: 'info' }), poster);
  return plafond || file;
}

// ---------------------------------------------------------------- Les questions gardées pour un modèle
//
// Décision du propriétaire du 19/11/2026 (« Le réviser ») : aucune clé n'est effacée, aucun agent connecté n'est coupé
// (ni les clés des services de modèles, ni la connexion par abonnement, ni la liste des fournisseurs). Il ne reste ici
// que le rangement de la file « offline-queue » : les questions qu'Odin gardait pour les reposer à un modèle.
// Seulement quand AUCUN modèle n'est prêt (ni celui d'Odin, ni un agent connecté) : sinon la passerelle les repose
// elle-même (retryOffline) et rien n'est rangé. Coffre verrouillé : rien non plus (on ne sait pas). Les textes rangés
// passent par le masqueur : aucun secret en clair dans la note.

export const MARQUE_FILE = 'migration-questions-rangees';

export interface MarqueFile {
  at: string;
  /** Questions de la file « offline-queue » rangées dans une note du Cerveau. */
  file: number;
  message?: string;
  dit?: boolean;
}

export interface RangementDeps {
  paths: OdinPaths;
  cfg: OdinConfig;
  kv: { getKv(k: string): string | undefined; setKv(k: string, v: string): void };
  /** Un modèle (celui d'Odin ou un agent connecté) est-il prêt à ce démarrage ? Vrai : rien n'est rangé ni marqué. */
  pret: boolean;
  noter?(e: Record<string, unknown>): void;
  /** Range une note dans le Cerveau ; rend son chemin. Absent : la file reste telle quelle. */
  ranger?(titre: string, corps: string): string;
  /** Masque les secrets d'un texte avant qu'il entre dans la note (le masqueur d'Odin). Absent : les motifs connus. */
  masquer?(texte: string): string;
}

const objet = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined);

// Le message, dans la langue du propriétaire (réglée dans Réglages → Voix) ; une langue sans texte reçoit l'anglais,
// puis le français. Japonais : à faire relire.
const TEXTES_FILE: Record<string, { titre: string; message: (n: number, note: string) => string }> = {
  fr: { titre: 'Questions gardées pour un modèle', message: (n, note) => `🧹 J'avais gardé ${n} question${n > 1 ? 's' : ''} en attendant un modèle pour y répondre, et aucun n'est prêt. Je les ai rangées dans ton Cerveau (note « ${note} ») : tu peux me les reposer, je ferai ce que je sais faire.` },
  en: { titre: 'Questions kept for a model', message: (n, note) => `🧹 I had kept ${n} question${n > 1 ? 's' : ''} waiting for a model to answer them, and none is ready. I filed them in your Brain (note “${note}”): you can ask me again, and I'll do what I can.` },
  es: { titre: 'Preguntas guardadas para un modelo', message: (n, note) => `🧹 Había guardado ${n} pregunta${n > 1 ? 's' : ''} esperando un modelo que las respondiera, y ninguno está listo. Las he guardado en tu Cerebro (nota «${note}»): puedes volver a hacérmelas y haré lo que sé hacer.` },
  de: { titre: 'Für ein Modell aufbewahrte Fragen', message: (n, note) => `🧹 Ich hatte ${n} Frage${n > 1 ? 'n' : ''} aufbewahrt, bis ein Modell sie beantworten kann, und keines ist bereit. Ich habe sie in deinem Gehirn abgelegt (Notiz „${note}“): Du kannst sie mir noch einmal stellen, ich tue, was ich kann.` },
  ja: { titre: 'モデルのために取っておいた質問', message: (n, note) => `🧹 答えられるモデルを待って ${n} 件の質問を取っておきましたが、使えるモデルがありません。あなたの「脳」にしまいました（ノート「${note}」）。もう一度聞いてくれれば、できることをします。` },
};
/** fr, en, es, de, ja ; une autre langue : l'anglais ; aucune (ou « auto ») : le français, langue par défaut. */
const langueFile = (langue: string | undefined): string => {
  const code = (langue ?? '').toLowerCase().replace(/[-_].*$/, '').replace(/^auto$/, '');
  return TEXTES_FILE[code] ? code : code ? 'en' : 'fr';
};

/** Le message du rangement, dans la langue donnée (sinon l'anglais, puis le français). Pur. */
export function messageFile(langue: string | undefined, n: number, note: string): string {
  return TEXTES_FILE[langueFile(langue)].message(n, note);
}

/**
 * Au démarrage, APRÈS le plafond du juge, quand aucun modèle n'est prêt : la file des questions gardées pour un modèle
 * est rangée dans une note du Cerveau, puis vidée ; le propriétaire est prévenu UNE fois, dans sa langue
 * (notification, prochain message ou rapport du matin, bulle). Un modèle prêt : rien n'est fait ni marqué. Idempotent
 * (marque « migration-questions-rangees »). Ne touche ni au coffre, ni à la configuration, ni à aucun fichier d'Odin.
 */
export function rangerQuestionsGardees(d: RangementDeps): MarqueFile | undefined {
  const deja = d.kv.getKv(MARQUE_FILE);
  if (deja) { try { return JSON.parse(deja) as MarqueFile; } catch { return undefined; } }
  if (d.pret) return undefined;
  // Coffre verrouillé : les clés des agents connectés ne se lisent pas, « aucun modèle prêt » n'est pas sûr. Rien n'est
  // rangé ni marqué : un démarrage coffre ouvert revoit la file.
  if (vaultState(d.paths.home) === 'locked') return undefined;
  const masquer = d.masquer ?? ((t: string) => new Redactor().redact(t));
  let l: unknown[] = [];
  try { const x = JSON.parse(d.kv.getKv(QUEUE_KEY) || '[]') as unknown; if (Array.isArray(x)) l = x; } catch { return undefined; }
  const qs = l.map(objet).filter((q): q is Record<string, unknown> => typeof q?.text === 'string' && q.text.trim() !== '');
  const marque: MarqueFile = { at: new Date().toISOString(), file: 0 };
  if (qs.length) {
    if (!d.ranger) return undefined; // rien pour les ranger : la file reste (rien n'est perdu)
    const langue = d.cfg.voice?.stt?.language;
    const titre = TEXTES_FILE[langueFile(langue)].titre;
    const corps = qs.map((q) => `- ${typeof q.at === 'number' ? new Date(q.at).toISOString().slice(0, 16).replace('T', ' ') : '?'}${typeof q.channel === 'string' && q.channel ? ` (${q.channel})` : ''} : ${masquer(String(q.text).replace(/\s+/g, ' ').trim()).slice(0, 500)}`).join('\n');
    const chemin = d.ranger(titre, `${corps}\n`);
    d.kv.setKv(QUEUE_KEY, '[]');
    marque.file = qs.length;
    marque.message = messageFile(langue, qs.length, chemin.replace(/\.md$/, '').split('/').pop() || titre);
    marque.dit = false;
  } else if (l.length) d.kv.setKv(QUEUE_KEY, '[]');
  d.kv.setKv(MARQUE_FILE, JSON.stringify(marque));
  if (marque.message) {
    const texte = marque.message;
    void pushAll(d.paths.home, { title: '🧹 Odin', body: texte, view: 'settings', tag: 'odin-questions' }).catch(() => { /* appareil injoignable : la file et la marque restent */ });
    try {
      const f = JSON.parse(d.kv.getKv('deferred') || '[]') as unknown;
      const attente = Array.isArray(f) ? f.filter((x): x is string => typeof x === 'string') : [];
      d.kv.setKv('deferred', JSON.stringify([...attente, texte].slice(-30)));
    } catch { d.kv.setKv('deferred', JSON.stringify([texte])); }
    console.error(`[modèles] ${marque.file} question(s) gardée(s) pour un modèle rangée(s) dans le Cerveau`);
  }
  try { d.noter?.({ evenement: 'questions-rangees', file: marque.file }); } catch { /* journal facultatif */ }
  return marque;
}
