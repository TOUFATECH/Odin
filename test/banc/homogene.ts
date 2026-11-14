// Banc « tout homogène » : ce qui doit être pareil d'une appli à l'autre, mesuré dans un vrai navigateur.
//
//   - l'en-tête de chaque appli : retour, icône, nom, phrase, « Exporter / partager », fiche (nom, ce qu'elle fait,
//     applicatifs similaires) à la même place et de la même taille partout ;
//   - la rangée d'onglets : une seule ligne, même hauteur, même place ;
//   - Odin (la mascotte) : jamais posé sur un texte, un bouton ou un champ, jamais d'obstacle à un clic.
//
// Sert à l'essai `test/homogene.test.ts` et au passage complet (`/home/claude/odin-wt/homogene-tmp/scripts/passage.ts`).
// Pas de dépendance aux types de Playwright : une page qui sait `evaluate` suffit.

export interface PageE { evaluate<R = unknown>(js: string): Promise<R>; waitForTimeout(ms: number): Promise<void> }
export type Boite = { x: number; y: number; w: number; h: number } | null;

/** Ce que l'en-tête d'une page d'appli montre, et où (positions relatives à la zone de la page, défilement compris). */
export interface Entete {
  id: string;
  retour: Boite; icone: Boite; titre: Boite; phrase: Boite; partage: Boite; fiche: Boite; ficheOuverte: boolean;
  /** Les rubriques visibles de la fiche (« D'où vient le nom », « Ce qu'elle fait », « Applicatifs similaires existants »…). */
  rubriques: string[];
  similaires: string[];
  nom: string;
  onglets: { boite: Boite; lignes: number; hauteur: number; n: number } | null;
  /** Taille de police du titre, en px. */
  police: number;
}

/** Mesure l'en-tête de la page d'appli ouverte (#v-app). */
export async function entete(p: PageE): Promise<Entete | null> {
  return p.evaluate<Entete | null>(`(() => {
    const body = document.querySelector('#v-app .body'); if (!body || !document.querySelector('#v-app.on')) return null;
    const o = body.getBoundingClientRect(), st = body.scrollTop;
    const b = (sel) => { const e = body.querySelector(sel); if (!e) return null; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return null; const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: Math.round(r.left - o.left), y: Math.round(r.top - o.top + st), w: Math.round(r.width), h: Math.round(r.height) }; };
    const fiche = body.querySelector('.va-head > details.va-plus');
    const ong = body.querySelector('.va-onglets');
    let onglets = null;
    if (ong) { const bs = [...ong.querySelectorAll('button')]; const tops = new Set(bs.map((x) => Math.round(x.getBoundingClientRect().top))); onglets = { boite: b('.va-onglets'), lignes: tops.size, hauteur: Math.round(ong.getBoundingClientRect().height), n: bs.length }; }
    const h1 = body.querySelector('.va-head h1');
    return {
      id: '', nom: h1 ? h1.textContent.trim() : '',
      retour: b('.va-head .va-back'), icone: b('.va-head .va-ic'), titre: b('.va-head h1'), phrase: b('.va-head .va-desc'), partage: b('.va-head .va-share'), fiche: b('.va-head > details.va-plus'),
      ficheOuverte: Boolean(fiche && fiche.open),
      rubriques: fiche ? [...fiche.querySelectorAll('.va-story > div > h4')].map((h) => h.textContent.trim()) : [],
      similaires: fiche ? [...fiche.querySelectorAll('.va-sim li')].map((l) => l.textContent.trim()) : [],
      onglets, police: h1 ? parseFloat(getComputedStyle(h1).fontSize) : 0,
    };
  })()`);
}

/** Les rubriques que la fiche de chaque appli doit montrer en entrant. */
export const RUBRIQUES = ['D\'où vient le nom', 'Ce qu\'elle fait', 'Applicatifs similaires existants'];

