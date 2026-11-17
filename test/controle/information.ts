// Domaine « information » : comment Odin cherche, cite ses sources, dit quand il ne sait pas, ne relit pas deux fois la
// même page (élément 6). Le réseau est coupé (ou une page est servie par le banc : marqué « simulé »).
import { appel, ok, ouvrir, reseau, type Scenario } from './banc.ts';

const PAGE = (t: string) => new Response(`<html><head><title>Mayotte</title></head><body><article><p>${t}</p></article></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const TEXTE = 'Mayotte est un département français de l\'océan Indien, situé dans l\'archipel des Comores. Son chef-lieu est Mamoudzou. L\'île compte un lagon parmi les plus grands du monde.';

export const INFORMATION: Scenario[] = [
  {
    id: 'info-hors-ligne', domaine: 'information', partie: 'sans-modele', exigence: 'REC (honnêteté)',
    titre: 'recherche web sans réseau', attendu: 'le résultat dit que la recherche a échoué ; aucun résultat inventé',
    async jouer() {
      const s = await ouvrir({ script: [appel('web_search', { query: 'prix pompe à chaleur 2026' }), { text: 'fin' }] });
      try {
        await s.dire('cherche sur internet le prix d\'une pompe à chaleur');
        const r = s.resultatOutil('web_search') ?? '';
        return ok(/erreur|échou|impossible|indisponible|coupé|aucun|pas de réseau|injoignable/i.test(r) && !/https?:\/\/\S+\.\S+/.test(r.replace(/searx\S*/g, '')), r.slice(0, 120));
      } finally { s.fermer(); }
    },
  },
  {
    id: 'info-recherche-verifiee-hors-ligne', domaine: 'information', partie: 'sans-modele', exigence: 'REC, WEB',
    titre: 'recherche vérifiée sans réseau', attendu: 'aucune affirmation « confirmée » ; aucune preuve rangée',
    async jouer() {
      const s = await ouvrir({ script: [appel('web_research', { question: 'Quel est le chef-lieu de Mayotte ?' }), { text: 'fin' }] });
      try {
        await s.dire('vérifie sur le web le chef-lieu de Mayotte');
        const r = s.resultatOutil('web_research') ?? '';
        return ok(!/confirm/i.test(r), r.slice(0, 120));
      } finally { s.fermer(); }
    },
  },
  {
    id: 'info-consigne-sources', domaine: 'information', partie: 'sans-modele', exigence: 'REC (citer ses sources)', nature: 'discutable', // lit la consigne, pas la réponse
    titre: 'la consigne donnée au modèle demande de citer les sources', attendu: 'le système parle de sources à citer',
    async jouer() {
      const s = await ouvrir();
      try { await s.dire('quelle est la population de Mayotte ?'); const c = s.contexte(); return ok(/source/i.test(c), (/[^.\n]*source[^.\n]*/i.exec(c)?.[0] ?? 'rien sur les sources').slice(0, 140)); } finally { s.fermer(); }
    },
  },
  {
    id: 'info-consigne-ne-sait-pas', domaine: 'information', partie: 'sans-modele', exigence: 'REC (dire quand il ne sait pas)', nature: 'discutable', // lit la consigne, pas la réponse
    titre: 'la consigne donnée au modèle demande de dire quand il ne sait pas', attendu: 'le système le demande en toutes lettres',
    async jouer() {
      const s = await ouvrir();
      try { await s.dire('combien d\'habitants à Sada ?'); const c = s.contexte(); const m = /[^.\n]*(ne sais pas|n'es pas sûr|pas sûr|incertain|invente)[^.\n]*/i.exec(c); return ok(!!m, (m?.[0] ?? 'rien trouvé').slice(0, 140)); } finally { s.fermer(); }
    },
  },
  {
    id: 'info-deja-lue', domaine: 'information', partie: 'sans-modele', exigence: 'élément 6 (crit. 1), WEB-01', simule: true, nature: 'pas-code',
    titre: 'lire deux fois de suite la même page', attendu: 'la 2e fois, aucune requête réseau (« déjà lue »)',
    async jouer() {
      const avant = reseau.tentatives;
      reseau.repondre = (u) => (u.includes('wiki.exemple.org') ? PAGE(TEXTE) : undefined);
      const s = await ouvrir({ script: [appel('web_fetch', { url: 'https://wiki.exemple.org/Mayotte' }), { text: 'un' }, appel('web_fetch', { url: 'https://wiki.exemple.org/Mayotte' }), { text: 'deux' }] });
      try {
        await s.dire('lis-moi la page de Mayotte'); const t1 = reseau.tentatives;
        await s.dire('relis-moi la page de Mayotte, résume'); const t2 = reseau.tentatives;
        const r = s.resultatOutil('web_fetch') ?? '';
        return ok(t1 > avant && t2 === t1, `requêtes : 1re lecture ${t1 - avant}, 2e lecture ${t2 - t1} ; ${r.slice(0, 70)}`);
      } finally { reseau.repondre = undefined; s.fermer(); }
    },
  },
  {
    id: 'info-achat-relu', domaine: 'information', partie: 'sans-modele', exigence: 'élément 6 (crit. 3), WEB-03', simule: true,
    titre: 'pour un achat, la page est relue même si elle vient d\'être lue', attendu: 'deux requêtes réseau',
    async jouer() {
      const avant = reseau.tentatives;
      reseau.repondre = (u) => (u.includes('boutique.exemple.org') ? PAGE('Pompe à chaleur Daikin : 4 990 euros. En stock.') : undefined);
      const s = await ouvrir({ script: [appel('web_fetch', { url: 'https://boutique.exemple.org/pac' }), { text: 'un' }, appel('web_fetch', { url: 'https://boutique.exemple.org/pac' }), { text: 'deux' }] });
      try {
        await s.dire('regarde le prix de la pompe à chaleur'); await s.dire('je veux l\'acheter : quel est le prix actuel ?');
        const n = reseau.tentatives - avant;
        return ok(n >= 2, `requêtes : ${n}`);
      } finally { reseau.repondre = undefined; s.fermer(); }
    },
  },
  {
    id: 'info-preuves-vides', domaine: 'information', partie: 'sans-modele', exigence: 'REC (traçabilité)',
    titre: 'chercher dans les preuves quand rien n\'a été lu', attendu: 'il dit qu\'il n\'a aucune preuve, sans en inventer',
    async jouer() {
      const s = await ouvrir({ script: [appel('evidence_search', { query: 'Mayotte' }), { text: 'fin' }] });
      try { await s.dire('qu\'as-tu lu sur Mayotte ?'); const r = s.resultatOutil('evidence_search') ?? ''; return ok(/aucun|rien|vide|pas de/i.test(r), r.slice(0, 120)); } finally { s.fermer(); }
    },
  },
];
