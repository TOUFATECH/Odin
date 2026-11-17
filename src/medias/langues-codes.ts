// Médias reçus : codes de langue. ISO 639-2 (formes B et T) ↔ ISO 639-1 ↔ BCP 47. Une langue sans code à deux lettres
// garde son code à trois lettres (valide en BCP 47) : aucune langue n'est écartée. « und », « mis », « zxx » et un
// code vide ne sont PAS des déclarations de langue. Le nom en clair vient du système (Intl.DisplayNames).

// T[/B]:1 — les langues qui ont un code à deux lettres.
const TABLE = 'aar:aa abk:ab afr:af aka:ak sqi/alb:sq amh:am ara:ar arg:an hye/arm:hy asm:as ava:av ave:ae aym:ay aze:az bak:ba bam:bm '
  + 'eus/baq:eu bel:be ben:bn bis:bi bod/tib:bo bos:bs bre:br bul:bg mya/bur:my cat:ca ces/cze:cs cha:ch che:ce zho/chi:zh chu:cu '
  + 'chv:cv cor:kw cos:co cre:cr cym/wel:cy dan:da deu/ger:de div:dv dzo:dz ell/gre:el eng:en epo:eo est:et ewe:ee fao:fo fas/per:fa '
  + 'fij:fj fin:fi fra/fre:fr fry:fy ful:ff kat/geo:ka gla:gd gle:ga glg:gl glv:gv grn:gn guj:gu hat:ht hau:ha heb:he her:hz hin:hi '
  + 'hmo:ho hrv:hr hun:hu ibo:ig isl/ice:is ido:io iii:ii iku:iu ile:ie ina:ia ind:id ipk:ik ita:it jav:jv jpn:ja kal:kl kan:kn '
  + 'kas:ks kau:kr kaz:kk khm:km kik:ki kin:rw kir:ky kom:kv kon:kg kor:ko kua:kj kur:ku lao:lo lat:la lav:lv lim:li lin:ln lit:lt '
  + 'ltz:lb lub:lu lug:lg mkd/mac:mk mah:mh mal:ml mri/mao:mi mar:mr msa/may:ms mlg:mg mlt:mt mon:mn nau:na nav:nv nbl:nr nde:nd '
  + 'ndo:ng nep:ne nld/dut:nl nno:nn nob:nb nor:no nya:ny oci:oc oji:oj ori:or orm:om oss:os pan:pa pli:pi pol:pl por:pt pus:ps '
  + 'que:qu roh:rm ron/rum:ro run:rn rus:ru sag:sg san:sa sin:si slk/slo:sk slv:sl sme:se smo:sm sna:sn snd:sd som:so sot:st spa:es '
  + 'srd:sc srp:sr ssw:ss sun:su swa:sw swe:sv tah:ty tam:ta tat:tt tel:te tgk:tg tgl:tl tha:th tir:ti ton:to tsn:tn tso:ts tuk:tk '
  + 'tur:tr twi:tw uig:ug ukr:uk urd:ur uzb:uz ven:ve vie:vi vol:vo wln:wa wol:wo xho:xh yid:yi yor:yo zha:za zul:zu';

const VERS1 = new Map<string, string>();
const VERS3 = new Map<string, string>();
for (const e of TABLE.split(' ')) {
  const [trois, un] = e.split(':');
  const [t, b] = trois.split('/');
  VERS1.set(t, un); if (b) VERS1.set(b, un);
  VERS3.set(un, t);
}

const NON_DECLAREES = new Set(['', 'und', 'mis', 'zxx', 'xx', 'xxx', 'unk', 'none', 'null']);
const lettres = (s: string) => { for (const c of s) if (!((c >= 'a' && c <= 'z'))) return false; return s.length > 0; };
const alnum = (s: string) => { for (const c of s) if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) return false; return s.length > 0; };

