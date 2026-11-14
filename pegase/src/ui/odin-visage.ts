// Le visage d'Odin (même dessin que l'interface d'Odin, charte du 14/11/2026 : bleu, yeux carrés plissés, halos qui tournent).
// Montré dans l'avatar du profil tant que la personne n'a pas mis de photo.
export const ODIN_SVG = `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true"><defs><radialGradient id="odinBody" cx="50%" cy="46%" r="54%"><stop class="s1" offset="0" stop-color="#2F6FE0"/><stop class="s2" offset=".5" stop-color="#3F82F0"/><stop class="s3" offset=".82" stop-color="#7EAEF8"/><stop class="s4" offset="1" stop-color="#C3DBFF"/></radialGradient><radialGradient id="odinHalo" cx="50%" cy="50%" r="50%"><stop offset=".8" stop-color="#C3DBFF" stop-opacity=".65"/><stop offset=".93" stop-color="#C3DBFF" stop-opacity=".38"/><stop offset="1" stop-color="#C3DBFF" stop-opacity="0"/></radialGradient><radialGradient id="odinHalo2" cx="50%" cy="50%" r="50%"><stop offset=".8" stop-color="#FFFFFF" stop-opacity=".72"/><stop offset=".93" stop-color="#FFFFFF" stop-opacity=".4"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient><filter id="odinSoft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation=".8"/></filter><filter id="odinBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1"/></filter></defs><g class="orbit o1"><circle class="halo" cx="63" cy="64" r="49" fill="url(#odinHalo)" filter="url(#odinBlur)"/></g><g class="orbit o2"><circle class="halo" cx="57.5" cy="57" r="48" fill="url(#odinHalo2)" filter="url(#odinBlur)"/></g><g class="body"><circle cx="60" cy="60" r="44" fill="url(#odinBody)" filter="url(#odinSoft)"/><g class="eyes"><g class="brow l"><rect class="eye l" x="40" y="50" width="15" height="12" rx="2.6" fill="#fff"/></g><g class="brow r"><rect class="eye r" x="65" y="50" width="15" height="12" rx="2.6" fill="#fff"/></g></g></g></svg>`;

