// Les actions des pages pegase:// qui ne touchent ni aux onglets ni à Odin : agenda, import des favoris,
// cookies et données des sites, permissions, mots de passe.
import { dialog, type Session } from 'electron';
import { writeFileSync } from 'node:fs';
import { getDomain } from 'tldts-experimental';
import type { ProfilOuvert } from './profil';
import type { Favori, Espace } from '../commun/types';
import { nouvelId } from './outils';
import { versIcs, depuisIcs, type RendezVousIcs } from './ics';
import { detecter, lireChromium, lireFirefox, lireArc, type Lien } from './importer';
import { MotsDePasse, generer, copierSecret } from './motsdepasse';
import type { Synchro } from './odin';

export interface Contexte { p: ProfilOuvert; sy?: Synchro; mdp?: MotsDePasse; envoyer: (c: string, a?: unknown) => void; planifier: () => void }
type R = { fait: boolean; r?: unknown };
const fini = (r?: unknown): R => ({ fait: true, r });

const siteDe = (domaine: string) => { const d = domaine.replace(/^\./, ''); return getDomain(d) || d; };

export async function actionsPages(c: Contexte, action: string, arg: any): Promise<R> {
  const p = c.p;
  switch (action) {
    // ————— Agenda (collection « agenda », forme du contrat § 6) —————
    case 'agenda': return fini(p.base.tous<RendezVousIcs>('agenda').filter((x) => x && x.debut).sort((a, b) => a.debut.localeCompare(b.debut)));
    case 'agendaMettre': {
      const r = arg?.rdv ?? {};
      const titre = String(r.titre ?? '').trim().slice(0, 300); if (!titre) return fini({ ok: false, texte: 'Donne un titre au rendez-vous.' });
      const debut = String(r.debut ?? ''), fin = String(r.fin ?? '');
      if (Number.isNaN(Date.parse(debut)) || Number.isNaN(Date.parse(fin)) || Date.parse(fin) < Date.parse(debut)) return fini({ ok: false, texte: 'Les heures du rendez-vous ne vont pas (la fin doit venir après le début).' });
      const d: RendezVousIcs = { id: /^[A-Za-z0-9._:@-]{1,200}$/.test(String(r.id ?? '')) ? String(r.id) : nouvelId('rdv'), titre, debut, fin,
        ...(r.lieu ? { lieu: String(r.lieu).slice(0, 300) } : {}), ...(r.agenda ? { agenda: String(r.agenda).slice(0, 60) } : {}),
        ...(Number.isFinite(Number(r.rappel)) && r.rappel !== '' && r.rappel !== null && r.rappel !== undefined ? { rappel: Math.max(0, Math.round(Number(r.rappel))) } : {}),
        ...(/^#[0-9a-fA-F]{6}$/.test(String(r.couleur ?? '')) ? { couleur: String(r.couleur) } : {}), ...(r.notes ? { notes: String(r.notes).slice(0, 4000) } : {}) };
      p.mettre('agenda', d); return fini({ ok: true, id: d.id });
    }
    case 'agendaSuppr': p.suppr('agenda', String(arg?.id)); return fini(true);
    case 'agendaImporter': {
      const l = depuisIcs(String(arg?.texte ?? '').slice(0, 5_000_000));
      for (const r of l) p.mettre('agenda', r);
      return fini({ n: l.length });
    }
    case 'agendaIcs': return fini(versIcs(p.base.tous<RendezVousIcs>('agenda').filter((x) => x?.debut), `Agenda de ${p.profil().nom} (Pégase)`));
    case 'agendaExporter': {
      const r = await dialog.showSaveDialog({ title: 'Exporter l’agenda', defaultPath: 'agenda-pegase.ics', filters: [{ name: 'Agenda (iCalendar)', extensions: ['ics'] }] });
      if (r.canceled || !r.filePath) return fini(false);
      writeFileSync(r.filePath, versIcs(p.base.tous<RendezVousIcs>('agenda').filter((x) => x?.debut), `Agenda de ${p.profil().nom} (Pégase)`));
      return fini(true);
    }
    case 'aPoser': return fini(p.base.get<{ liste: any[] }>('reglages', 'agenda-a-poser')?.liste ?? []);
    case 'aPoserMettre': { const l = Array.isArray(arg?.liste) ? arg.liste.slice(0, 50).map((x: any) => ({ id: String(x.id || nouvelId('ap')), titre: String(x.titre || '').slice(0, 200), duree: Math.max(15, Math.min(600, Number(x.duree) || 60)) })) : []; p.mettre('reglages', { id: 'agenda-a-poser', liste: l }); return fini(true); }

    // ————— Import des favoris —————
    case 'importDetecter': return fini(detecter().map(({ chemin: _c, ...x }) => x));
    case 'importer': {
      const choisis = new Set<string>(Array.isArray(arg?.ids) ? arg.ids.map(String) : []);
      const l = detecter().filter((x) => choisis.has(x.id));
      let favoris = 0, espaces = 0, onglets = 0;
      const existants = new Set(p.favoris().filter((f) => f.type === 'favori').map((f) => f.url));
      for (const x of l) {
        if (x.type === 'arc') {
          for (const e of lireArc(x.chemin)) {
            let esp = p.espaces().find((y) => y.nom === e.nom);
            if (!esp) { esp = p.mettre<Espace>('espaces', { id: nouvelId('e'), nom: e.nom, couleur: (p.espaces().length) % 8, ordre: (p.espaces().at(-1)?.ordre ?? 0) + 1 }); espaces++; }
            const deja = new Set(p.ongletsRanges().filter((o) => o.espace === esp!.id).map((o) => o.url));
            let k = 0;
            for (const t of e.epingles) if (!deja.has(t.url)) { const o = p.creerOnglet(t.url, esp.id, { epingle: true, titre: t.titre }); p.mettreOnglet({ ...o, ordre: k++ }); onglets++; }
          }
          continue;
        }
        const liens: Lien[] = x.type === 'firefox' ? lireFirefox(x.chemin) : lireChromium(x.chemin);
        const racine = ajouterDossier(p, `Importés de ${x.navigateur}${l.filter((y) => y.navigateur === x.navigateur).length > 1 ? ` (${x.nom})` : ''}`);
        const dossiers = new Map<string, string>();
        for (const li of liens) {
          if (existants.has(li.url)) continue;
          existants.add(li.url);
          const cle = li.dossier.join('/');
          let d = racine;
          if (cle) { d = dossiers.get(cle) ?? ''; if (!d) { d = ajouterDossier(p, li.dossier.join(' › ').slice(0, 120), racine); dossiers.set(cle, d); } }
          p.mettre<Favori>('favoris', { id: nouvelId('f'), type: 'favori', nom: li.titre, url: li.url, dossier: d, ordre: Date.now() + favoris, tuile: false });
          favoris++;
        }
      }
      return fini({ favoris, espaces, onglets });
    }

    // ————— Cookies et données des sites (restent sur ce PC, jamais envoyés à Odin) —————
    case 'cookiesListe': {
      const tous = await p.session.cookies.get({});
      const sites = new Map<string, { site: string; n: number; taille: number; garde: boolean }>();
      const garder = new Set(p.reglages().garderSites);
      for (const k of tous) { const s = siteDe(k.domain ?? ''); const e = sites.get(s) ?? { site: s, n: 0, taille: 0, garde: garder.has(s) }; e.n++; e.taille += (k.name?.length ?? 0) + (k.value?.length ?? 0); sites.set(s, e); }
      const cache = await p.session.getCacheSize().catch(() => 0);
      return fini({ sites: [...sites.values()].sort((a, b) => b.n - a.n), total: tous.length, taille: [...sites.values()].reduce((x, y) => x + y.taille, 0), cache });
    }
    case 'cookiesSite': {
      const s = String(arg?.site ?? '');
      const l = (await p.session.cookies.get({})).filter((k) => siteDe(k.domain ?? '') === s);
      return fini(l.map((k) => ({ nom: k.name, domaine: k.domain, chemin: k.path, expire: k.expirationDate ? Math.round(k.expirationDate * 1000) : null, secure: k.secure, httpOnly: k.httpOnly, sameSite: k.sameSite, taille: (k.value ?? '').length })));
    }
    case 'cookieValeur': { // seulement au clic sur « afficher »
      const l = await p.session.cookies.get({ name: String(arg?.nom ?? '') });
      const k = l.find((x) => x.domain === arg?.domaine && x.path === arg?.chemin); return fini(k ? k.value : null);
    }
    case 'cookieSuppr': {
      const d = String(arg?.domaine ?? '').replace(/^\./, ''); const url = `http${arg?.secure ? 's' : ''}://${d}${arg?.chemin ?? '/'}`;
      await p.session.cookies.remove(url, String(arg?.nom ?? '')); return fini(true);
    }
    case 'cookiesSupprSite': {
      const s = String(arg?.site ?? ''); await supprimerSite(p.session, s); return fini(true);
    }
    case 'cookiesTout': await p.session.clearStorageData(); await p.session.clearCache(); return fini(true);
    case 'garderSite': {
      const s = String(arg?.site ?? ''); const l = new Set(p.reglages().garderSites);
      if (arg?.oui) l.add(s); else l.delete(s);
      p.mettreReglage('garderSites', [...l].slice(0, 500)); return fini(true);
    }

    // ————— Permissions des sites —————
    case 'permissionsListe': {
      const m: Map<string, boolean> = (p.session as any).__reponsesPermissions ?? new Map();
      return fini([...m.entries()].map(([k, ok]) => { const i = k.lastIndexOf('|'); return { cle: k, origine: k.slice(0, i), permission: k.slice(i + 1), ok }; }));
    }
    case 'permissionOublier': { const m: Map<string, boolean> | undefined = (p.session as any).__reponsesPermissions; m?.delete(String(arg?.cle)); return fini(true); }

    // ————— Mots de passe —————
    case 'mdpListe': return fini(c.mdp ? { ...c.mdp.liste(), verif: c.sy ? c.sy.verifierMotDePasse('') !== null : false, ouvert: c.mdp.ouvert() } : null);
    case 'mdpReveler': case 'mdpCopier': {
      if (!c.mdp) return fini({ ok: false, texte: 'Pas de mots de passe dans une fenêtre privée.' });
      if (!c.mdp.ouvert()) {
        const v = c.sy?.verifierMotDePasse(String(arg?.motdepasse ?? ''));
        if (v === null || v === undefined) return fini({ ok: false, texte: 'Crée ton compte ou relie Pégase à Odin (Réglages → Synchro Odin) : c’est ton mot de passe d’Odin qui protège l’affichage.' });
        if (!v) return fini({ ok: false, texte: 'Ce n’est pas ton mot de passe d’Odin.' });
        c.mdp.deverrouiller();
      }
      const m = c.mdp.reveler(String(arg?.id ?? '')); if (m === null) return fini({ ok: false, texte: 'Mot de passe introuvable.' });
      if (action === 'mdpCopier') { copierSecret(m); return fini({ ok: true, copie: true }); }
      return fini({ ok: true, motdepasse: m, jusqua: Date.now() + 30_000 });
    }
    case 'mdpSuppr': c.mdp?.supprimer(String(arg?.id)); return fini(true);
    case 'mdpAjouter': {
      if (!c.mdp) return fini({ ok: false });
      let o = ''; try { const u = new URL(/^https?:\/\//.test(String(arg?.site)) ? String(arg.site) : `https://${arg?.site}`); o = u.origin; } catch { return fini({ ok: false, texte: 'Adresse du site invalide.' }); }
      if (!arg?.motdepasse) return fini({ ok: false, texte: 'Mot de passe vide.' });
      c.mdp.enregistrer(o, String(arg?.identifiant ?? '').slice(0, 300), String(arg.motdepasse).slice(0, 1000)); return fini({ ok: true });
    }
    case 'mdpGenerer': { const g = generer(); if (arg?.copier) copierSecret(g); return fini(arg?.copier ? true : g); }
    case 'mdpProposition': {
      const pr = c.mdp?.proposition; if (!c.mdp || !pr) return fini();
      if (arg?.op === 'enregistrer') c.mdp.enregistrer(pr.origine, pr.identifiant, pr.motdepasse);
      if (arg?.op === 'jamais') c.mdp.jamaisPour(pr.origine);
      c.mdp.proposition = null; c.planifier(); return fini(true);
    }
    case 'mdpPlusJamais': c.mdp?.plusJamais(String(arg?.origine)); return fini(true);
  }
  return { fait: false };
}

function ajouterDossier(p: ProfilOuvert, nom: string, parent?: string): string {
  const deja = p.favoris().find((f) => f.type === 'dossier' && f.nom === nom && (f.dossier ?? '') === (parent ?? ''));
  if (deja) return deja.id;
  const d: Favori = { id: nouvelId('fd'), type: 'dossier', nom, url: '', ordre: Date.now(), ...(parent ? { dossier: parent } : {}) };
  p.mettre('favoris', d); return d.id;
}

/** Efface les cookies et les données d'un site (tous ses sous-domaines). */
export async function supprimerSite(s: Session, site: string): Promise<void> {
  const l = (await s.cookies.get({})).filter((k) => siteDe(k.domain ?? '') === site);
  const origines = new Set<string>();
  for (const k of l) { const d = (k.domain ?? '').replace(/^\./, ''); await s.cookies.remove(`http${k.secure ? 's' : ''}://${d}${k.path ?? '/'}`, k.name).catch(() => 0); origines.add(`https://${d}`); origines.add(`http://${d}`); }
  origines.add(`https://${site}`); origines.add(`https://www.${site}`); origines.add(`http://${site}`);
  for (const o of origines) await s.clearStorageData({ origin: o }).catch(() => 0);
}

/** « Effacer en fermant Pégase » : tout sauf les sites gardés. */
export async function viderEnFermant(p: ProfilOuvert): Promise<void> {
  const r = p.reglages(); if (!r.viderFermeture || p.prive) return;
  // Tous les types de données (cookies, stockage, cache, service workers…), sauf les sites gardés.
  const garder = r.garderSites.flatMap((x) => [`https://${x}`, `https://www.${x}`, `http://${x}`, `http://www.${x}`]);
  await (garder.length ? p.session.clearData({ excludeOrigins: garder }) : p.session.clearData()).catch(() => 0);
  await p.session.clearCache().catch(() => 0);
}
