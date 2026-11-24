// Vortex · la configuration d'un appareil du VPN, gardée dans le coffre (maquette « Réseau » validée, lot R8).
// Réponse du propriétaire : le QR code est « gardé (chiffré dans le coffre) pour le remontrer ».
//
// La configuration d'un appareil contient sa clé privée. Elle est rangée dans le coffre chiffré (Thésauros) et, tant que
// le coffre est ouvert, seulement là : les réglages de Vortex ne la gardent pas. Elle y ENTRE par le lien Vortex →
// Thésauros qui existait (l'action « ajouter » du coffre). Ce fichier fait le reste : la relire, la renommer, l'effacer.
// Ce ne sont PAS des actions : rien ici ne peut être lancé par la parole, un outil, une automatisation, une clé d'API ou
// une autre appli. Seules les actions de Vortex réservées au propriétaire (qr, telecharger, modifier, revoquer) et le
// rangement de Vortex passent par ici.
//
// Une entrée du coffre = une note (la configuration est dans `notes`, pas dans « mot de passe » : elle ne passe ni dans
// le bilan des mots de passe, ni dans la vérification des fuites, et ne peut plus servir de « mot de passe » à un outil).
// Ses deux clés sont aussi dans `champs`, pour que le masqueur d'Odin les cache (il relit le coffre au démarrage). Elle est reconnue par la clé PUBLIQUE de l'appareil
// (`url` : « vortex:<clé publique> »), pas par son nom : deux appareils ne se confondent jamais, un nom peut changer.
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { vaultState } from '../../vault.ts';
import { load, store, type Item } from '../modules/brisingamen.ts';
import type { ModCtx } from '../types.ts';

/** Le nom de site sous lequel le lien Vortex → Thésauros range une configuration (avant ce lot, l'entrée restait telle quelle : la configuration dans son mot de passe). */
export const SITE_AVANT = 'Vortex (VPN de la maison)';
const MARQUE = 'vortex:';
const DOSSIER = 'Personnel';

/** Le dossier du coffre (Thésauros), vu depuis Vortex. */
const duCoffre = (ctx: ModCtx): ModCtx => ({ ...ctx, dir: join(ctx.dir, '..', 'brisingamen') });

/** Le coffre est-il ouvert ? Fermé : sa clé manque (Odin pas encore redémarré) ou le mot de passe maître le verrouille. */
export function coffreOuvert(ctx: ModCtx): boolean {
  if (!/^[a-f0-9]{64}$/.test(process.env.BRISINGAMEN_KEY ?? '')) return false;
  try { return vaultState(ctx.home) !== 'locked'; } catch { return false; }
}

const estDe = (i: Item, pub: string, nom?: string): boolean => !i.membre && (i.url === `${MARQUE}${pub}` || (nom !== undefined && i.url === SITE_AVANT && i.user === nom && i.name === `VPN ${nom}`));
/** La clé privée écrite dans une configuration gardée (44 caractères en base64), ou rien. */
const cleDans = (conf: unknown): string | undefined => /^PrivateKey = ([A-Za-z0-9+/]{43}=)\s*$/m.exec(String(conf ?? ''))?.[1];

/** La clé publique que donne une clé privée (X25519) ; clé mal écrite : rien. */
function publiqueDe(priv: string): string | undefined {
  try {
    const brute = Buffer.from(priv, 'base64'); if (brute.length !== 32) return undefined;
    const k = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), brute]), format: 'der', type: 'pkcs8' });
    return createPublicKey(k).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  } catch { return undefined; }
}
/**
 * La clé privée gardée dans cette entrée, si c'est bien celle de CET appareil (elle donne sa clé publique). Une entrée
 * du même nom laissée par un autre appareil, ou une entrée abîmée, ne passe pas : jamais la clé d'un autre dans un QR code.
 */
function cleDe(i: Item | undefined, pub: string): string | undefined {
  for (const conf of [i?.notes, i?.password]) { const cle = cleDans(conf); if (cle && publiqueDe(cle) === pub) return cle; }
  return undefined;
}

/** Le coffre, lu ; `undefined` : fermé ou illisible (rien n'est dit de plus : jamais un contenu dans une erreur). */
function lire(ctx: ModCtx): Item[] | undefined {
  if (!coffreOuvert(ctx)) return undefined;
  try { return load(duCoffre(ctx)); } catch { return undefined; }
}
/**
 * Le coffre réécrit d'un coup : la nouvelle version est d'abord écrite à côté (chiffrée, comme le coffre), puis mise à sa
 * place. Une coupure pendant l'écriture laisse l'ancien coffre entier (tous les mots de passe y sont), jamais un fichier à moitié écrit.
 */