/** Ce qui manque à l'en-tête d'une appli (vide : tout y est). */
export function manquesEntete(e: Entete | null): string[] {
  if (!e) return ['la page de l\'appli ne s\'est pas ouverte'];
  const m: string[] = [];
  if (!e.retour) m.push('bouton « Applis » (retour) absent');
  if (!e.titre || !e.nom) m.push('nom de l\'appli absent');
  if (!e.phrase) m.push('phrase « ce qu\'elle fait » absente sous le nom');
  if (!e.fiche) m.push('fiche de l\'appli absente');
  else if (!e.ficheOuverte) m.push('fiche repliée en entrant');
  for (const r of RUBRIQUES) if (!e.rubriques.includes(r)) m.push(`rubrique « ${r} » absente`);
  if (e.onglets && e.onglets.lignes > 1) m.push(`onglets sur ${e.onglets.lignes} lignes`);
  return m;
}

/**
 * Compare les en-têtes de plusieurs applis à la même largeur : ce qui n'est pas à la même place ou de la même taille.
 * Le bouton retour, l'icône, le titre doivent être au pixel près au même endroit ; le bouton « Exporter / partager »
 * aligné à droite ; la rangée d'onglets de même hauteur partout.
 */
export function ecartsEntetes(liste: Entete[], tol = 2): string[] {
  const ok = liste.filter((e) => e.retour && e.titre);
  if (ok.length < 2) return [];
  const mode = <T>(xs: T[]): T => { const c = new Map<string, { v: T; n: number }>(); for (const x of xs) { const k = JSON.stringify(x); const e = c.get(k); if (e) e.n++; else c.set(k, { v: x, n: 1 }); } return [...c.values()].sort((a, b) => b.n - a.n)[0].v; };
  const ref = {
    retour: mode(ok.map((e) => [e.retour!.x, e.retour!.y, e.retour!.w, e.retour!.h])),
    icone: mode(ok.filter((e) => e.icone).map((e) => [e.icone!.x, e.icone!.y, e.icone!.w, e.icone!.h])),
    titreX: mode(ok.map((e) => e.titre!.x)), titreY: mode(ok.map((e) => e.titre!.y)),
    police: mode(ok.map((e) => e.police)),
    partage: mode(ok.filter((e) => e.partage).map((e) => [e.partage!.x + e.partage!.w, e.partage!.w, e.partage!.h])),
    onglets: mode(ok.filter((e) => e.onglets).map((e) => e.onglets!.hauteur)),
  };
  const loin = (a: number[], b: number[]) => a.some((v, i) => Math.abs(v - b[i]) > tol);
  const ecarts: string[] = [];
  for (const e of ok) {
    if (loin([e.retour!.x, e.retour!.y, e.retour!.w, e.retour!.h], ref.retour)) ecarts.push(`${e.id} : bouton retour en ${e.retour!.x},${e.retour!.y} (${e.retour!.w}×${e.retour!.h}) au lieu de ${ref.retour.join(',')}`);
    if (e.icone && ref.icone && loin([e.icone.x, e.icone.y, e.icone.w, e.icone.h], ref.icone)) ecarts.push(`${e.id} : icône en ${e.icone.x},${e.icone.y} (${e.icone.w}×${e.icone.h}) au lieu de ${ref.icone.join(',')}`);
    if (Math.abs(e.titre!.x - ref.titreX) > tol || Math.abs(e.titre!.y - ref.titreY) > tol) ecarts.push(`${e.id} : titre en ${e.titre!.x},${e.titre!.y} au lieu de ${ref.titreX},${ref.titreY}`);
    if (e.police !== ref.police) ecarts.push(`${e.id} : titre en ${e.police} px au lieu de ${ref.police} px`);
    if (e.partage && ref.partage && loin([e.partage.x + e.partage.w, e.partage.w, e.partage.h], ref.partage)) ecarts.push(`${e.id} : « Exporter / partager » finit à ${e.partage.x + e.partage.w} px (${e.partage.w}×${e.partage.h}) au lieu de ${ref.partage.join(',')}`);
    if (e.onglets && ref.onglets !== undefined && Math.abs(e.onglets.hauteur - ref.onglets) > tol) ecarts.push(`${e.id} : rangée d'onglets haute de ${e.onglets.hauteur} px au lieu de ${ref.onglets} px`);
  }
  return ecarts;
}