let n = 0;
/** Chaque Odin de la page a ses propres dégradés (sinon ils prendraient tous les couleurs du premier). */
function unique(svg: string): string { const k = ++n; return svg.replace(/(id="|url\(#)(odin(?:Body|Halo2|Halo|Soft|Blur))/g, `$1$2-${k}`); }

/** L'avatar d'un profil : sa photo s'il en a mis une, sinon Odin (animé). `cls` : classes en plus (« grand »…). */
export function avatar(p: { photo?: string; nom?: string }, cls = ''): string {
  if (p.photo && /^data:image\/(jpeg|png|webp);base64,/.test(p.photo)) return `<span class="avatar photo ${cls}" aria-hidden="true"><img src="${p.photo}" alt=""></span>`;
  return `<span class="avatar odin ${cls}" aria-hidden="true">${unique(ODIN_SVG)}</span>`;
}

/** Réduit une image choisie par la personne en un carré de 256 px (JPEG), pour la garder légère. */
export async function reduirePhoto(f: File): Promise<string> {
  const url = URL.createObjectURL(f);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const c = Math.min(img.naturalWidth, img.naturalHeight), t = 256;
    const cv = document.createElement('canvas'); cv.width = t; cv.height = t;
    cv.getContext('2d')!.drawImage(img, (img.naturalWidth - c) / 2, (img.naturalHeight - c) / 2, c, c, 0, 0, t, t);
    return cv.toDataURL('image/jpeg', 0.86);
  } finally { URL.revokeObjectURL(url); }
}


/** Les humeurs d'Odin (mêmes couleurs et mêmes yeux que dans Odin, face.js) : bleu par défaut. */
export const HUMEURS: Record<string, { t: [string, string, string, string]; y: [number, number] }> = {
  neutre: { t: ['#2F6FE0', '#3F82F0', '#7EAEF8', '#C3DBFF'], y: [1, 1] },
  joie: { t: ['#F0A818', '#F7BD32', '#FDD66B', '#FFEDAE'], y: [1, .8] },
  rire: { t: ['#F28A12', '#F8A630', '#FCC468', '#FFE1A8'], y: [1.05, .55] },
  amour: { t: ['#E0457B', '#EE6A97', '#F7A3C0', '#FFD3E2'], y: [1.12, 1.08] },
  fierte: { t: ['#7A4BD8', '#9166E6', '#B596F2', '#DCCBFF'], y: [1, .62] },
  excite: { t: ['#F06A12', '#F7872E', '#FBAE66', '#FFD6AE'], y: [1.1, 1.2] },
  clin: { t: ['#14A3A0', '#25BAB4', '#6AD6CF', '#B8F1EC'], y: [1, 1] },
  malice: { t: ['#8E3FB8', '#A659CC', '#C68DE0', '#EACBF7'], y: [1, .55] },
  surprise: { t: ['#16A6D8', '#30BCE8', '#76D6F3', '#BFEEFC'], y: [1.3, 1.25] },
  reflexion: { t: ['#4256C9', '#5A6FDB', '#8E9DEB', '#C9D1FA'], y: [.95, .9] },
  concentration: { t: ['#2558B8', '#3570D0', '#6E9CE6', '#B5CDF7'], y: [1.05, .45] },
  confus: { t: ['#7C7FA0', '#9396B4', '#B6B8CF', '#DEDFEB'], y: [1, 1] },
  inquiet: { t: ['#C77A1E', '#D6913A', '#E6B575', '#F5DDB8'], y: [.9, .85] },
  triste: { t: ['#2F6FE0', '#3F82F0', '#7EAEF8', '#C3DBFF'], y: [.75, .7] },
  colere: { t: ['#C8231C', '#E0352B', '#F06A55', '#FFA593'], y: [1.1, .4] },
  peur: { t: ['#6E5BB8', '#8574CC', '#AB9FE2', '#D9D2F7'], y: [.6, .7] },
  gene: { t: ['#E2557A', '#EE7896', '#F6A9BD', '#FFD8E2'], y: [.55, .5] },
  fatigue: { t: ['#5F7287', '#768A9F', '#A1B1C2', '#D2DBE4'], y: [1, .25] },
  ecoute: { t: ['#2E9E5B', '#43B672', '#7CD29E', '#C2EDD3'], y: [1, 1.08] },
  regarde: { t: ['#0E8FB8', '#22A7CF', '#64C6E2', '#B2E6F4'], y: [1.05, 1.05] },
  parle: { t: ['#D8A112', '#E8B62C', '#F3CF68', '#FCEAB0'], y: [1, 1] },
  cache: { t: ['#8A6E4B', '#A08562', '#C1AA8C', '#E5D8C6'], y: [1, .08] },
};
/** Odin dans une humeur donnée (couleur du corps et des halos, taille des yeux). */
export function odinVisage(humeur = 'neutre'): string {
  const h = HUMEURS[humeur] ?? HUMEURS.neutre;
  const [a, b, c, d] = h.t, [sx, sy] = h.y;
  return unique(ODIN_SVG
    .replace(/(class="s1"[^>]*stop-color=")#[0-9A-Fa-f]{6}/, `$1${a}`).replace(/(class="s2"[^>]*stop-color=")#[0-9A-Fa-f]{6}/, `$1${b}`)
    .replace(/(class="s3"[^>]*stop-color=")#[0-9A-Fa-f]{6}/, `$1${c}`).replace(/(class="s4"[^>]*stop-color=")#[0-9A-Fa-f]{6}/, `$1${d}`)
    .replace(/<radialGradient id="odinHalo"[^]*?<\/radialGradient>/, (m) => m.replace(/#C3DBFF/g, d))
    .replace(/<g class="brow (l|r)">/g, `<g class="brow $1" style="transform-box: fill-box; transform-origin: center; transform: scale(${sx}, ${sy}); transition: transform .3s">`));
}
/** Lit les marques d'humeur d'Odin dans sa réponse (« [humeur=joie] ») : l'humeur, et le texte sans les marques. */
export function lireHumeur(texte: string): { humeur?: string; texte: string } {
  let humeur: string | undefined;
  const t = texte.replace(/\[humeur[=:]\s*([a-zé]+)\]/gi, (_m, h: string) => { const k = h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); if (HUMEURS[k]) humeur = k; return ''; }).trim();
  return { humeur, texte: t };
}
