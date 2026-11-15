// Genèse dans l'interface · le suivi des installations par le réseau (PXE). Trois onglets de la page de Genèse :
// - Installations : chaque poste reconnu (nom, adresse MAC, adresse IP, marque, modèle, numéro de série), son étape,
//   son avancement et son état, en direct ; boutons Annuler (ton accord d'abord), Bloquer, Débloquer ; suspendre tout.
// - Historique : toutes les installations gardées dans la base de Genèse, filtrables (poste, résultat, période), le
//   rapport (réussies, échecs, abandons, durée moyenne, par image), l'export pour tableur, ce qu'Odin a signalé.
// - Protection : le mot de passe d'installation (saisie masquée), le délai d'abandon, les postes bloqués.
// Chargé avant thjalfi.js (ordre alphabétique) ; la page de Genèse appelle OdinGeneseSuivi.dessiner(racine, onglet, outils).
(() => {
  'use strict';
  // Ce qui doit survivre à la relecture (la page se redessine toutes les 5 s sur l'onglet « Installations »).
  const E = { ouvert: '', fiche: null, ligne: '', filtres: { periode: '30 jours', resultat: 'tous', q: '' } };
  const CSS = `
.tj-ban{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-radius:16px;border:2px solid color-mix(in srgb,var(--twarn) 55%,transparent);background:color-mix(in srgb,var(--twarn) 10%,var(--panel));font-size:14px}.tj-ban>span{flex:1;min-width:200px}
.tj-p{border:1px solid var(--line);border-radius:16px;padding:12px 14px;margin-top:10px;min-width:0}
.tj-p-h{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}.tj-p-t{flex:1;min-width:180px}.tj-p-t b{display:block;font-size:15px;overflow-wrap:anywhere}.tj-p-t span{display:block;font-size:12.5px;color:var(--muted);overflow-wrap:anywhere}
.tj-p-n{text-align:right;flex:none}.tj-p-n b{font-size:20px;display:block}.tj-p-n span{font-size:12px;color:var(--muted)}
.tj-e{display:inline-flex;align-items:center;gap:5px;font-style:normal;flex:none;font-size:11.5px;font-weight:800;letter-spacing:.03em;padding:3px 9px;border-radius:999px;color:#fff;white-space:nowrap;vertical-align:middle}
.tj-e.bleu{background:var(--tblue)}.tj-e.vert{background:var(--tok)}.tj-e.rouge{background:var(--tbad)}.tj-e.jaune{background:var(--twarn)}.tj-e.gris{background:color-mix(in srgb,var(--ink) 50%,transparent)}
.tj-bar{height:8px;border-radius:4px;background:color-mix(in srgb,var(--ink) 12%,transparent);overflow:hidden;margin-top:10px}.tj-bar i{display:block;height:100%;border-radius:4px;background:var(--tblue);transition:width .4s}
.tj-bar.vert i{background:var(--tok)}.tj-bar.rouge i{background:var(--tbad)}.tj-bar.jaune i{background:var(--twarn)}.tj-bar.gris i{background:color-mix(in srgb,var(--ink) 40%,transparent)}
.tj-p-l{font-size:12.5px;color:var(--muted);margin-top:6px;overflow-wrap:anywhere}.tj-p-b{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.tj-pill.dan{background:color-mix(in srgb,var(--tbad) 14%,transparent);color:var(--tbad)}.tj-pill.pt{min-height:34px;padding:0 12px;font-size:12.5px}
.tj-tl{list-style:none;margin:10px 0 0 4px;padding:0;border-left:2px solid var(--line)}.tj-tl li{position:relative;padding:3px 0 3px 14px;font-size:13px;display:flex;gap:8px;flex-wrap:wrap}
.tj-tl li::before{content:'';position:absolute;left:-5px;top:9px;width:8px;height:8px;border-radius:50%;background:var(--tblue)}.tj-tl li.vert::before{background:var(--tok)}.tj-tl li.rouge::before{background:var(--tbad)}.tj-tl li.jaune::before{background:var(--twarn)}
.tj-tl time{color:var(--muted);font-variant-numeric:tabular-nums;font-size:12px;min-width:60px}.tj-tl span{color:var(--muted);overflow-wrap:anywhere}
.tj-id{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-top:10px}.tj-id div{font-size:13px;overflow-wrap:anywhere}.tj-id small{display:block;color:var(--muted);font-size:11.5px}
.tj-f{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}.tj-f label{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--muted);flex:1;min-width:150px}
.tj-in{min-height:38px;border-radius:10px;border:1px solid var(--line);background:var(--field);color:var(--ink);padding:0 10px;font:inherit;min-width:0;width:100%;box-sizing:border-box}
.tj-h{display:grid;grid-template-columns:104px minmax(0,1.3fr) minmax(0,1.2fr) 84px auto;gap:10px;align-items:center;padding:10px 4px;border:0;border-top:1px solid var(--line);background:none;width:100%;text-align:left;color:var(--ink);font:inherit;font-size:13px;cursor:pointer}
.tj-h small{display:block;color:var(--muted);font-size:12px;overflow-wrap:anywhere}.tj-h>span{min-width:0;overflow-wrap:anywhere}.tj-h:focus-visible{outline:2px solid var(--ta);outline-offset:-2px;border-radius:8px}
.tj-h .cm{display:none;font-style:normal}@media (max-width:720px){.tj-h{grid-template-columns:minmax(0,1fr) auto}.tj-h .c1,.tj-h .c3,.tj-h .c4{display:none}.tj-h .cm{display:inline}}
.tj-hd{padding:2px 4px 12px}.tj-c{display:flex;gap:8px;flex-wrap:wrap}.tj-c div{border:1px solid var(--line);border-radius:12px;padding:8px 12px;font-size:12.5px;color:var(--muted);min-width:84px}.tj-c b{display:block;font-size:18px;color:var(--ink)}
.tj-li{display:flex;gap:10px;align-items:baseline;padding:7px 0;border-top:1px solid var(--line);font-size:13px;flex-wrap:wrap}.tj-li time{color:var(--muted);font-size:12px;min-width:92px;font-variant-numeric:tabular-nums}.tj-li span{color:var(--muted);flex:1;min-width:160px;overflow-wrap:anywhere}
`;
  const deux = (n) => String(n).padStart(2, '0');
  const heure = (t) => { const d = new Date(t); return `${deux(d.getHours())}:${deux(d.getMinutes())}:${deux(d.getSeconds())}`; };
  const jour = (t) => { const d = new Date(t); return `${deux(d.getDate())}/${deux(d.getMonth() + 1)} ${deux(d.getHours())}:${deux(d.getMinutes())}`; };
  const duree = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? 'moins d\'1 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${deux(m % 60)}`; };
  const poids = (o) => (o >= 1024 ** 3 ? `${(o / 1024 ** 3).toFixed(1).replace('.', ',')} Go` : o >= 1024 ** 2 ? `${Math.round(o / 1024 ** 2)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);
  const COULEUR = { 'en cours': 'bleu', 'au menu': 'gris', 'terminée': 'vert', 'échouée': 'rouge', 'abandonnée': 'jaune', 'annulée': 'gris', 'bloquée': 'rouge', 'lancée à la main': 'bleu', 'repartie sur son disque': 'gris' };
  const RESULTAT = { fini: 'terminée', 'échec': 'échouée', 'sans nouvelles': 'abandonnée', 'annulée': 'annulée', 'bloquée': 'bloquée', 'lancée': 'lancée à la main' };
  const MODE = { auto: 'installation automatique', manuelle: 'installation à la main', essai: 'essai du système', outil: 'outil' };
  const nomDe = (p) => p.nom || 'Poste inconnu';
  const couleurEtape = (e) => (e === 'fini' ? 'vert' : e === 'échec' ? 'rouge' : e === 'sans nouvelles' ? 'jaune' : '');

  function outils(o) {
    const { el, act, note, redraw } = o;
    const faire = async (btn, action, input) => { if (btn) btn.disabled = true; const x = await act(action, input); if (btn) btn.disabled = false; note(x); if (x.text !== 'Annulé.') await redraw(); return x; };
    const etat = (txt) => el('em', { class: `tj-e ${COULEUR[txt] ?? 'gris'}` }, txt);
    const etapes = (l) => el('ol', { class: 'tj-tl', 'aria-label': 'Déroulement' }, ...(l ?? []).map((e) => el('li', { class: couleurEtape(e.etape) }, el('time', {}, heure(e.at)), el('b', {}, e.etape), e.detail ? el('span', {}, e.detail) : null)));
    const identite = (p) => el('div', { class: 'tj-id' }, ...[['Adresse MAC', p.mac], ['Adresse IP', p.ip], ['Marque', p.marque], ['Modèle', p.modele], ['Numéro de série', p.serie], ['Démarrage', p.fw], ['Lancée par', p.lancePar], ['Installateur', p.installateur], ['Arrêtée par', p.arretePar]].filter(([, v]) => v).map(([k, v]) => el('div', {}, el('small', {}, k), v)));
    const bloquer = async (btn, p) => { const raison = await window.OdinDialog.prompt(`Bloquer ${nomDe(p)} (${p.mac}) : il ne recevra plus ni menu ni fichiers d'installation. Raison (facultatif) :`, '', { ok: 'Bloquer' }); if (raison === null) return; await faire(btn, 'bloquer', { mac: p.mac, raison }); };
    return { faire, etat, etapes, identite, bloquer };
  }

  // ---------------- Installations ----------------
  /** La fiche ouverte d'un poste : ses installations passées et ce qui s'est passé pour lui (lu une fois par relecture). */
  function fichePoste(o, p, F) {
    const { el } = o, U = outils(o), box = el('div', {});
    box.append(U.identite(p), p.etapes?.length ? U.etapes(p.etapes) : el('p', { class: 'tj-empty' }, 'Aucune étape notée.'));
    if (p.logiciels?.length) box.append(el('p', { class: 'tj-p-l' }, `Logiciels : ${p.logiciels.map((l) => `${l.nom} ${l.ok ? '✓' : 'raté'}`).join(' · ')}`));
    const passees = (F?.passees ?? []).filter((h) => h.id !== p.id);
    if (passees.length) box.append(el('p', { class: 'tj-p-l', style: 'margin-top:12px;font-weight:700;color:var(--ink)' }, `Ses installations passées (${passees.length})`), ...passees.slice(0, 8).map((h) => el('div', { class: 'tj-li' }, el('time', {}, jour(h.at)), el('b', {}, h.isoName), U.etat(RESULTAT[h.result] ?? h.result), el('span', {}, `${duree(h.ms)}${h.raison ? ` · ${h.raison}` : ''}`))));
    return box;
  }
  function cartePoste(o, p) {
    const { el, ic, redraw } = o, U = outils(o), ouvert = E.ouvert === p.mac, c = COULEUR[p.etat] ?? 'gris';
    const qui = [p.mac, p.ip, [p.marque, p.modele].filter(Boolean).join(' '), p.serie ? `série ${p.serie}` : ''].filter(Boolean).join(' · ');
    const quoi = [p.image || 'aucun système choisi', MODE[p.mode] ?? '', p.installateur ? `par ${p.installateur}` : ''].filter(Boolean).join(' · ');
    const env = p.envoye, ligne = p.raison && !p.enCours ? p.raison : p.reel && env ? `Image envoyée : ${poids(env.octets)} sur ${poids(env.taille)} (${env.pct} %)` : p.detail || p.etape;
    const box = el('div', { class: 'tj-p', role: 'group', 'aria-label': `${nomDe(p)}, ${p.etat}` },
      el('div', { class: 'tj-p-h' },
        el('div', { class: 'tj-p-t' }, el('b', {}, nomDe(p), ' ', U.etat(p.etat), p.bloque && p.etat !== 'bloquée' ? el('em', { class: 'tj-e rouge', style: 'margin-left:4px' }, 'bloqué') : null), el('span', {}, qui), el('span', {}, quoi)),
        el('div', { class: 'tj-p-n' }, el('b', {}, p.lancee || !p.enCours ? `${p.pct} %` : '—'), el('span', {}, p.enCours ? `depuis ${duree(Date.now() - p.debut)}` : `le ${jour(p.maj)}`))),
      p.lancee || !p.enCours ? el('div', { class: `tj-bar ${c === 'bleu' ? '' : c}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(p.pct), 'aria-label': `Avancement de ${nomDe(p)}` }, el('i', { style: `width:${p.pct}%` })) : null,
      el('div', { class: 'tj-p-l' }, `${p.enCours ? `Étape : ${p.etape}` : `Dernière étape : ${p.etapes?.filter((e) => !['fini', 'échec', 'sans nouvelles'].includes(e.etape)).at(-1)?.etape ?? p.etape}`} · ${ligne}`),
      el('div', { class: 'tj-p-b' },
        el('button', { class: 'tj-pill n pt', type: 'button', 'aria-expanded': String(ouvert), onclick: () => { E.ouvert = ouvert ? '' : p.mac; E.fiche = null; redraw(); } }, ic('list', 14), ouvert ? 'Fermer' : 'Déroulement'),
        p.annulable ? el('button', { class: 'tj-pill dan pt', type: 'button', onclick: (e) => U.faire(e.currentTarget, 'annuler', { mac: p.mac }) }, ic('x', 14), 'Annuler l\'installation') : null,
        p.bloque ? el('button', { class: 'tj-pill n pt', type: 'button', onclick: (e) => U.faire(e.currentTarget, 'debloquer', { mac: p.mac }) }, ic('check', 14), 'Débloquer') : el('button', { class: 'tj-pill n pt', type: 'button', onclick: (e) => U.bloquer(e.currentTarget, p) }, ic('shield', 14), 'Bloquer ce poste')));
    if (ouvert) box.append(fichePoste(o, p, E.fiche?.mac === p.mac ? E.fiche : null));
    return box;
  }
  async function installations(root, o) {
    const { el, ic, post } = o, U = outils(o), D = (await post('suivi')).data ?? {}, c = D.chiffres ?? {}, postes = D.postes ?? [];
    if (E.ouvert && postes.some((p) => p.mac === E.ouvert)) { const f = (await post('poste', { mac: E.ouvert })).data; if (f) E.fiche = f; }
    if (D.suspendu) root.append(el('div', { class: 'tj-ban', role: 'status' }, ic('alert', 18), el('span', {}, el('b', {}, 'Nouvelles installations suspendues'), ` depuis le ${jour(D.suspendu.at)}. Chaque poste voit le message et démarre sur son disque ; celles déjà lancées finissent.`), el('button', { class: 'tj-pill pri', type: 'button', onclick: (e) => U.faire(e.currentTarget, 'reprendre', {}) }, ic('play', 14), 'Reprendre')));
    root.append(el('div', { class: 'tj-k' },
      el('div', { style: 'background:color-mix(in srgb,var(--tblue) 14%,transparent)' }, el('b', {}, String(c.enCours ?? 0)), el('span', {}, `installation${(c.enCours ?? 0) > 1 ? 's' : ''}`, el('br'), 'en cours')),
      el('div', { style: 'background:color-mix(in srgb,var(--tok) 14%,transparent)' }, el('b', {}, String(c.reussies ?? 0)), el('span', {}, `terminée${(c.reussies ?? 0) > 1 ? 's' : ''}`, el('br'), 'depuis 24 h')),
      el('div', { style: 'background:color-mix(in srgb,var(--twarn) 14%,transparent)' }, el('b', {}, String(c.rates ?? 0)), el('span', {}, 'échouée(s) ou', el('br'), 'abandonnée(s), 24 h')),
      el('div', { style: 'background:color-mix(in srgb,var(--tbad) 14%,transparent)' }, el('b', {}, String(c.bloques ?? 0)), el('span', {}, `poste${(c.bloques ?? 0) > 1 ? 's' : ''}`, el('br'), `bloqué${(c.bloques ?? 0) > 1 ? 's' : ''}`))));
    const lances = postes.filter((p) => p.lancee), menu = postes.filter((p) => p.enCours && !p.lancee), finis = postes.filter((p) => !p.enCours);
    root.append(el('div', { class: 'tj-w' }, el('h3', {}, 'Installations en cours', el('small', {}, `${lances.length} poste${lances.length > 1 ? 's' : ''}`), lances.length ? el('span', { class: 'r tj-live' }, 'en direct') : null),
      ...lances.map((p) => cartePoste(o, p)), lances.length ? null : el('p', { class: 'tj-empty' }, 'Aucune installation en cours.'),
      el('div', { class: 'tj-btns', style: 'margin-top:12px' }, D.suspendu ? null : el('button', { class: 'tj-pill n', type: 'button', onclick: (e) => U.faire(e.currentTarget, 'suspendre', {}) }, 'Suspendre les nouvelles installations'),
        el('span', { class: 'x' }, ic('clock', 13), `sans signe de vie depuis ${D.abandon ?? 30} min : installation dite abandonnée`))));
    const grille = el('div', { class: 'tj-grid' }); root.append(grille);
    grille.append(el('div', { class: 'tj-w' }, el('h3', {}, 'Postes au menu', el('small', {}, `${menu.length}`)), ...menu.map((p) => cartePoste(o, p)), menu.length ? null : el('p', { class: 'tj-empty' }, 'Aucun poste n\'attend au menu de démarrage.'),
      el('p', { class: 'tj-note' }, D.protection?.actif ? `Mot de passe d'installation demandé ${D.protection.pour === 'inconnus' ? 'aux postes non autorisés' : 'à tous les postes'}.` : 'Pas de mot de passe d\'installation : tout poste du réseau local a le menu (onglet Protection).')));
    grille.append(el('div', { class: 'tj-w' }, el('h3', {}, 'Passées récemment', el('small', {}, `${finis.length}`)), ...finis.slice(0, 12).map((p) => cartePoste(o, p)), finis.length ? null : el('p', { class: 'tj-empty' }, 'Rien pour l\'instant. Tout l\'historique est dans l\'onglet « Historique ».')));
  }

  // ---------------- Historique ----------------
  function ligneHistorique(o, h) {
    const { el, redraw } = o, U = outils(o), cle = h.id || `${h.mac}-${h.at}`, ouvert = E.ligne === cle, res = RESULTAT[h.result] ?? h.result;
    const tete = el('button', { class: 'tj-h', type: 'button', 'aria-expanded': String(ouvert), onclick: () => { E.ligne = ouvert ? '' : cle; redraw(); } },
      el('span', { class: 'c1' }, jour(h.at)), el('span', {}, el('b', {}, h.host || 'Poste inconnu'), el('small', {}, el('i', { class: 'cm' }, `${jour(h.at)} · `), `${h.mac}${h.ip ? ` · ${h.ip}` : ''}`)),
      el('span', { class: 'c3' }, h.isoName, el('small', {}, MODE[h.mode] ?? '')), el('span', { class: 'c4' }, duree(h.ms)), el('span', {}, U.etat(res)));
    if (!ouvert) return [tete];
    return [tete, el('div', { class: 'tj-hd' },
      el('p', { class: 'tj-p-l' }, `Du ${jour(h.debut ?? h.at - h.ms)} au ${jour(h.at)} · ${duree(h.ms)} · ${h.isoName}${h.tours > 1 ? ` · ${h.tours} essais à la suite` : ''}${h.raison ? ` · ${h.raison}` : ''}`),
      U.identite({ mac: h.mac, ip: h.ip, marque: h.marque, modele: h.modele, serie: h.serie, fw: h.fw, lancePar: h.lancePar, installateur: h.installateur, arretePar: h.arretePar }),
      h.etapes?.length ? U.etapes(h.etapes) : null,
      h.logiciels?.length ? el('p', { class: 'tj-p-l' }, `Logiciels : ${h.logiciels.map((l) => `${l.nom} ${l.ok ? '✓' : 'raté'}`).join(' · ')}`) : null)];
  }
  async function historique(root, o) {
    const { el, ic, post, redraw } = o, f = E.filtres, R = (await post('rapport', f)).data ?? {};
    const q = el('input', { class: 'tj-in', type: 'search', value: f.q, placeholder: 'nom, adresse MAC, image, numéro de série…', onkeydown: (e) => { if (e.key === 'Enter') { f.q = q.value; redraw(); } } });
    const choix = (liste, valeur, onchange) => { const s = el('select', { class: 'tj-in', onchange: () => onchange(s.value) }, ...liste.map((x) => el('option', { value: x, selected: x === valeur }, x))); return s; };
    root.append(el('div', { class: 'tj-w' }, el('h3', {}, 'Historique des installations', el('small', {}, 'gardé dans la base de Genèse')),
      el('div', { class: 'tj-f' }, el('label', { style: 'flex:2' }, 'Poste ou image', q),
        el('label', {}, 'Résultat', choix(['tous', 'réussies', 'échecs', 'abandons', 'annulées', 'bloquées', 'lancées à la main'], f.resultat, (v) => { f.resultat = v; f.q = q.value; redraw(); })),
        el('label', {}, 'Période', choix(['7 jours', '30 jours', '90 jours', 'tout'], f.periode, (v) => { f.periode = v; f.q = q.value; redraw(); })),
        el('button', { class: 'tj-pill pri', type: 'button', onclick: () => { f.q = q.value; redraw(); } }, 'Afficher')),
      el('p', { class: 'tj-note', role: 'status' }, R.texte ?? ''),
      el('div', { class: 'tj-c', style: 'margin-top:10px' }, ...[['installations', R.total], ['réussies', R.reussies], ['échecs', R.echecs], ['abandons', R.abandons], ['annulées', R.annulees], ['bloquées', R.bloquees], ['à la main', R.lancees], ['réussite', R.taux === undefined ? '—' : `${R.taux} %`], ['durée moyenne', R.dureeMoyenneMs === undefined ? '—' : duree(R.dureeMoyenneMs)]].map(([k, v]) => el('div', {}, el('b', {}, String(v ?? 0)), k))),
      el('div', { style: 'margin-top:12px' }, ...(R.lignes ?? []).slice(0, 200).flatMap((h) => ligneHistorique(o, h)), (R.lignes ?? []).length ? null : el('p', { class: 'tj-empty' }, 'Aucune installation pour ces critères.')),
      (R.lignes ?? []).length > 200 ? el('p', { class: 'tj-note' }, `Les 200 plus récentes sont affichées (${R.lignes.length} en tout) ; l'export les contient toutes.`) : null,
      el('div', { class: 'tj-btns', style: 'margin-top:12px' }, el('button', { class: 'tj-pill n', type: 'button', disabled: !(R.lignes ?? []).length, onclick: () => {
        // Le fichier pour tableur est fabriqué ici, dans le navigateur, à partir de ce qu'Odin vient de rendre.
        const marque = String.fromCharCode(0xFEFF); // en tête de fichier : le tableur lit alors les accents correctement
        const a = el('a', { href: URL.createObjectURL(new Blob([marque + (R.csv ?? '')], { type: 'text/csv;charset=utf-8' })), download: R.fichier ?? 'installations-genese.csv' }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      } }, ic('list', 14), 'Exporter pour un tableur (CSV)'))));
    const grille = el('div', { class: 'tj-grid' }); root.append(grille);
    const parImage = R.parImage ?? [], max = Math.max(1, ...parImage.map((x) => x.total));
    grille.append(el('div', { class: 'tj-w' }, el('h3', {}, 'Par image'), ...parImage.slice(0, 10).map((x) => el('div', { style: 'margin-top:8px' }, el('div', { style: 'display:flex;gap:8px;font-size:13px' }, el('span', { style: 'flex:1;min-width:0;overflow-wrap:anywhere' }, x.image), el('b', {}, `${x.reussies} / ${x.total}`)), el('div', { class: 'tj-bar vert', style: 'margin-top:4px' }, el('i', { style: `width:${Math.round((x.total / max) * 100)}%` })))), parImage.length ? el('p', { class: 'tj-note' }, 'Réussies / lancées, sur la période.') : el('p', { class: 'tj-empty' }, 'Rien sur la période.')));
    const NIV = { critique: 'rouge', haute: 'jaune', moyenne: 'jaune', info: 'vert' };
    grille.append(el('div', { class: 'tj-w' }, el('h3', {}, 'Ce qu\'Odin a signalé'), ...(R.alertes ?? []).slice(0, 15).map((a) => el('div', { class: 'tj-li' }, el('time', {}, jour(Date.parse(a.at))), el('em', { class: `tj-e ${NIV[a.niveau] ?? 'gris'}` }, a.niveau === 'critique' ? 'grave' : NIV[a.niveau] === 'jaune' ? 'souci' : 'info'), el('b', { style: 'flex:1;min-width:160px;overflow-wrap:anywhere' }, a.titre, a.fois > 1 ? ` (×${a.fois})` : ''))), (R.alertes ?? []).length ? null : el('p', { class: 'tj-empty' }, 'Aucune notification de Genèse pour l\'instant.')));
    root.append(el('div', { class: 'tj-w' }, el('h3', {}, 'Journal de Genèse', el('small', {}, 'débuts, blocages, annulations, mots de passe refusés')), ...(R.evenements ?? []).slice(0, 60).map((e) => el('div', { class: 'tj-li' }, el('time', {}, jour(e.at)), el('b', {}, e.quoi), el('span', {}, [e.nom || e.mac, e.nom && e.mac ? e.mac : '', e.detail].filter(Boolean).join(' · ')))), (R.evenements ?? []).length ? null : el('p', { class: 'tj-empty' }, 'Rien sur la période.')));
  }

  // ---------------- Protection ----------------
  async function protection(root, o) {
    const { el, ic, post, act, note, redraw } = o, U = outils(o), D = (await post('suivi')).data ?? {}, P = D.protection ?? {};
    const mdp = el('input', { class: 'tj-in', type: 'password', autocomplete: 'new-password', maxlength: '64', 'aria-label': 'Nouveau mot de passe d\'installation' }), mdp2 = el('input', { class: 'tj-in', type: 'password', autocomplete: 'new-password', maxlength: '64', 'aria-label': 'Le même mot de passe, encore une fois' });
    const pour = el('select', { class: 'tj-in' }, ...[['toutes les installations', 'toutes'], ['postes non autorisés seulement', 'inconnus']].map(([t, v]) => el('option', { value: t, selected: (P.pour ?? 'toutes') === v }, t)));
    const dit = el('p', { class: 'tj-note', role: 'status' });
    const enregistrer = async (btn) => {
      if (mdp.value !== mdp2.value) { dit.textContent = 'Les deux saisies ne sont pas identiques.'; return; }
      if (!mdp.value && !P.actif) { dit.textContent = 'Écris un mot de passe (10 caractères au moins).'; return; }
      // Changer un mot de passe déjà réglé, ou le demander à moins de postes : Odin demande ton accord (fenêtre de confirmation).
      btn.disabled = true; const x = await act('mot_de_passe', { mot_de_passe: mdp.value, pour: pour.value }); btn.disabled = false; mdp.value = ''; mdp2.value = '';
      if (x.text === 'Annulé.') { dit.textContent = 'Rien n\'est changé.'; return; }
      if (x.ok === false) { dit.textContent = x.text; return; } note(x); await redraw();
    };
    root.append(el('div', { class: 'tj-grid' },
      el('div', { class: 'tj-w' }, el('h3', {}, ic('shield', 16), 'Mot de passe d\'installation', el('em', { class: `r tj-e ${P.actif ? 'vert' : 'gris'}` }, P.actif ? 'demandé' : 'aucun')),
        el('p', { class: 'tj-note', style: 'margin-top:0' }, P.actif ? `Demandé ${P.pour === 'inconnus' ? 'aux postes non autorisés' : 'à tous les postes'} depuis le ${jour(P.depuis)}. Sans lui : ni menu des systèmes, ni fichiers d'installation.` : 'Aucun : tout poste du réseau local qui démarre par le réseau a le menu des systèmes.'),
        el('div', { class: 'tj-f', style: 'margin-top:10px' }, el('label', {}, P.actif ? 'Nouveau mot de passe (vide : inchangé)' : 'Mot de passe (10 caractères au moins)', mdp), el('label', {}, 'Encore une fois', mdp2), el('label', { style: 'flex:1.6;min-width:220px' }, 'Demandé pour', pour)),
        el('div', { class: 'tj-btns', style: 'margin-top:10px' }, el('button', { class: 'tj-pill pri', type: 'button', onclick: (e) => enregistrer(e.currentTarget) }, 'Enregistrer'),
          P.actif ? el('button', { class: 'tj-pill dan', type: 'button', onclick: (e) => U.faire(e.currentTarget, 'retirer_mot_de_passe', {}) }, 'Retirer le mot de passe') : null),
        dit,
        el('p', { class: 'tj-note' }, `Le poste le tape sur son écran, avant le menu (saisie masquée). Odin ne garde que son empreinte. ${P.essaisMax ?? 5} erreurs : le poste est bloqué 15 minutes (puis 1 heure, puis 24 heures s'il recommence) et tu es prévenu ; au-delà de 10 refus en une heure, tous postes confondus, Odin te prévient aussi et ralentit les essais.`),
        el('p', { class: 'tj-note' }, '« Postes non autorisés seulement » : un poste autorisé est reconnu à son adresse MAC, que tout le réseau local peut lire. Un appareil qui prend cette adresse passe sans mot de passe ; Odin n\'accepte qu\'une adresse IP par poste autorisé et te prévient si une deuxième se présente. Pour une vraie barrière : « toutes les installations ».'),
        el('p', { class: 'tj-note' }, 'Au démarrage, le clavier est lu comme un clavier américain : tape normalement, Odin reconnaît aussi la forme tapée sur un clavier AZERTY. Le mot de passe voyage en clair sur le réseau local : ne reprends pas un mot de passe qui sert ailleurs.')),
      el('div', { class: 'tj-w' }, el('h3', {}, 'Toutes les installations'),
        el('div', { class: 'tj-row', style: 'margin-top:0' }, el('span', {}, 'Suspendre les nouvelles installations ', el('small', {}, '(celles en cours finissent)')), el('button', { class: 'tj-sw', type: 'button', role: 'switch', 'aria-checked': String(Boolean(D.suspendu)), 'aria-label': 'Suspendre les nouvelles installations', onclick: (e) => U.faire(e.currentTarget, D.suspendu ? 'reprendre' : 'suspendre', {}) })),
        (() => { const n = el('input', { type: 'number', min: '5', max: '720', value: String(D.abandon ?? 30), 'aria-label': 'Minutes sans signe de vie' }); return el('div', { class: 'tj-row' }, el('span', {}, 'Installation dite abandonnée sans signe de vie depuis'), n, el('small', {}, 'min'), el('button', { class: 'tj-pill n pt', type: 'button', onclick: (e) => U.faire(e.currentTarget, 'delai_abandon', { minutes: Number(n.value) }) }, 'OK')); })(),
        el('p', { class: 'tj-note' }, 'Pendant une installation automatique, le poste dit « je suis là » chaque minute. Windows ne dit rien pendant la copie : Odin attend alors 2 heures au moins.'),
        (P.verrous ?? []).length ? el('p', { class: 'tj-p-l', style: 'font-weight:700;color:var(--ink);margin-top:12px' }, 'Bloqués après 5 mots de passe refusés') : null,
        ...(P.verrous ?? []).map((v) => el('div', { class: 'tj-li' }, el('b', {}, v.mac), el('span', {}, `jusqu'à ${heure(v.jusqua)}`))),
        (P.passes ?? []).length ? el('p', { class: 'tj-p-l', style: 'font-weight:700;color:var(--ink);margin-top:12px' }, 'Postes qui ont donné le mot de passe') : null,
        ...(P.passes ?? []).map((v) => el('div', { class: 'tj-li' }, el('b', {}, v.mac), el('span', {}, `${v.qui ? `saisi par ${v.qui} · ` : ''}laissez-passer jusqu'à ${heure(v.jusqua)} (prolongé tant qu'il charge)`))))));
    const mac = el('input', { class: 'tj-in', type: 'text', placeholder: '52:54:00:12:34:56', 'aria-label': 'Adresse MAC du poste à bloquer' }), raison = el('input', { class: 'tj-in', type: 'text', maxlength: '120', 'aria-label': 'Raison du blocage' });
    root.append(el('div', { class: 'tj-w' }, el('h3', {}, 'Postes bloqués', el('small', {}, `${(D.bloques ?? []).length}`)),
      ...(D.bloques ?? []).map((b) => el('div', { class: 'tj-li' }, el('time', {}, jour(b.at)), el('b', {}, b.nom || 'Poste inconnu'), el('span', {}, `${b.mac}${b.raison ? ` · ${b.raison}` : ''}`), el('button', { class: 'tj-pill n pt', type: 'button', onclick: (e) => U.faire(e.currentTarget, 'debloquer', { mac: b.mac }) }, 'Débloquer'))),
      (D.bloques ?? []).length ? null : el('p', { class: 'tj-empty' }, 'Aucun poste bloqué.'),
      el('div', { class: 'tj-f', style: 'margin-top:12px' }, el('label', {}, 'Adresse MAC du poste', mac), el('label', { style: 'flex:2' }, 'Raison (facultatif)', raison), el('button', { class: 'tj-pill n', type: 'button', onclick: (e) => { if (mac.value.trim()) U.faire(e.currentTarget, 'bloquer', { mac: mac.value.trim(), raison: raison.value }); } }, ic('shield', 14), 'Bloquer')),
      el('p', { class: 'tj-note' }, 'Un poste bloqué voit le message sur son écran, puis démarre sur son propre disque : il ne reçoit plus ni menu ni fichiers. Le blocage suit l\'adresse MAC (et l\'adresse IP d\'où le poste a parlé) : il ne vaut que pour un poste qui ne triche pas. Un poste peut changer d\'adresse : contre quelqu\'un de malveillant, mets un mot de passe d\'installation.')));
  }

  window.OdinGeneseSuivi = {
    onglets: [['installations', 'Installations'], ['historique', 'Historique'], ['protection', 'Protection']],
    async dessiner(racine, onglet, o) {
      if (!document.getElementById('tjSuiviCss')) { const st = document.createElement('style'); st.id = 'tjSuiviCss'; st.textContent = CSS; document.head.append(st); }
      if (onglet === 'historique') await historique(racine, o); else if (onglet === 'protection') await protection(racine, o); else await installations(racine, o);
    },
  };
})();
