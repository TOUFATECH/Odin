// Achille · son autorité de certification locale, à lui seul (distincte de celle d'Odin). Elle sert à lire le HTTPS
// de TES sites quand tes appareils passent par le proxy d'essai. Elle est LIMITÉE par construction (contrainte de
// noms) : adresses privées, noms locaux, et les domaines que tu as prouvés. Elle ne peut rien signer pour un autre
// site d'Internet : un navigateur refuserait le certificat.
// La clé privée est chiffrée avec la clé de la machine (chiffrerChamp) dans ca.json (0o600). Les certificats de
// chaque site sont signés à la demande et gardés en mémoire. La liste des domaines change : l'autorité est refaite,
// et la page dit de la réinstaller sur tes appareils.
import { createPrivateKey, X509Certificate, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';
import { issueCertificate, LOCAL_SUFFIXES, type Signer } from '../../web/access.ts';

interface Fichier { cert: string; cle: string; domaines: string[]; cree: string }
export interface Autorite {
  cert: string; domaines: string[]; cree: string;
  /** empreinte SHA-256 du certificat (à comparer sur l'appareil) */ empreinte: string;
  /** l'autorité vient d'être (re)faite : à réinstaller sur les appareils */ refaite: boolean;
  /** le certificat (et sa clé) d'un site, signé à la demande */
  pour(hote: string): { cert: string; key: string };
}

const caches = new Map<string, { cle: string; signer: Signer; feuilles: Map<string, { cert: string; key: string }> }>();
const pareil = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** L'autorité d'Achille pour cette liste de domaines prouvés (faite ou refaite au besoin). */
export function autorite(dir: string, home: string, domainesProuves: string[]): Autorite {
  const f = join(dir, 'ca.json'), domaines = [...new Set(domainesProuves.map((d) => d.toLowerCase()))].sort();
  let x: Fichier | undefined, refaite = false;
  try { x = JSON.parse(readFileSync(f, 'utf8')) as Fichier; } catch { x = undefined; }
  if (!x || !pareil(x.domaines ?? [], domaines)) {
    const r = issueCertificate('Achille (Odin) — essais de tes sites', [], [], { isCA: true, days: 825, permittedDns: [...LOCAL_SUFFIXES, ...domaines] });
    x = { cert: r.cert, cle: chiffrerChamp(home, r.key), domaines, cree: new Date().toISOString() };
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const t = `${f}.tmp`; writeFileSync(t, JSON.stringify(x, null, 2), { mode: 0o600 }); renameSync(t, f);
    caches.delete(f); refaite = true;
  }
  let c = caches.get(f);
  if (!c || c.cle !== x.cle) {
    const xc = new X509Certificate(x.cert), key = createPrivateKey(dechiffrerChamp(home, x.cle));
    const ski = createHash('sha1').update(xc.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).digest();
    c = { cle: x.cle, signer: { cn: /CN=([^\n]+)/.exec(xc.subject)?.[1] ?? 'Achille', key, ski }, feuilles: new Map() };
    caches.set(f, c);
  }
  const cc = c, fx = x;
  return {
    cert: fx.cert, domaines: fx.domaines, cree: fx.cree, refaite,
    empreinte: new X509Certificate(fx.cert).fingerprint256,
    pour(hote: string) {
      const h = hote.toLowerCase();
      const deja = cc.feuilles.get(h); if (deja) return deja;
      const v = isIP(h);
      if (v === 6) throw new Error('adresse IPv6 : pas d\'interception en v1');
      const r = issueCertificate(h.slice(0, 60), v ? [] : [h], v ? [h] : [], { signer: cc.signer, days: 90 });
      const feuille = { cert: r.cert + fx.cert, key: r.key };
      if (cc.feuilles.size > 500) cc.feuilles.clear();
      cc.feuilles.set(h, feuille);
      return feuille;
    },
  };
}
/** Le certificat de l'autorité (à installer), ou rien si elle n'est pas encore faite. */
export function certificatAutorite(dir: string): string | undefined {
  const f = join(dir, 'ca.json'); if (!existsSync(f)) return undefined;
  try { return (JSON.parse(readFileSync(f, 'utf8')) as Fichier).cert; } catch { return undefined; }
}
