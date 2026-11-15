// Hermès · le genre « logiciel » de la bibliothèque commune : reconnaître un installateur (exe, msi, msix, dmg, pkg,
// deb, rpm, AppImage, apk, zip d'installation), le système visé, l'éditeur et la version ; l'icône est lue dans le
// fichier quand c'est possible sans rien installer (ressources d'un programme Windows), sinon une icône par type.
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { iconeType, type Fiche, type Genre } from './bibliotheque.ts';
import { SOFT } from './sources.ts';

export const MOTIF_LOGICIEL = /\.(exe|msi|msix|msixbundle|appx|dmg|pkg|deb|rpm|appimage|apk|zip)$/i;
/** Le système visé d'après le type de fichier. Pur. */
export function viseDuNom(nom: string): string {
  const e = (/\.([a-z0-9]+)$/i.exec(nom)?.[1] ?? '').toLowerCase();
  return ['exe', 'msi', 'msix', 'msixbundle', 'appx'].includes(e) ? 'Windows' : ['dmg', 'pkg'].includes(e) ? 'macOS' : ['deb', 'rpm', 'appimage'].includes(e) ? `Linux${e === 'deb' ? ' (Debian, Ubuntu)' : e === 'rpm' ? ' (Fedora, Rocky)' : ''}` : e === 'apk' ? 'Android' : 'selon le contenu';
}

// ---------------------------------------------------------------- Les ressources d'un programme Windows (PE)
/** Lit un morceau d'un fichier. */
function lecteur(chemin: string): { at: (off: number, len: number) => Buffer; taille: number; fermer: () => void } {
  const fd = openSync(chemin, 'r'), taille = statSync(chemin).size;
  return { taille, fermer: () => closeSync(fd), at: (off, len) => { const n = Math.max(0, Math.min(len, taille - off)); const b = Buffer.alloc(n); if (n) readSync(fd, b, 0, n, off); return b; } };
}
export interface InfoPe { editeur?: string; produit?: string; version?: string; description?: string; icone?: string }
/**
 * L'éditeur, le produit, la version et l'icône d'un programme Windows (.exe), lus dans ses ressources (type 16 : les
 * informations de version ; types 14 et 3 : le groupe d'icônes et l'icône). Rien n'est exécuté. Rend `undefined`
 * pour un fichier qui n'est pas un programme Windows.
 */