function ecrire(ctx: ModCtx, items: Item[]): boolean {
  const c = duCoffre(ctx), aCote = join(c.dir, 'vortex-ecriture.tmp');
  try {
    mkdirSync(aCote, { recursive: true }); store({ ...c, dir: aCote }, items);
    renameSync(join(aCote, 'coffre.bin'), join(c.dir, 'coffre.bin'));
    return true;
  } catch { return false; } finally { try { rmSync(aCote, { recursive: true, force: true }); } catch { /* un reste chiffré, sans effet */ } }
}

/**
 * La configuration vient d'être rangée par le lien Vortex → Thésauros (l'action « ajouter » du coffre : le lien reste
 * visible dans les liens entre applis). Ici, son entrée est marquée de la clé publique de l'appareil et devient
 * une note ; les entrées du même nom laissées par un appareil retiré avant ce lot sont effacées. `false` : rien trouvé.
 */
export function marquerConfig(ctx: ModCtx, a: { pub: string; nom: string }): boolean {
  const items = lire(ctx); if (!items) return false;
  const miennes = items.filter((i) => estDe(i, a.pub, a.nom)), it = [...miennes].reverse().find((i) => cleDe(i, a.pub));
  if (!it) return false;
  const conf = cleDans(it.notes) && publiqueDe(String(cleDans(it.notes))) === a.pub ? String(it.notes) : String(it.password);
  // Les deux clés sont aussi rangées comme « autres secrets » de l'entrée : le masqueur d'Odin (heimdall/redact.ts) cache
  // partout les valeurs de ces champs-là (il ne lit pas les notes). Aucun de ces champs ne peut servir de référence
  // « coffre:… » dans un outil (liste fermée : identifiant, mot de passe).
  const partagee = /^PresharedKey = ([A-Za-z0-9+/]{43}=)\s*$/m.exec(conf)?.[1];
  const note: Item = { id: it.id, type: 'note', name: `VPN ${a.nom}`, user: a.nom, url: `${MARQUE}${a.pub}`, notes: conf, champs: { 'clé privée': String(cleDans(conf)), ...(partagee ? { 'clé partagée': partagee } : {}) }, folder: it.folder ?? DOSSIER, updated: ctx.now().toISOString() };
  return ecrire(ctx, [...items.filter((i) => !miennes.includes(i)), note]);
}

/** La clé privée d'un appareil, relue dans le coffre. `ferme` : le coffre n'a pas pu être lu ; sinon la clé, ou rien si l'entrée n'y est pas. */
export function cleGardee(ctx: ModCtx, a: { pub: string; nom: string }): { ferme: boolean; cle?: string; /** trouvée dans une entrée d'avant ce lot (pas encore marquée de sa clé publique) */ ancienne?: boolean } {
  const items = lire(ctx); if (!items) return { ferme: true };
  for (const i of items) if (estDe(i, a.pub, a.nom)) { const cle = cleDe(i, a.pub); if (cle) return { ferme: false, cle, ancienne: i.url !== `${MARQUE}${a.pub}` }; }
  return { ferme: false };
}

/** L'appareil change de nom : son entrée du coffre aussi (la configuration elle-même ne change pas). */
export function renommerConfig(ctx: ModCtx, a: { pub: string; avant: string; apres: string }): boolean {
  const items = lire(ctx); if (!items) return false;
  let touche = false;
  for (const i of items) if (estDe(i, a.pub, a.avant)) { i.name = `VPN ${a.apres}`; i.user = a.apres; i.url = `${MARQUE}${a.pub}`; i.updated = ctx.now().toISOString(); touche = true; }
  return touche ? ecrire(ctx, items) : true;
}

/** L'empreinte d'une clé publique : ce que Vortex garde d'un appareil retiré dont l'entrée reste à effacer (jamais la clé). */
export const empreinteDe = (pub: string): string => createHash('sha256').update(`vortex:${pub}`).digest('hex').slice(0, 32);

/**
 * Retire du coffre la configuration d'un appareil (il est retiré du VPN : sa clé ne vaut plus rien, elle n'a plus à être
 * gardée). L'appareil est désigné par sa clé publique, ou par son empreinte. `ferme` : le coffre n'a pas pu être lu ni
 * écrit, rien n'est retiré (à refaire quand il sera ouvert).
 */
export function retirerConfig(ctx: ModCtx, a: { pub?: string; empreinte?: string; nom?: string }): { ferme: boolean; retires: number } {
  const items = lire(ctx); if (!items) return { ferme: true, retires: 0 };
  const vise = (i: Item): boolean => (a.pub !== undefined ? estDe(i, a.pub, a.nom) : !i.membre && ((typeof i.url === 'string' && i.url.startsWith(MARQUE) && empreinteDe(i.url.slice(MARQUE.length)) === a.empreinte) || (a.nom !== undefined && i.url === SITE_AVANT && i.user === a.nom && i.name === `VPN ${a.nom}`)));
  const reste = items.filter((i) => !vise(i)), retires = items.length - reste.length;
  if (retires && !ecrire(ctx, reste)) return { ferme: true, retires: 0 };
  return { ferme: false, retires };
}
