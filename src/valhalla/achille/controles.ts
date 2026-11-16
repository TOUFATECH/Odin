// Achille · la recherche passive des défauts courants. Elle ne fait que LIRE une réponse déjà reçue : aucune requête
// envoyée, aucun essai d'attaque. Chaque défaut a un niveau et un conseil en français simple. Pur.

export type Niveau = 'haut' | 'moyen' | 'bas' | 'info';
export interface Defaut { code: string; niveau: Niveau; titre: string; conseil: string }
export interface ReponseLue {
  url: string; code: number;
  /** en-têtes en minuscules ; set-cookie peut être une liste */
  entetes: Record<string, string | string[] | undefined>;
  corps?: string;
  /** fin de validité du certificat présenté (HTTPS) */
  certFin?: string;
}

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : v ?? '');
const liste = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
const NIVEAUX: Record<Niveau, number> = { haut: 0, moyen: 1, bas: 2, info: 3 };

/** Les défauts trouvés dans une réponse (du plus grave au moins grave). */
export function controler(r: ReponseLue, maintenant = new Date()): Defaut[] {
  const d: Defaut[] = [], h = r.entetes, https = /^https:/i.test(r.url);
  const type = un(h['content-type']).toLowerCase(), html = type.includes('text/html') || /^\s*<(!doctype|html)/i.test(r.corps ?? '');
  const csp = un(h['content-security-policy']);
  const add = (code: string, niveau: Niveau, titre: string, conseil: string) => d.push({ code, niveau, titre, conseil });
  if (html) {
    if (!csp) add('csp', 'moyen', 'Pas de politique de sécurité du contenu (Content-Security-Policy)', 'Ajoute un en-tête Content-Security-Policy qui dit d\'où les scripts ont le droit de venir : il limite les dégâts d\'une injection de script.');
    if (!h['x-frame-options'] && !/frame-ancestors/i.test(csp)) add('cadre', 'moyen', 'La page peut être affichée dans le cadre d\'un autre site', 'Ajoute X-Frame-Options: DENY (ou frame-ancestors \'self\' dans la politique de contenu) pour empêcher le détournement de clic.');
    if (!h['referrer-policy']) add('referrer', 'bas', 'Pas de règle pour l\'adresse d\'origine (Referrer-Policy)', 'Ajoute Referrer-Policy: strict-origin-when-cross-origin pour ne pas transmettre tes adresses complètes aux autres sites.');
  }
  if (https && !h['strict-transport-security']) add('hsts', 'moyen', 'HTTPS non imposé (pas de Strict-Transport-Security)', 'Ajoute Strict-Transport-Security: max-age=31536000 pour que les navigateurs ne reviennent jamais en http.');
  if (!h['x-content-type-options']) add('nosniff', 'bas', 'Le navigateur peut deviner le type des fichiers (X-Content-Type-Options absent)', 'Ajoute X-Content-Type-Options: nosniff.');
  for (const c of liste(h['set-cookie'])) {
    const nom = c.split('=')[0].trim().slice(0, 40), attrs = c.toLowerCase();
    const manque = [...(https && !/;\s*secure/.test(attrs) ? ['Secure'] : []), ...(!/;\s*httponly/.test(attrs) ? ['HttpOnly'] : []), ...(!/;\s*samesite=/.test(attrs) ? ['SameSite'] : [])];
    if (manque.length) add(`cookie:${nom}`, manque.includes('HttpOnly') || manque.includes('Secure') ? 'moyen' : 'bas', `Cookie « ${nom} » sans ${manque.join(', ')}`, 'Ajoute ces attributs au cookie : Secure (seulement en HTTPS), HttpOnly (illisible par les scripts), SameSite=Lax (pas envoyé par les autres sites).');
  }
  const corps = r.corps ?? '';
  if (html) {
    for (const f of corps.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) ?? []) {
      if (!/method\s*=\s*["']?post/i.test(f)) continue;
      if (!/<input\b[^>]*type\s*=\s*["']?hidden[^>]*name\s*=\s*["']?[^"'\s>]*(csrf|xsrf|token|nonce|authenticity)/i.test(f) && !/<input\b[^>]*name\s*=\s*["']?[^"'\s>]*(csrf|xsrf|token|nonce|authenticity)[^>]*type\s*=\s*["']?hidden/i.test(f)) { add('formulaire', 'moyen', 'Formulaire POST sans jeton anti-falsification', 'Ajoute un champ caché avec un jeton propre à la session (protection CSRF), vérifié par le serveur à chaque envoi.'); break; }
    }
    const gen = /<meta\b[^>]*name\s*=\s*["']generator["'][^>]*content\s*=\s*["']([^"']+)/i.exec(corps)?.[1];
    if (gen && /\d/.test(gen)) add('generator', 'bas', `Version exposée dans la page : ${gen.slice(0, 60)}`, 'Retire la balise generator : elle dit aux curieux quelle version attaquer.');
    if (https && /<(?:script|iframe|img|link|audio|video|source)\b[^>]*(?:src|href)\s*=\s*["']http:\/\//i.test(corps)) add('mixte', 'moyen', 'Contenu mixte : une page HTTPS charge des éléments en http', 'Passe ces éléments en https : en http, ils peuvent être modifiés en chemin.');
    if (/<title>\s*Index of \//i.test(corps)) add('index', 'moyen', 'Liste des fichiers d\'un dossier visible (« Index of / »)', 'Coupe l\'affichage automatique des dossiers (autoindex off, Options -Indexes).');
  }
  for (const k of ['server', 'x-powered-by', 'x-aspnet-version']) { const v = un(h[k]); if (v && /\d/.test(v)) add(`version:${k}`, 'bas', `Version exposée dans l'en-tête ${k} : ${v.slice(0, 60)}`, 'Masque le numéro de version (server_tokens off, expose_php Off…).'); }
  if (un(h['access-control-allow-origin']).trim() === '*' && un(h['access-control-allow-credentials']).toLowerCase() === 'true') add('cors', 'haut', 'CORS ouvert à tous les sites avec identifiants', 'N\'autorise que tes propres origines : « * » avec les identifiants permet à n\'importe quel site de lire les réponses.');
  if (r.certFin) {
    const j = (Date.parse(r.certFin) - maintenant.getTime()) / 864e5;
    if (Number.isFinite(j) && j < 0) add('certificat', 'haut', 'Certificat expiré', 'Renouvelle le certificat du site.');
    else if (Number.isFinite(j) && j < 21) add('certificat', 'moyen', `Certificat bientôt expiré (dans ${Math.max(0, Math.round(j))} j)`, 'Renouvelle le certificat (ou vérifie que le renouvellement automatique marche).');
  }
  return d.sort((a, b) => NIVEAUX[a.niveau] - NIVEAUX[b.niveau]);
}
