// Tirésias — le banc de mesure de vitesse, lancé dans un processus à part (« node mesure.ts '<réglages en JSON>' »).
// Il crée UN fichier de test, le remplit de données impossibles à compresser, mesure la lecture puis l'écriture
// (séquentielles par blocs de 1 Mo, aléatoires par blocs de 4 Ko, avec 1 ou plusieurs accès en parallèle), puis
// efface le fichier. Il ne touche jamais à autre chose que ce fichier : pas de disque brut, pas d'autre chemin.
// Pourquoi à part : les accès en parallèle occupent toute la réserve de fils d'exécution de Node ; lancés dans
// Odin lui-même, ils figeraient tout le reste le temps de la mesure.
// Ce qu'il écrit sur sa sortie : une ligne de JSON par étape, par résultat, puis { fin: true }.
import { randomFillSync } from 'node:crypto';
import { close, closeSync, constants, fdatasync, open, read, unlinkSync, write } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Le nom obligé du fichier de test : le banc refuse de créer ou d'effacer quoi que ce soit d'autre. */
export const NOM_TEST = /^odin-test-vitesse-[a-f0-9]{10}\.tmp$/;
/** Les mesures, dans l'ordre : bloc (octets), accès en parallèle, au hasard ou à la suite. */
export const MESURES = [
  { nom: 'seq1m_q8', bloc: 1024 * 1024, file: 8, alea: false },
  { nom: 'seq1m_q1', bloc: 1024 * 1024, file: 1, alea: false },
  { nom: 'rnd4k_q32', bloc: 4096, file: 32, alea: true },
  { nom: 'rnd4k_q1', bloc: 4096, file: 1, alea: true },
] as const;
export interface LigneMesure { nom: string; sens: 'lecture' | 'ecriture'; moS: number; acces: number; latMs: number; octets: number; ms: number }

const M = 1024 * 1024;
/** WebAssembly (toujours présent dans Node ; absent des types du projet, qui n'incluent pas ceux du navigateur). */
const WASM = (globalThis as unknown as { WebAssembly: { Memory: new (o: { initial: number }) => { buffer: ArrayBuffer } } }).WebAssembly;
const dire = (x: unknown) => { process.stdout.write(`${JSON.stringify(x)}\n`); };
const p = <T>(f: (cb: (e: NodeJS.ErrnoException | null, v: T) => void) => void) => new Promise<T>((ok, ko) => f((e, v) => (e ? ko(e) : ok(v))));

