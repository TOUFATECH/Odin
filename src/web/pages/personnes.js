// Fenêtre Profil (vue v-profil) : les personnes qui parlent à Odin. À gauche la liste (nom, rôle, canaux) ; à droite la
// carte de la personne choisie (rôle, autonomie, identités et leur preuve, accès aux applis EN LECTURE, note libre du
// propriétaire, emplacement du portrait, vide pour l'instant) et sa ligne de temps — qui a demandé quoi, quand, ce que
// ça a donné —, chargée au fil du défilement. À 390 px, la liste puis la carte, l'une sous l'autre.
// Le propriétaire voit tout et efface l'historique à la main (aperçu exact, puis confirmation) ; un membre voit
// seulement la sienne, en lecture, et peut signaler une erreur au propriétaire.
// Lot 5b, le bloc « Droits » : ce que la personne peut faire, dans les deux registres nommés (rôle et autonomie : mémoire
// d'Odin ; applis, groupes, compte, appareils : Persona). Le propriétaire seul le change, et seulement par les actions qui
// existent, telles qu'elles sont : /api/action (user_save, user_link, user_unlink) et /api/valhalla/act (Persona :
// acces_cases, modifier, couper_appareil). Limiter part en un geste ; donner reçoit du serveur sa validation (avant →
// après), montrée telle quelle, et ne repart, avec la confirmation, qu'après le geste du propriétaire. Après chaque
// changement, la carte est relue du serveur. Un membre voit ses droits, sans rien pour les changer.
// La page lit /api/personnes… ; tout est écrit en textContent (jamais de HTML venu d'Odin ou d'une personne).
// Tous les textes sont dans le dictionnaire T, en tête : rien n'est écrit ailleurs.
(() => {
  'use strict';
  window.OdinProfil = window.OdinProfil || {};
  if (window.OdinProfil.rendre) return;

  // ---------------- Dictionnaire (tous les textes de la page)
  const T = {
    'titre': 'Profil', 'liste.titre': 'Personnes', 'liste.vide': 'Personne d\'autre que toi ne parle encore à Odin.',
    'liste.choisir': 'Choisis une personne pour voir sa carte et son historique.', 'liste.toi': 'Toi (propriétaire)',
    'inconnus': '{n} message{s} d\'inconnus non appairés (sans fiche, rien n\'est gardé d\'eux)', 'canaux.aucun': 'aucun canal',
    'role.owner': 'Propriétaire', 'role.member': 'Membre', 'role.guest': 'Invité',
    'autonomie.prudent': 'Prudent', 'autonomie.equilibre': 'Équilibré', 'autonomie.autonome': 'Autonome',
    'carte.role': 'Rôle', 'carte.autonomie': 'Autonomie', 'carte.identites': 'Identités', 'carte.identites.aucune': 'Aucune identité reliée.',
    'carte.partage': 'appareil partagé : le compte, pas forcément la personne', 'carte.acces': 'Accès aux applis',
    'carte.acces.groupes': 'Groupes : {g}', 'carte.acces.aucune': 'Aucune appli.', 'carte.acces.sanslien': 'Aucun compte Persona relié à cette personne : ses accès aux applis ne sont pas connus ici.',
    'carte.acces.inconnu': 'Le compte Persona relié est introuvable (Persona arrêté ou compte retiré).',
    'carte.regl': 'Tout se règle aussi dans Réglages › Personnes (mémoire d\'Odin) et dans Persona (accès aux applis).',
    'carte.regl.personnes': 'Réglages › Personnes', 'carte.regl.persona': 'Ouvrir Persona',
    'carte.note': 'Ta note', 'carte.note.aide': 'Ce que tu veux qu\'Odin sache d\'elle. Visible de toi seul.', 'carte.note.enregistrer': 'Enregistrer la note',
    'carte.note.ok': 'Note enregistrée.', 'carte.note.sansfiche': 'Pas de note ici : tu n\'as pas de fiche à ton nom dans la mémoire d\'Odin.',
    'carte.portrait': 'Portrait', 'carte.portrait.vide': 'Vide pour l\'instant : Odin le rédigera lui-même quand son propre modèle de langue sera entraîné.',
    'carte.signaler': 'Signaler une erreur', 'carte.signaler.question': 'Qu\'est-ce qui est faux sur ta fiche ? Le propriétaire d\'Odin sera prévenu.',
    'carte.signaler.ok': 'C\'est envoyé : le propriétaire d\'Odin est prévenu.', 'carte.sienne': 'Ta fiche, en lecture.',
    'preuve.session-proprietaire': 'session du propriétaire', 'preuve.appareil-appaire': 'appareil appairé', 'preuve.code-prouve': 'code prouvé au téléphone', 'preuve.non-prouve': 'non prouvé',
    'histo.titre': 'Historique', 'histo.total': '{n} ligne{s}', 'histo.vide': 'Rien pour l\'instant : ses demandes à Odin apparaîtront ici.',
    'histo.plus': 'En charger d\'autres', 'histo.fin': 'Début de l\'historique.', 'histo.erreur': 'Historique indisponible pour l\'instant.',
    'histo.sanstexte': '(le texte de la demande n\'est pas gardé ici)', 'histo.via': 'par {c}', 'histo.partage': 'appareil partagé',
    'sorte.demande': 'A demandé', 'sorte.action': 'A fait', 'sorte.decision': 'A décidé', 'sorte.validation': 'A validé', 'sorte.refus': 'Refusé', 'sorte.connexion': 'Connexion',
    'resultat.reussi': 'fait', 'resultat.echoue': 'échoué', 'resultat.en_attente': 'en attente', 'resultat.arrete': 'arrêté', 'resultat.en_cours': 'en cours',
    'resultat.inconnu': 'issue inconnue', 'resultat.sans_tour': 'commande, sans tour d\'Odin',
    'eff.ouvrir': 'Effacer l\'historique…', 'eff.tout': 'Tout son historique', 'eff.periode': 'Une période', 'eff.du': 'Du', 'eff.au': 'Au',
    'eff.voir': 'Voir ce qui sera effacé', 'eff.rien': 'Rien à effacer sur cette période.', 'eff.fait': '{n} ligne{s} effacée{s}.',
    'eff.change': 'L\'historique a changé depuis l\'aperçu : rien n\'a été effacé. Regarde le nouvel aperçu.', 'eff.dates': 'Choisis les deux dates (la première avant la seconde).',
    'eff.q': 'Effacer l\'historique de {nom}{periode} ?', 'eff.q.periode': ' du {du} au {au}', 'eff.q.jusqua': ' jusqu\'à maintenant ({au})',
    'eff.retire': 'Retiré pour de bon : {n} ligne{s} de son historique (qui a demandé quoi, quand, ce que ça a donné).',
    'eff.reste': 'Reste ailleurs, non touché :', 'eff.reste.historique': '{n} ligne{s} de son historique hors de cette période',
    'eff.reste.messages': '{n} message{s} de ses conversations', 'eff.reste.missions': '{n} tour{s} d\'Odin (Activité)',
    'eff.reste.aiguillage': '{n} ligne{s} du journal d\'aiguillage (le début de chaque demande, masqué)', 'eff.reste.souvenirs': '{n} souvenir{s} à son nom',
    'eff.reste.note': 'ta note sur elle', 'eff.reste.lien': 'le lien avec son compte Persona', 'eff.reste.audit': 'le journal des décisions (audit)',
    'eff.reste.sauvegardes': 'les sauvegardes déjà faites', 'eff.reste.inconnus': 'le compteur des inconnus', 'eff.ok': 'Effacer', 'eff.sansretour': 'L\'effacement est réel et sans retour.',
    'erreur.connexion': 'Connecte-toi à Odin.', 'erreur.x_odin': 'Requête refusée (en-tête manquant).', 'erreur.methode': 'Requête refusée.',
    'erreur.invalide': 'Ce qui a été envoyé n\'est pas valable.', 'erreur.inconnu': 'Cette personne n\'existe plus.', 'erreur.reserve': 'Réservé au propriétaire d\'Odin.',
    'erreur.change': 'L\'historique a changé : recommence.', 'erreur.trop': 'Déjà trois signalements dans l\'heure : réessaie plus tard.',
    'erreur.indisponible': 'Odin ne peut prévenir personne pour l\'instant : réessaie plus tard.', 'erreur.disque': 'Odin n\'a pas pu l\'enregistrer.',
    'erreur.reseau': 'Odin ne répond pas.', 'erreur.refuse': 'Tu n\'as pas accès à ces fiches.',
    'raison.proprietaire': '', 'raison.la-sienne': '', 'raison.reglage-proprietaire-seul': 'Le propriétaire a réservé les fiches à lui seul.',
    'raison.invite': 'Un invité ne voit pas les fiches.', 'raison.lien-absent': 'Ton compte n\'est pas encore relié à ta fiche : demande-le au propriétaire d\'Odin.',
    'raison.lien-douteux': 'Le lien entre ton compte et ta fiche n\'est pas sûr : demande au propriétaire d\'Odin de le vérifier.',
    'raison.autre-personne': 'Tu ne vois que ta propre fiche.', 'raison.demandeur-inconnu': 'Tu n\'as pas accès à ces fiches.',
    // Lot 3 : ce qu'Odin a mesuré (des mesures et leur nombre d'observations, aucun jugement).
    'obs.titre': 'Ce qu\'Odin a observé', 'obs.calcule': 'Calculé le {d}', 'obs.chargement': 'Calcul en cours…', 'obs.erreur': 'Mesures indisponibles pour l\'instant.',
    'mes.nom.langues': 'Langues employées', 'mes.nom.longueur': 'Longueur médiane des demandes', 'mes.nom.heures': 'Heures habituelles',
    'mes.nom.applis': 'Applis les plus demandées', 'mes.nom.abouties': 'Demandes abouties',
    'mes.sur': 'sur {n} observation{s}', 'mes.troppeu': 'trop peu', 'mes.rien': 'Rien à mesurer pour l\'instant.',
    'mes.nonmesure': 'non mesuré', 'mes.anoter.appli-du-tour': 'L\'appli qui a servi chaque demande n\'est pas encore notée.',
    'mes.langue.nonreconnue': 'non reconnue', 'mes.longueur.val': '{v} caractère{s}',
    'mes.heures.texte': '{n} heure{s} sur 24 avec des demandes ; le plus souvent : {top}', 'mes.heures.aucune': 'Aucune demande notée à une heure.',
    'mes.heures.label': 'Demandes par heure : {l}',
    'mes.heures.choisies': '{n} heure{s} habituelle{s} choisie{s} : {l}', 'mes.heures.labelc': 'Heures habituelles choisies : {l}', 'mes.abouties.val': '{p} ({a} sur {n} tours finis)',
    'mes.corrige.toi': 'corrigé par toi', 'mes.corrige.lui': 'corrigé par le propriétaire', 'mes.odin': 'Mesure d\'Odin : {v}', 'mes.cache': 'Cachée : toi seul la vois',
    'mes.cacher': 'Cacher', 'mes.remettre': 'Remettre', 'mes.corriger': 'Corriger', 'mes.annuler': 'Annuler ma correction',
    'mes.enregistrer': 'Enregistrer', 'mes.fermer': 'Fermer',
    'mes.f.longueur': 'Longueur médiane, en caractères', 'mes.f.abouties': 'Part des demandes abouties, en %', 'mes.f.heures': 'Touche les heures habituelles.',
    'mes.f.langues': 'Un code de langue et sa part en % par ligne (le total ne dépasse pas 100).', 'mes.f.code': 'Code de langue', 'mes.f.part': 'Part en %',
    'mes.f.ajouter': 'Ajouter une langue', 'mes.f.invalide': 'Valeur non valable : vérifie les nombres et les codes de langue.',
    'eff.retire.mesures': 'Les mesures gardées de « Ce qu\'Odin a observé » : elles seront recalculées sur ce qui reste.',
    'eff.reste.mesures': '{n} mesure{s} que tu as cachée{s} ou corrigée{s} (tes réglages restent)',
    // Lot 5b : le bloc « Droits » (deux registres) et le journal des droits, traduit depuis ses codes.
    'droits.titre': 'Droits', 'droits.aide': 'Limiter s\'applique tout de suite. Donner ouvre ta validation, qui montre avant → après.',
    'droits.lecture': 'Ce que tu peux faire aujourd\'hui. Seul le propriétaire d\'Odin le change.', 'droits.proprio': 'Le rôle de propriétaire ne se change pas ici.',
    'droits.odin': 'Dans la mémoire d\'Odin', 'droits.odin.aide': 'quand cette personne lui écrit', 'droits.persona': 'Dans Persona', 'droits.persona.aide': 'les applis ouvertes avec son compte',
    'droits.compte': 'Compte : {e}', 'droits.compte.actif': 'actif', 'droits.compte.coupe': 'coupé (aucune appli ne s\'ouvre)',
    'droits.compte.couper': 'Couper le compte', 'droits.compte.reactiver': 'Réactiver le compte…', 'droits.groupes': 'Groupes : {g}', 'droits.groupes.aucun': 'aucun',
    'droits.applis': 'Applis', 'droits.applis.aucune': 'Aucune appli ouverte.', 'droits.applis.autres': 'Donner une autre appli ({n})',
    'droits.via.perso': 'accès à elle seule', 'droits.via.groupe': 'par le groupe {g}', 'droits.via.tous': 'ouverte à toute personne connectée', 'droits.via.admin': 'groupe admin : toutes les applis',
    'droits.via.fixe': 'se change dans Persona (cela touche tout le groupe)', 'droits.via.fixe.tous': 'se change dans Persona (cela touche toute personne connectée)',
    'droits.appliquer': 'Appliquer', 'droits.appliquer.aria': 'Appliquer : {q}',
    'eff.reste.droits': '{n} changement{s} de ses droits (journal des droits)',
    'droits.appareils': 'Appareils connectés', 'droits.appareils.aucun': 'Aucun appareil connecté.', 'droits.appareil.poste': 'poste', 'droits.appareil.vu': 'vu le {d}',
    'droits.appareil.couper': 'Couper', 'droits.appareil.couper.aria': 'Couper {a}', 'droits.delier': 'Délier', 'droits.delier.aria': 'Délier {i}',
    'droits.lier': 'Lier…', 'droits.lier.champ': 'Lier une identité (canal:identifiant, ex. telegram:12345)', 'droits.lier.exemple': 'canal:identifiant', 'droits.lier.format': 'Écris l\'identité sous la forme canal:identifiant.',
    'droits.tout': 'Couper tout…', 'droits.tout.ok': 'Couper tout', 'droits.tout.rien': 'Rien à couper : pas d\'accès à elle seule, et son compte est déjà coupé.',
    'droits.tout.q': 'Couper tout pour {nom} ?', 'droits.tout.coupe': 'Sera coupé :', 'droits.tout.applis': 'son accès à elle seule à : {l}',
    'droits.tout.compte': 'son compte Persona : ses connexions ouvertes sont fermées et aucune appli ne s\'ouvre plus pour elle',
    'droits.tout.reste': 'Reste tel quel :', 'droits.tout.groupes': 'ses groupes ({g}) : avec le compte coupé, ils ne lui ouvrent plus rien',
    'droits.tout.odin': 'son rôle et son autonomie dans la mémoire d\'Odin, et ses identités liées (elle peut encore écrire à Odin)',
    'droits.tout.histo': 'Rien n\'est effacé de son historique.',
    'droits.valider.titre': 'Donner un droit', 'droits.valider.ok': 'Confirmer',
    'droits.fait': 'C\'est fait : la carte est à jour.', 'droits.annule': 'Rien n\'a changé.', 'droits.refus': 'Refusé : {r}',
    'sorte.droit': 'Droit changé', 'sens.donne': 'donné', 'sens.limite': 'limité', 'registre.odin': 'Mémoire d\'Odin', 'registre.persona': 'Persona',
    'droit.ligne': '{quoi} : {avant} → {apres}', 'droit.pour': 'pour {p}', 'droit.rien': 'rien', 'droit.tous': 'toute personne connectée',
    'droit.acces': 'Accès à {a}', 'droit.groupes': 'Groupes', 'droit.compte': 'Compte', 'droit.identite': 'Identité', 'droit.personne': 'Fiche',
    'droit.identites': '{n} identité{s}',
  };
  const ROLES = ['owner', 'member', 'guest'], AUTONOMIES = ['prudent', 'equilibre', 'autonome'];
  const PREUVES = ['session-proprietaire', 'appareil-appaire', 'code-prouve', 'non-prouve'];
  const SORTES = ['demande', 'action', 'decision', 'validation', 'refus', 'connexion', 'droit'];
  const SENS = ['donne', 'limite'], REGISTRES = ['odin', 'persona'];
  // Les deux seules adresses où le bloc « Droits » envoie : les actions qui existent déjà, avec leur validation.
  const ACTION_ODIN = '/api/action', ACTION_PERSONA = '/api/valhalla/act';
  const RESULTATS = ['reussi', 'echoue', 'en_attente', 'arrete', 'en_cours', 'inconnu', 'sans_tour'];
  const RAISONS = ['proprietaire', 'la-sienne', 'reglage-proprietaire-seul', 'invite', 'lien-absent', 'lien-douteux', 'autre-personne', 'demandeur-inconnu'];
  const MESURES = ['langues', 'longueur', 'heures', 'applis', 'abouties'], A_NOTER = ['appli-du-tour'];

  // ---------------- Logique pure (sans document)
  /** Le texte d'une clé, avec ses valeurs ({n}, {s} : pluriel de n, {nom}…) ; une clé absente se voit (jamais vide). */
  function t(cle, v = {}) {
    const brut = Object.prototype.hasOwnProperty.call(T, cle) ? T[cle] : `[${cle}]`;
    const n = Number(v.n);
    return brut.replace(/\{(\w+)\}/g, (_, k) => (k === 's' ? (n > 1 ? 's' : '') : v[k] === undefined ? '' : String(v[k])));
  }
  const langue = () => { try { return (typeof navigator !== 'undefined' && navigator.language) || undefined; } catch { return undefined; } };
  function quand(ms) { if (!ms && ms !== 0) return '—'; try { return new Date(ms).toLocaleString(langue(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return String(ms); } }
  function jour(ms) { try { return new Date(ms).toLocaleDateString(langue(), { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return String(ms); } }
  const nomDe = (p) => (p && p.synthetique ? t('liste.toi') : (p && p.nom) || '—');
  const canaux = (p) => (p && Array.isArray(p.canaux) && p.canaux.length ? p.canaux.join(', ') : t('canaux.aucun'));
  /** Le message d'un refus de la route (code et raison). */
  function erreurDe(r) {
    if (!r) return t('erreur.reseau');
    if (r.code === 'refuse' && r.raison && T[`raison.${r.raison}`]) return t(`raison.${r.raison}`);
    return T[`erreur.${r.code}`] ? t(`erreur.${r.code}`) : t('erreur.reseau');
  }
  /** Une période de deux dates de formulaire (« AAAA-MM-JJ ») : du début du premier jour à la fin du second, heure locale. */
  function periodeDe(du, au) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(du || '')), a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(au || ''));
    if (!d || !a) return undefined;
    const depuis = new Date(+d[1], +d[2] - 1, +d[3], 0, 0, 0, 0).getTime(), jusqua = new Date(+a[1], +a[2] - 1, +a[3], 23, 59, 59, 999).getTime();
    return Number.isFinite(depuis) && Number.isFinite(jusqua) && depuis <= jusqua ? { depuis, jusqua } : undefined;
  }
  /** Le texte de la confirmation : exactement ce que l'aperçu dit retirer, et tout ce qui reste ailleurs. */
  function texteConfirmation(nom, cible, bilan) {
    const r = bilan.reste || {}, lignes = [];
    const periode = cible.depuis !== undefined ? t('eff.q.periode', { du: jour(cible.depuis), au: quand(cible.jusqua) }) : t('eff.q.jusqua', { au: quand(cible.jusqua) });
    lignes.push(t('eff.q', { nom, periode }), '', t('eff.retire', { n: bilan.retire.historique }), t('eff.retire.mesures'), '', t('eff.reste'));
    const puce = (x) => lignes.push(`• ${x}`);
    if (r.historique) puce(t('eff.reste.historique', { n: r.historique }));
    if (r.mesuresCorrigees) puce(t('eff.reste.mesures', { n: r.mesuresCorrigees }));
    if (r.droits) puce(t('eff.reste.droits', { n: r.droits }));
    puce(t('eff.reste.messages', { n: r.messages || 0 })); puce(t('eff.reste.missions', { n: r.missions || 0 }));
    puce(t('eff.reste.aiguillage', { n: r.aiguillage || 0 })); puce(t('eff.reste.souvenirs', { n: r.souvenirs || 0 }));
    if (r.note) puce(t('eff.reste.note')); if (r.lienPersona) puce(t('eff.reste.lien'));
    puce(t('eff.reste.audit')); puce(t('eff.reste.sauvegardes')); puce(t('eff.reste.inconnus'));
    lignes.push('', t('eff.sansretour'));
    return lignes.join('\n');
  }
  /** Les clés que la page doit savoir dire (codes envoyés par Odin compris). */
  const clesAttendues = () => [
    ...ROLES.map((x) => `role.${x}`), ...AUTONOMIES.map((x) => `autonomie.${x}`), ...PREUVES.map((x) => `preuve.${x}`),
    ...SORTES.map((x) => `sorte.${x}`), ...RESULTATS.map((x) => `resultat.${x}`), ...RAISONS.map((x) => `raison.${x}`),
    ...MESURES.map((x) => `mes.nom.${x}`), ...A_NOTER.map((x) => `mes.anoter.${x}`),
    ...SENS.map((x) => `sens.${x}`), ...REGISTRES.map((x) => `registre.${x}`),
  ];

  // ---------------- Les droits, dits en clair (codes traduits ici, jamais rangés en une langue)
  const code = (pre, x) => (Object.prototype.hasOwnProperty.call(T, `${pre}.${x}`) ? t(`${pre}.${x}`) : String(x));
  /** Un groupe, une personne (« @login ») ou « * » d'une liste de droits. */
  const quiDit = (g) => { const x = String(g); return x === '*' ? t('droit.tous') : x.startsWith('@') ? x.slice(1) : x.startsWith('groupe:') ? x.slice(7) : x; };
  /** Une valeur d'avant ou d'après du journal des droits (listes « a,b », « actif »/« coupe », « clé=valeur;… »). */
  function valeurDroit(quoi, v) {
    const s = String(v == null ? '' : v);
    if (!s) return t('droit.rien');
    if (quoi === 'role') return code('role', s);
    if (quoi === 'autonomie') return code('autonomie', s);
    if (quoi === 'compte') return s === 'actif' ? t('droits.compte.actif') : s === 'coupe' ? t('droits.compte.coupe') : s;
    if (quoi === 'groupes' || quoi.startsWith('acces:')) return s.split(',').filter(Boolean).map(quiDit).join(', ') || t('droit.rien');
    if (quoi === 'identite') {
      // « canal:identifiant;user=…;role=…;autonomy=… » : Odin écrit la fin ; l'identifiant, lui, vient de dehors et peut
      // contenir « ; » ou « = » — il reste du texte, tel quel, et seule la fin est lue comme rôle et autonomie.
      const m = /^(.*);user=[^;]*;role=([^;]*);autonomy=([^;]*)$/s.exec(s);
      return m ? [m[1], code('role', m[2]), code('autonomie', m[3])].join(' · ') : s;
    }
    const parts = s.split(';').map((x) => {
      const m = /^(\w+)=(.*)$/.exec(x); if (!m) return x;
      if (m[1] === 'role') return code('role', m[2]);
      if (m[1] === 'autonomy') return code('autonomie', m[2]);
      if (m[1] === 'groups') return m[2].split(',').filter(Boolean).map(quiDit).join(', ') || t('droit.rien');
      if (m[1] === 'identities') return t('droit.identites', { n: m[2] });
      return null; // un identifiant interne (user=…) ne se montre pas
    }).filter(Boolean);
    return parts.join(' · ') || t('droit.rien');
  }
  /** Une ligne du journal des droits en une phrase : « Autonomie : Prudent → Équilibré ». nomAppli : id → nom affiché. */
  function texteDroit(dr, nomAppli = (x) => x) {
    const quoi = String((dr && dr.quoi) || '');
    const sujet = quoi === 'role' ? t('carte.role') : quoi === 'autonomie' ? t('carte.autonomie') : quoi === 'groupes' ? t('droit.groupes') : quoi === 'compte' ? t('droit.compte')
      : quoi === 'identite' ? t('droit.identite') : quoi === 'personne' ? t('droit.personne') : quoi.startsWith('acces:') ? t('droit.acces', { a: nomAppli(quoi.slice(6)) }) : quoi;
    return t('droit.ligne', { quoi: sujet, avant: valeurDroit(quoi, dr.avant), apres: valeurDroit(quoi, dr.apres) });
  }
  /** D'où vient l'accès à une appli (« accès à elle seule », « par le groupe famille »…). */
  function viaDe(a) {
    const out = [];
    if (a.personnel) out.push(t('droits.via.perso'));
    for (const g of a.par || []) out.push(g === 'admin' ? t('droits.via.admin') : g === '*' ? t('droits.via.tous') : t('droits.via.groupe', { g }));
    return out.join(' ; ');
  }
  /** La confirmation de « Couper tout » : exactement ce qui sera coupé, et ce qui reste. */
  function texteCouperTout(nom, dr) {
    const perso = (dr.applis || []).filter((a) => a.personnel), lignes = [t('droits.tout.q', { nom }), '', t('droits.tout.coupe')];
    if (perso.length) lignes.push(`• ${t('droits.tout.applis', { l: perso.map((a) => a.nom).join(', ') })}`);
    if (dr.actif) lignes.push(`• ${t('droits.tout.compte')}`);
    lignes.push('', t('droits.tout.reste'));
    if ((dr.groupes || []).length) lignes.push(`• ${t('droits.tout.groupes', { g: dr.groupes.join(', ') })}`);
    lignes.push(`• ${t('droits.tout.odin')}`, '', t('droits.tout.histo'));
    return lignes.join('\n');
  }

  // ---------------- Les mesures, dites simplement dans la langue de la personne qui regarde (Intl, aucune liste de mots)
  function pourcent(x) { try { return new Intl.NumberFormat(langue(), { style: 'percent', maximumFractionDigits: 0 }).format(Number(x) || 0); } catch { return `${Math.round((Number(x) || 0) * 100)} %`; } }
  function nombre(x) { try { return new Intl.NumberFormat(langue(), { maximumFractionDigits: 1 }).format(Number(x) || 0); } catch { return String(x); } }
  /** Le nom d'une langue d'après son code ; le code tel quel si le navigateur ne le connaît pas (jamais deviné). */
  function nomLangue(code) {
    const c = String(code == null ? '' : code);
    try { const n = new Intl.DisplayNames(langue(), { type: 'language' }).of(c); return n && n !== c ? n : c; } catch { return c; }
  }
  function heure(h) { try { return new Intl.DateTimeFormat(langue(), { hour: 'numeric' }).format(new Date(2000, 0, 1, h)); } catch { return `${h} h`; } }
  const cases24 = (v) => (v && Array.isArray(v.cases) && v.cases.length === 24 ? v.cases.map((x) => Math.max(0, Number(x) || 0)) : null);
  /** Les heures qui ont des demandes, de la plus fréquente à la moins fréquente. */
  const heuresTriees = (cases) => cases.map((n, h) => ({ h, n })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.h - b.h);
  /** Une mesure résumée en une ligne de texte (la valeur d'Odin à côté d'une correction, le texte des heures).
   *  corrige : la valeur vient du propriétaire ; des heures corrigées sont oui/non, donc dites sans aucun compte. */
  function resume(cle, v, n, corrige) {
    if (v == null) return t('mes.rien');
    if (cle === 'langues') {
      const parts = Array.isArray(v.parts) ? v.parts.map((p) => `${nomLangue(p.code)} ${pourcent(p.part)}`) : [];
      if (v.nonReconnues && v.nonReconnues.n) parts.push(`${t('mes.langue.nonreconnue')} ${pourcent(v.nonReconnues.part)}`);
      return parts.length ? parts.join(', ') : t('mes.rien');
    }
    if (cle === 'longueur') return t('mes.longueur.val', { v: nombre(v.mediane), n: Number(v.mediane) });
    if (cle === 'heures') {
      const c = cases24(v); if (!c) return t('mes.rien');
      const l = heuresTriees(c);
      if (corrige) {
        const choisies = c.map((x, h) => (x > 0 ? heure(h) : null)).filter(Boolean);
        return choisies.length ? t('mes.heures.choisies', { n: choisies.length, l: choisies.join(', ') }) : t('mes.heures.aucune');
      }
      return l.length ? t('mes.heures.texte', { n: l.length, top: l.slice(0, 3).map((x) => `${heure(x.h)} (${nombre(x.n)})`).join(', ') }) : t('mes.heures.aucune');
    }
    if (cle === 'abouties') return v.abouties !== undefined && n ? t('mes.abouties.val', { p: pourcent(v.part), a: v.abouties, n }) : pourcent(v.part);
    if (cle === 'applis') return Array.isArray(v.ids) && v.ids.length ? v.ids.join(', ') : t('mes.rien');
    return t('mes.rien');
  }
  /** Ce que la correction d'une mesure envoie, lu dans son formulaire ; undefined si une valeur n'est pas valable. */
  function correctionDe(cle, f) {
    const num = (s) => (String(s).trim() === '' ? NaN : Number(String(s).replace(',', '.')));
    if (cle === 'longueur') { const x = num(f.mediane); return Number.isFinite(x) && x >= 0 ? { mediane: x } : undefined; }
    if (cle === 'abouties') { const x = num(f.part); return Number.isFinite(x) && x >= 0 && x <= 100 ? { part: x / 100 } : undefined; }
    if (cle === 'heures') return Array.isArray(f.heures) && f.heures.length === 24 ? { cases: f.heures.map((on) => (on ? 1 : 0)) } : undefined;
    if (cle === 'langues') {
      const parts = [];
      for (const l of f.lignes || []) {
        const code = String(l.code || '').trim(), p = String(l.part || '').trim();
        if (!code && !p) continue;
        const x = num(p);
        if (!code || !Number.isFinite(x) || x < 0 || x > 100) return undefined;
        parts.push({ code, part: x / 100 });
      }
      return parts.length ? { parts } : undefined;
    }
    return undefined;
  }

  // ---------------- Dessin
  const el = (tag, a = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(a)) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };
  const CSS = `
.pf{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);gap:16px;align-items:start;min-width:0}
@media (max-width:760px){.pf{grid-template-columns:minmax(0,1fr)}}
.pf-bloc{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:12px 14px;min-width:0}
.pf h2{font-size:16px;margin:0 0 8px}.pf h3{font-size:14px;margin:16px 0 8px;color:var(--ink)}
.pf-liste ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.pf-p{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;min-height:44px;padding:8px 10px;border-radius:10px;border:1px solid var(--line);background:var(--panel2,var(--panel));color:var(--ink);font:inherit;text-align:left;cursor:pointer;overflow-wrap:anywhere}
.pf-p:hover{background:var(--hover)}.pf-p[aria-current=true]{border-color:var(--accent);background:var(--sel,var(--hover))}
.pf-p:focus-visible,.pf-b:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.pf-n{font-weight:600;font-size:14px}.pf-s{font-size:12.5px;color:var(--muted)}
.pf-inc{margin:10px 0 0;font-size:12.5px;color:var(--muted)}
.pf-tete{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}.pf-tete h2{margin:0;font-size:20px;overflow-wrap:anywhere}
.pf-pill{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--muted)}
.pf-dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 14px;margin:12px 0 0;font-size:14px}
.pf-dl dt{color:var(--muted)}.pf-dl dd{margin:0;min-width:0;overflow-wrap:anywhere}
@media (max-width:420px){.pf-dl{grid-template-columns:minmax(0,1fr)}.pf-dl dd{margin-bottom:6px}}
.pf-id{display:block}.pf-id small{color:var(--muted)}
.pf-aide{font-size:12.5px;color:var(--muted);margin:10px 0 0}
.pf-actes{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.pf-b{min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--panel2,var(--panel));color:var(--ink);padding:0 14px;font:600 13px/1 inherit;font-family:inherit;cursor:pointer}
.pf-b.danger{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 50%,var(--line))}.pf-b[disabled]{opacity:.5;cursor:default}
.pf textarea{box-sizing:border-box;width:100%;min-height:88px;padding:8px 10px;border-radius:10px;border:1px solid var(--field,var(--line));background:var(--panel2,var(--panel));color:var(--ink);font:inherit;resize:vertical}
.pf-st{font-size:13px;color:var(--muted);min-height:18px;margin:6px 0 0}.pf-st.ko{color:var(--bad)}.pf-st.ok{color:var(--good)}
.pf-portrait{font-size:13px;color:var(--muted);font-style:italic;border:1px dashed var(--line);border-radius:10px;padding:10px 12px}
.pf-temps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.pf-l{border:1px solid var(--line);border-radius:10px;padding:8px 12px;background:var(--panel2,var(--panel));min-width:0}
.pf-lt{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;font-size:12.5px;color:var(--muted)}.pf-lt b{color:var(--ink);font-size:13.5px}
.pf-q{margin:4px 0 0;font-size:14px;color:var(--ink);overflow-wrap:anywhere;white-space:pre-wrap}.pf-q.vide{color:var(--muted);font-style:italic;font-size:12.5px}
.pf-tag{font-size:11.5px;border:1px solid var(--line);border-radius:6px;padding:0 7px}
.pf-tag.reussi{color:var(--good)}.pf-tag.echoue{color:var(--bad)}.pf-tag.en_attente,.pf-tag.en_cours{color:var(--warn)}
.pf-eff{margin-top:14px}.pf-eff summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:var(--bad);font-weight:600}
.pf-eff label{display:flex;gap:8px;align-items:center;min-height:44px;font-size:14px}.pf-eff input[type=date]{min-height:40px;border-radius:8px;border:1px solid var(--field,var(--line));background:var(--panel2,var(--panel));color:var(--ink);padding:0 8px;font:inherit}
.pf-dates{display:flex;flex-wrap:wrap;gap:8px 14px}
.pf-vide{font-size:13.5px;color:var(--muted);padding:12px 0;margin:0}
.pf-ms{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.pf-m{border:1px solid var(--line);border-radius:10px;padding:8px 12px;background:var(--panel2,var(--panel));min-width:0}
.pf-mt{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}.pf-mt b{font-size:14px;color:var(--ink)}
.pf-msur{font-size:12.5px;color:var(--muted)}
.pf-mv{margin:6px 0 0;font-size:14px;color:var(--ink);overflow-wrap:anywhere}
.pf-m.peu .pf-mv,.pf-m.nm .pf-mv,.pf-m.peu .pf-ht{color:var(--muted)}
.pf-m.peu .pf-lb i,.pf-m.peu .pf-hb{background:var(--muted)}
.pf-pill.peu{border-style:dashed}.pf-pill.corr{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 50%,var(--line))}
.pf-langs{list-style:none;padding:0;display:flex;flex-direction:column;gap:4px}
.pf-langs li{display:grid;grid-template-columns:minmax(0,9em) minmax(0,1fr) 3.2em;gap:8px;align-items:center}
.pf-ln{overflow-wrap:anywhere}.pf-lp{text-align:right;font-variant-numeric:tabular-nums}
.pf-lb{height:8px;border-radius:4px;background:color-mix(in srgb,var(--line) 70%,transparent);overflow:hidden}.pf-lb i{display:block;height:100%;background:var(--accent)}
.pf-h{display:grid;grid-template-columns:repeat(24,minmax(0,1fr));gap:2px;height:48px;align-items:end;border-bottom:1px solid var(--line)}
.pf-hb{display:block;background:var(--accent);border-radius:2px 2px 0 0;min-width:0}
.pf-hx{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));font-size:11.5px;color:var(--muted);margin-top:2px}
.pf-ht{margin:6px 0 0;font-size:13px}
.pf-mf{margin-top:8px}.pf-mf input{min-height:44px;box-sizing:border-box;border-radius:8px;border:1px solid var(--field,var(--line));background:var(--panel);color:var(--ink);padding:0 8px;font:inherit}
.pf-mfl{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:13.5px}.pf-mfl input{width:8em}
.pf-hks{display:grid;grid-template-columns:repeat(auto-fill,minmax(52px,1fr));gap:6px;margin-top:6px}
.pf-hk{min-height:44px;min-width:44px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--muted);font:inherit;font-size:12.5px;cursor:pointer}
.pf-hk[aria-pressed=true]{background:color-mix(in srgb,var(--accent) 28%,var(--panel));border-color:var(--accent);color:var(--ink);font-weight:700}
.pf-hk:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.pf-lfs{display:flex;flex-direction:column;gap:6px;margin-top:6px}.pf-lf{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.pf-lf input[type=text]{width:8em}.pf-lf input[type=number]{width:6em}
.pf-droits{margin-top:14px}.pf-droits>h3{margin-top:0}
.pf-reg{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:10px;background:var(--panel2,var(--panel));min-width:0}
.pf-reg h4{margin:8px 0 2px;font-size:14px;color:var(--ink)}.pf-reg h4:first-child{margin-top:0}.pf-reg h4 small{font-weight:400;color:var(--muted);font-size:12.5px}
.pf-rang{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;min-height:44px;font-size:14px;min-width:0}.pf-rang>b{font-weight:600;min-width:6.5em}
.pf-sel{min-height:44px;min-width:44px;border-radius:8px;border:1px solid var(--field,var(--line));background:var(--panel);color:var(--ink);padding:0 8px;font:inherit}
.pf-cases,.pf-apps{list-style:none;margin:2px 0 0;padding:0;display:flex;flex-direction:column;gap:2px;min-width:0}
.pf-case{display:flex;gap:10px;align-items:center;min-height:44px;cursor:pointer;font-size:14px;overflow-wrap:anywhere;min-width:0}
.pf-case input{width:22px;height:22px;flex:none;margin:0;accent-color:var(--accent)}.pf-case input:disabled{cursor:default}
.pf-case input:focus-visible,.pf-sel:focus-visible,.pf-lier input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.pf-case small,.pf-apps small{display:block;color:var(--muted);font-size:12.5px}
.pf-apps li{display:flex;gap:10px;align-items:center;justify-content:space-between;min-height:44px;font-size:14px;min-width:0;overflow-wrap:anywhere}.pf-apps li>span{min-width:0}
.pf-plus summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-size:14px;color:var(--accent)}
.pf-lier{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px}
.pf-lier input{flex:1 1 14em;min-width:0;min-height:44px;box-sizing:border-box;border-radius:8px;border:1px solid var(--field,var(--line));background:var(--panel);color:var(--ink);padding:0 10px;font:inherit}
.pf-tout{margin-top:12px}
.pf-choix{display:flex;gap:8px;align-items:center;flex-wrap:nowrap;min-width:0}
`;
  function style() { if (!document.getElementById('pf-css')) document.head.append(el('style', { id: 'pf-css' }, CSS)); }

  /** Envoie à une action qui existe (seulement ces deux adresses) ; la réponse telle quelle. */
  async function defautPoster(url, corps) {
    if (url !== ACTION_ODIN && url !== ACTION_PERSONA) return undefined;
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify(corps) });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, ...j };
    } catch { return undefined; }
  }

  async function defautApi(path, opts = {}) {
    try {
      const init = { method: opts.method || 'GET', headers: { 'x-odin': '1' } };
      if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
      const r = await fetch(`/api/personnes${path}`, init);
      const j = await r.json().catch(() => ({}));
      return { status: r.status, ...j };
    } catch { return undefined; }
  }

  // ---------------- Rendu. ctx = { api?, confirmer?, demander?, dire? }
  async function rendre(host, ctx = {}) {
    if (!host) return undefined;
    style();
    const api = ctx.api || defautApi;
    const D = window.OdinDialog;
    const confirmer = ctx.confirmer || ((txt) => (D ? D.confirm(txt, { ok: t('eff.ok'), danger: true }) : Promise.resolve(false)));
    const demander = ctx.demander || ((txt) => (D && D.prompt ? D.prompt(txt, '') : Promise.resolve(null)));
    // Le bloc « Droits » : l'envoi vers une action qui existe, la validation (texte du serveur), la confirmation de « Couper tout ».
    const poster = ctx.poster || defautPoster;
    const valider = ctx.valider || ((txt) => (D ? D.confirm(txt, { titre: t('droits.valider.titre'), ok: t('droits.valider.ok') }) : Promise.resolve(false)));
    const confirmerCoupure = ctx.confirmerCoupure || ((txt) => (D ? D.confirm(txt, { ok: t('droits.tout.ok'), danger: true }) : Promise.resolve(false)));
    const etat = { liste: null, choisi: null, carte: null, proprietaire: false, lignes: [], suite: undefined, total: 0, charge: false, msgDroits: null, occupe: false };
    let temps, compte, plus, sentinelle, obs; // la ligne de temps de la carte affichée
    let obsZone; // le bloc « Ce qu'Odin a observé » de la carte affichée

    const zoneListe = el('aside', { class: 'pf-bloc pf-liste', 'aria-label': t('liste.titre') });
    const zoneCarte = el('section', { class: 'pf-bloc pf-carte', 'aria-live': 'polite' });
    const racine = el('div', { class: 'pf' }, zoneListe, zoneCarte);
    host.replaceChildren(racine);

    const r = await api('');
    if (!r || r.ok !== true) {
      zoneListe.replaceChildren(el('h2', {}, t('liste.titre')), el('p', { class: 'pf-vide', role: 'status' }, erreurDe(r)));
      zoneCarte.hidden = true;
      return { etat };
    }
    etat.liste = Array.isArray(r.personnes) ? r.personnes : []; etat.proprietaire = Boolean(r.proprietaire);
    peindreListe(r.inconnus);
    if (etat.liste.length === 1 && !etat.proprietaire) await choisir(etat.liste[0].id);
    else zoneCarte.replaceChildren(el('p', { class: 'pf-vide' }, etat.liste.length ? t('liste.choisir') : t('liste.vide')));

    function peindreListe(inconnus) {
      const ul = el('ul', {}, ...etat.liste.map((p) => el('li', {}, el('button', { type: 'button', class: 'pf-p', 'data-id': p.id, 'aria-current': String(etat.choisi === p.id), onclick: () => choisir(p.id, true) },
        el('span', { class: 'pf-n' }, nomDe(p)), el('span', { class: 'pf-s' }, `${t(`role.${p.role}`)} · ${canaux(p)}`)))));
      // replaceChildren écrirait « null » : le compteur des inconnus ne s'ajoute que s'il y en a.
      zoneListe.replaceChildren(el('h2', {}, t('liste.titre')), etat.liste.length ? ul : el('p', { class: 'pf-vide' }, t('liste.vide')));
      if (inconnus && inconnus.total) zoneListe.append(el('p', { class: 'pf-inc' }, t('inconnus', { n: inconnus.total })));
    }

    async function choisir(id, defiler) {
      etat.choisi = id; etat.lignes = []; etat.suite = undefined; etat.total = 0;
      for (const b of zoneListe.querySelectorAll('.pf-p')) b.setAttribute('aria-current', String(b.getAttribute('data-id') === id));
      const c = await api(`/${encodeURIComponent(id)}`);
      if (!c || c.ok !== true) { zoneCarte.replaceChildren(el('p', { class: 'pf-vide', role: 'status' }, erreurDe(c))); return; }
      etat.carte = c.carte; etat.proprietaire = Boolean(c.proprietaire);
      peindreCarte();
      await Promise.all([chargerMesures(), charger()]);
      if (defiler && zoneCarte.scrollIntoView && typeof matchMedia === 'function' && matchMedia('(max-width:760px)').matches) zoneCarte.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    function peindreCarte() {
      const c = etat.carte, proprio = etat.proprietaire;
      const nom = c.synthetique ? t('liste.toi') : c.nom;
      const ids = c.identites.length ? c.identites.map((i) => el('span', { class: 'pf-id' }, `${i.canal}:${i.pair} `, el('small', {}, `(${t(`preuve.${i.preuve}`)}${i.partage ? ` · ${t('carte.partage')}` : ''})`))) : t('carte.identites.aucune');
      const acces = !c.persona ? t('carte.acces.sanslien') : !c.acces ? t('carte.acces.inconnu')
        : [c.acces.groupes && c.acces.groupes.length ? el('span', { class: 'pf-id' }, t('carte.acces.groupes', { g: c.acces.groupes.join(', ') })) : null,
          el('span', { class: 'pf-id' }, c.acces.applis.length ? c.acces.applis.map((a) => a.nom).join(', ') : t('carte.acces.aucune'))];
      const dl = el('dl', { class: 'pf-dl' },
        el('dt', {}, t('carte.role')), el('dd', {}, t(`role.${c.role}`)),
        c.autonomie ? [el('dt', {}, t('carte.autonomie')), el('dd', {}, t(`autonomie.${c.autonomie}`))] : null,
        el('dt', {}, t('carte.identites')), el('dd', {}, ids),
        el('dt', {}, t('carte.acces')), el('dd', {}, acces));
      // Une personne de la mémoire d'Odin : le bloc « Droits » (ses deux registres) ; l'entrée sans fiche du propriétaire : le résumé.
      const blocs = [el('div', { class: 'pf-tete' }, el('h2', {}, nom), el('span', { class: 'pf-pill' }, t(`role.${c.role}`))), c.synthetique ? dl : blocDroits(c, nom, ids)];
      if (proprio) {
        blocs.push(el('p', { class: 'pf-aide' }, t('carte.regl')), el('div', { class: 'pf-actes' },
          el('button', { type: 'button', class: 'pf-b', onclick: () => { if (window.openSettings) window.openSettings('personnes'); } }, t('carte.regl.personnes')),
          el('button', { type: 'button', class: 'pf-b', onclick: () => { if (window.OdinApps && window.OdinApps.app) window.OdinApps.app('var'); } }, t('carte.regl.persona'))));
        blocs.push(el('h3', {}, t('carte.note')));
        if (c.notable) {
          const zone = el('textarea', { 'aria-label': t('carte.note'), maxlength: '2000' }); zone.value = c.note || '';
          const st = el('p', { class: 'pf-st', role: 'status' });
          blocs.push(el('p', { class: 'pf-aide' }, t('carte.note.aide')), zone, el('div', { class: 'pf-actes' }, el('button', { type: 'button', class: 'pf-b', onclick: async () => {
            const rep = await api(`/${encodeURIComponent(c.id)}/note`, { method: 'POST', body: { texte: zone.value } });
            if (rep && rep.ok) { c.note = rep.note; st.textContent = t('carte.note.ok'); st.className = 'pf-st ok'; } else { st.textContent = erreurDe(rep); st.className = 'pf-st ko'; }
          } }, t('carte.note.enregistrer'))), st);
        } else blocs.push(el('p', { class: 'pf-aide' }, t('carte.note.sansfiche')));
      } else {
        const st = el('p', { class: 'pf-st', role: 'status' });
        blocs.push(el('p', { class: 'pf-aide' }, t('carte.sienne')), el('div', { class: 'pf-actes' }, el('button', { type: 'button', class: 'pf-b', onclick: async () => {
          const texte = await demander(t('carte.signaler.question'));
          if (texte == null || !String(texte).trim()) return;
          const rep = await api('/moi/signaler', { method: 'POST', body: { texte: String(texte) } });
          if (rep && rep.ok) { st.textContent = t('carte.signaler.ok'); st.className = 'pf-st ok'; } else { st.textContent = erreurDe(rep); st.className = 'pf-st ko'; }
        } }, t('carte.signaler'))), st);
      }
      obsZone = el('div', { class: 'pf-obs', 'aria-live': 'polite' }, el('p', { class: 'pf-aide' }, t('obs.chargement')));
      blocs.push(el('h3', {}, t('obs.titre')), obsZone);
      blocs.push(el('h3', {}, t('carte.portrait')), el('p', { class: 'pf-portrait' }, t('carte.portrait.vide')));
      compte = el('span', { class: 'pf-pill' });
      temps = el('ol', { class: 'pf-temps', 'aria-label': t('histo.titre') });
      plus = el('button', { type: 'button', class: 'pf-b', hidden: true, onclick: () => charger() }, t('histo.plus'));
      sentinelle = el('div', { 'aria-hidden': 'true', style: 'height:1px' });
      blocs.push(el('div', { class: 'pf-tete' }, el('h3', {}, t('histo.titre')), compte), temps, sentinelle, el('div', { class: 'pf-actes' }, plus));
      if (proprio) blocs.push(formEffacer(c, nom));
      zoneCarte.replaceChildren(...blocs);
      // Défilement : la suite se charge quand le bas de la liste arrive à l'écran (le bouton reste pour le clavier).
      if (obs) obs.disconnect();
      if (typeof IntersectionObserver === 'function') { obs = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && etat.suite && !etat.charge) charger(); }); obs.observe(sentinelle); }
    }

    // ---- « Ce qu'Odin a observé » : chaque mesure, sa valeur, « sur N observations », grisée sous 20 ; le propriétaire
    // seul cache, corrige ou annule (la route le vérifie aussi) ; un membre lit, sans valeur d'origine ni mesure cachée.
    async function chargerMesures() {
      const c = etat.carte; if (!c || !obsZone) return;
      const zone = obsZone, rep = await api(`/${encodeURIComponent(c.id)}/mesures`);
      if (etat.carte !== c || obsZone !== zone) return; // une autre personne a été choisie entre-temps
      peindreMesures(rep);
    }
    function peindreMesures(rep) {
      if (!rep || rep.ok !== true || !Array.isArray(rep.mesures)) { obsZone.replaceChildren(el('p', { class: 'pf-aide', role: 'status' }, rep && rep.code ? erreurDe(rep) : t('obs.erreur'))); return; }
      const st = el('p', { class: 'pf-st', role: 'status' });
      obsZone.replaceChildren(el('ul', { class: 'pf-ms' }, ...rep.mesures.filter((m) => m && MESURES.includes(m.cle)).map((m) => mesure(m, st))),
        el('p', { class: 'pf-aide' }, t('obs.calcule', { d: quand(rep.calculeLe) })), st);
    }
    async function regler(cle, corps, st) {
      const c = etat.carte, rep = await api(`/${encodeURIComponent(c.id)}/mesures/${encodeURIComponent(cle)}`, { method: 'POST', body: corps });
      if (etat.carte !== c) return;
      if (rep && rep.ok) return peindreMesures(rep);
      st.textContent = rep && rep.raison === 'correction-invalide' ? t('mes.f.invalide') : erreurDe(rep); st.className = 'pf-st ko';
    }
    function valeur(m) {
      const v = m.valeur;
      if (m.etat !== 'mesure' && !m.corrigeParProprietaire) return el('p', { class: 'pf-mv' }, T[`mes.anoter.${m.aNoter}`] ? t(`mes.anoter.${m.aNoter}`) : t('mes.rien'));
      if (v == null) return el('p', { class: 'pf-mv' }, t('mes.rien'));
      if (m.cle === 'langues' && Array.isArray(v.parts)) {
        const rang = (nom, part) => el('li', {}, el('span', { class: 'pf-ln' }, nom), el('span', { class: 'pf-lb', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.round(Math.min(1, Math.max(0, Number(part) || 0)) * 100)}%` })), el('span', { class: 'pf-lp' }, pourcent(part)));
        const l = v.parts.map((p) => rang(nomLangue(p.code), p.part));
        if (v.nonReconnues && v.nonReconnues.n) l.push(rang(t('mes.langue.nonreconnue'), v.nonReconnues.part));
        return el('ul', { class: 'pf-mv pf-langs' }, l);
      }
      if (m.cle === 'heures') {
        const c = cases24(v); if (!c) return el('p', { class: 'pf-mv' }, t('mes.rien'));
        const max = Math.max(1, ...c), l = c.map((n, h) => ({ h, n })).filter((x) => x.n > 0);
        const corrige = !!m.corrigeParProprietaire;
        const label = corrige
          ? t('mes.heures.labelc', { l: l.length ? l.map((x) => heure(x.h)).join(' ; ') : t('mes.heures.aucune') })
          : t('mes.heures.label', { l: l.length ? l.map((x) => `${heure(x.h)} : ${nombre(x.n)}`).join(' ; ') : t('mes.heures.aucune') });
        return el('div', { class: 'pf-mv' },
          el('div', { class: 'pf-h', role: 'img', 'aria-label': label }, c.map((n) => el('span', { class: 'pf-hb', style: `height:${n ? Math.max(4, Math.round((n / max) * 100)) : 0}%` }))),
          el('div', { class: 'pf-hx', 'aria-hidden': 'true' }, [0, 6, 12, 18].map((h) => el('span', {}, heure(h)))),
          el('p', { class: 'pf-ht' }, resume('heures', v, m.n, corrige)));
      }
      return el('p', { class: 'pf-mv' }, resume(m.cle, v, m.n));
    }
    function mesure(m, st) {
      const proprio = etat.proprietaire, mesuree = m.etat === 'mesure';
      const peu = mesuree && m.tropPeu, li = el('li', { class: `pf-m${peu ? ' peu' : ''}${mesuree ? '' : ' nm'}`, 'data-mesure': m.cle });
      const tete = el('div', { class: 'pf-mt' }, el('b', {}, t(`mes.nom.${m.cle}`)),
        mesuree ? el('span', { class: 'pf-msur' }, t('mes.sur', { n: m.n })) : el('span', { class: 'pf-pill' }, t('mes.nonmesure')),
        peu ? el('span', { class: 'pf-pill peu' }, t('mes.troppeu')) : null,
        m.corrigeParProprietaire ? el('span', { class: 'pf-pill corr' }, proprio ? t('mes.corrige.toi') : t('mes.corrige.lui')) : null,
        proprio && m.cache ? el('span', { class: 'pf-pill' }, t('mes.cache')) : null);
      li.append(tete, valeur(m));
      if (proprio && m.corrigeParProprietaire && m.valeurMesuree !== undefined) li.append(el('p', { class: 'pf-aide' }, t('mes.odin', { v: resume(m.cle, m.valeurMesuree, m.n) })));
      if (!proprio) return li;
      const forme = el('div', { class: 'pf-mf', hidden: true });
      let ouvert = false;
      const corrigeable = mesuree && m.cle !== 'applis';
      if (!mesuree && !m.cache && !m.corrigeParProprietaire) return li; // « non mesuré » : rien à cacher ni à corriger
      li.append(el('div', { class: 'pf-actes' },
        mesuree || m.cache ? el('button', { type: 'button', class: 'pf-b', onclick: () => regler(m.cle, { cacher: !m.cache }, st) }, m.cache ? t('mes.remettre') : t('mes.cacher')) : null,
        corrigeable ? el('button', { type: 'button', class: 'pf-b', 'aria-expanded': 'false', onclick: (e) => {
          const b = e && e.target && e.target.setAttribute ? e.target : null;
          ouvert = !ouvert; forme.hidden = !ouvert; if (b) b.setAttribute('aria-expanded', String(ouvert));
          if (ouvert) forme.replaceChildren(...formulaire(m, st, () => { ouvert = false; forme.hidden = true; if (b) b.setAttribute('aria-expanded', 'false'); }));
        } }, t('mes.corriger')) : null,
        m.corrigeParProprietaire ? el('button', { type: 'button', class: 'pf-b', onclick: () => regler(m.cle, { annuler: true }, st) }, t('mes.annuler')) : null), forme);
      return li;
    }
    /** Le petit formulaire de correction, adapté à la mesure, pré-rempli avec la valeur affichée. */
    function formulaire(m, st, fermer) {
      const v = m.valeur || {}, envoyer = (lire) => () => {
        const corr = correctionDe(m.cle, lire());
        if (!corr) { st.textContent = t('mes.f.invalide'); st.className = 'pf-st ko'; return undefined; }
        return regler(m.cle, { corriger: corr }, st);
      };
      const bas = (lire) => el('div', { class: 'pf-actes' }, el('button', { type: 'button', class: 'pf-b', onclick: envoyer(lire) }, t('mes.enregistrer')), el('button', { type: 'button', class: 'pf-b', onclick: fermer }, t('mes.fermer')));
      if (m.cle === 'longueur' || m.cle === 'abouties') {
        const lib = m.cle === 'longueur' ? t('mes.f.longueur') : t('mes.f.abouties');
        const x = el('input', { type: 'number', min: '0', ...(m.cle === 'abouties' ? { max: '100' } : {}), step: 'any', inputmode: 'decimal', 'aria-label': lib });
        x.value = m.cle === 'longueur' ? (v.mediane != null ? String(v.mediane) : '') : (v.part != null ? String(Math.round(v.part * 100)) : '');
        return [el('label', { class: 'pf-mfl' }, lib, x), bas(() => (m.cle === 'longueur' ? { mediane: x.value } : { part: x.value }))];
      }
      if (m.cle === 'heures') {
        const c = cases24(v) || Array(24).fill(0), on = c.map((n) => n > 0);
        const bs = on.map((x, h) => { const b = el('button', { type: 'button', class: 'pf-hk', 'aria-pressed': String(x) }, heure(h)); b.addEventListener('click', () => { on[h] = !on[h]; b.setAttribute('aria-pressed', String(on[h])); }); return b; });
        return [el('p', { class: 'pf-aide' }, t('mes.f.heures')), el('div', { class: 'pf-hks' }, bs), bas(() => ({ heures: on.slice() }))];
      }
      // Les langues : une ligne par langue (code, part en %), et une ligne vide pour en ajouter.
      const lignes = [], liste = el('div', { class: 'pf-lfs' });
      const ajouter = (code, part) => {
        const a = el('input', { type: 'text', maxlength: '15', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('mes.f.code') }), b = el('input', { type: 'number', min: '0', max: '100', step: 'any', inputmode: 'decimal', 'aria-label': t('mes.f.part') });
        a.value = code || ''; b.value = part == null ? '' : String(part); lignes.push({ a, b }); liste.append(el('div', { class: 'pf-lf' }, a, b, el('span', {}, '%')));
      };
      for (const p of (Array.isArray(v.parts) ? v.parts : []).slice(0, 8)) ajouter(String(p.code == null ? '' : p.code), Math.round((Number(p.part) || 0) * 100));
      ajouter('', null);
      return [el('p', { class: 'pf-aide' }, t('mes.f.langues')), liste,
        el('div', { class: 'pf-actes' }, el('button', { type: 'button', class: 'pf-b', onclick: () => ajouter('', null) }, t('mes.f.ajouter'))),
        bas(() => ({ lignes: lignes.map((l) => ({ code: l.a.value, part: l.b.value })) }))];
    }

    function ligne(l) {
      if (l.sorte === 'droit' && l.droit) return ligneDroit(l);
      const tete = el('div', { class: 'pf-lt' }, el('b', {}, t(`sorte.${l.sorte}`)), el('span', {}, quand(l.t)), el('span', {}, t('histo.via', { c: l.canal })),
        el('span', {}, t(`preuve.${l.preuve}`)), l.partage ? el('span', {}, t('histo.partage')) : null,
        l.resultat ? el('span', { class: `pf-tag ${l.resultat}` }, t(`resultat.${l.resultat}`)) : null);
      return el('li', { class: 'pf-l' }, tete, l.quoi ? el('p', { class: 'pf-q' }, l.quoi) : l.sorte === 'demande' ? el('p', { class: 'pf-q vide' }, t('histo.sanstexte')) : null);
    }

    /** Une ligne du journal des droits : quoi, avant → après, pour qui, dans quel registre, donné ou limité. */
    function ligneDroit(l) {
      const dr = l.droit, applis = (etat.carte && etat.carte.droits && etat.carte.droits.applis) || [];
      const nomAppli = (id) => (applis.find((a) => a.id === id) || {}).nom || id;
      // Pour qui : son id dans la mémoire d'Odin, ou « @login » de Persona — celui de la carte ouverte se dit par son nom.
      const pour = String(dr.pour || ''), cp = etat.carte && etat.carte.persona && etat.carte.persona.login;
      const p = cp && pour === `@${cp}` ? etat.carte : (etat.liste || []).find((x) => x.id === pour);
      const tete = el('div', { class: 'pf-lt' }, el('b', {}, t('sorte.droit')), el('span', {}, quand(l.t)), el('span', { class: 'pf-tag' }, code('registre', dr.registre)),
        el('span', { class: `pf-tag ${dr.sens === 'donne' ? 'en_attente' : 'reussi'}` }, code('sens', dr.sens)));
      return el('li', { class: 'pf-l' }, tete, el('p', { class: 'pf-q' }, `${texteDroit(dr, nomAppli)} — ${t('droit.pour', { p: p ? nomDe(p) : quiDit(pour) })}`));
    }

    // ---- Le bloc « Droits ». Rien n'est supposé : chaque changement passe par une action qui existe, puis la carte est relue.
    async function agir(url, corps) {
      const r = await poster(url, corps);
      // Donner : le serveur répond d'abord par sa demande de validation (avant → après) ; elle est montrée TELLE QUELLE, et
      // la même demande ne repart, avec la confirmation, qu'après le geste du propriétaire.
      if (r && r.ok === false && typeof r.confirm === 'string' && r.confirm) {
        if (!(await validerSansRepetition(r.confirm))) return { annule: true };
        return poster(url, { ...corps, confirm: true });
      }
      return r;
    }
    /** La validation, protégée d'une touche tenue : Entrée (ou Espace) gardée enfoncée sur « Lier… » ou « Réactiver… »
     *  se répète sur « Confirmer », qui a le focus. Tant que la validation est ouverte, une frappe RÉPÉTÉE de ces touches
     *  est arrêtée avant tout le reste ; une nouvelle frappe, voulue, passe. */
    async function validerSansRepetition(txt) {
      const w = typeof window !== 'undefined' && window && typeof window.addEventListener === 'function' ? window : null;
      const arreter = (e) => { if (e && e.repeat && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); } };
      if (w) { w.addEventListener('keydown', arreter, true); w.addEventListener('keypress', arreter, true); }
      try { return await valider(txt); } finally { if (w) { w.removeEventListener('keydown', arreter, true); w.removeEventListener('keypress', arreter, true); } }
    }
    /** Un changement : l'envoi, l'état d'avant remis si rien n'a été fait, le message, puis la carte relue du serveur. */
    async function changer(url, corps, remettre) {
      if (etat.occupe || !etat.carte) { if (remettre) remettre(); return false; }
      etat.occupe = true;
      const id = etat.carte.id;
      let r; try { r = await agir(url, corps); } finally { etat.occupe = false; }
      // Un refus : « ok: false », ou un code HTTP d'échec (garde, connexion) même sans « ok » — jamais dit « fait ».
      const refuse = Boolean(r && !r.annule && (r.ok === false || Number(r.status) >= 400));
      const fait = Boolean(r && !r.annule && !refuse);
      if (!fait && remettre) remettre();
      etat.msgDroits = !r ? { texte: t('erreur.reseau'), bien: false } : r.annule ? { texte: t('droits.annule'), bien: true }
        : refuse ? { texte: t('droits.refus', { r: String(r.error || r.text || r.code || '') }), bien: false } : { texte: t('droits.fait'), bien: true };
      if (etat.carte && etat.carte.id === id) await choisir(id);
      return fait;
    }
    function blocDroits(c, nom, ids) {
      const dr = c.droits || null, change = etat.proprietaire && !c.synthetique && c.role !== 'owner';
      const st = el('p', { class: 'pf-st pf-dst', role: 'status' });
      if (etat.msgDroits) { st.textContent = etat.msgDroits.texte; st.className = `pf-st pf-dst ${etat.msgDroits.bien ? 'ok' : 'ko'}`; etat.msgDroits = null; }
      const rang = (titre, ...x) => el('div', { class: 'pf-rang' }, el('b', {}, titre), ...x);
      // Un sélecteur ne fait rien partir seul : au clavier, chaque flèche le change (et l'événement « change » part à
      // chaque fois). « Appliquer » envoie le choix, et seulement s'il diffère de l'état lu du serveur.
      const appliquer = (sel, quoi, nomQuoi, avant, corps) => {
        const b = el('button', { type: 'button', class: 'pf-b', 'data-appliquer': quoi, disabled: true, 'aria-label': t('droits.appliquer.aria', { q: nomQuoi }) }, t('droits.appliquer'));
        sel.addEventListener('change', () => { if (sel.value === avant) b.setAttribute('disabled', ''); else b.removeAttribute('disabled'); });
        b.addEventListener('click', () => {
          if (sel.value === avant) return undefined;
          return changer(ACTION_ODIN, corps(), () => { sel.value = avant; b.setAttribute('disabled', ''); });
        });
        return b;
      };
      const tete = (cle) => el('h4', {}, t(cle), ' ', el('small', {}, `(${t(`${cle}.aide`)})`));

      // Registre 1 : la mémoire d'Odin (rôle, autonomie, identités).
      const odin = el('section', { class: 'pf-reg', 'aria-label': t('droits.odin') }, tete('droits.odin'));
      if (change) {
        const role = el('select', { class: 'pf-sel', 'data-droit': 'role', 'aria-label': t('carte.role') }, ...ROLES.map((x) => el('option', { value: x, selected: x === c.role }, t(`role.${x}`))));
        role.value = c.role;
        odin.append(rang(t('carte.role'), el('span', { class: 'pf-choix' }, role, appliquer(role, 'role', t('carte.role'), c.role, () => ({ kind: 'user_save', id: c.id, name: c.nom, role: role.value, autonomy: c.autonomie })))));
        if (c.role === 'member') {
          const auto = el('select', { class: 'pf-sel', 'data-droit': 'autonomie', 'aria-label': t('carte.autonomie') }, ...AUTONOMIES.map((x) => el('option', { value: x, selected: x === c.autonomie }, t(`autonomie.${x}`))));
          auto.value = c.autonomie;
          odin.append(rang(t('carte.autonomie'), el('span', { class: 'pf-choix' }, auto, appliquer(auto, 'autonomie', t('carte.autonomie'), c.autonomie, () => ({ kind: 'user_save', id: c.id, name: c.nom, role: c.role, autonomy: auto.value })))));
        } else if (c.autonomie) odin.append(rang(t('carte.autonomie'), el('span', {}, code('autonomie', c.autonomie))));
      } else {
        odin.append(rang(t('carte.role'), el('span', {}, code('role', c.role))));
        if (c.autonomie) odin.append(rang(t('carte.autonomie'), el('span', {}, code('autonomie', c.autonomie))));
        if (etat.proprietaire && c.role === 'owner') odin.append(el('p', { class: 'pf-aide' }, t('droits.proprio')));
      }
      odin.append(el('h4', {}, t('carte.identites')));
      if (!c.identites.length) odin.append(el('p', { class: 'pf-aide' }, t('carte.identites.aucune')));
      else odin.append(el('ul', { class: 'pf-apps' }, c.identites.map((i, k) => el('li', {}, el('span', {}, ids[k]),
        change ? el('button', { type: 'button', class: 'pf-b', 'aria-label': t('droits.delier.aria', { i: `${i.canal}:${i.pair}` }), onclick: () => changer(ACTION_ODIN, { kind: 'user_unlink', channel: i.canal, peer: i.pair }) }, t('droits.delier')) : null))));
      if (change) {
        const champ = el('input', { type: 'text', 'data-droit': 'lier', autocomplete: 'off', spellcheck: 'false', maxlength: '200', 'aria-label': t('droits.lier.champ'), placeholder: t('droits.lier.exemple') });
        odin.append(el('div', { class: 'pf-lier' }, champ, el('button', { type: 'button', class: 'pf-b', onclick: () => {
          const m = /^([a-z][a-z0-9_-]*):(.+)$/.exec(String(champ.value || '').trim());
          if (!m) { st.textContent = t('droits.lier.format'); st.className = 'pf-st pf-dst ko'; return undefined; }
          return changer(ACTION_ODIN, { kind: 'user_link', id: c.id, channel: m[1], peer: m[2].trim() });
        } }, t('droits.lier'))));
      }

      // Registre 2 : Persona (compte, groupes, applis et d'où vient l'accès, appareils).
      const pers = el('section', { class: 'pf-reg', 'aria-label': t('droits.persona') }, tete('droits.persona'));
      if (!c.persona) pers.append(el('p', { class: 'pf-aide' }, t('carte.acces.sanslien')));
      else if (!dr) pers.append(el('p', { class: 'pf-aide' }, t('carte.acces.inconnu')));
      else {
        const login = dr.login;
        pers.append(rang(t('droits.compte', { e: dr.actif ? t('droits.compte.actif') : t('droits.compte.coupe') }),
          change ? (dr.actif
            ? el('button', { type: 'button', class: 'pf-b', onclick: () => changer(ACTION_PERSONA, { module: 'var', action: 'modifier', input: { login, actif: 'coupé' } }) }, t('droits.compte.couper'))
            : el('button', { type: 'button', class: 'pf-b', onclick: () => changer(ACTION_PERSONA, { module: 'var', action: 'modifier', input: { login, actif: 'actif' } }) }, t('droits.compte.reactiver'))) : null));
        pers.append(el('p', { class: 'pf-aide' }, t('droits.groupes', { g: (dr.groupes || []).length ? dr.groupes.join(', ') : t('droits.groupes.aucun') })));
        const ouvertes = (dr.applis || []).filter((a) => a.personnel || (a.par || []).length), fermees = (dr.applis || []).filter((a) => !a.personnel && !(a.par || []).length);
        pers.append(el('h4', {}, t('droits.applis')));
        if (change) {
          // Une case par appli : cochée = elle peut l'ouvrir. Seul l'accès « à elle seule » se coche ou se décoche ici ;
          // un accès venu d'un groupe toucherait tout le groupe : il se change dans Persona.
          const caseDe = (a) => {
            const coche = Boolean(a.personnel || (a.par || []).length), fixe = !a.personnel && coche;
            const box = el('input', { type: 'checkbox', 'data-appli': a.id, checked: coche, disabled: fixe });
            box.checked = coche;
            box.addEventListener('change', () => changer(ACTION_PERSONA, { module: 'var', action: 'acces_cases', input: { qui: `@${login}`, [a.id]: !coche } }, () => { box.checked = coche; }));
            const fixeDit = (a.par || []).includes('*') ? t('droits.via.fixe.tous') : t('droits.via.fixe');
            return el('li', {}, el('label', { class: 'pf-case' }, box, el('span', {}, a.nom, coche ? el('small', {}, viaDe(a), fixe ? ` — ${fixeDit}` : '') : null)));
          };
          pers.append(ouvertes.length ? el('ul', { class: 'pf-cases' }, ouvertes.map(caseDe)) : el('p', { class: 'pf-aide' }, t('droits.applis.aucune')));
          if (fermees.length) pers.append(el('details', { class: 'pf-plus' }, el('summary', {}, t('droits.applis.autres', { n: fermees.length })), el('ul', { class: 'pf-cases' }, fermees.map(caseDe))));
        } else {
          pers.append(ouvertes.length ? el('ul', { class: 'pf-apps' }, ouvertes.map((a) => el('li', {}, el('span', {}, a.nom, el('small', {}, viaDe(a)))))) : el('p', { class: 'pf-aide' }, t('droits.applis.aucune')));
        }
        pers.append(el('h4', {}, t('droits.appareils')));
        const aps = dr.appareils || [];
        pers.append(aps.length ? el('ul', { class: 'pf-apps pf-apx' }, aps.map((x) => {
          const quoi = `${x.nom} (${x.plateforme})`;
          return el('li', {}, el('span', {}, quoi, el('small', {}, `${x.sorte === 'poste' ? t('droits.appareil.poste') : x.appli || ''} · ${t('droits.appareil.vu', { d: quand(x.vu) })}`)),
            change && x.id ? el('button', { type: 'button', class: 'pf-b', 'aria-label': t('droits.appareil.couper.aria', { a: quoi }), onclick: () => changer(ACTION_PERSONA, { module: 'var', action: 'couper_appareil', input: { id: x.id } }) }, t('droits.appareil.couper')) : null);
        })) : el('p', { class: 'pf-aide' }, t('droits.appareils.aucun')));
      }

      const bloc = el('div', { class: 'pf-droits' }, el('h3', {}, t('droits.titre')), el('p', { class: 'pf-aide' }, change ? t('droits.aide') : t('droits.lecture')), odin, pers);
      // « Couper tout » : un geste lourd (pas un droit donné) — une confirmation simple, qui dit ce qui sera coupé.
      if (change && dr) bloc.append(el('div', { class: 'pf-actes pf-tout' }, el('button', { type: 'button', class: 'pf-b danger', onclick: () => couperTout(dr) }, t('droits.tout'))));
      bloc.append(st);
      return bloc;

      async function couperTout(d0) {
        const perso = (d0.applis || []).filter((a) => a.personnel);
        if (!perso.length && !d0.actif) { st.textContent = t('droits.tout.rien'); st.className = 'pf-st pf-dst ok'; return; }
        if (!(await confirmerCoupure(texteCouperTout(nom, d0)))) { st.textContent = t('droits.annule'); st.className = 'pf-st pf-dst ok'; return; }
        if (perso.length) {
          const input = { qui: `@${d0.login}` }; for (const a of perso) input[a.id] = false;
          if (!(await changer(ACTION_PERSONA, { module: 'var', action: 'acces_cases', input }))) return; // refusé : la raison est dite, rien d'autre ne part
        }
        if (d0.actif) await changer(ACTION_PERSONA, { module: 'var', action: 'modifier', input: { login: d0.login, actif: 'coupé' } });
      }
    }

    async function charger() {
      if (etat.charge || !etat.carte) return;
      etat.charge = true; if (plus) plus.disabled = true;
      const id = etat.carte.id, q = etat.suite ? `?n=30&avant=${encodeURIComponent(etat.suite)}` : '?n=30';
      const rep = await api(`/${encodeURIComponent(id)}/historique${q}`);
      etat.charge = false; if (plus) plus.disabled = false;
      if (etat.carte.id !== id) return; // une autre personne a été choisie entre-temps
      if (!rep || rep.ok !== true) { if (!etat.lignes.length) temps.replaceChildren(el('li', { class: 'pf-vide' }, rep && rep.code ? erreurDe(rep) : t('histo.erreur'))); return; }
      const lot = Array.isArray(rep.lignes) ? rep.lignes : [];
      etat.lignes = etat.lignes.concat(lot); etat.suite = rep.suite; etat.total = Number(rep.total) || etat.lignes.length;
      compte.textContent = t('histo.total', { n: etat.total });
      if (!etat.lignes.length) temps.replaceChildren(el('li', { class: 'pf-vide' }, t('histo.vide')));
      else { if (etat.lignes.length === lot.length) temps.replaceChildren(); temps.append(...lot.map(ligne)); }
      plus.hidden = !etat.suite;
    }

    function formEffacer(c, nom) {
      const tout = el('input', { type: 'radio', name: 'pf-eff', value: 'tout', checked: true }), per = el('input', { type: 'radio', name: 'pf-eff', value: 'periode' });
      const du = el('input', { type: 'date', 'aria-label': t('eff.du') }), au = el('input', { type: 'date', 'aria-label': t('eff.au') });
      const st = el('p', { class: 'pf-st', role: 'status' });
      const dire = (x, bien) => { st.textContent = x; st.className = `pf-st ${bien ? 'ok' : 'ko'}`; };
      async function lancer() {
        let corps = {};
        if (per.checked) { const p = periodeDe(du.value, au.value); if (!p) return dire(t('eff.dates'), false); corps = p; }
        let ap = await api(`/${encodeURIComponent(c.id)}/effacer/apercu`, { method: 'POST', body: corps });
        for (let essai = 0; essai < 2; essai++) {
          if (!ap || !ap.ok && ap.code !== 'change') return dire(erreurDe(ap), false);
          if (!ap.bilan || !ap.bilan.retire || !ap.bilan.retire.historique) return dire(t('eff.rien'), true);
          if (!(await confirmer(texteConfirmation(nom, ap.cible, ap.bilan)))) return undefined;
          const fin = await api(`/${encodeURIComponent(c.id)}/effacer`, { method: 'POST', body: { ...(ap.cible.depuis !== undefined ? { depuis: ap.cible.depuis } : {}), jusqua: ap.cible.jusqua, jeton: ap.jeton } });
          if (fin && fin.ok) { dire(t('eff.fait', { n: fin.bilan.retire.historique }), true); etat.lignes = []; etat.suite = undefined; chargerMesures(); return charger(); }
          if (!fin || fin.code !== 'change') return dire(erreurDe(fin), false);
          dire(t('eff.change'), false); ap = fin; // l'historique a changé : nouvel aperçu, nouvelle confirmation
        }
        return undefined;
      }
      return el('details', { class: 'pf-eff' }, el('summary', {}, t('eff.ouvrir')),
        el('label', {}, tout, t('eff.tout')), el('label', {}, per, t('eff.periode')),
        el('div', { class: 'pf-dates' }, el('label', {}, t('eff.du'), du), el('label', {}, t('eff.au'), au)),
        el('div', { class: 'pf-actes' }, el('button', { type: 'button', class: 'pf-b danger', onclick: lancer }, t('eff.voir'))), st);
    }

    return { etat, choisir, charger };
  }

  // La vue « Profil » s'ouvre : la fenêtre se dessine (à chaque ouverture, pour être à jour).
  function brancher() {
    document.addEventListener('odin:vue', (e) => { if (e && e.detail && e.detail.vue === 'profil') rendre(document.getElementById('profilBox')); });
  }
  if (typeof document !== 'undefined' && document.addEventListener) brancher();

  window.OdinProfil = { rendre, logique: { T, t, quand, jour, nomDe, canaux, erreurDe, periodeDe, texteConfirmation, clesAttendues, texteDroit, valeurDroit, viaDe, texteCouperTout, ROLES, AUTONOMIES, PREUVES, SORTES, RESULTATS, RAISONS } };
})();
