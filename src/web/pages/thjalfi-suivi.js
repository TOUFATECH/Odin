// Genèse dans l'interface · le suivi des installations par le réseau (PXE). Trois onglets de la page de Genèse :
// - Installations : chaque poste reconnu (nom, adresse MAC, adresse IP, marque, modèle, numéro de série), son étape,
//   son avancement et son état, en direct ; boutons Annuler (ton accord d'abord), Bloquer, Débloquer ; suspendre tout.
// - Historique : toutes les installations gardées dans la base de Genèse, filtrables (poste, résultat, période), le
//   rapport (réussies, échecs, abandons, durée moyenne, par image), l'export pour tableur, ce qu'Odin a signalé.
// - Protection : le mot de passe d'installation (saisie masquée), le délai d'abandon, les postes bloqués.
// En haut de l'onglet Installations (lot S7 de la maquette « Genèse · Systèmes ») : le déploiement en cours, PC par PC en
// six étapes nommées, Annuler (qui dit si le disque a déjà été touché), Recommencer (phrase et appui long, puis toutes les
// vérifications de « Déployer »), et la fin avec son tableau.
// Chargé avant thjalfi.js (ordre alphabétique) ; la page de Genèse appelle OdinGeneseSuivi.dessiner(racine, onglet, outils).
(() => {
  'use strict';
  // Ce qui doit survivre à la relecture (la page se redessine toutes les 5 s sur l'onglet « Installations »).
  const E = { ouvert: '', fiche: null, ligne: '', filtres: { periode: '30 jours', resultat: 'tous', q: '' }, lot: '', dep: '', annule: '' };
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
/* Le déploiement PC par PC et sa fin (lot S7) */
.tjd-face{--s:56px;position:relative;width:var(--s);height:var(--s);border-radius:50%;background:radial-gradient(circle at 40% 35%,#ffe3a0,#e19b1f);display:inline-flex;align-items:center;justify-content:center;gap:calc(var(--s)*.12);box-shadow:0 0 calc(var(--s)*.4) #ffd16677;flex:none}
.tjd-face i{display:block;width:calc(var(--s)*.11);height:calc(var(--s)*.23);background:#fff;border-radius:999px}
.tjd-face em{position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:4px;font-style:normal;font-weight:800;font-size:calc(var(--s)*.18);color:var(--ta);white-space:nowrap;letter-spacing:.08em}
.tjd-tete{display:flex;gap:14px;align-items:center}.tjd-tete h3{flex-wrap:wrap}
.tjd-k div{background:color-mix(in srgb,var(--tblue) 12%,transparent)}.tjd-k div.ok{background:color-mix(in srgb,var(--tok) 14%,transparent)}.tjd-k div.ko{background:color-mix(in srgb,var(--tbad) 12%,transparent)}
.tjd-k span small{display:block;color:var(--muted);font-size:12px}.tjd-k b{white-space:nowrap}
.tjd-pc{border:1px solid var(--line);border-radius:16px;padding:12px 14px;margin-top:10px;min-width:0}
.tjd-h{display:flex;gap:12px;align-items:center}.tjd-ico{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--ta) 12%,transparent);color:var(--ta);flex:none}
.tjd-nm{flex:1;min-width:0}.tjd-nm b{display:block;font-size:15px;overflow-wrap:anywhere}.tjd-nm small{display:block;color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}
.tjd-pct{text-align:right;flex:none}.tjd-pct b{display:block;font-size:20px}.tjd-pct small{font-size:12px;color:var(--muted)}
.tjd-segs{list-style:none;margin:8px 0 0;padding:0;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}
.tjd-segs li{font-size:11.5px;color:var(--muted);min-width:0}.tjd-segs li span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tjd-segs i{display:block;height:5px;border-radius:3px;background:color-mix(in srgb,var(--ink) 12%,transparent);margin-bottom:4px}
.tjd-segs .ok i{background:var(--tok)}.tjd-segs .cur i{background:var(--tblue)}.tjd-segs .cur{color:var(--ink);font-weight:700}.tjd-segs .ko i{background:var(--tbad)}.tjd-segs .ko{color:var(--tbad);font-weight:700}
@media (max-width:520px){.tjd-segs{gap:3px}.tjd-segs li{font-size:10px}.tjd-segs li:not(.cur):not(.ko) span{visibility:hidden}.tjd-h{flex-wrap:wrap}.tjd-pct{text-align:left;flex-basis:100%}}
.tjd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.tjd-ln{font-size:13px;color:var(--muted);margin-top:8px;overflow-wrap:anywhere}
.tjd-garde{display:flex;gap:12px;align-items:flex-start;margin-top:10px;padding:12px 14px;border-radius:14px;border:2px solid color-mix(in srgb,var(--tbad) 60%,transparent);background:color-mix(in srgb,var(--tbad) 9%,var(--panel))}
.tjd-garde.calme{border-color:color-mix(in srgb,var(--tok) 55%,transparent);background:color-mix(in srgb,var(--tok) 8%,var(--panel))}
.tjd-garde .gi{color:var(--tbad);flex:none;margin-top:2px}.tjd-garde.calme .gi{color:var(--tok)}.tjd-garde b{font-size:14.5px}.tjd-garde p{margin:4px 0 10px;font-size:13.5px}
.tj-pill.pt{min-height:44px}
.tjd-hero{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:8px 6px 4px}.tjd-hero h3{margin:18px 0 0;font-size:20px;justify-content:center}.tjd-hero p{margin:0;max-width:560px;font-size:14px;color:var(--muted);line-height:1.45}.tjd-hero small{color:var(--muted);font-size:12px}
.tjd-tab{margin-top:14px;overflow-x:auto}.tjd-res{width:100%;border-collapse:collapse;font-size:13.5px}
.tjd-res th{text-align:left;font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding:8px;border-bottom:1px solid var(--line)}
.tjd-res td{padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:middle;overflow-wrap:anywhere}.tjd-res td small{display:block;color:var(--muted);font-size:12px;margin-top:3px}.tjd-res td.ac{text-align:right}
.tjd-res tr.dt td{background:color-mix(in srgb,var(--ink) 3%,transparent)}
@media (max-width:640px){.tjd-res .hp{display:none}.tjd-res thead{display:none}.tjd-res,.tjd-res tbody{display:block}.tjd-res tr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 10px;padding:10px 4px;border-bottom:1px solid var(--line)}.tjd-res td{border:0;padding:0}.tjd-res td.ac{grid-column:2;grid-row:1/span 2;align-self:center}.tjd-res tr.dt{grid-template-columns:minmax(0,1fr)}.tjd-res td.ac .tj-pill{padding:0 12px}}
.tjd-res td small{overflow-wrap:anywhere}.tjd-res td:first-child small{overflow-wrap:normal;white-space:nowrap}
.tjd-face em.coeur{color:#ff6fa8;letter-spacing:.2em}.tj-pill.tjd-b{min-height:44px}
.tjd-fin-b{justify-content:center;margin-top:16px}.tjd-autres{margin:6px 2px 0;font-size:15px;color:var(--muted)}
.tjd-fond{position:fixed;inset:0;z-index:9000;background:rgba(10,16,24,.55);display:flex;align-items:center;justify-content:center;padding:16px}
.tjd-dlg{width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--panel,#fff);color:var(--ink,#111);border:1px solid var(--line);border-radius:20px;padding:18px 20px;box-shadow:0 20px 50px rgba(0,0,0,.3);box-sizing:border-box}
.tjd-dlg h3{margin:0 0 4px;font-size:17px}.tjd-dlg p{font-size:13.5px;line-height:1.45}
.tjd-lb{display:block;font-weight:700;font-size:14px;margin-top:8px}.tjd-lb code{font-size:14px;padding:2px 8px;border-radius:8px;background:color-mix(in srgb,var(--tbad) 12%,transparent);color:var(--tbad)}
.tjd-row{display:flex;gap:10px;align-items:stretch;margin-top:8px;flex-wrap:wrap}.tjd-row .tj-in{flex:1;min-width:160px;min-height:44px}
.tjd-appui{position:relative;overflow:hidden;min-height:48px;padding:0 16px;border-radius:12px;border:0;background:var(--tbad);color:#fff;font:inherit;font-weight:700;font-size:13.5px;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;flex:1 1 220px}
.tjd-appui:disabled{opacity:.45;cursor:not-allowed}.tjd-appui .tx{position:relative;display:inline-flex;gap:8px;align-items:center}.tjd-remplir{position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(0,0,0,.28)}
.tjd-msg{display:block;font-size:12.5px;color:var(--muted);margin-top:6px}.tjd-msg.ok{color:var(--tok);font-weight:700}.tjd-msg.ko{color:var(--tbad);font-weight:700}
@media (prefers-reduced-motion:reduce){.tj-bar i{transition:none}}
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
  // ---------------- Le déploiement en cours, PC par PC, et sa fin (maquette « Genèse · Systèmes », lot S7) ----------------
  // Lu par « deploiement_suivi » (propriétaire seul). Chaque PC : six étapes nommées, la ligne du moment, Annuler (le
  // garde-fou dit si son disque a déjà été touché), Bloquer, Déroulement. À la fin : le tableau, et « Recommencer » pour un
  // PC raté (la phrase « effacer 1 pc » ET un appui long de 3 s, puis Odin repasse par toutes les vérifications de
  // « Déployer » : jamais un effacement sans nouvelle autorisation).
  const MOTS = {
    vide: 'Rien en cours', 'vide.texte': 'Lance un déploiement depuis « Déployer », ou depuis la carte d\'un système.',
    deployer: 'Déployer', historique: 'Historique', 'historique.voir': 'Voir l\'historique', systemes: 'Mes systèmes', encore: 'Déployer encore',
    titre: '{sys} sur {n} PC', direct: 'en direct', fermer: 'Tu peux fermer la page : Odin continue et te prévient à la fin, sur ton téléphone aussi.',
    'k.cours': 'en cours', 'k.attente': '{n} en attente', 'k.prets': 'prêts', 'k.rates': 'à reprendre', 'k.reste': 'avant la fin', 'k.reste.inconnu': 'pas encore d\'estimation',
    pcparpc: 'PC par PC', deroulement: 'Déroulement', 'deroulement.fermer': 'Fermer', annuler: 'Annuler', bloquer: 'Bloquer ce PC',
    'annuler.titre': 'Arrêter le déploiement de {nom} ?', 'annuler.oui': 'Arrêter', 'annuler.non': 'Continuer',
    'disque.non': 'Son disque n\'est pas encore touché : il redémarrera sur son système.',
    'disque.attente': 'Il n\'a pas encore démarré : son disque n\'est pas touché. Son autorisation est annulée.',
    'disque.attente.peutetre': 'Odin n\'a rien effacé ; mais un système a été lancé à la main sur ce PC depuis le menu : son disque a peut-être été écrit. Son autorisation est annulée.',
    'disque.oui': 'Son disque est déjà effacé (ou en train de l\'être) : l\'installateur a déjà ses réponses, éteins le PC s\'il continue seul. Il ne démarrera pas tant qu\'il n\'est pas réinstallé (« Recommencer »).',
    'disque.peutetre': 'L\'installation a été lancée à la main sur le PC : Odin ne peut pas savoir si son disque a déjà été écrit. Éteins le PC s\'il continue seul.',
    suspendre: 'Suspendre les nouvelles installations', 'une.notif': 'Vingt PC qui finissent ensemble : une seule notification.',
    'fin.titre': '{ok} PC prêt{s} sur {n}', 'fin.sys': '{sys} est installé', 'fin.profil': ' avec le profil « {profil} »', 'fin.compte': 'Le compte local « {compte} » est créé ; son mot de passe est dans le coffre d\'Odin.',
    'fin.coffre': 'Le mot de passe de chaque PC est dans le coffre d\'Odin.', 'fin.aucun': 'Aucun PC n\'est prêt. Chaque ligne dit pourquoi ; « Recommencer » relance un PC.', 'fin.menu': '{sys} a été proposé au menu de chaque PC, sans rien effacer.',
    'col.pc': 'PC', 'col.res': 'Résultat', 'col.reseau': 'Sur le réseau', 'col.log': 'Logiciels', recommencer: 'Recommencer',
    recents: 'Déploiements récents', voir: 'Voir', 'recent.ligne': '{sys} · {n} PC · {quand}',
    'rec.titre': 'Recommencer sur {nom}', 'rec.texte': 'Une nouvelle autorisation, pour ce PC seulement, une seule fois, pendant 2 h : son disque sera effacé à son prochain démarrage par le réseau, s\'il est bien lui (adresse, numéro de série, taille du disque). Un nouveau mot de passe est rangé dans le coffre.',
    'rec.menu': '{sys} sera de nouveau proposé au menu de ce PC, sans rien effacer.', 'rec.menu.bouton': 'Le proposer de nouveau',
    'phrase.titre': 'Pour effacer et réinstaller, tape', 'phrase.ok': 'C\'est juste.', 'phrase.ko': 'Pas encore : tape exactement la phrase.',
    appui: 'Garde appuyé 3 s : recommencer sur {nom}', 'appui.aide': 'Garde le bouton enfoncé (doigt, souris, ou touche Espace) pendant 3 secondes. Relâcher avant arrête tout.',
    'appui.ferme': 'Tape d\'abord la phrase.', 'appui.encore': 'Encore {s} s…', 'appui.lache': 'Relâché trop tôt : rien n\'est lancé.', envoi: 'Odin vérifie et autorise…',
    'rec.fait': 'Autorisé. Allume le PC par le réseau : tu le suis ici.', 'rec.fermer': 'Fermer', 'rec.erreur': 'Rien n\'est autorisé : {raison}',
    autres: 'Autres postes du démarrage réseau',
    'etat.attente': 'en attente', 'etat.cours': 'en cours', 'etat.pret': 'prêt', 'etat.echec': 'échouée', 'etat.abandonnee': 'abandonnée', 'etat.annulee': 'annulée', 'etat.bloquee': 'bloquée', 'etat.lancee': 'lancée à la main', 'etat.expiree': 'pas démarré à temps', 'etat.refusee': 'refusée au démarrage', 'etat.remplacee': 'remplacée',
    'etape.reseau': 'Réseau', 'etape.chargeur': 'Chargeur', 'etape.systeme': 'Système', 'etape.installation': 'Installation', 'etape.logiciels': 'Logiciels', 'etape.fini': 'Fini',
    'seg.fait': ' : fait', 'seg.cours': ' : en cours', 'seg.arrete': ' : arrêté ici', 'seg.aria': 'Étapes de {nom}', 'avance.aria': 'Avancement de {nom}', 'deroulement.aria': 'Déroulement de {nom}',
    envoye: 'Système envoyé · {a} sur {b}', 'log.ligne': 'Logiciels · {noms} ({ok} installé{s}{rates})', 'log.rates': ', {n} raté{s}', 'log.court': '{ok} installé{s}{rates}',
    jusqua: 'jusqu\'à {h}', depuis: 'depuis {d}', 'en.duree': 'en {d}', prochain: 'Le prochain PC qui démarre', 'prochain.court': 'Le prochain PC',
    'aucune.etape': 'Aucune étape notée.', 'pas.demarre': 'Le PC n\'a pas encore démarré par le réseau.', commence: 'Commencé le {quand}', action: 'Action',
    'recent.prets': '{ok} prêt{s} sur {n}', 'recent.cours': ' · en cours', 'plus.recent': 'Le plus récent',
  };
  const mot = (k, v = {}) => String(MOTS[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => String(v[x] ?? ''));
  const ETAT_DEP = { attente: [mot('etat.attente'), 'gris'], 'en cours': [mot('etat.cours'), 'bleu'], 'prêt': [mot('etat.pret'), 'vert'], 'échec': [mot('etat.echec'), 'rouge'], abandonnée: [mot('etat.abandonnee'), 'jaune'], annulée: [mot('etat.annulee'), 'gris'], bloquée: [mot('etat.bloquee'), 'rouge'], lancée: [mot('etat.lancee'), 'bleu'], expirée: [mot('etat.expiree'), 'jaune'], refusée: [mot('etat.refusee'), 'rouge'], remplacée: [mot('etat.remplacee'), 'gris'] };
  const ETAPES6 = ['reseau', 'chargeur', 'systeme', 'installation', 'logiciels', 'fini'].map((k) => mot(`etape.${k}`));
  /** « 2 installés, 1 raté » (logiciels). */
  const logs = (l) => mot('log.court', { ok: l.ok, s: l.ok > 1 ? 's' : '', rates: l.rates ? mot('log.rates', { n: l.rates, s: l.rates > 1 ? 's' : '' }) : '' });
  /** La phrase, l'appui long : les MÊMES règles que l'onglet Déployer (et que le serveur, qui revérifie tout). */
  const L = () => window.OdinGeneseDeployer?.logique ?? {};
  const APPUI = () => Number(L().APPUI_MS) || 3000;
  const phrasePour = (n) => (L().phrasePour ? L().phrasePour(n) : `effacer ${Math.max(0, Math.round(Number(n) || 0))} pc`);
  const normale = (x) => String(x == null ? '' : x).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const phraseOk = (saisie, attendue) => (L().phraseOk ? L().phraseOk(saisie, attendue) : Boolean(attendue) && normale(saisie) === normale(attendue));
  const peutLancer = (o) => (L().peutLancer ? L().peutLancer(o) : Boolean(o && o.phraseOk === true && Number(o.appuiMs) >= APPUI()));
  const texteDisque = (p) => (p.etat === 'attente' ? mot(p.disque === 'peut-être' ? 'disque.attente.peutetre' : 'disque.attente') : p.disque === 'oui' ? mot('disque.oui') : p.disque === 'peut-être' ? mot('disque.peutetre') : mot('disque.non'));
  /** Le visage d'Odin (deux yeux en pastille et la couleur) ; les marques autour : z z z, ♥. */
  const visage = (el, taille, marque) => el('span', { class: 'tjd-face', style: `--s:${taille}px`, 'aria-hidden': 'true' }, el('i'), el('i'), marque ? el('em', { class: /♥/.test(marque) ? 'coeur' : '' }, marque) : null);
  /** Changer d'onglet de la page de Genèse (Déployer, Historique, Systèmes). */
  const allerA = (o, id, libelle) => { if (typeof o.aller === 'function') { o.aller(id); return; } const b = [...(document.querySelectorAll ? document.querySelectorAll('.tj-tabs [role=tab]') : [])].find((x) => x.textContent.trim() === libelle); if (b) b.click(); };

  function segments(el, p) {
    const k = p.etape, fini = p.etat === 'prêt';
    return el('ol', { class: 'tjd-segs', 'aria-label': mot('seg.aria', { nom: p.nom }) }, ...ETAPES6.map((t, j) => {
      const fait = fini || j < k, cours = !fini && p.etat === 'en cours' && j === k, rate = !fini && p.etat !== 'en cours' && p.etat !== 'attente' && j === k;
      return el('li', { class: fait ? 'ok' : cours ? 'cur' : rate ? 'ko' : '', ...(cours ? { 'aria-current': 'step' } : {}) }, el('i'), el('span', {}, t), el('b', { class: 'tjd-sr' }, fait ? mot('seg.fait') : cours ? mot('seg.cours') : rate ? mot('seg.arrete') : ''));
    }));
  }
  function lignePc(o, lot, p, maintenant) {
    const { el, ic, redraw } = o, U = outils(o), [etat, coul] = ETAT_DEP[p.etat] ?? [p.etat, 'gris'], ouvert = E.dep === p.autorisation, confirme = E.annule === p.autorisation;
    const env = p.envoye && p.etape === 2 ? mot('envoye', { a: poids(p.envoye.octets), b: poids(p.envoye.taille) }) : '';
    const log = p.etape === 4 && (p.logiciels.ok || p.logiciels.rates) ? `${mot('etape.logiciels')} · ${p.logiciels.noms.slice(-3).join(', ')} (${logs(p.logiciels)})` : '';
    const ligne = env || log || p.ligne || '';
    const depuis = p.etat === 'attente' ? mot('jusqua', { h: heure(p.expire).slice(0, 5) }) : p.etat === 'en cours' ? mot('depuis', { d: duree(maintenant - (p.debut ?? maintenant)) }) : p.finA && p.debut ? mot('en.duree', { d: duree(p.finA - p.debut) }) : '';
    const box = el('div', { class: 'tjd-pc', role: 'group', 'aria-label': `${p.nom}, ${etat}`, 'data-pc': p.autorisation },
      el('div', { class: 'tjd-h' }, el('span', { class: 'tjd-ico' }, ic('pc', 22)),
        el('span', { class: 'tjd-nm' }, el('b', {}, p.prochain && !p.mac ? mot('prochain') : p.nom, ' ', el('em', { class: `tj-e ${coul}` }, etat)), el('small', {}, [p.mac, lot.isoNom].filter(Boolean).join(' · '))),
        el('span', { class: 'tjd-pct' }, el('b', {}, p.etat === 'attente' ? '—' : `${p.pct} %`), el('small', {}, depuis))),
      el('div', { class: `tj-bar ${coul === 'bleu' ? '' : coul}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(p.pct), 'aria-label': mot('avance.aria', { nom: p.nom }) }, el('i', { style: `width:${p.pct}%` })),
      segments(el, p),
      el('div', { class: 'tjd-ln' }, ligne));
    if (confirme && p.annulable) {
      const grave = p.disque !== 'non';
      box.append(el('div', { class: `tjd-garde${grave ? '' : ' calme'}`, role: 'alertdialog', 'aria-labelledby': `tjd-ga-${p.autorisation}` }, el('span', { class: 'gi' }, ic(grave ? 'alert' : 'disk', 22)),
        el('div', {}, el('b', { id: `tjd-ga-${p.autorisation}` }, mot('annuler.titre', { nom: p.nom })), el('p', {}, texteDisque(p)),
          el('div', { class: 'tj-btns' },
            el('button', { class: 'tj-pill dan tjd-b', type: 'button', 'data-f': `annuler-oui-${p.autorisation}`, onclick: async (e) => { e.currentTarget.disabled = true; E.annule = ''; const x = await o.post('deploiement_annuler', { autorisation: p.autorisation }, true); o.note(x); await redraw(); } }, ic('x', 14), mot('annuler.oui')),
            el('button', { class: 'tj-pill n tjd-b', type: 'button', 'data-f': `annuler-non-${p.autorisation}`, onclick: () => { E.annule = ''; redraw(); } }, mot('annuler.non'))))));
    }
    box.append(el('div', { class: 'tj-p-b' },
      el('button', { class: 'tj-pill n pt', type: 'button', 'aria-expanded': String(ouvert), 'data-f': `deroulement-${p.autorisation}`, onclick: () => { E.dep = ouvert ? '' : p.autorisation; redraw(); } }, ic('list', 14), ouvert ? mot('deroulement.fermer') : mot('deroulement')),
      p.annulable && !confirme ? el('button', { class: 'tj-pill dan pt', type: 'button', 'data-f': `annuler-${p.autorisation}`, onclick: () => { E.annule = p.autorisation; redraw(); } }, ic('x', 14), mot('annuler')) : null,
      p.recommencable ? el('button', { class: 'tj-pill pri pt', type: 'button', 'data-f': `recommencer-${p.autorisation}`, onclick: () => ouvrirRecommencer(o, lot, p) }, mot('recommencer')) : null,
      p.mac && p.etat !== 'prêt' ? el('button', { class: 'tj-pill n pt', type: 'button', 'data-f': `bloquer-${p.autorisation}`, onclick: (e) => U.bloquer(e.currentTarget, { mac: p.mac, nom: p.nom }) }, ic('shield', 14), mot('bloquer')) : null));
    if (ouvert) box.append(p.deroulement.length ? el('ol', { class: 'tj-tl', 'aria-label': mot('deroulement.aria', { nom: p.nom }) }, ...p.deroulement.map((e) => el('li', { class: couleurEtape(e.etape === 'Fini' ? 'fini' : e.etape) }, el('time', {}, heure(e.at)), el('b', {}, e.etape), e.detail ? el('span', {}, e.detail) : null))) : el('p', { class: 'tj-empty' }, p.etat === 'attente' ? mot('pas.demarre') : mot('aucune.etape')));
    return box;
  }
  function enCours(root, o, lot, maintenant, suspendu) {
    const { el, ic } = o, U = outils(o), c = lot.chiffres;
    root.append(el('div', { class: 'tj-w tjd-tete' }, visage(el, 56), el('div', { style: 'flex:1;min-width:0' },
      el('h3', { style: 'margin:0' }, mot('titre', { sys: lot.isoNom, n: c.total }), el('span', { class: 'tj-live' }, mot('direct'))),
      el('p', { class: 'tj-note', style: 'margin:2px 0 0' }, mot('fermer')))));
    root.append(el('div', { class: 'tj-k tjd-k' },
      el('div', {}, el('b', {}, String(c.enCours)), el('span', {}, mot('k.cours'), c.attente ? el('small', {}, mot('k.attente', { n: c.attente })) : null)),
      el('div', { class: 'ok' }, el('b', {}, String(c.prets)), el('span', {}, mot('k.prets'))),
      el('div', { class: 'ko' }, el('b', {}, String(c.rates)), el('span', {}, mot('k.rates'))),
      el('div', {}, el('b', {}, lot.resteMin ? `~ ${lot.resteMin} min` : '—'), el('span', {}, lot.resteMin ? mot('k.reste') : mot('k.reste.inconnu')))));
    root.append(el('div', { class: 'tj-w' }, el('h3', {}, mot('pcparpc')), ...lot.pcs.map((p) => lignePc(o, lot, p, maintenant)),
      el('div', { class: 'tj-btns', style: 'margin-top:12px' }, suspendu ? null : el('button', { class: 'tj-pill tjd-b n', type: 'button', onclick: (e) => U.faire(e.currentTarget, 'suspendre', {}) }, ic('clock', 14), mot('suspendre')), el('span', { class: 'tj-note', style: 'margin:0' }, mot('une.notif')))));
  }
  function fin(root, o, lot, maintenant) {
    const { el, ic, redraw } = o, c = lot.chiffres, s0 = c.prets > 1 ? 's' : '';
    const phrase = lot.facon === 'menu' ? mot('fin.menu', { sys: lot.isoNom }) : c.prets ? `${mot('fin.sys', { sys: lot.isoNom })}${lot.profil ? mot('fin.profil', { profil: lot.profil }) : ''}. ${lot.compte ? mot('fin.compte', { compte: lot.compte }) : mot('fin.coffre')}` : mot('fin.aucun');
    const lignes = lot.pcs.flatMap((p) => {
      const [etat, coul] = ETAT_DEP[p.etat] ?? [p.etat, 'gris'], ouvert = E.dep === p.autorisation;
      const tr = el('tr', {},
        el('td', {}, el('b', {}, p.prochain && !p.mac ? mot('prochain.court') : p.nom), el('small', {}, p.mac || '—')),
        el('td', {}, el('em', { class: `tj-e ${coul}` }, etat), p.etat !== 'prêt' && p.raison ? el('small', {}, p.raison) : null),
        el('td', { class: 'hp' }, p.etat === 'prêt' ? [p.host, p.ip].filter(Boolean).join(' · ') || '—' : '—'),
        el('td', { class: 'hp' }, p.logiciels.ok || p.logiciels.rates ? logs(p.logiciels) : '—'),
        el('td', { class: 'ac' }, p.recommencable ? el('button', { class: 'tj-pill pri pt', type: 'button', 'data-f': `recommencer-${p.autorisation}`, onclick: () => ouvrirRecommencer(o, lot, p) }, mot('recommencer'))
          : el('button', { class: 'tj-pill n pt', type: 'button', 'aria-expanded': String(ouvert), 'data-f': `deroulement-${p.autorisation}`, onclick: () => { E.dep = ouvert ? '' : p.autorisation; redraw(); } }, ouvert ? mot('deroulement.fermer') : mot('deroulement'))));
      if (!ouvert) return [tr];
      return [tr, el('tr', { class: 'dt' }, el('td', { colspan: '5' }, p.deroulement.length ? el('ol', { class: 'tj-tl', 'aria-label': mot('deroulement.aria', { nom: p.nom }) }, ...p.deroulement.map((e) => el('li', { class: couleurEtape(e.etape === 'Fini' ? 'fini' : e.etape) }, el('time', {}, heure(e.at)), el('b', {}, e.etape), e.detail ? el('span', {}, e.detail) : null))) : el('p', { class: 'tj-empty' }, mot('aucune.etape'))))];
    });
    root.append(el('div', { class: 'tj-w' },
      el('div', { class: 'tjd-hero' }, visage(el, 96, c.prets ? '♥ ♥' : ''), el('h3', {}, mot('fin.titre', { ok: c.prets, s: s0, n: c.total })), el('p', {}, phrase),
        el('small', {}, mot('commence', { quand: jour(lot.cree) }))),
      el('div', { class: 'tjd-tab' }, el('table', { class: 'tjd-res' }, el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, mot('col.pc')), el('th', { scope: 'col' }, mot('col.res')), el('th', { scope: 'col', class: 'hp' }, mot('col.reseau')), el('th', { scope: 'col', class: 'hp' }, mot('col.log')), el('th', { scope: 'col' }, el('span', { class: 'tjd-sr' }, mot('action'))))), el('tbody', {}, ...lignes))),
      el('div', { class: 'tj-btns tjd-fin-b' },
        el('button', { class: 'tj-pill tjd-b pri', type: 'button', onclick: () => allerA(o, 'deployer', 'Déployer') }, ic('play', 14), mot('encore')),
        el('button', { class: 'tj-pill tjd-b n', type: 'button', onclick: () => allerA(o, 'historique', 'Historique') }, ic('list', 14), mot('historique.voir')),
        el('button', { class: 'tj-pill tjd-b n', type: 'button', onclick: () => allerA(o, 'systemes', 'Systèmes') }, ic('grid', 14), mot('systemes')))));
    void maintenant;
  }
  function vide(root, o) {
    const { el, ic } = o;
    root.append(el('div', { class: 'tj-w' }, el('div', { class: 'tjd-hero' }, visage(el, 88, 'z z z'), el('h3', {}, mot('vide')), el('p', {}, mot('vide.texte')),
      el('div', { class: 'tj-btns', style: 'justify-content:center' }, el('button', { class: 'tj-pill tjd-b pri', type: 'button', onclick: () => allerA(o, 'deployer', 'Déployer') }, ic('play', 14), mot('deployer')),
        el('button', { class: 'tj-pill tjd-b n', type: 'button', onclick: () => allerA(o, 'historique', 'Historique') }, ic('list', 14), mot('historique'))))));
  }
  /**
   * « Recommencer » : une fenêtre posée sur la page (la page se relit toutes les 5 s, la saisie ne se perd pas). La phrase
   * ET l'appui long de 3 s ; puis « recommencer », qui repasse par toutes les vérifications de « Déployer ».
   */
  function ouvrirRecommencer(o, lot, p) {
    const { el, ic } = o;
    document.getElementById('tjdRec')?.remove();
    const avant = document.activeElement;
    const Z = { saisie: '', appui: { debut: 0, minuteur: 0 }, etat: 'rien', garde: 0 };
    const auto = lot.facon !== 'menu', attendue = auto ? phrasePour(1) : '';
    const page = document.querySelector('.tj');
    const fermer = async (relire) => { clearInterval(Z.appui.minuteur); clearInterval(Z.garde); fond.remove(); if (document.removeEventListener) document.removeEventListener('keydown', echap, true); if (avant && avant.isConnected && avant.focus) avant.focus(); if (relire) await o.redraw(); };
    const echap = (ev) => { if (ev.key === 'Escape' && Z.etat !== 'envoi') { ev.stopPropagation(); void fermer(Z.etat === 'fait'); } };
    const annonce = el('p', { class: 'tjd-msg', role: 'status', 'aria-live': 'assertive', 'data-f': 'rec-annonce' });
    const corps = el('div', { class: 'tjd-dlg-c' });
    const envoyer = async () => {
      Z.etat = 'envoi'; annonce.className = 'tjd-msg'; annonce.textContent = mot('envoi'); corps.querySelectorAll('button,input').forEach((b) => { b.disabled = true; });
      let r; try { r = await o.post('recommencer', { autorisation: p.autorisation, ...(auto ? { phrase: Z.saisie } : {}) }, true); } catch (e) { r = { ok: false, text: String(e && e.message || 'connexion indisponible') }; }
      if (r && r.ok !== false && !r.error) {
        Z.etat = 'fait'; o.note(r);
        corps.replaceChildren(el('p', { class: 'tjd-msg ok' }, ic('check', 16), ' ', mot('rec.fait')), el('p', { class: 'tj-note' }, String(r.text || '')),
          el('div', { class: 'tj-btns' }, el('button', { class: 'tj-pill pri tjd-b', type: 'button', 'data-f': 'rec-fermer', onclick: () => fermer(true) }, mot('rec.fermer'))));
        corps.querySelector('button')?.focus();
      } else {
        Z.etat = 'erreur'; annonce.className = 'tjd-msg ko'; annonce.textContent = mot('rec.erreur', { raison: String((r && (r.text || r.error)) || 'refusé') }); corps.querySelectorAll('button,input').forEach((b) => { b.disabled = false; });
        if (bouton) bouton.disabled = !phraseOk(Z.saisie, attendue);
      }
    };
    let bouton = null;
    if (auto) {
      const remplir = el('span', { class: 'tjd-remplir' });
      bouton = el('button', { type: 'button', class: 'tjd-appui', 'data-f': 'rec-appui', disabled: true, 'aria-describedby': 'tjd-rec-aide' }, remplir, el('span', { class: 'tx' }, ic('alert', 16), mot('appui', { nom: p.nom })));
      const etat = el('span', { class: 'tjd-msg', role: 'status' });
      const aide = el('small', { class: 'tjd-msg', id: 'tjd-rec-aide' }, mot('appui.ferme'));
      const champ = el('input', { class: 'tj-in', id: 'tjd-rec-phrase', 'data-f': 'rec-phrase', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
      champ.addEventListener('input', () => {
        Z.saisie = String(champ.value || ''); const ok = phraseOk(Z.saisie, attendue);
        etat.className = `tjd-msg${ok ? ' ok' : ''}`; etat.textContent = Z.saisie ? mot(ok ? 'phrase.ok' : 'phrase.ko') : '';
        bouton.disabled = !ok || Z.etat === 'envoi'; aide.textContent = mot(ok ? 'appui.aide' : 'appui.ferme');
      });
      const commencer = (ev) => {
        if (bouton.disabled || Z.appui.minuteur) return;
        if (ev && ev.preventDefault) ev.preventDefault();
        Z.appui = { debut: Date.now(), minuteur: 0 }; let dit = -1;
        Z.appui.minuteur = setInterval(() => {
          const ms = Date.now() - Z.appui.debut;
          remplir.style.width = `${Math.min(100, (ms / APPUI()) * 100)}%`;
          const reste = Math.max(0, Math.ceil((APPUI() - ms) / 1000)); if (reste !== dit && reste > 0) { dit = reste; annonce.className = 'tjd-msg'; annonce.textContent = mot('appui.encore', { s: reste }); }
          if (peutLancer({ phraseOk: phraseOk(Z.saisie, attendue), appuiMs: ms })) { clearInterval(Z.appui.minuteur); Z.appui = { debut: 0, minuteur: 0 }; void envoyer(); }
        }, 50);
      };
      const lacher = () => { if (!Z.appui.minuteur) return; clearInterval(Z.appui.minuteur); Z.appui = { debut: 0, minuteur: 0 }; remplir.style.width = '0'; annonce.className = 'tjd-msg'; annonce.textContent = mot('appui.lache'); };
      bouton.addEventListener('pointerdown', commencer);
      for (const t of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) bouton.addEventListener(t, lacher);
      bouton.addEventListener('keydown', (ev) => { if ((ev.key === ' ' || ev.key === 'Enter') && !ev.repeat) commencer(ev); else if ((ev.key === ' ' || ev.key === 'Enter') && ev.preventDefault) ev.preventDefault(); });
      bouton.addEventListener('keyup', (ev) => { if (ev.key === ' ' || ev.key === 'Enter') lacher(); });
      bouton.addEventListener('contextmenu', (ev) => { if (ev.preventDefault) ev.preventDefault(); });
      corps.append(el('p', {}, mot('rec.texte')),
        el('label', { for: 'tjd-rec-phrase', class: 'tjd-lb' }, mot('phrase.titre'), ' ', el('code', { 'data-phrase': attendue, translate: 'no' }, attendue)),
        el('div', { class: 'tjd-row' }, champ, bouton), etat, aide, annonce,
        el('div', { class: 'tj-btns', style: 'margin-top:10px' }, el('button', { class: 'tj-pill n tjd-b', type: 'button', 'data-f': 'rec-annuler', onclick: () => fermer(false) }, mot('rec.fermer'))));
    } else {
      corps.append(el('p', {}, mot('rec.menu', { sys: lot.isoNom })), annonce,
        el('div', { class: 'tj-btns' }, el('button', { class: 'tj-pill pri tjd-b', type: 'button', 'data-f': 'rec-menu', onclick: () => void envoyer() }, mot('rec.menu.bouton')), el('button', { class: 'tj-pill n tjd-b', type: 'button', 'data-f': 'rec-annuler', onclick: () => fermer(false) }, mot('rec.fermer'))));
    }
    const boite = el('div', { class: 'tjd-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tjd-rec-t' }, el('h3', { id: 'tjd-rec-t' }, mot('rec.titre', { nom: p.nom })), el('p', { class: 'tj-note', style: 'margin-top:0' }, [p.mac, lot.isoNom].filter(Boolean).join(' · ')), corps);
    const fond = el('div', { class: 'tjd-fond', id: 'tjdRec', onclick: (ev) => { if (ev.target === fond && Z.etat !== 'envoi') void fermer(Z.etat === 'fait'); } }, boite);
    // La fenêtre prend les couleurs de la page de Genèse (elle est posée sur le document, hors de la page).
    if (page && typeof getComputedStyle === 'function') { const cs = getComputedStyle(page); for (const v of ['--ta', '--tok', '--tbad', '--twarn', '--tblue']) { const x = cs.getPropertyValue(v); if (x) fond.style.setProperty(v, x.trim()); } }
    document.body.append(fond); if (document.addEventListener) document.addEventListener('keydown', echap, true);
    // Quitter la page de Genèse (une autre page d'Odin) : la fenêtre se ferme, rien n'est envoyé, aucun minuteur ne reste.
    Z.garde = setInterval(() => { if (page && !page.isConnected && Z.etat !== 'envoi') void fermer(false); }, 500);
    (corps.querySelector('input') || corps.querySelector('button'))?.focus();
  }
  /** Le déploiement à montrer : celui choisi, sinon un en cours, sinon le plus récent s'il a fini depuis moins de 24 h. */
  function lotAMontrer(lots, maintenant) {
    if (E.lot) { const l = lots.find((x) => x.lot === E.lot); if (l) return l; }
    const actif = lots.find((l) => !l.fini); if (actif) return actif;
    const l0 = lots[0]; if (!l0) return null;
    const dernier = Math.max(l0.cree, ...l0.pcs.map((p) => p.finA ?? 0));
    return maintenant - dernier < 864e5 ? l0 : null;
  }
  async function deploiement(root, o) {
    const r = await o.post('deploiement_suivi', {});
    if (!r || r.ok === false || !r.data) return { macs: new Set(), montre: false, suspendre: false };
    const D = r.data, lots = Array.isArray(D.lots) ? D.lots : [], maintenant = Number(D.maintenant) || Date.now(), lot = lotAMontrer(lots, maintenant);
    if (!lot) vide(root, o); else if (lot.fini) fin(root, o, lot, maintenant); else enCours(root, o, lot, maintenant, D.suspendu);
    const autres = lots.filter((l) => !lot || l.lot !== lot.lot);
    if (autres.length) {
      const { el } = o;
      root.append(el('div', { class: 'tj-w' }, el('h3', {}, mot('recents')),
        ...autres.slice(0, 5).map((l) => el('div', { class: 'tj-li' }, el('time', {}, jour(l.cree)), el('b', {}, l.isoNom), el('span', {}, `${mot('recent.prets', { ok: l.chiffres.prets, s: l.chiffres.prets > 1 ? 's' : '', n: l.chiffres.total })}${l.fini ? '' : mot('recent.cours')}`),
          el('button', { class: 'tj-pill n pt', type: 'button', onclick: () => { E.lot = l.lot; E.dep = ''; E.annule = ''; o.redraw(); } }, mot('voir')))),
        lot && E.lot ? el('button', { class: 'tj-pill n pt', type: 'button', style: 'margin-top:8px', onclick: () => { E.lot = ''; o.redraw(); } }, mot('plus.recent')) : null));
    }
    const macs = new Set(lot && !lot.fini ? lot.pcs.map((p) => p.mac).filter(Boolean) : []);
    return { macs, montre: true, suspendre: Boolean(lot && !lot.fini) };
  }

  async function installations(root, o) {
    const { el, ic, post } = o, U = outils(o), D = (await post('suivi')).data ?? {}, c = D.chiffres ?? {};
    if (D.suspendu) root.append(el('div', { class: 'tj-ban', role: 'status' }, ic('alert', 18), el('span', {}, el('b', {}, 'Nouvelles installations suspendues'), ` depuis le ${jour(D.suspendu.at)}. Chaque poste voit le message et démarre sur son disque ; celles déjà lancées finissent.`), el('button', { class: 'tj-pill pri', type: 'button', onclick: (e) => U.faire(e.currentTarget, 'reprendre', {}) }, ic('play', 14), 'Reprendre')));
    // Le déploiement d'abord (lot S7) ; ses PC en cours ne sont pas répétés plus bas.
    const dep = await deploiement(root, o), postes = (D.postes ?? []).filter((p) => !dep.macs.has(p.mac));
    if (E.ouvert && postes.some((p) => p.mac === E.ouvert)) { const f = (await post('poste', { mac: E.ouvert })).data; if (f) E.fiche = f; }
    if (dep.montre) root.append(el('h3', { class: 'tjd-autres' }, mot('autres')));
    if (!dep.montre) root.append(el('div', { class: 'tj-k' },
      el('div', { style: 'background:color-mix(in srgb,var(--tblue) 14%,transparent)' }, el('b', {}, String(c.enCours ?? 0)), el('span', {}, `installation${(c.enCours ?? 0) > 1 ? 's' : ''}`, el('br'), 'en cours')),
      el('div', { style: 'background:color-mix(in srgb,var(--tok) 14%,transparent)' }, el('b', {}, String(c.reussies ?? 0)), el('span', {}, `terminée${(c.reussies ?? 0) > 1 ? 's' : ''}`, el('br'), 'depuis 24 h')),
      el('div', { style: 'background:color-mix(in srgb,var(--twarn) 14%,transparent)' }, el('b', {}, String(c.rates ?? 0)), el('span', {}, 'échouée(s) ou', el('br'), 'abandonnée(s), 24 h')),
      el('div', { style: 'background:color-mix(in srgb,var(--tbad) 14%,transparent)' }, el('b', {}, String(c.bloques ?? 0)), el('span', {}, `poste${(c.bloques ?? 0) > 1 ? 's' : ''}`, el('br'), `bloqué${(c.bloques ?? 0) > 1 ? 's' : ''}`))));
    const lances = postes.filter((p) => p.lancee), menu = postes.filter((p) => p.enCours && !p.lancee), finis = postes.filter((p) => !p.enCours);
    root.append(el('div', { class: 'tj-w' }, el('h3', {}, 'Installations en cours', el('small', {}, `${lances.length} poste${lances.length > 1 ? 's' : ''}`), lances.length ? el('span', { class: 'r tj-live' }, 'en direct') : null),
      ...lances.map((p) => cartePoste(o, p)), lances.length ? null : el('p', { class: 'tj-empty' }, dep.macs.size ? 'Aucune autre installation en cours.' : 'Aucune installation en cours.'),
      el('div', { class: 'tj-btns', style: 'margin-top:12px' }, D.suspendu || dep.suspendre ? null : el('button', { class: 'tj-pill n tjd-b', type: 'button', onclick: (e) => U.faire(e.currentTarget, 'suspendre', {}) }, 'Suspendre les nouvelles installations'),
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
    /** Pour les essais : les textes, et quel déploiement est montré. */
    MOTS, lotAMontrer, texteDisque, etat: E,
    async dessiner(racine, onglet, o) {
      if (!document.getElementById('tjSuiviCss')) { const st = document.createElement('style'); st.id = 'tjSuiviCss'; st.textContent = CSS; document.head.append(st); }
      // La page se relit toutes les 5 s : le bouton qui avait le focus (clavier) le retrouve après la relecture.
      const f = document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-f') : null;
      if (onglet === 'historique') await historique(racine, o); else if (onglet === 'protection') await protection(racine, o); else await installations(racine, o);
      if (f && /^(annuler|deroulement|recommencer|bloquer)/.test(f)) setTimeout(() => { const a = document.activeElement; if ((!a || a === document.body) && !document.getElementById('tjdRec')) document.querySelector(`.tj [data-f="${f}"]`)?.focus(); }, 0);
    },
  };
})();
