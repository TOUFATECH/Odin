// Odin OS — mode essai. Quand aucun Odin ne répond (page ouverte seule, téléphone pas encore relié),
// le bureau fonctionne avec des données d'exemple, toujours signalées « Essai ». Rien n'est lu ni modifié
// sur la machine : les fichiers ci-dessous n'existent que dans la mémoire de la page.
(() => {
  'use strict';
  const OS = window.OS;
  const CLE = 'odin-os-etat';
  const MAISON = '/home/odin';
  const maintenant = Date.now();

  // ——— Fichiers d'exemple (en mémoire) ———
  const fs = new Map();
  const dossier = (c) => fs.set(c, { dossier: true, modifie: maintenant - 864e5 });
  const fichier = (c, texte, age = 36e5) => fs.set(c, { dossier: false, texte, modifie: maintenant - age });
  ['', '/Bureau', '/Documents', '/Images', '/Musique', '/Téléchargements', '/Vidéos', '/.local', '/.local/share', '/.local/share/Trash', '/.local/share/Trash/files'].forEach((d) => dossier(MAISON + d));
  fichier(`${MAISON}/Documents/Bienvenue.txt`, 'Bienvenue dans Odin OS !\n\nTu es en mode essai : ces fichiers sont des exemples, ils disparaissent quand tu fermes la page.\nInstalle Odin OS (Docker, LXC ou image PC) pour travailler sur tes vrais fichiers.\n');
  fichier(`${MAISON}/Documents/Idées.txt`, '- Essayer les cinq thèmes dans Réglages → Apparence\n- Installer Ullr depuis Odin Store\n- Taper « aide » dans le Terminal\n', 72e5);
  fichier(`${MAISON}/Téléchargements/lisez-moi.txt`, 'Les fichiers que tu télécharges arrivent ici. Ullr les analyse à l\'arrivée quand Odin OS est installé.\n', 2 * 864e5);
  const norm = (c) => { const p = []; for (const s of String(c || MAISON).replace(/^~/, MAISON).split('/')) { if (!s || s === '.') continue; if (s === '..') p.pop(); else p.push(s); } return `/${p.join('/')}`; };
  const dedans = (c) => c === MAISON || c.startsWith(`${MAISON}/`);
  const parent = (c) => c.slice(0, c.lastIndexOf('/')) || '/';
  const nomDe = (c) => c.slice(c.lastIndexOf('/') + 1);
  const nomValide = (n) => typeof n === 'string' && n.length > 0 && n.length <= 200 && !/[/\\\u0000]/.test(n) && n !== '.' && n !== '..';
  const enfants = (c) => [...fs.keys()].filter((k) => k !== c && parent(k) === c);
  const erreur = (error) => ({ ok: false, error });

  const E = OS.essai = {};
  E.MAISON = MAISON;

  // ——— État (gardé dans le navigateur) ———
  E.etat = async () => { try { return { ok: true, etat: JSON.parse(localStorage.getItem(CLE) || '{}') }; } catch { return { ok: true, etat: {} }; } };
  E.sauver = async (patch) => { try { const e = JSON.parse(localStorage.getItem(CLE) || '{}'); localStorage.setItem(CLE, JSON.stringify({ ...e, ...patch })); } catch { /* stockage indisponible : l'état reste en mémoire */ } return { ok: true }; };

  E.systeme = async () => ({ ok: true, essai: true, os: { version: OS.version, base: 'Ubuntu 26.04 LTS' }, odin: { version: '' }, cible: 'essai',
    machine: { nom: 'essai', processeur: 'Exemple', coeurs: 4, memoire: { total: 8 * 2 ** 30, libre: 5.1 * 2 ** 30 }, disque: { total: 64 * 2 ** 30, libre: 51 * 2 ** 30 }, noyau: '', depuis: 0 },
    capacites: { terminal: false, apt: false, applisLinux: false, windows: false, android: false, mac: false }, compte: null, demo: true });

  // ——— Fichiers ———
  E.fichiers = async (chemin) => {
    const c = norm(chemin); if (!dedans(c)) return erreur('Ce dossier est hors de ton espace.');
    const d = fs.get(c); if (!d || !d.dossier) return erreur('Dossier introuvable.');
    const entrees = enfants(c).filter((k) => !nomDe(k).startsWith('.')).map((k) => { const f = fs.get(k); return { nom: nomDe(k), dossier: f.dossier, taille: f.dossier ? null : new Blob([f.texte]).size, modifie: f.modifie }; });
    return { ok: true, essai: true, chemin: c, maison: MAISON, parent: c === MAISON ? null : parent(c), entrees };
  };
  E.fichier = async (chemin) => { const c = norm(chemin), f = fs.get(c); if (!dedans(c) || !f || f.dossier) return erreur('Fichier introuvable.'); return { ok: true, essai: true, nom: nomDe(c), chemin: c, taille: new Blob([f.texte]).size, genre: 'texte', texte: f.texte }; };
  E.operation = async (action, d = {}) => {
    const c = norm(d.chemin);
    if (!dedans(c)) return erreur('Ce dossier est hors de ton espace.');
    if (action === 'dossier' || action === 'nouveau') {
      if (!nomValide(d.nom)) return erreur('Ce nom ne convient pas.');
      const cible = `${c}/${d.nom}`; if (fs.has(cible)) return erreur('Ce nom existe déjà ici.');
      if (action === 'dossier') dossier(cible); else fichier(cible, '', 0);
      fs.get(cible).modifie = Date.now(); return { ok: true, chemin: cible };
    }
    if (!fs.has(c) || c === MAISON) return erreur('Élément introuvable.');
    if (action === 'renommer') {
      if (!nomValide(d.nom)) return erreur('Ce nom ne convient pas.');
      const cible = `${parent(c)}/${d.nom}`; if (fs.has(cible)) return erreur('Ce nom existe déjà ici.');
      for (const k of [...fs.keys()]) if (k === c || k.startsWith(`${c}/`)) { fs.set(cible + k.slice(c.length), fs.get(k)); fs.delete(k); }
      return { ok: true, chemin: cible };
    }
    if (action === 'corbeille') { for (const k of [...fs.keys()]) if (k === c || k.startsWith(`${c}/`)) fs.delete(k); return { ok: true, text: 'Mis à la corbeille (essai : l\'exemple est simplement retiré).' }; }
    if (action === 'ecrire') { const f = fs.get(c); if (f.dossier) return erreur('C\'est un dossier.'); f.texte = String(d.texte ?? '').slice(0, 2e6); f.modifie = Date.now(); return { ok: true }; }
    return erreur('Action indisponible en mode essai.');
  };

  // ——— Terminal (quelques commandes simulées sur les fichiers d'exemple) ———
  E.terminal = async (commande, dossierCourant) => {
    const ici = norm(dossierCourant), [cmd, ...args] = commande.trim().split(/\s+/), cible = (a) => norm(!a ? ici : a.startsWith('/') || a.startsWith('~') ? a : `${ici}/${a}`);
    const sortie = (s, dossier2) => ({ ok: true, essai: true, sortie: s, dossier: dossier2 || ici, code: 0 });
    switch (cmd) {
      case 'pwd': return sortie(ici);
      case 'whoami': return sortie('odin');
      case 'date': return sortie(new Date().toLocaleString('fr-FR'));
      case 'uname': return sortie('Odin OS (mode essai)');
      case 'echo': return sortie(args.join(' '));
      case 'ls': { const r = await E.fichiers(cible(args.find((a) => !a.startsWith('-')))); return r.ok ? sortie(r.entrees.map((e) => (e.dossier ? `${e.nom}/` : e.nom)).join('  ')) : { ...sortie(`ls : ${r.error}`), code: 1 }; }
      case 'cd': { const c = cible(args[0] || '~'); const d = fs.get(c); return d && d.dossier && dedans(c) ? sortie('', c) : { ...sortie(`cd : dossier introuvable : ${args[0]}`), code: 1 }; }
      case 'cat': { const r = await E.fichier(cible(args[0])); return r.ok ? sortie(r.texte) : { ...sortie(`cat : ${r.error}`), code: 1 }; }
      case 'mkdir': { const c = cible(args[0]); const r = await E.operation('dossier', { chemin: parent(c), nom: nomDe(c) }); return r.ok ? sortie('') : { ...sortie(`mkdir : ${r.error}`), code: 1 }; }
      case 'touch': { const c = cible(args[0]); const r = await E.operation('nouveau', { chemin: parent(c), nom: nomDe(c) }); return r.ok ? sortie('') : { ...sortie(`touch : ${r.error}`), code: 1 }; }
      default: return { ok: false, error: `« ${cmd} » : pas de vrai système en mode essai. Les commandes système marchent quand Odin OS est installé (Docker, LXC ou image PC). Tape « aide » pour les commandes disponibles.` };
    }
  };
  E.paquets = async (action) => (action === 'applis' ? { ok: true, essai: true, applis: [] } : { ok: false, error: 'Les applis Linux s\'installent quand Odin OS est installé (Docker, LXC ou image PC). En mode essai, il n\'y a pas de vrai système derrière.' });

  // ——— Applis d'Odin : la vraie liste (écrite depuis le registre), des pages d'exemple ———
  E.catalogue = async () => ({ ok: true, essai: true, modules: window.OS_CATALOGUE || [] });
  E.vue = async (id) => {
    const m = (window.OS_CATALOGUE || []).find((x) => x.id === id); if (!m) return erreur('appli inconnue');
    const base = { ok: true, essai: true, id: m.id, name: m.name, family: m.family, what: m.what, actions: m.actions.map((a) => ({ ...a, params: [], quick: true })), alerts: [] };
    if (id === 'ullr') return { ...base, view: { subtitle: 'Exemple : sur un Odin installé, tu vois ici tes vraies analyses.', kpis: [{ label: 'Incidents ouverts', value: '0', tone: 'bon' }, { label: 'Détections', value: '0', hint: 'à vérifier', tone: 'bon' }, { label: 'Quarantaine', value: '1' }, { label: 'Dossiers surveillés', value: '2' }],
      sections: [{ kind: 'table', title: 'Quarantaine', columns: ['Menace', 'Fichier d\'origine', 'Depuis'], empty: 'Vide.', rows: [{ cells: ['Exemple.Hameconnage', 'Téléchargements/facture-exemple.pdf.exe', 'exemple'], actions: [] }] }, { kind: 'table', title: 'Incidents (signaux reliés entre les applis)', columns: ['Quand', 'Incident', 'Risque', 'Vu par', 'État'], empty: '✓ Aucun incident.', rows: [] }] } };
    return { ...base, view: { subtitle: 'Mode essai : cette appli montre ses vraies données sur un Odin installé.', kpis: [], sections: [{ kind: 'list', title: `Ce que fait ${m.name}`, items: m.does.map((d) => ({ title: d })) }] } };
  };
  E.agir = async (module, action) => { const m = (window.OS_CATALOGUE || []).find((x) => x.id === module), a = m && m.actions.find((x) => x.id === action); return { ok: true, essai: true, text: `Essai : « ${a ? a.label : action} » ne s'exécute que sur un Odin installé. Rien n'a été fait.` }; };
  E.ordre = async (texte) => ({ ok: true, essai: true, text: `Essai : je ne peux pas exécuter « ${texte} » sans Odin. Installe Odin OS (Docker, LXC ou image PC) pour que je le fasse vraiment.` });

  /** Réponses de la bulle d'Odin sans IA : des règles simples, qui agissent sur le bureau quand c'est possible. */
  E.repondre = (texte) => {
    const t = OS.sansAccent(texte);
    const theme = Object.keys(OS.themes).find((k) => t.includes(OS.sansAccent(OS.themes[k].nom)));
    if (/theme|style|apparence/.test(t) && theme) { OS.regler({ theme, fond: '' }); return `C'est fait : thème ${OS.themes[theme].nom}.`; }
    if (/sombre/.test(t) && /mode|theme|passe|mets/.test(t)) { OS.regler({ apparence: 'sombre' }); return 'Mode sombre activé.'; }
    if (/clair/.test(t) && /mode|theme|passe|mets/.test(t)) { OS.regler({ apparence: 'clair' }); return 'Mode clair activé.'; }
    const appli = Object.values(OS.applis).find((a) => t.includes(OS.sansAccent(a.nom)));
    if (/install/.test(t)) { const m = OS.catalogue.find((x) => t.includes(OS.sansAccent(x.nom))); if (m) return OS.installerAppli(m.id, { silence: true }) ? `${m.nom} est installé : tu le trouves dans le lanceur.` : `${m.nom} est déjà installé.`; return 'Dis-moi quelle appli : ouvre Odin Store pour voir les 28 applis d\'Odin. Les applis Windows, Android et Mac ne sont pas encore dans cette version.'; }
    if (/ouvre|lance|montre/.test(t) && appli) { OS.ouvrir(appli.id); return `J'ouvre ${appli.nom}.`; }
    if (/essai|demo|vrai/.test(t)) return 'Tu es en mode essai : aucun Odin ne répond derrière cette page, donc les fichiers et les chiffres sont des exemples. Installe Odin OS avec « odin os installer » pour le vrai système.';
    if (/virus|protege|securite|ullr/.test(t)) return 'Ullr est l\'antivirus d\'Odin et Skögul surveille les programmes. Ouvre Ullr depuis le dock : en mode essai tu vois un exemple, sur un Odin installé il analyse vraiment.';
    if (/bonjour|salut|coucou|bonsoir/.test(t)) return 'Salut ! Je peux changer le thème, ouvrir une appli ou installer une appli d\'Odin. Essaie « mets le thème Verre ».';
    return 'En mode essai, je réponds sans IA : je sais changer le thème (« mets le thème Néon »), ouvrir une appli (« ouvre le Terminal ») et installer une appli d\'Odin (« installe Ullr »). Sur un Odin installé, tu me parles normalement.';
  };
})();
