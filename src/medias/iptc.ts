// Médias reçus : ressources Photoshop « 8BIM » (APP13 d'un JPEG, étiquette 0x8649 d'un TIFF) et IPTC IIM (ressource
// 0x0404, étiquette 0x83BB). Jeu de caractères : 1:90 = ESC % G → UTF-8, sinon Latin-1 avec encodage douteux. Le XMP
// l'emporte sur l'IPTC (rang plus faible) ; un désaccord sur titre, légende, auteur ou droits est signalé.

import type { Contexte, FicheEnCours } from './contrat.ts';
import { ErreurFormat } from './contrat.ts';
import { ajouterChamp, ajouterChampOctets, candidatPrise, remarque } from './champs.ts';
import { lireDateIptc } from './dates.ts';

/** Ressources 8BIM : seule 0x0404 (IPTC) est lue ; la vignette 0x040C est signalée. */
export function lire8bim(b: Buffer, f: FicheEnCours, ctx: Contexte): void {
  let p = 0, n = 0;
  if (b.toString('latin1', 0, 14) === 'Photoshop 3.0\0') p = 14;
  while (p + 12 <= b.length) {
    if (++n > ctx.budget.bornes.ressources8bim) { remarque(f, 'Photoshop : trop de ressources'); return; }
    ctx.budget.pas();
    const sig = b.toString('latin1', p, p + 4);
    if (sig !== '8BIM' && sig !== 'PHUT' && sig !== 'AgHg' && sig !== 'DCSR') throw new ErreurFormat('ressource Photoshop invalide');
    const id = b.readUInt16BE(p + 4);
    const lNom = b[p + 6];
    let q = p + 7 + lNom;
    if ((lNom + 1) % 2) q++;
    if (q + 4 > b.length) throw new ErreurFormat('ressource Photoshop tronquée');
    const taille = b.readUInt32BE(q);
    q += 4;
    if (q + taille > b.length) throw new ErreurFormat('ressource Photoshop plus longue que le bloc');
    if (id === 0x0404) lireIptc(b.subarray(q, q + taille), f, ctx);
    else if (id === 0x040c || id === 0x0409) remarque(f, 'vignette Photoshop présente');
    p = q + taille + (taille % 2);
  }
}

const TABLE: Record<string, string> = {
  '2:5': 'titre', '2:25': 'mots_cles', '2:80': 'artiste', '2:90': 'ville', '2:92': 'sous_lieu', '2:95': 'region', '2:100': 'code_pays',
  '2:101': 'pays', '2:110': 'editeur_photo', '2:115': 'editeur_photo', '2:116': 'droits', '2:120': 'description', '2:105': 'x:titre_court',
  '2:122': 'x:redacteur', '2:40': 'x:instructions', '2:15': 'x:categorie',
};

/** IPTC IIM : enregistrements 0x1C r d longueur ; longueur étendue > 4 octets refusée. */
export function lireIptc(b: Buffer, f: FicheEnCours, ctx: Contexte): void {
  let p = 0, utf8 = false;
  const vals = new Map<string, Buffer[]>();
  while (p + 5 <= b.length) {
    ctx.budget.pas();
    if (b[p] !== 0x1c) { if (b[p] === 0) break; throw new ErreurFormat('IPTC : marqueur invalide'); }
    const r = b[p + 1], d = b[p + 2];
    let l = b.readUInt16BE(p + 3);
    p += 5;
    if (l & 0x8000) {
      const n = l & 0x7fff;
      if (n > 4 || p + n > b.length) throw new ErreurFormat('IPTC : longueur étendue refusée');
      l = 0; for (let i = 0; i < n; i++) l = l * 256 + b[p + i];
      p += n;
    }
    if (p + l > b.length) throw new ErreurFormat('IPTC : enregistrement plus long que le bloc');
    const v = b.subarray(p, p + l);
    p += l;
    if (r === 1 && d === 90) { utf8 = v.length >= 3 && v[0] === 0x1b && v[1] === 0x25 && v[2] === 0x47; continue; }
    const k = `${r}:${d}`;
    const l2 = vals.get(k); if (l2) { if (l2.length < 256) l2.push(v); } else vals.set(k, [v]);
  }
  const enc = utf8 ? 'utf-8' : 'latin1';
  for (const [k, liste] of vals) {
    const cle = TABLE[k];
    if (!cle) continue;
    const source = `IPTC:${k}`;
    if (cle === 'mots_cles' || (cle === 'artiste' && liste.length > 1)) {
      const textes = liste.map((x) => new TextDecoder(enc).decode(x).trim()).filter(Boolean);
      ajouterChamp(f, ctx, cle, textes.join(' ; '), source, { valeurs: textes, encodageDouteux: !utf8 && liste.some((x) => x.some((o) => o >= 0x80)) });
    } else if (cle.startsWith('x:')) ajouterChampOctets(f, ctx, cle, liste[0], enc, source, { nom: cle.slice(2).replace('_', ' '), groupe: 'œuvre' });
    else ajouterChampOctets(f, ctx, cle, liste[0], enc, source);
  }
  const date = vals.get('2:55')?.[0];
  if (date) candidatPrise(ctx, lireDateIptc(date.toString('latin1'), vals.get('2:60')?.[0]?.toString('latin1'), 'prise de vue', ctx.maintenant), 4, 'IPTC:2:55 + 2:60');
  // Désaccords XMP / IPTC sur les champs principaux.
  for (const cle of ['titre', 'description', 'artiste', 'droits']) {
    const xmp = f.champs.find((c) => c.cle === cle && c.source.startsWith('XMP'));
    const iptc = f.champs.find((c) => c.cle === cle && c.source.startsWith('IPTC'));
    if (xmp && iptc && xmp.valeur.normalize('NFKC').toLowerCase() !== iptc.valeur.normalize('NFKC').toLowerCase()) remarque(f, `XMP et IPTC ne disent pas la même chose (${xmp.nom.toLowerCase()})`);
  }
}
