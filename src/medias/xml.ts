// Médias reçus : un petit lecteur XML borné (XMP, iXML, OOXML, ODF, EPUB). Automate à indexOf, aucune expression
// régulière. Refuse les DTD et les entités déclarées (<!DOCTYPE, <!ENTITY) ; seules les 5 entités prédéfinies et les
// références numériques valides sont décodées. Préfixes résolus par xmlns (comparés par URI) ; xml:lang hérité.

import { ErreurFormat } from './contrat.ts';

export interface NoeudXml { ns: string; local: string; attrs: Array<{ ns: string; local: string; valeur: string }>; enfants: NoeudXml[]; texte: string; lang?: string }

const NS_XML = 'http://www.w3.org/XML/1998/namespace';
const PREDEF: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };

/** Décode les entités d'un texte ; refuse les références invalides. */
export function decoderEntites(s: string): string {
  if (!s.includes('&')) return s;
  let r = '', i = 0;
  while (i < s.length) {
    const k = s.indexOf('&', i);
    if (k < 0) { r += s.slice(i); break; }
    r += s.slice(i, k);
    const f = s.indexOf(';', k);
    if (f < 0 || f - k > 12) throw new ErreurFormat('entité XML mal formée');
    const nom = s.slice(k + 1, f);
    if (nom[0] === '#') {
      const hex = nom[1] === 'x' || nom[1] === 'X';
      const corps = nom.slice(hex ? 2 : 1);
      if (!corps.length) throw new ErreurFormat('référence XML vide');
      for (const c of corps) {
        const ok = (c >= '0' && c <= '9') || (hex && ((c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')));
        if (!ok) throw new ErreurFormat('référence XML invalide');
      }
      const v = parseInt(corps, hex ? 16 : 10);
      if (!(v > 0) || v > 0x10ffff || (v >= 0xd800 && v <= 0xdfff)) throw new ErreurFormat('référence XML interdite');
      r += String.fromCodePoint(v);
    } else {
      const v = PREDEF[nom];
      if (v === undefined) throw new ErreurFormat(`entité XML inconnue (${nom.slice(0, 16)})`);
      r += v;
    }
    i = f + 1;
  }
  return r;
}

const estBlanc = (c: string) => c === ' ' || c === '\n' || c === '\r' || c === '\t';

export function lireXml(texte: string, o: { profondeur?: number; maxNoeuds?: number; maxTexte?: number } = {}): NoeudXml {
  const maxProf = o.profondeur ?? 32, maxNoeuds = o.maxNoeuds ?? 100_000, maxTexte = o.maxTexte ?? 4 * 1024 * 1024;
  const racine: NoeudXml = { ns: '', local: '#document', attrs: [], enfants: [], texte: '' };
  const pile: Array<{ n: NoeudXml; brut: string; prefixes: Map<string, string> }> = [{ n: racine, brut: '', prefixes: new Map([['xml', NS_XML]]) }];
  let i = 0, noeuds = 0, totalTexte = 0;
  const s = texte;
  const ajouterTexte = (t: string) => {
    if (!t) return;
    totalTexte += t.length;
    if (totalTexte > maxTexte) throw new ErreurFormat('texte XML trop long');
    pile[pile.length - 1].n.texte += t;
  };
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { ajouterTexte(decoderEntites(s.slice(i))); break; }
    if (lt > i) ajouterTexte(decoderEntites(s.slice(i, lt)));
    if (s.startsWith('<?', lt)) { const f = s.indexOf('?>', lt + 2); if (f < 0) throw new ErreurFormat('instruction XML non fermée'); i = f + 2; continue; }
    if (s.startsWith('<!--', lt)) { const f = s.indexOf('-->', lt + 4); if (f < 0) throw new ErreurFormat('commentaire XML non fermé'); i = f + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) { const f = s.indexOf(']]>', lt + 9); if (f < 0) throw new ErreurFormat('CDATA non fermé'); ajouterTexte(s.slice(lt + 9, f)); i = f + 3; continue; }
    if (s.startsWith('<!', lt)) throw new ErreurFormat('DTD ou entité déclarée refusée');
    if (s[lt + 1] === '/') {
      const f = s.indexOf('>', lt + 2);
      if (f < 0) throw new ErreurFormat('balise XML non fermée');
      const nom = s.slice(lt + 2, f).trim();
      const haut = pile[pile.length - 1];
      if (pile.length <= 1 || haut.brut !== nom) throw new ErreurFormat('balises XML mal imbriquées');
      pile.pop();
      i = f + 1;
      continue;
    }
    // Ouverture : nom, attributs, fin « > » ou « /> ».
    let j = lt + 1;
    while (j < s.length && !estBlanc(s[j]) && s[j] !== '>' && s[j] !== '/') j++;
    const brut = s.slice(lt + 1, j);
    if (!brut) throw new ErreurFormat('nom de balise XML vide');
    const attrsBruts: Array<[string, string]> = [];
    let ferme = false;
    for (;;) {
      while (j < s.length && estBlanc(s[j])) j++;
      if (j >= s.length) throw new ErreurFormat('balise XML non fermée');
      if (s[j] === '>') { j++; break; }
      if (s[j] === '/' && s[j + 1] === '>') { j += 2; ferme = true; break; }
      const deb = j;
      while (j < s.length && s[j] !== '=' && !estBlanc(s[j]) && s[j] !== '>' && s[j] !== '/') j++;
      const an = s.slice(deb, j);
      while (j < s.length && estBlanc(s[j])) j++;
      if (s[j] !== '=' || !an) throw new ErreurFormat('attribut XML mal formé');
      j++;
      while (j < s.length && estBlanc(s[j])) j++;
      const q = s[j];
      if (q !== '"' && q !== '\'') throw new ErreurFormat('attribut XML sans guillemets');
      const f = s.indexOf(q, j + 1);
      if (f < 0) throw new ErreurFormat('attribut XML non fermé');
      attrsBruts.push([an, decoderEntites(s.slice(j + 1, f))]);
      if (attrsBruts.length > 256) throw new ErreurFormat('trop d\'attributs XML');
      j = f + 1;
    }
    if (++noeuds > maxNoeuds) throw new ErreurFormat('trop de nœuds XML');
    if (pile.length > maxProf) throw new ErreurFormat(`XML plus profond que ${maxProf}`);
    const parent = pile[pile.length - 1];
    let prefixes = parent.prefixes;
    for (const [an, v] of attrsBruts) {
      if (an === 'xmlns' || an.startsWith('xmlns:')) { if (prefixes === parent.prefixes) prefixes = new Map(parent.prefixes); prefixes.set(an === 'xmlns' ? '' : an.slice(6), v); }
    }
    const resoudre = (nom: string, defaut: boolean) => {
      const k = nom.indexOf(':');
      if (k < 0) return { ns: defaut ? prefixes.get('') ?? '' : '', local: nom };
      return { ns: prefixes.get(nom.slice(0, k)) ?? nom.slice(0, k), local: nom.slice(k + 1) };
    };
    const { ns, local } = resoudre(brut, true);
    const n: NoeudXml = { ns, local, attrs: [], enfants: [], texte: '' };
    for (const [an, v] of attrsBruts) {
      if (an === 'xmlns' || an.startsWith('xmlns:')) continue;
      const r = resoudre(an, false);
      n.attrs.push({ ns: r.ns, local: r.local, valeur: v });
      if (r.ns === NS_XML && r.local === 'lang') n.lang = v;
    }
    if (n.lang === undefined && parent.n.lang !== undefined) n.lang = parent.n.lang;
    parent.n.enfants.push(n);
    if (!ferme) pile.push({ n, brut, prefixes });
    i = j;
  }
  if (pile.length > 1) throw new ErreurFormat('XML tronqué (balises non fermées)');
  return racine;
}

/** Premier enfant (profondeur quelconque, parcours borné) qui a ce nom local et cet espace de noms. */
export function chercher(n: NoeudXml, local: string, ns?: string, max = 100_000): NoeudXml | undefined {
  const pile = [n];
  let k = 0;
  while (pile.length && k++ < max) {
    const x = pile.shift()!;
    if (x !== n && x.local === local && (ns === undefined || x.ns === ns)) return x;
    pile.push(...x.enfants);
  }
  return undefined;
}
export const attr = (n: NoeudXml, local: string, ns?: string) => n.attrs.find((a) => a.local === local && (ns === undefined || a.ns === ns))?.valeur;