/** Normalise un code (« fre », « fra », « FR », « fr_FR », « en-us ») en BCP 47 ; undefined si non déclaré ou invalide. */
export function versBcp47(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const t = code.trim().slice(0, 35).replace(/_/g, '-').toLowerCase();
  if (NON_DECLAREES.has(t)) return undefined;
  const parties = t.split('-');
  const l = parties[0];
  if (!lettres(l) || l.length < 2 || l.length > 3) return undefined;
  if (NON_DECLAREES.has(l)) return undefined;
  const base = l.length === 3 ? VERS1.get(l) ?? l : l;
  const reste: string[] = [];
  for (const p of parties.slice(1)) {
    if (!alnum(p) || p.length > 8) return base;
    if (p.length === 2 && lettres(p)) reste.push(p.toUpperCase());
    else if (p.length === 4 && lettres(p)) reste.push(p[0].toUpperCase() + p.slice(1));
    else reste.push(p);
  }
  return [base, ...reste].join('-');
}

/** Code ISO 639-2/T d'un code BCP 47 (pour comparer). */
export function versIso3(code: string): string {
  const b = (versBcp47(code) ?? code).split('-')[0];
  return b.length === 2 ? VERS3.get(b) ?? b : b;
}

/**
 * Macrolangues ISO 639-3 → leurs langues individuelles. Une piste déclarée « swa » (swahili, macrolangue) et un texte
 * reconnu « swh » (swahili de l'Est) disent la même langue : ce n'est pas un désaccord. Le shimaoré (swb) et le
 * kibushi (buc) restent distincts du swahili : seul le kibushi appartient à la macrolangue malgache (mg).
 */
const MACRO: Record<string, string> = {
  sw: 'swh swc', ar: 'arb ary arz apc acm ajp aeb arq afb ayl acq apd abv ars acx aec shu ssh adf ayp acy pga auz abh avl ayh ayn',
  zh: 'cmn yue wuu hak nan cjy hsn gan cdo mnp cpx czh czo lzh', fa: 'pes prs', ms: 'zsm kxd jak meo mfa min mui', no: 'nb nn nob nno',
  et: 'ekk vro', lv: 'lvs ltg', sq: 'als aln aat aae', uz: 'uzn uzs', mn: 'khk mvf', ku: 'kmr ckb sdh', ne: 'npi dty',
  or: 'ory spv', ps: 'pbu pst pbt', az: 'azj azb', mg: 'plt buc msh bhr tdx txy xmv xmw bmm skg bzc tkg', qu: 'quz qub qug quy qvi',
  om: 'gaz hae orc', ff: 'fub fuf fuh fuq fuv ffm fue', kr: 'knc kby krt', ak: 'twi fat', yi: 'ydd yih', gn: 'gug gui gun', ik: 'esi esk',
  kg: 'kng kwy ldi', lah: 'pnb skr', iu: 'ike ikt', oj: 'ojg ojb ojc ojs ojw otw', cr: 'crk cwd csw crj crl crm',
};
const VERS_MACRO = new Map<string, string>();
for (const [m, l] of Object.entries(MACRO)) for (const x of l.split(' ')) if (x) VERS_MACRO.set(x, m);

/** La langue « de base » d'un code : sous-étiquette principale, ramenée à sa macrolangue si elle en a une. */
function baseLangue(code: string): string {
  const b = (versBcp47(code) ?? code.toLowerCase()).split('-')[0];
  return VERS_MACRO.get(b) ?? b;
}

/** Vrai si deux codes disent la même langue (« sw » et « swh », « fr-FR » et « fra », « zh » et « cmn »). */
export function memeLangue(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return baseLangue(a) === baseLangue(b);
}

/** Nom en clair (en français) ; repli : le code. */
export function nomLangue(code: string): string {
  try { const n = new Intl.DisplayNames(['fr'], { type: 'language' }).of(code); return n || code; } catch { return code; }
}

/** Langue « QuickTime » 16 bits empaquetée (mdhd) → code ISO 639-2 ; undefined pour 0x7FFF/« und ». */
export function langueEmpaquetee(v: number): string | undefined {
  if (v === 0x7fff || v === 0 || v < 0x400) return undefined;
  const c = (k: number) => String.fromCharCode(((v >> k) & 0x1f) + 0x60);
  return versBcp47(c(10) + c(5) + c(0));
}
