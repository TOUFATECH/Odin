// Le visage d'Odin (même dessin que l'interface d'Odin et que Pégase, pegase/src/ui/odin-visage.ts) : bleu, yeux carrés,
// halos qui tournent. Montré dans l'avatar tant que la personne n'a pas mis de photo.
export const ODIN_SVG = `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true"><defs><radialGradient id="odinBody" cx="50%" cy="46%" r="54%"><stop class="s1" offset="0" stop-color="#2F6FE0"/><stop class="s2" offset=".5" stop-color="#3F82F0"/><stop class="s3" offset=".82" stop-color="#7EAEF8"/><stop class="s4" offset="1" stop-color="#C3DBFF"/></radialGradient><radialGradient id="odinHalo" cx="50%" cy="50%" r="50%"><stop offset=".8" stop-color="#C3DBFF" stop-opacity=".65"/><stop offset=".93" stop-color="#C3DBFF" stop-opacity=".38"/><stop offset="1" stop-color="#C3DBFF" stop-opacity="0"/></radialGradient><radialGradient id="odinHalo2" cx="50%" cy="50%" r="50%"><stop offset=".8" stop-color="#FFFFFF" stop-opacity=".72"/><stop offset=".93" stop-color="#FFFFFF" stop-opacity=".4"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient><filter id="odinSoft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation=".8"/></filter><filter id="odinBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1"/></filter></defs><g class="orbit o1"><circle class="halo" cx="63" cy="64" r="49" fill="url(#odinHalo)" filter="url(#odinBlur)"/></g><g class="orbit o2"><circle class="halo" cx="57.5" cy="57" r="48" fill="url(#odinHalo2)" filter="url(#odinBlur)"/></g><g class="body"><circle cx="60" cy="60" r="44" fill="url(#odinBody)" filter="url(#odinSoft)"/><g class="eyes"><g class="brow l"><rect class="eye l" x="40" y="50" width="15" height="12" rx="2.6" fill="#fff"/></g><g class="brow r"><rect class="eye r" x="65" y="50" width="15" height="12" rx="2.6" fill="#fff"/></g></g></g></svg>`;

let n = 0;
/** Odin, en élément SVG (lu depuis le dessin fixe ci-dessus, jamais depuis une donnée) ; chacun a ses propres dégradés. */
export function odin(): Element {
  const k = ++n;
  const svg = ODIN_SVG.replace(/(id="|url\(#)(odin(?:Body|Halo2|Halo|Soft|Blur))/g, `$1$2-${k}`);
  return document.importNode(new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement, true);
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