export function infoPe(chemin: string): InfoPe | undefined {
  let L: ReturnType<typeof lecteur> | undefined;
  try {
    L = lecteur(chemin); const r = L;
    const dos = r.at(0, 64); if (dos.length < 64 || dos.toString('latin1', 0, 2) !== 'MZ') return undefined;
    const pe = dos.readUInt32LE(0x3c), h = r.at(pe, 24); if (h.toString('latin1', 0, 4) !== 'PE\0\0') return undefined;
    const nsec = h.readUInt16LE(6), optSize = h.readUInt16LE(20), opt = r.at(pe + 24, optSize), plus = opt.readUInt16LE(0) === 0x20b;
    const dd = plus ? 112 : 96; if (opt.length < dd + 24) return undefined;
    const resRva = opt.readUInt32LE(dd + 16); if (!resRva) return {};
    const secs = r.at(pe + 24 + optSize, nsec * 40), sections: Array<{ va: number; vs: number; raw: number; rs: number }> = [];
    for (let i = 0; i < nsec; i++) sections.push({ vs: secs.readUInt32LE(i * 40 + 8), va: secs.readUInt32LE(i * 40 + 12), rs: secs.readUInt32LE(i * 40 + 16), raw: secs.readUInt32LE(i * 40 + 20) });
    const off = (rva: number) => { const s = sections.find((x) => rva >= x.va && rva < x.va + Math.max(x.vs, x.rs)); return s ? rva - s.va + s.raw : -1; };
    const base = off(resRva); if (base < 0) return {};
    const entrees = (dirOff: number) => { const d = r.at(base + dirOff, 16); if (d.length < 16) return []; const n = d.readUInt16LE(12) + d.readUInt16LE(14), e = r.at(base + dirOff + 16, Math.min(n, 512) * 8), out: Array<{ id: number; sous: boolean; off: number }> = []; for (let i = 0; i + 8 <= e.length; i += 8) { const nm = e.readUInt32LE(i), o = e.readUInt32LE(i + 4); out.push({ id: nm & 0x80000000 ? -1 : nm, sous: Boolean(o & 0x80000000), off: o & 0x7fffffff }); } return out; };
    /** La donnée d'une ressource : type, puis identifiant (le premier si absent), puis la première langue. */
    const donnee = (type: number, id?: number): Buffer | undefined => {
      const t = entrees(0).find((x) => x.id === type && x.sous); if (!t) return undefined;
      const n = entrees(t.off).find((x) => (id === undefined || x.id === id)); if (!n) return undefined;
      let leaf = n; if (n.sous) { const l = entrees(n.off)[0]; if (!l) return undefined; leaf = l; }
      const de = r.at(base + leaf.off, 8); if (de.length < 8) return undefined;
      const o = off(de.readUInt32LE(0)), len = de.readUInt32LE(4); if (o < 0 || len <= 0 || len > 4 * 1024 * 1024) return undefined;
      return r.at(o, len);
    };
    const out: InfoPe = {};
    // Informations de version : chaînes « clé » → « valeur » en UTF-16.
    const v = donnee(16);
    if (v) {
      const lire = (cle: string): string | undefined => {
        const k = Buffer.from(`${cle}\0`, 'utf16le'), i = v.indexOf(k); if (i < 0) return undefined;
        let p = i + k.length; while (p + 1 < v.length && v.readUInt16LE(p) === 0) p += 2;
        let fin = p; while (fin + 1 < v.length && v.readUInt16LE(fin) !== 0) fin += 2;
        const t = v.toString('utf16le', p, fin).trim(); return t && t.length < 200 ? t : undefined;
      };
      out.editeur = lire('CompanyName'); out.produit = lire('ProductName'); out.version = lire('ProductVersion') ?? lire('FileVersion'); out.description = lire('FileDescription');
    }
    // Icône : le groupe d'icônes, la plus grande image ; un fichier .ico rebâti (ou le PNG tel quel).
    const g = donnee(14);
    if (g && g.length >= 6) {
      const n = g.readUInt16LE(4); let best: { w: number; id: number; e: Buffer } | undefined;
      for (let i = 0; i < n && 6 + i * 14 + 14 <= g.length; i++) { const e = g.subarray(6 + i * 14, 6 + i * 14 + 14), w = e[0] || 256; if (!best || w > best.w) best = { w, id: e.readUInt16LE(12), e }; }
      const img = best ? donnee(3, best.id) : undefined;
      if (img && img.length < 400 * 1024) {
        if (img.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') out.icone = `data:image/png;base64,${img.toString('base64')}`;
        else { const head = Buffer.alloc(22); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4); best!.e.copy(head, 6, 0, 12); head.writeUInt32LE(img.length, 14); head.writeUInt32LE(22, 18); out.icone = `data:image/x-icon;base64,${Buffer.concat([head, img]).toString('base64')}`; }
      }
    }
    return out;
  } catch { return undefined; } finally { L?.fermer(); }
}

/** Reconnaître un installateur : catalogue d'Hermès (nom, version, page officielle), système visé, ressources du programme. */
export async function reconnaitreLogiciel(chemin: string, nom: string): Promise<Partial<Fiche>> {
  const src = SOFT.find((x) => x.match.test(nom)), v = src ? src.match.exec(nom)?.[1] : undefined;
  const pe = /\.exe$/i.test(nom) ? infoPe(chemin) : undefined;
  const version = v ?? pe?.version ?? /(\d+(?:[._]\d+){1,3})/.exec(nom)?.[1]?.replace(/_/g, '.');
  return {
    produit: src?.name ?? pe?.produit ?? nom.replace(MOTIF_LOGICIEL, '').replace(/[-_ ]?v?\d+(?:[._]\d+)+.*$/, '').replace(/[-_]+/g, ' ').trim(),
    ...(pe?.editeur ? { editeurNom: pe.editeur } : {}), ...(version ? { version } : {}), vise: viseDuNom(nom),
    ...(src?.page ? { page: src.page } : {}), detail: pe?.description ?? src?.about,
    arch: /arm64|aarch64/i.test(nom) ? 'arm64' : /x64|amd64|x86_64|win64/i.test(nom) ? 'x86_64' : /x86|win32|i[36]86/i.test(nom) ? 'x86 (32 bits)' : undefined,
    icone: pe?.icone ?? iconeType(nom),
  };
}

export const GENRE_LOGICIEL: Genre = {
  id: 'logiciel', libelle: 'logiciel', libelles: 'logiciels', motif: MOTIF_LOGICIEL, importes: 'Importés', journal: 'fjalar', fichierJournal: 'bibliotheque.jsonl', cleVerif: 'verifBiblio',
  origine: 'Hermès · logiciel', usage: 'l\'installer', appli: 'Hermès', reconnaitre: reconnaitreLogiciel,
};