/** `ecoute` : s'arrêter (et effacer le fichier) dès que l'entrée du processus se ferme, c'est-à-dire dès qu'Odin n'est plus là. */
interface Reglages { fichier: string; octets: number; dureeMs: number; ecoute?: boolean }
async function banc(o: Reglages): Promise<number> {
  if (!NOM_TEST.test(basename(o.fichier))) { dire({ erreur: 'nom de fichier de test refusé' }); return 2; }
  const octets = Math.floor(o.octets / M) * M, dureeMs = Math.max(100, Math.min(60_000, Math.round(o.dureeMs)));
  if (!(octets >= 4 * M) || octets > 64 * 1024 * M) { dire({ erreur: 'taille de fichier refusée' }); return 2; }
  // Mémoire alignée sur les pages : l'écriture directe (sans le cache du système) l'exige. La mémoire d'un module
  // WebAssembly l'est toujours ; un tampon ordinaire de Node ne l'est pas. 8 Mo de données au hasard à écrire,
  // 8 Mo où lire.
  const mem = Buffer.from(new WASM.Memory({ initial: (16 * M) / 65536 }).buffer), source = mem.subarray(0, 8 * M), lu = mem.subarray(8 * M);
  randomFillSync(source);
  let arret = false, fd: number | undefined, cree = false;
  const stop = () => { arret = true; };
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(s, stop);
  // Odin s'arrête ou disparaît : l'entrée se ferme, le banc s'arrête et efface son fichier.
  if (o.ecoute) { process.stdin.on('end', stop); process.stdin.on('close', stop); process.stdin.on('error', stop); process.stdin.resume(); }
  // Dernier filet : quoi qu'il arrive, le fichier créé ici ne reste pas.
  const effacer = () => { if (fd !== undefined) { try { closeSync(fd); } catch { /* déjà fermé */ } fd = undefined; } if (cree) { try { unlinkSync(o.fichier); } catch { /* déjà effacé */ } cree = false; } };
  process.on('exit', effacer);
  try {
    // Création : jamais par-dessus un fichier existant (O_EXCL). D'abord en écriture directe ; si le système de
    // fichiers ne sait pas (EINVAL), avec le cache du système, et on le dit.
    let direct = constants.O_DIRECT !== undefined;
    const ouvrir = (drapeaux: number) => p<number>((cb) => open(o.fichier, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | drapeaux, 0o600, cb));
    try { fd = await ouvrir(direct ? constants.O_DIRECT : 0); }
    catch (e) { if (!direct || (e as NodeJS.ErrnoException).code !== 'EINVAL') throw e; direct = false; fd = await ouvrir(0); }
    cree = true;
    const ecrire = (pos: number, depuis: number, n: number) => p<number>((cb) => write(fd!, source, depuis, n, pos, cb));
    try { await ecrire(0, 0, M); }
    catch (e) {
      // Ouvert en direct, mais l'écriture directe est refusée : on recommence avec le cache du système.
      if (!direct || (e as NodeJS.ErrnoException).code !== 'EINVAL') throw e;
      await p<void>((cb) => close(fd!, (er) => cb(er, undefined))); fd = undefined; unlinkSync(o.fichier); cree = false;
      direct = false; fd = await ouvrir(0); cree = true; await ecrire(0, 0, M);
    }
    dire({ etape: 'ouverture', direct });

    // Remplissage : tout le fichier, par blocs de 1 Mo pris à des endroits différents des données au hasard.
    const t0 = performance.now(); let dit = t0;
    for (let pos = M; pos < octets && !arret; pos += M) {
      await ecrire(pos, ((pos / M) % 8) * M, M);
      if (performance.now() - dit > 250) { dit = performance.now(); dire({ etape: 'remplissage', fait: pos + M, total: octets }); }
    }
    if (arret) return 3;
    await p<void>((cb) => fdatasync(fd!, (e) => cb(e, undefined)));
    const remplissageMoS = octets / 1e6 / Math.max(0.001, (performance.now() - t0) / 1000);
    dire({ etape: 'remplissage', fait: octets, total: octets, moS: remplissageMoS });

    const mesurer = async (m: (typeof MESURES)[number], ecrit: boolean): Promise<LigneMesure> => {
      const n = Math.floor(octets / m.bloc), debut = performance.now(), fin = debut + dureeMs; let suivant = 0, faits = 0, attente = 0;
      await Promise.all(Array.from({ length: Math.min(m.file, n) }, async (_x, k) => {
        const tampon = lu.subarray(k * m.bloc, (k + 1) * m.bloc);
        while (!arret && performance.now() < fin) {
          const i = m.alea ? Math.floor(Math.random() * n) : suivant++ % n, t = performance.now();
          if (ecrit) await ecrire(i * m.bloc, m.bloc === M ? (i % 7) * M : ((i * 7919) % 2047) * 4096, m.bloc);
          else await p<number>((cb) => read(fd!, tampon, 0, m.bloc, i * m.bloc, cb));
          attente += performance.now() - t; faits++;
        }
      }));
      // Avec le cache du système, une écriture n'est finie que quand tout est vraiment sur le disque.
      if (ecrit && !direct) await p<void>((cb) => fdatasync(fd!, (e) => cb(e, undefined)));
      const ms = performance.now() - debut, s = Math.max(0.001, ms / 1000);
      return { nom: m.nom, sens: ecrit ? 'ecriture' : 'lecture', moS: (faits * m.bloc) / 1e6 / s, acces: faits / s, latMs: faits ? attente / faits : 0, octets: faits * m.bloc, ms };
    };
    let rang = 0;
    for (const ecrit of [false, true]) for (const m of MESURES) {
      if (arret) return 3;
      dire({ etape: 'mesure', nom: m.nom, sens: ecrit ? 'ecriture' : 'lecture', rang: ++rang, sur: MESURES.length * 2 });
      dire({ resultat: await mesurer(m, ecrit) });
    }
    if (arret) return 3;
    dire({ fin: true, direct, remplissageMoS });
    return 0;
  } catch (e) {
    const er = e as NodeJS.ErrnoException;
    dire({ erreur: er.code === 'ENOSPC' ? 'plus de place sur ce disque' : er.code === 'EACCES' || er.code === 'EPERM' ? 'pas le droit d\'écrire dans ce dossier' : er.code === 'EEXIST' ? 'un fichier de ce nom existe déjà' : er.code === 'EROFS' ? 'ce disque est en lecture seule' : er.code === 'EIO' ? 'le disque a renvoyé une erreur de lecture ou d\'écriture' : er.message, code: er.code });
    return 1;
  } finally { effacer(); }
}

// Lancé directement (et pas chargé comme module par un essai) : on lit les réglages et on mesure.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let o: Reglages | undefined;
  try { o = JSON.parse(process.argv[2] ?? '') as typeof o; } catch { /* réglages illisibles */ }
  if (!o || typeof o.fichier !== 'string' || typeof o.octets !== 'number' || typeof o.dureeMs !== 'number') { dire({ erreur: 'réglages illisibles' }); process.exit(2); }
  banc(o).then((code) => { process.exitCode = code; process.stdin.pause(); process.stdin.destroy(); }, (e) => { dire({ erreur: (e as Error).message }); process.exit(1); });
}
