// Alchimie · la boîte à outils (idées d'IT-Tools, réécrites) : petits calculs sans rien installer, tout reste sur
// la machine. Pur, testé.
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const OUTILS: Record<string, string> = {
  empreinte: 'Empreinte (MD5, SHA-1, SHA-256, SHA-512) d\'un texte',
  base64: 'Base64 : encoder ou décoder (« décode: … »)',
  url: 'Adresse web : encoder ou décoder (« décode: … »)',
  uuid: 'Identifiants uniques (UUID), « 5 » pour en avoir 5',
  jwt: 'Lire un jeton JWT (en-tête, contenu, expiration), sans le vérifier',
  horodatage: 'Horodatage Unix ↔ date',
  json: 'JSON : vérifier et mettre en forme',
  mot_de_passe: 'Mot de passe solide (longueur, 20 par défaut)',
  sous_reseau: 'Sous-réseau (ex. 192.168.1.0/24) : masque, première et dernière adresse, nombre d\'adresses',
  couleur: 'Couleur : #hex ↔ rgb ↔ hsl',
  texte: 'Texte : caractères, mots, lignes, MAJUSCULES, minuscules, nom-de-fichier',
};

const dec = (s: string) => /^(d[ée]code|decode)\s*:\s*/i.test(s) ? s.replace(/^[^:]*:\s*/, '') : null;
const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const date = (ms: number) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'Indian/Mayotte', dateStyle: 'full', timeStyle: 'medium' });

/** Lance un outil sur une entrée ; renvoie le texte du résultat. `now` pour les tests. */
export function outil(nom: string, entree: string, now = Date.now()): string {
  const e = String(entree ?? '');
  switch (nom) {
    case 'empreinte': return ['md5', 'sha1', 'sha256', 'sha512'].map((a) => `${a.toUpperCase()} : ${createHash(a).update(e).digest('hex')}`).join('\n');
    case 'base64': { const d = dec(e); return d !== null ? Buffer.from(d.trim(), 'base64').toString('utf8') : Buffer.from(e, 'utf8').toString('base64'); }
    case 'url': { const d = dec(e); try { return d !== null ? decodeURIComponent(d) : encodeURIComponent(e); } catch { throw new Error('texte mal encodé'); } }
    case 'uuid': { const n = Math.max(1, Math.min(50, Number(e) || 1)); return Array.from({ length: n }, () => randomUUID()).join('\n'); }
    case 'jwt': {
      const p = e.trim().split('.'); if (p.length < 2) throw new Error('ce n\'est pas un jeton JWT (trois parties séparées par des points)');
      let h: Record<string, unknown>, c: Record<string, unknown>;
      try { h = JSON.parse(b64url(p[0])); c = JSON.parse(b64url(p[1])); } catch { throw new Error('jeton illisible'); }
      const t = (k: string) => (typeof c[k] === 'number' ? `\n${k} : ${date((c[k] as number) * 1000)}` : '');
      const exp = typeof c.exp === 'number' ? ((c.exp as number) * 1000 < now ? '\n⚠ expiré' : '\n✓ pas encore expiré') : '';
      return `En-tête : ${JSON.stringify(h, null, 2)}\nContenu : ${JSON.stringify(c, null, 2)}${t('iat')}${t('nbf')}${t('exp')}${exp}\n(signature non vérifiée)`;
    }
    case 'horodatage': {
      const x = e.trim();
      if (!x) return `Maintenant : ${Math.floor(now / 1000)} (${date(now)})`;
      if (/^\d{9,13}$/.test(x)) { const ms = x.length > 11 ? Number(x) : Number(x) * 1000; return `${date(ms)}\nISO : ${new Date(ms).toISOString()}`; }
      const ms = Date.parse(x); if (Number.isNaN(ms)) throw new Error('date non reconnue (ex. 2026-11-13 09:30 ou 1794555000)');
      return `${Math.floor(ms / 1000)} (secondes) · ${ms} (millisecondes)`;
    }
    case 'json': { try { return JSON.stringify(JSON.parse(e), null, 2); } catch (err) { throw new Error(`JSON invalide : ${(err as Error).message}`); } }
    case 'mot_de_passe': {
      const n = Math.max(8, Math.min(128, Number(e) || 20)), A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$%&*+-=?@_';
      const b = randomBytes(n * 2); let out = ''; for (let i = 0; out.length < n && i < b.length; i++) if (b[i] < 256 - (256 % A.length)) out += A[b[i] % A.length];
      return out;
    }
    case 'sous_reseau': {
      const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(e.trim()); if (!m) throw new Error('écris une adresse avec son masque, ex. 192.168.1.0/24');
      const parts = m[1].split('.').map(Number), bits = Number(m[2]); if (parts.some((x) => x > 255) || bits > 32) throw new Error('adresse invalide');
      const ip = parts.reduce((a, x) => a * 256 + x, 0), mask = bits ? (0xffffffff << (32 - bits)) >>> 0 : 0, net = (ip & mask) >>> 0, bc = (net | (~mask >>> 0)) >>> 0;
      const s = (n: number) => [24, 16, 8, 0].map((k) => (n >>> k) & 255).join('.');
      const hosts = bits >= 31 ? 2 ** (32 - bits) : 2 ** (32 - bits) - 2;
      return [`Réseau : ${s(net)}/${bits}`, `Masque : ${s(mask)}`, `Première adresse : ${s(bits >= 31 ? net : net + 1)}`, `Dernière adresse : ${s(bits >= 31 ? bc : bc - 1)}`, `Diffusion : ${s(bc)}`, `Adresses utilisables : ${hosts.toLocaleString('fr-FR')}`].join('\n');
    }
    case 'couleur': {
      const x = e.trim().toLowerCase(); let r: number, g: number, b: number;
      const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(x), rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(x);
      if (hex) { const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]; [r, g, b] = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)); }
      else if (rgb) { [r, g, b] = rgb.slice(1).map(Number); if ([r, g, b].some((v) => v > 255)) throw new Error('valeurs de 0 à 255'); }
      else throw new Error('écris #1e5fd6 ou rgb(30, 95, 214)');
      const [R, G, B] = [r, g, b].map((v) => v / 255), mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, d = mx - mn;
      const s2 = d ? d / (1 - Math.abs(2 * l - 1)) : 0, h2 = !d ? 0 : mx === R ? 60 * (((G - B) / d) % 6) : mx === G ? 60 * ((B - R) / d + 2) : 60 * ((R - G) / d + 4);
      return [`Hex : #${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`, `RGB : rgb(${r}, ${g}, ${b})`, `HSL : hsl(${Math.round((h2 + 360) % 360)}, ${Math.round(s2 * 100)} %, ${Math.round(l * 100)} %)`].join('\n');
    }
    case 'texte': {
      const words = e.trim() ? e.trim().split(/\s+/).length : 0;
      return [`${[...e].length} caractères · ${words} mots · ${e ? e.split('\n').length : 0} ligne(s)`, `MAJUSCULES : ${e.toUpperCase()}`, `minuscules : ${e.toLowerCase()}`, `nom-de-fichier : ${e.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`].join('\n');
    }
    default: throw new Error(`outil inconnu : ${nom} (${Object.keys(OUTILS).join(', ')})`);
  }
}