/** Ce qu'Odin (la mascotte) couvre en ce moment, et s'il peut gêner un clic. */
export interface SousOdin {
  /** Odin est-il à l'écran ? */
  visible: boolean;
  boite: Boite;
  /** Les commandes (boutons, liens, champs, onglets) et les textes qu'il recouvre vraiment (points de son carré). */
  commandes: string[]; textes: string[];
  /** Les points de son carré qui interceptent un clic (pointer-events) alors qu'une commande est dessous. */
  bloque: string[];
}

/**
 * Regarde sous Odin : on cache Odin le temps de demander au navigateur ce qu'il y a à chaque point de son carré
 * (elementFromPoint), puis on vérifie que les points où il reçoit les clics ne cachent aucune commande.
 */
export async function sousOdin(p: PageE, sel = '#buddyRoam'): Promise<SousOdin> {
  return p.evaluate<SousOdin>(`(() => {
    const o = document.querySelector(${JSON.stringify(sel)});
    const res = { visible: false, boite: null, commandes: [], textes: [], bloque: [] };
    if (!o) return res;
    const s = getComputedStyle(o); const r = o.getBoundingClientRect();
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05 || r.width < 4 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return res;
    res.visible = true; res.boite = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    const nom = (e) => { const t = (e.getAttribute('aria-label') || e.textContent || e.value || e.placeholder || '').replace(/\\s+/g, ' ').trim().slice(0, 40); return e.localName + (e.id ? '#' + e.id : '') + (t ? ' « ' + t + ' »' : ''); };
    const CMD = 'button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=link],[contenteditable=""],[contenteditable=true],label';
    // Les points qui reçoivent les clics sur Odin (avec Odin visible).
    const k = 6, pts = [];
    for (let i = 0; i <= k; i++) for (let j = 0; j <= k; j++) pts.push([r.left + 2 + (r.width - 4) * i / k, r.top + 2 + (r.height - 4) * j / k]);
    const prend = pts.map(([x, y]) => { const e = document.elementFromPoint(x, y); return Boolean(e && (e === o || o.contains(e))); });
    // Ce qu'il y a dessous (Odin caché un instant, sans transition).
    const avant = o.style.visibility; o.style.visibility = 'hidden';
    const cmds = new Set(), txts = new Set(), bloque = new Set();
    pts.forEach(([x, y], n) => {
      const e = document.elementFromPoint(x, y); if (!e || e === document.documentElement || e === document.body) return;
      const c = e.closest(CMD);
      if (c && !o.contains(c)) { cmds.add(nom(c)); if (prend[n]) bloque.add(nom(c)); return; }
      // Un texte : un nœud texte non vide dont la boîte contient le point.
      for (const t of e.childNodes) { if (t.nodeType !== 3 || !/\\S/.test(t.data)) continue; const rg = document.createRange(); rg.selectNodeContents(t); for (const q of rg.getClientRects()) if (x >= q.left && x <= q.right && y >= q.top && y <= q.bottom) { txts.add(nom(e)); break; } }
    });
    o.style.visibility = avant;
    res.commandes = [...cmds]; res.textes = [...txts]; res.bloque = [...bloque];
    return res;
  })()`);
}

/** Attend qu'Odin et sa bulle aient fini de se déplacer (ils choisissent leur place après chaque changement de page). */
export async function odinPose(p: PageE): Promise<void> {
  await p.evaluate(`window.OdinCompanion?.sync?.('hopto')`).catch(() => undefined);
  const js = `[...document.querySelectorAll('#buddyRoam,#odinBubble')].map((e) => { const r = e.getBoundingClientRect(); return Math.round(r.left) + ',' + Math.round(r.top); }).join('|')`;
  let avant = '', stable = 0; for (let i = 0; i < 30 && stable < 3; i++) { await p.waitForTimeout(150); const a = await p.evaluate<string>(js); if (a === avant) stable++; else { stable = 0; avant = a; } }
}
