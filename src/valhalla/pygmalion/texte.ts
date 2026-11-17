// Pygmalion — les formats de texte écrits dans Odin : HTML, XML, RTF, Markdown, JSON, texte.
// Sécurité : tout texte venu d'ailleurs est ÉCHAPPÉ (jamais une balise, un script ni une commande RTF) ; le HTML produit
// interdit tout script à l'ouverture (politique de contenu) ; le XML n'a ni DOCTYPE ni entité externe, et ses noms
// d'éléments sont nettoyés.

const escHtml = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const sansControles = (s: string) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');

/** **gras** et *italique* en HTML (sur un texte déjà échappé). */
const enLigneHtml = (t: string) => escHtml(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');

/** Un document HTML complet et autonome (aucun script, aucune ressource extérieure). */
export function ecrireHtml(markdown: string, titre: string, marque: string): string {
  const corps: string[] = [];
  let liste: string[] = [];
  const fermer = () => { if (liste.length) corps.push(`<ul>${liste.map((x) => `<li>${x}</li>`).join('')}</ul>`); liste = []; };
  for (const ligne of sansControles(markdown).replace(/\r/g, '').split('\n')) {
    const h = /^(#{1,3})\s+(.*)$/.exec(ligne), li = /^\s*[-*•]\s+(.*)$/.exec(ligne);
    if (li) { liste.push(enLigneHtml(li[1])); continue; }
    fermer();
    if (h) corps.push(`<h${h[1].length + 1}>${enLigneHtml(h[2])}</h${h[1].length + 1}>`);
    else if (ligne.trim()) corps.push(`<p>${enLigneHtml(ligne)}</p>`);
  }
  fermer();
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="generator" content="Odin (Pygmalion) — ${escHtml(marque)}">
<title>${escHtml(sansControles(titre))}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#222}.creation{margin-top:3rem;font-size:13px;color:#666;border-top:1px solid #ddd;padding-top:.5rem}</style>
</head>
<body>
<h1>${escHtml(sansControles(titre))}</h1>
${corps.join('\n')}
<p class="creation"><em>${escHtml(marque)}</em></p>
</body>
</html>
`;
}

/** Un nom d'élément XML sûr. */
export function nomXml(n: string): string {
  let x = String(n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_.-]/g, '_');
  if (!/^[A-Za-z_]/.test(x)) x = `_${x}`;
  if (/^xml/i.test(x)) x = `_${x}`;
  return x.slice(0, 100);
}
const escXml = (s: string) => sansControles(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Un document XML à partir de données (objets, tableaux, valeurs). Aucun DOCTYPE, aucune entité. */
export function ecrireXml(donnees: unknown, racine: string, marque: string): string {
  let n = 0;
  const elem = (nom: string, v: unknown, prof: number): string => {
    if (++n > 1_000_000 || prof > 64) throw new Error('données trop grandes ou trop profondes pour le XML');
    const t = nomXml(nom), pad = '  '.repeat(prof);
    if (v === null || v === undefined) return `${pad}<${t}/>`;
    if (Array.isArray(v)) return v.map((x) => elem(nom, x, prof)).join('\n');
    if (typeof v === 'object') {
      const enfants = Object.entries(v as Record<string, unknown>).map(([k, x]) => elem(k, x, prof + 1)).join('\n');
      return `${pad}<${t}>\n${enfants}\n${pad}</${t}>`;
    }
    return `${pad}<${t}>${escXml(String(v))}</${t}>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${escXml(marque).replace(/--/g, '—')} -->\n${elem(racine, donnees, 0)}\n`;
}

/** Un texte en RTF (ANSI + \uN pour tout caractère non ASCII) : # titres en gras, paragraphes. */
export function ecrireRtf(markdown: string, titre: string, marque: string): string {
  const rtf = (s: string) => [...sansControles(s)].map((c) => {
    const code = c.codePointAt(0)!;
    if (c === '\\' || c === '{' || c === '}') return `\\${c}`;
    if (code < 128) return c;
    if (code > 0xffff) { const u = c.length === 2 ? [c.charCodeAt(0), c.charCodeAt(1)] : [code]; return u.map((x) => `\\u${x > 32767 ? x - 65536 : x}?`).join(''); }
    return `\\u${code > 32767 ? code - 65536 : code}?`;
  }).join('');
  const lignes = sansControles(markdown).replace(/\r/g, '').split('\n').map((l) => {
    const h = /^(#{1,3})\s+(.*)$/.exec(l), li = /^\s*[-*•]\s+(.*)$/.exec(l);
    const plain = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
    if (h) return `{\\b\\fs${[32, 28, 26][h[1].length - 1]} ${rtf(plain(h[2]))}}\\par`;
    if (li) return `\\bullet\\tab ${rtf(plain(li[1]))}\\par`;
    return `${rtf(plain(l))}\\par`;
  });
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Calibri;}}\\fs22\n{\\b\\fs36 ${rtf(titre)}}\\par\n${lignes.join('\n')}\n{\\i\\fs18 ${rtf(marque)}}\\par\n}`;
}

export const ecrireMarkdown = (markdown: string, titre: string, marque: string): string => `# ${sansControles(titre)}\n\n${sansControles(markdown).replace(/\r/g, '').trim()}\n\n---\n*${marque}*\n`;
export const ecrireTexte = (texte: string, marque: string): string => `${sansControles(texte).replace(/\r/g, '').trim()}\n\n— ${marque}\n`;
/** JSON : les données sous « donnees », la marque sous « creation » (jamais mêlée aux données). */
export const ecrireJson = (donnees: unknown, marque: string): string => `${JSON.stringify({ creation: marque, donnees }, null, 2)}\n`;
