// Gygès (Hlín) — vie privée et visibilité : où tu apparais sur Internet (moteurs de recherche, annuaires,
// revendeurs de données, réseaux sociaux, fuites connues), ce que chaque résultat montre (adresse, numéro,
// photos), son niveau de risque, comment le faire retirer (formulaire du site, demande à Google, lettre RGPD),
// le suivi des demandes et la revérification chaque mois. Pour toi, tes sociétés, et un proche seulement avec
// son accord noté. Idées de Sherlock, Maigret, WhatsMyName, SpiderFoot, PhoneInfoga, Social Analyzer et
// Blackbird ; aucun code ni aucune liste copiés.
//
// C'est une appli de DÉFENSE de sa propre vie privée. Les garde-fous sont dans le code :
//   - on ne cherche que des FICHES créées exprès (toi, tes sociétés, un proche dont l'accord est noté : qui,
//     quand, comment). Créer ou changer une fiche demande ton accord (action grave) ; sans accord noté, la fiche
//     d'un proche est refusée ; retirer l'accord efface la fiche et tout ce qui avait été trouvé ;
//   - aucune action ne prend un nom libre : elles prennent l'identifiant d'une fiche. Ni l'IA d'Odin, ni le mode
//     sans IA, ni une automatisation ne peuvent lancer une recherche sur un tiers ;
//   - pas d'énumération de comptes (ni GHunt, ni équivalent), aucun contournement de connexion, de captcha ou de
//     limite : un site qui ne répond pas clairement sans connexion donne un lien « à vérifier toi-même » ;
//   - les recherches sur le web passent par Pythie (action « brut » : sans IA, sans historique) ;
//   - tout est rangé dans le dossier de l'appli, fermé aux outils de fichiers (Heimdall) ; numéros, e-mails et
//     rues sont masqués dans les alertes, les réponses et les tableaux (« 06 •• •• •• 12 ») ; rien n'est envoyé à
//     l'IA par Gygès, et rien n'est publié nulle part.
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { createDocx } from '../../files/office.ts';
import { createPdf } from '../../files/pdf.ts';
import { isSecretFile } from '../../heimdall/policy.ts';
import { telecharger } from '../lien.ts';
import { normUrl } from '../volva/engine.ts';
import { accord, accordValide, ACCORD_MOIS, ecrire, etiquette, fiches, garderFiches, identifiants, jour, jourFr, jourLocal, lire, masqueAdresse, masqueMail, masquer, masqueTel, MAX_PROCHES, MAX_SOCIETES, plat, resumeMasque, slug, trouver, type Fiche, type Saisie } from '../hlin/fiches.ts';
import { analyser, empreinte, fusion, plusGrave, requetes, risque, voir, type Bilan, type Niveau, type Resultat } from '../hlin/traces.ts';
import { guideDe, lettre, LIENS, OBJETS, plusJours, procedure, REGLE_DELAI, reponseAvant, RESEAUX, type TypeLettre } from '../hlin/retrait.ts';
import { cleHibpValide, dnsSysteme, existe, fuitesDe, SITES, sonder, variantes, type Dns } from '../hlin/sondes.ts';
import { direPhoto, lirePhoto, POUR_RETIRER_LE_LIEU } from '../hlin/exif.ts';
import { load as coffre } from './brisingamen.ts';
import type { ActionResult, Level, ModCtx, Module, Param, Section, Tone } from '../types.ts';

const s = (v: unknown) => String(v ?? '').trim();
/** La pause entre deux recherches : les moteurs ne sont pas bousculés. Les essais la mettent à zéro. */
let pauseMs = 1500;
export function rythme(ms: number): void { pauseMs = Math.max(0, ms); }
const pause = (ms = pauseMs) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());
/** Le DNS qui sert à vérifier les noms qui imitent (celui de la machine ; un essai donne le sien). */
let dns: Dns | undefined;
export function useDns(d?: Dns): void { dns = d; }

/** Une demande de retrait suivie : envoyée le…, réponse attendue avant le…, relancée, faite ou refusée. */
export interface Demande {
  id: string; fiche: string; resultat?: string; site: string; url?: string;
  /** une lettre RGPD (effacement, opposition, accès), ou une demande faite autrement (formulaire du site, Google, opérateur) */
  type: Exclude<TypeLettre, 'relance'> | 'formulaire'; par?: string; montre: string[];
  creee: string; envoyee?: string; recue?: string; avant?: string; prolongee?: boolean; relances: string[];
  etat: 'à envoyer' | 'envoyée' | 'relancée' | 'faite' | 'refusée'; reponse?: string; note?: string; lettres: string[];
  /** rappels déjà envoyés (une seule alerte par étape) */
  rappel?: string; rappelCnil?: string;
}
const resultats = (ctx: ModCtx) => lire<Resultat[]>(ctx, 'resultats.json', []);
const demandes = (ctx: ModCtx) => lire<Demande[]>(ctx, 'demandes.json', []);
const garderResultats = (ctx: ModCtx, l: Resultat[]) => ecrire(ctx, 'resultats.json', l);
const garderDemandes = (ctx: ModCtx, l: Demande[]) => ecrire(ctx, 'demandes.json', l);
const GENRES: Record<Fiche['genre'], string> = { moi: 'toi', societe: 'société', proche: 'proche' };
const TON: Record<Niveau, Tone> = { élevé: 'mauvais', moyen: 'attention', faible: 'neutre' };
const ORDRE: Record<Niveau, number> = { élevé: 0, moyen: 1, faible: 2 };
const pl = (n: number, un: string, plusieurs = `${un}s`) => `${n} ${n > 1 ? plusieurs : un}`;
/** « te concernant », « sur TOUFATECH », « sur Sara M. » (jamais le nom entier d'un proche dans une alerte). */
const sur = (f: Fiche) => (f.genre === 'moi' ? 'te concernant' : `sur ${etiquette(f)}`);

/** La fiche qu'une action désigne (par son identifiant ou son nom exact) : elle doit exister, et l'accord d'un proche doit tenir. */
function ficheDe(ctx: ModCtx, ref: unknown, o: { pourChercher?: boolean } = {}): Fiche {
  const l = fiches(ctx), f = trouver(l, ref);
  if (!f) throw new Error(s(ref) && !/^moi$/i.test(s(ref)) ? `aucune fiche « ${s(ref).slice(0, 40)} » : Gygès ne cherche que des fiches créées exprès (toi, tes sociétés, un proche avec son accord)${l.length ? ` — fiches : ${l.map((x) => x.nom).join(', ')}` : ''}` : 'ta fiche n\'existe pas encore : remplis « Ma fiche » (ton nom, ta ville, tes numéros, tes e-mails, tes pseudos)');
  if (o.pourChercher && !accordValide(f, ctx.now())) throw new Error(`l'accord de ${etiquette(f)} a plus de ${ACCORD_MOIS} mois (ou n'est pas noté) : redemande-le-lui et note-le de nouveau (« Un proche, avec son accord »), ou retire la fiche`);
  return f;
}
/** Le résultat ou la demande qu'une action désigne : son identifiant, seul ou en tête d'un libellé de liste (« r3f9… · site »). */
const ident = (v: unknown) => s(v).split(/[\s·]/)[0];
function resultatDe(ctx: ModCtx, ref: unknown): { r: Resultat; l: Resultat[] } {
  const l = resultats(ctx), r = l.find((x) => x.id === ident(ref));
  if (!r) throw new Error('résultat introuvable : choisis-le dans la liste de l\'onglet « Résultats »');
  return { r, l };
}
function demandeDe(ctx: ModCtx, ref: unknown): { d: Demande; l: Demande[] } {
  const l = demandes(ctx), d = l.find((x) => x.id === ident(ref));
  if (!d) throw new Error('demande introuvable : choisis-la dans la liste de l\'onglet « Demandes »');
  return { d, l };
}
const ligne = (r: Resultat) => `- ${r.site || r.url} (${r.categorie}) : ${r.montre.length ? `montre ${r.montre.join(', ')}${r.details?.length ? ` (${r.details.join(', ')})` : ''}` : r.titre} · risque ${r.risque}`;

/** La clé Have I Been Pwned, relue dans le coffre (Thésauros) : jamais gardée ailleurs, jamais affichée. */
function cleFuites(ctx: ModCtx): string | undefined {
  try { return [...coffre({ dir: join(ctx.dir, '..', 'brisingamen') } as ModCtx)].reverse().find((x) => /have\s*i\s*been\s*pwned|hibp/i.test(`${x.name} ${x.url ?? ''} ${x.user ?? ''}`) && cleHibpValide(x.password))?.password?.trim(); } catch { return undefined; }
}

// ---------------------------------------------------------------- « où j'apparais » : une vérification
export type Quoi = 'tout' | 'web' | 'pseudos' | 'fuites' | 'domaines';
export interface Verif extends Bilan { erreurs: string[]; recherches: number; complet: boolean }
const enCours = new Set<string>();
const propre = (t: unknown, max: number) => String(t ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Les valeurs de la fiche qu'un texte montre, masquées (« 06 •• •• •• 12 ») : pour savoir lequel de tes numéros est visible. */
const detailsDe = (f: Fiche, texte: string, url: string) => { const v = voir(f, texte, url); return [...v.telephones.map(masqueTel), ...v.emails.map(masqueMail), ...v.adresses.map(masqueAdresse)]; };

/**
 * Cherche où une fiche apparaît, puis compare avec la fois d'avant. Quatre sources, chacune polie :
 * recherches préparées par Pythie (une à la fois, avec une pause), profils publics à ses pseudos, fuites connues
 * (avec ta clé), noms de domaine qui imitent (DNS). Rien n'est gardé en clair hors de la fiche : titres et extraits
 * sont masqués avant d'être rangés.
 */
export async function verifier(ctx: ModCtx, f: Fiche, quoi: Quoi = 'tout'): Promise<Verif> {
  if (enCours.has(f.id)) throw new Error('une recherche est déjà en cours pour cette fiche : attends qu\'elle finisse');
  if (!accordValide(f, ctx.now())) throw new Error(`l'accord de ${etiquette(f)} n'est plus valable : note-le de nouveau`);
  enCours.add(f.id);
  try {
    const quand = ctx.now().toISOString(), toutes = fiches(ctx), societe = f.genre === 'societe';
    const trouves = new Map<string, Resultat>(), sures = new Set<string>(), actuelles = new Set<string>(), erreurs: string[] = [];
    const base = (id: string, r: Omit<Resultat, 'id' | 'fiche' | 'vu' | 'revu'>): Resultat => ({ id: `r${empreinte(`${f.id}|${id}`)}`, fiche: f.id, vu: quand, revu: quand, ...r });
    const fait = (q: Quoi) => quoi === 'tout' || quoi === q;

    // 1. Le web, par Pythie : chaque recherche sort de la fiche (voir `requetes`), jamais d'un nom tapé au vol.
    const reqs = requetes(f); let recherches = 0;
    for (const q of reqs) actuelles.add(q.cle);
    if (fait('web')) for (const [k, q] of reqs.entries()) {
      if (k) await pause();
      recherches++;
      const r = await ctx.call('volva', 'brut', { question: q.q, n: 10 }, 'chercher où une fiche apparaît').catch((e: Error) => ({ ok: false, text: e.message } as ActionResult));
      const d = r.data as { sources?: Array<{ url?: unknown; title?: unknown; snippet?: unknown }>; erreurs?: string[] } | undefined;
      if (r.ok === false || !d) { erreurs.push(`Pythie : ${propre(r.text, 160)}`); continue; }
      const sources = Array.isArray(d.sources) ? d.sources : [];
      if (sources.length || !(d.erreurs ?? []).length) sures.add(q.cle); else erreurs.push(`Pythie : ${propre((d.erreurs ?? []).join(' ; '), 160)}`);
      for (const x of sources) {
        const url = propre(x.url, 600), titre = propre(x.title, 200), extrait = propre(x.snippet, 400); if (!/^https?:\/\//i.test(url)) continue;
        const a = analyser(f, { url, titre, extrait }); if (!a) continue;
        const id = `r${empreinte(`${f.id}|${normUrl(url)}`)}`, deja = trouves.get(id), details = detailsDe(f, `${titre} ${extrait}`, url);
        if (deja) {
          // La même page trouvée par deux recherches : ce qu'elle montre s'additionne, le risque le plus haut l'emporte.
          const montre = [...new Set([...deja.montre, ...a.montre])], r2 = societe ? { niveau: plusGrave(deja.risque, a.risque), raison: ORDRE[a.risque] < ORDRE[deja.risque] ? a.raison : deja.raison } : risque(a.categorie, montre, { incertain: Boolean(deja.incertain && a.incertain) });
          trouves.set(id, { ...deja, montre, details: [...new Set([...(deja.details ?? []), ...details])], par: [...new Set([...deja.par, q.cle])], risque: r2.niveau, raison: r2.raison, ...(deja.incertain && a.incertain ? {} : { incertain: undefined }) });
        } else trouves.set(id, base(normUrl(url), { genre: 'web', url, site: a.site, titre: masquer(titre, toutes).slice(0, 160), extrait: masquer(extrait, toutes).slice(0, 300), categorie: a.categorie, montre: a.montre, ...(details.length ? { details } : {}), par: [q.cle], risque: a.risque, raison: a.raison, etat: 'présent', ...(a.incertain ? { incertain: true } : {}), ...(a.officiel ? { officiel: true } : {}) }));
      }
    }

    // 2. Les pseudos : un profil public sur une liste courte de grands sites. Réponse claire seulement ; sinon le lien à ouvrir soi-même.
    const sondes = f.pseudos.flatMap((p) => SITES.map((site) => ({ p, site, cle: empreinte(`profil:${site.id}:${plat(p)}`) })));
    for (const x of sondes) actuelles.add(x.cle);
    if (fait('pseudos')) for (const [k, x] of sondes.entries()) {
      const url = x.site.profil(x.p), court = url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '').toLowerCase();
      // Un compte officiel déjà déclaré dans la fiche d'une société n'a pas à être vérifié.
      if (societe && f.comptes.some((c) => plat(c) === court)) { sures.add(x.cle); continue; }
      if (x.site.sonde && k) await pause(Math.min(pauseMs, 300));
      const etat = await sonder(ctx.fetch, x.site, x.p);
      if (etat !== 'à vérifier') sures.add(x.cle);
      if (etat === 'absent') continue;
      const r = societe ? risque('réseau social', [], { societe: true, imite: true, texte: x.p }) : risque('réseau social', ['pseudo']);
      trouves.set(`r${empreinte(`${f.id}|profil:${x.site.id}:${plat(x.p)}`)}`, base(`profil:${x.site.id}:${plat(x.p)}`, {
        genre: 'profil', url, site: court.split('/')[0], titre: `Profil « ${x.p} » sur ${x.site.nom}`, categorie: 'réseau social', par: [x.cle],
        ...(etat === 'présent' ? { extrait: `${x.site.nom} confirme qu'un profil public porte ce pseudo.`, montre: ['pseudo', ...(societe ? [] : ['photos possibles'])], risque: r.niveau, raison: r.raison, etat: 'présent' as const }
          : { extrait: `${x.site.nom} ne répond pas clairement sans connexion : ouvre le lien pour voir si ce profil existe.`, montre: [], risque: 'faible' as Niveau, raison: 'à vérifier toi-même : Odin ne passe pas les pages de connexion', etat: 'à vérifier' as const }),
      }));
    }

    // 3. Les fuites connues (Have I Been Pwned), avec ta clé ; sans clé, le lien pour vérifier toi-même.
    for (const m of f.emails) actuelles.add(empreinte(`fuite:${m}`));
    if (fait('fuites') && f.emails.length) {
      const cle = cleFuites(ctx);
      if (!cle) trouves.set(`r${empreinte(`${f.id}|fuites:lien`)}`, base('fuites:lien', { genre: 'fuite', url: LIENS.fuites, site: 'haveibeenpwned.com', titre: 'Fuites connues : à vérifier toi-même', extrait: 'Sans clé Have I Been Pwned dans le coffre, Odin ne cherche pas à ta place : ouvre le site et tape ton adresse e-mail.', categorie: 'fuite connue', montre: [], par: f.emails.map((m) => empreinte(`fuite:${m}`)), risque: 'faible', raison: 'à vérifier toi-même (ou donne ta clé Have I Been Pwned)', etat: 'à vérifier' }));
      else for (const [k, m] of f.emails.entries()) {
        if (k) await pause(pauseMs * 4);   // le service limite le nombre de demandes par minute
        const r = await fuitesDe(ctx.fetch, cle, m, (ms) => pause(Math.min(ms, pauseMs * 40)));
        if (r.etat === 'ok' || r.etat === 'aucune') sures.add(empreinte(`fuite:${m}`)); else erreurs.push(r.detail ?? 'Have I Been Pwned : erreur');
        if (r.etat === 'clé refusée') break;
        for (const x of r.fuites) {
          const grave = x.espion || x.donnees.some((d) => /mot de passe|bancaire|identité|passeport|sécurité sociale|questions secrètes|jetons|^adresse$/.test(d));
          trouves.set(`r${empreinte(`${f.id}|fuite:${x.nom}:${m}`)}`, base(`fuite:${x.nom}:${m}`, {
            genre: 'fuite', url: LIENS.fuites, site: 'haveibeenpwned.com', titre: `Fuite « ${x.titre} »${x.date ? ` (${jourFr(x.date)})` : ''}`,
            extrait: `${masqueMail(m)} fait partie de cette fuite${x.comptes ? ` (${x.comptes.toLocaleString('fr-FR')} comptes)` : ''}${x.site ? `, site ${x.site}` : ''}. Source : Have I Been Pwned (haveibeenpwned.com).`,
            categorie: 'fuite connue', montre: x.donnees.slice(0, 12), details: [masqueMail(m)], par: [empreinte(`fuite:${m}`)],
            risque: x.spam && !grave ? 'faible' : grave ? 'élevé' : 'moyen',
            raison: x.espion ? 'un logiciel espion a volé des identifiants enregistrés sur un appareil' : grave ? 'un mot de passe ou une donnée très sensible fait partie de la fuite' : x.spam ? 'ton adresse est dans une liste de spam' : 'ton adresse e-mail fait partie de cette fuite : hameçonnage ciblé possible', etat: 'présent',
          }));
        }
      }
    }

    // 4. Société : les noms de domaine qui imitent les siens (variantes fabriquées ici, existence demandée au DNS).
    const imitations = societe ? f.domaines.slice(0, 3).flatMap((d) => variantes(d, 80).filter((v) => !f.domaines.includes(v.nom)).map((v) => ({ ...v, de: d, cle: empreinte(`dns:${v.nom}`) }))) : [];
    for (const v of imitations) actuelles.add(v.cle);
    if (fait('domaines') && imitations.length) {
      const d = dns ?? dnsSysteme(), file = [...imitations];
      await Promise.all(Array.from({ length: 8 }, async () => {
        for (let v = file.shift(); v; v = file.shift()) {
          const r = await existe(d, v.nom).catch(() => undefined);
          if (!r) continue;
          sures.add(v.cle);
          if (r.existe) trouves.set(`r${empreinte(`${f.id}|domaine:${v.nom}`)}`, base(`domaine:${v.nom}`, { genre: 'domaine', url: '', site: v.nom, titre: `${v.nom} ressemble à ${v.de}`, extrait: `${v.genre} · ce nom existe${r.ip ? ` (adresse ${r.ip})` : ''}${r.mx ? ' et reçoit du courrier' : ''}.`, categorie: 'domaine qui imite', montre: [], par: [v.cle], risque: r.mx ? 'élevé' : 'moyen', raison: r.mx ? 'ce nom ressemble au tien et peut envoyer ou recevoir des e-mails : faux e-mails à ton nom possibles' : 'ce nom existe et ressemble au tien : vérifie à qui il est', etat: 'présent' }));
        }
      }));
      if (imitations.some((v) => !sures.has(v.cle))) erreurs.push('DNS : certains noms n\'ont pas pu être vérifiés (pas de réponse claire)');
    }

    const b = fusion(resultats(ctx), [...trouves.values()], { fiche: f.id, quand, sures, actuelles });
    garderResultats(ctx, b.liste);
    const complet = quoi === 'tout';
    if (complet) garderFiches(ctx, fiches(ctx).map((x) => (x.id === f.id ? { ...x, verifiee: quand } : x)));
    ctx.emit('verification', { genre: GENRES[f.genre], nouveaux: b.nouveaux.length, retires: b.retires.length, recherches });
    return { ...b, erreurs: [...new Set(erreurs)].slice(0, 6), recherches, complet };
  } finally { enCours.delete(f.id); }
}
/** Ce qui est nouveau depuis la dernière fois : une alerte (Forseti), sans aucune coordonnée en entier. */
function annoncer(ctx: ModCtx, f: Fiche, b: Bilan): void {
  if (!b.nouveaux.length) return;
  const haut = b.nouveaux.filter((r) => r.risque === 'élevé').length, moyen = b.nouveaux.filter((r) => r.risque === 'moyen').length;
  const level: Level = haut ? 'haute' : moyen ? 'moyenne' : 'info', tri = [...b.nouveaux].sort((x, y) => ORDRE[x.risque] - ORDRE[y.risque]);
  ctx.alert({
    level, key: `nouveaux:${f.id}:${jourLocal(ctx.now())}`,
    title: `${pl(b.nouveaux.length, 'nouveau résultat', 'nouveaux résultats')} ${sur(f)}${haut ? ` (${haut} à risque élevé)` : ''}`,
    detail: [...tri.slice(0, 5).map(ligne), ...(tri.length > 5 ? [`… et ${tri.length - 5} autre(s)`] : []), ...(b.retires.length ? [b.retires.length > 1 ? `${b.retires.length} résultats n'apparaissent plus : notés « retiré ».` : '1 résultat n\'apparaît plus : noté « retiré ».'] : [])].join('\n'),
    steps: ['Ouvre Gygès, onglet « Résultats » (ou « Sociétés »).', '« Comment le retirer » donne la marche à suivre pour chaque résultat.', 'Si ce n\'est pas toi (un homonyme) : « Pas moi ».'],
  });
}

// ---------------------------------------------------------------- lettres (fichiers remis par la page)
const dossierLettres = (ctx: ModCtx) => join(ctx.dir, 'lettres');
/** Écrit la lettre en trois formats (texte, Word, PDF) dans le dossier de l'appli et rend de quoi les télécharger. */
function ecrireLettre(ctx: ModCtx, d: Demande, f: Fiche, type: TypeLettre, contact: 'e-mail' | 'courrier'): Array<{ nom: string; ref: string }> {
  const aujourdhui = jourLocal(ctx.now());
  const l = lettre({ fiche: f, type, site: d.site, url: d.url, montre: d.montre, jour: aujourdhui, contact, ...(type === 'relance' ? { premiere: { type: d.type === 'formulaire' ? 'effacement' : d.type, envoyee: d.envoyee ?? aujourdhui } } : {}) });
  const dir = dossierLettres(ctx); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const nom = `lettre-${slug(type)}-${slug(d.site)}-${aujourdhui}-${d.id}`, titre = '';
  const fichiers: Array<[string, Buffer]> = [[`${nom}.txt`, Buffer.from(`${l.texte.replace(/\*\*/g, '')}\n`, 'utf8')], [`${nom}.docx`, createDocx(l.texte, titre)], [`${nom}.pdf`, createPdf(l.texte, titre)]];
  for (const [n, data] of fichiers) writeFileSync(join(dir, n), data, { mode: 0o600 });
  return fichiers.map(([n]) => ({ nom: n, ref: `lettres/${n}` }));
}
function effacerLettres(ctx: ModCtx, noms: string[]): void { for (const n of noms) { try { rmSync(join(dossierLettres(ctx), basename(n)), { force: true }); } catch { /* déjà parti */ } } }
/** Efface une fiche et tout ce qui s'y rattache : résultats, demandes, lettres. */
function effacerFiche(ctx: ModCtx, f: Fiche): { resultats: number; demandes: number } {
  const res = resultats(ctx), dem = demandes(ctx), miens = dem.filter((d) => d.fiche === f.id);
  effacerLettres(ctx, miens.flatMap((d) => d.lettres));
  garderResultats(ctx, res.filter((r) => r.fiche !== f.id)); garderDemandes(ctx, dem.filter((d) => d.fiche !== f.id));
  garderFiches(ctx, fiches(ctx).filter((x) => x.id !== f.id));
  return { resultats: res.filter((r) => r.fiche === f.id).length, demandes: miens.length };
}
const etatDemande = (d: Demande, aujourdhui: string) => (d.etat === 'envoyée' || d.etat === 'relancée') && d.avant && d.avant < aujourdhui ? `${d.etat}, délai dépassé` : d.etat;
const LIBELLE: Record<Demande['type'], string> = { effacement: 'effacement (art. 17)', opposition: 'opposition (art. 21)', 'accès': 'accès (art. 15)', formulaire: 'demande en ligne' };

/** Le début d'un fichier (les informations d'une photo sont au début ; on ne charge pas une vidéo entière). */
function debut(f: string, max = 32 * 1024 * 1024): Buffer { const fd = openSync(f, 'r'); try { const n = Math.min(statSync(f).size, max), b = Buffer.alloc(n); return b.subarray(0, readSync(fd, b, 0, n, 0)); } finally { closeSync(fd); } }

const FICHE_PARAM: Param = { key: 'fiche', label: 'Fiche (vide : la tienne)', kind: 'text', default: 'moi', help: 'Le nom d\'une fiche déjà créée : toi, une de tes sociétés, ou un proche dont l\'accord est noté.' };
const IDENTITE: Param[] = [
  { key: 'villes', label: 'Villes (où l\'on te connaît)', kind: 'text', default: '', help: 'Séparées par des virgules. Elles précisent la recherche de ton nom.' },
  { key: 'adresses', label: 'Adresses postales', kind: 'textarea', default: '', help: 'Une par ligne, avec le code postal et la ville.' },
  { key: 'telephones', label: 'Numéros de téléphone', kind: 'text', default: '', help: 'Séparés par des virgules.' },
  { key: 'emails', label: 'Adresses e-mail', kind: 'text', default: '', help: 'Séparées par des virgules.' },
  { key: 'pseudos', label: 'Pseudos (Snapchat, Instagram, TikTok…)', kind: 'text', default: '', help: 'Sans le @, séparés par des virgules.' },
];
const MOI: Param[] = [{ key: 'prenom', label: 'Prénom', kind: 'text', required: true }, { key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'autres_noms', label: 'Autres noms (naissance, usage)', kind: 'text', default: '', help: 'En entier, séparés par des virgules.' }, ...IDENTITE];
const PROCHE: Param[] = [
  { key: 'prenom', label: 'Prénom', kind: 'text', required: true }, { key: 'nom', label: 'Nom', kind: 'text', required: true },
  { key: 'accord_par', label: 'Qui a donné son accord', kind: 'text', required: true, help: 'La personne elle-même (ou son parent, pour un enfant).' },
  { key: 'accord_le', label: 'Quel jour', kind: 'text', required: true, help: 'Exemple : 12/11/2026.' },
  { key: 'accord_comment', label: 'Comment', kind: 'text', required: true, help: 'De vive voix, par message, par écrit…' },
  ...IDENTITE.map((p) => (p.key === 'villes' ? { ...p, label: 'Villes' } : p)),
];
const SOCIETE: Param[] = [
  { key: 'nom', label: 'Nom de la société', kind: 'text', required: true }, { key: 'autres_noms', label: 'Autres noms (enseigne, sigle)', kind: 'text', default: '' },
  { key: 'villes', label: 'Ville', kind: 'text', default: '' }, { key: 'domaines', label: 'Noms de domaine', kind: 'text', default: '', help: 'Tous ceux qui sont à toi, séparés par des virgules (ex. toufatech.com).' },
  { key: 'comptes', label: 'Comptes officiels', kind: 'textarea', default: '', help: 'L\'adresse de chaque profil officiel, une par ligne (ex. instagram.com/ma-societe). Les autres comptes à ce nom seront signalés.' },
  { key: 'pseudos', label: 'Pseudos de la marque', kind: 'text', default: '', help: 'Le nom utilisé sur les réseaux, pour repérer les faux comptes.' },
];
const saisieDe = (i: Record<string, unknown>): Saisie => ({ prenom: i.prenom, nom: i.nom, autres_noms: i.autres_noms, villes: i.villes, adresses: i.adresses, telephones: i.telephones, emails: i.emails, pseudos: i.pseudos, domaines: i.domaines, comptes: i.comptes });
const TYPES_LETTRE = ['effacement', 'opposition', 'accès'];
const COMMENT = ['pas moi', 'c\'est voulu', 'retiré', 'il existe', 'à suivre'];

export const hlin: Module = {
  id: 'hlin', name: 'Gygès', family: 'Sécurité',
  what: 'Ta vie privée et ta visibilité sur Internet : où tu apparais (moteurs de recherche, annuaires, revendeurs de données, réseaux sociaux, fuites connues), ce que chaque résultat montre, son niveau de risque, comment le faire retirer, et le suivi de tes demandes. Pour toi, tes sociétés, et un proche seulement avec son accord.',
  does: [
    'fiches : toi, tes sociétés, et un proche seulement si son accord est noté (qui, quand, comment) ; retirer l\'accord efface tout',
    '« où j\'apparais » : recherches préparées par Pythie (nom et ville, numéro, e-mail, pseudo, rue), classées en annuaire, revendeur de données, réseau social, presse, registre de sociétés, avis',
    'pseudos : profil public sur une liste courte de grands sites, réponse claire seulement ; sinon le lien à ouvrir toi-même (Odin ne passe ni connexion ni captcha)',
    'fuites connues de tes e-mails (Have I Been Pwned, avec ta clé rangée dans le coffre)',
    'photo envoyée : lieu caché (GPS), appareil, date',
    'pour chaque résultat : ce qu\'il montre, le niveau de risque (faible, moyen, élevé) avec la raison, et la marche à suivre pour le faire retirer',
    'lettres RGPD prêtes à signer (effacement art. 17, opposition art. 21, accès art. 15, relance), en texte, Word et PDF',
    'suivi des demandes : envoyée le, réponse attendue avant le (un mois), relance, faite ou refusée ; rappel quand le délai est dépassé, puis plainte à la CNIL',
    'revérification chaque mois : ce qui est nouveau est signalé, ce qui a disparu est noté « retiré »',
    'sociétés : fiches et avis, réseaux, faux comptes, noms de domaine qui imitent (vérifiés par DNS)',
    'numéros, e-mails et adresses toujours masqués dans les alertes ; rien n\'est publié, rien ne part vers une IA',
  ],
  // « Sherlock », « Maigret » et « Blackbird » sont aussi des séries, des films ou des chansons : écrits avec leur auteur,
  // ils n'attrapent pas « mets Sherlock sur la télé » dans le mode sans IA.
  from: ['sherlock-project/sherlock', 'soxoj/maigret', 'WhatsMyName', 'SpiderFoot', 'PhoneInfoga', 'Social Analyzer', 'antoniaci/blackbird'],
  upstream: ['sherlock-project/sherlock', 'soxoj/maigret', 'smicallef/spiderfoot', 'sundowndev/phoneinfoga', 'qeeqbox/social-analyzer', 'antoniaci/blackbird'],
  words: ['vie privée', 'vie privee', 'ma visibilité', 'ma visibilite', 'où j\'apparais', 'ou j\'apparais', 'traces sur internet', 'données personnelles', 'donnees personnelles', 'droit à l\'effacement', 'droit a l\'effacement', 'droit à l\'oubli', 'droit a l\'oubli', 'lettre rgpd', 'rgpd', 'revendeurs de données', 'faux comptes', 'gygès', 'gyges', 'hlín', 'hlin'],
  // Une photo envoyée depuis le navigateur arrive dans « photos » (copie effacée après la lecture).
  depot: (ctx) => ({ dossier: join(ctx.dir, 'photos'), ref: (nom) => `photo:${nom}` }),
  // Seules les lettres préparées par l'appli peuvent être remises à l'appareil (jamais les fiches ni les résultats).
  retrait: (ctx, ref) => { const m = /^lettres\/(lettre-[a-z0-9.-]{1,150}\.(?:txt|docx|pdf))$/.exec(ref); if (!m) return undefined; const f = join(dossierLettres(ctx), m[1]); return existsSync(f) && statSync(f).isFile() ? f : undefined; },
  actions: [
    // (« etat », pas « bilan » : pour le mode sans IA, « bilan » veut dire « vérifie », et « vérifie où j'apparais » doit lancer la recherche.)
    { id: 'etat', label: 'Où j\'apparais', what: 'Le bilan : ce qui est visible et à quel risque, les demandes en cours', read: true, external: true, words: ['où j\'apparais', 'ou j\'apparais', 'où est-ce que j\'apparais', 'j\'apparais sur internet', 'bilan de ma vie privée', 'bilan de ma visibilité', 'mes traces sur internet'], run: (ctx) => {
      const l = fiches(ctx); if (!l.length) return { text: 'Aucune fiche pour l\'instant. Commence par « Ma fiche » (ton nom, ta ville, tes numéros, tes e-mails, tes pseudos), puis lance la recherche.' };
      const res = resultats(ctx), dem = demandes(ctx), aujourdhui = jourLocal(ctx.now());
      const out = l.map((f) => {
        const p = res.filter((r) => r.fiche === f.id && r.etat === 'présent'), n = (lv: Niveau) => p.filter((r) => r.risque === lv).length;
        const tete = `${f.nom} (${GENRES[f.genre]}) : ${f.verifiee ? `${pl(p.length, 'résultat')} — ${n('élevé')} élevé, ${n('moyen')} moyen, ${n('faible')} faible · vérifié le ${jourFr(f.verifiee)}` : 'jamais vérifié : lance la recherche'}`;
        return [tete, ...[...p].sort((a, b) => ORDRE[a.risque] - ORDRE[b.risque]).slice(0, 4).map(ligne)].join('\n');
      });
      const suivies = dem.filter((d) => d.etat === 'envoyée' || d.etat === 'relancée'), retard = suivies.filter((d) => d.avant && d.avant < aujourdhui);
      return { text: [...out, `Demandes : ${suivies.length} en cours${retard.length ? `, dont ${retard.length} au délai dépassé` : ''}, ${dem.filter((d) => d.etat === 'faite').length} faite(s).`].join('\n'), data: { fiches: l.length, resultats: res.filter((r) => r.etat === 'présent').length, demandes: suivies.length } };
    } },
    { id: 'chercher', label: 'Vérifier maintenant', what: 'Cherche où une fiche apparaît (web par Pythie, pseudos, fuites connues, domaines qui imitent) et compare avec la dernière fois', external: true, words: ['vérifie où j\'apparais', 'verifie ou j\'apparais', 'cherche où j\'apparais', 'cherche ou j\'apparais', 'vérifie ma vie privée', 'vérifie ma visibilité', 'cherche mes traces sur internet'],
      params: [FICHE_PARAM, { key: 'quoi', label: 'Quoi', kind: 'select', options: ['tout', 'web', 'pseudos', 'fuites', 'domaines'], default: 'tout' }], run: async (ctx, i) => {
      const f = ficheDe(ctx, i.fiche, { pourChercher: true }), quoi = (['tout', 'web', 'pseudos', 'fuites', 'domaines'].includes(s(i.quoi)) ? s(i.quoi) : 'tout') as Quoi;
      const b = await verifier(ctx, f, quoi), p = b.liste.filter((r) => r.fiche === f.id && r.etat === 'présent'), n = (lv: Niveau) => p.filter((r) => r.risque === lv).length, liens = b.liste.filter((r) => r.fiche === f.id && r.etat === 'à vérifier').length;
      return { text: [
        `🔎 Recherche faite ${sur(f)} : ${pl(p.length, 'résultat')} (${n('élevé')} élevé, ${n('moyen')} moyen, ${n('faible')} faible) · ${pl(b.nouveaux.length, 'nouveau', 'nouveaux')} · ${pl(b.retires.length, 'retiré')}${liens ? ` · ${pl(liens, 'lien')} à vérifier toi-même` : ''}.`,
        ...[...b.nouveaux].sort((x, y) => ORDRE[x.risque] - ORDRE[y.risque]).slice(0, 8).map(ligne),
        ...(b.erreurs.length ? [`⚠ Pas tout vérifié : ${b.erreurs.join(' · ')}`] : []),
        `Ouvre l'onglet « ${f.genre === 'societe' ? 'Sociétés' : 'Résultats'} » : « ${f.genre === 'societe' ? 'Que faire' : 'Comment le retirer'} » donne la marche à suivre.`,
      ].join('\n'), data: { nouveaux: b.nouveaux.length, retires: b.retires.length, presents: p.length, erreurs: b.erreurs } };
    } },
    { id: 'resultats', label: 'Résultats', what: 'Ce qui est visible, du plus risqué au moins risqué (coordonnées masquées)', read: true, external: true, words: ['résultats de ma vie privée', 'resultats de ma vie privee', 'ce qui est visible sur moi'], params: [{ ...FICHE_PARAM, default: '', label: 'Fiche (vide : toutes)' }, { key: 'risque', label: 'À partir du risque', kind: 'select', options: ['faible', 'moyen', 'élevé'], default: 'faible' }], run: (ctx, i) => {
      const f = s(i.fiche) ? ficheDe(ctx, i.fiche) : undefined, min = ORDRE[(s(i.risque) || 'faible') as Niveau] ?? 2;
      const l = resultats(ctx).filter((r) => r.etat === 'présent' && (!f || r.fiche === f.id) && ORDRE[r.risque] <= min).sort((a, b) => ORDRE[a.risque] - ORDRE[b.risque]);
      return { text: l.length ? `${pl(l.length, 'résultat')} :\n${l.slice(0, 40).map((r) => `${ligne(r)} · ${r.id}`).join('\n')}` : 'Rien de visible pour l\'instant (ou pas encore de recherche).', data: l.slice(0, 200) };
    } },
    { id: 'demandes', label: 'Mes demandes', what: 'Le suivi des demandes de retrait : envoyée le, réponse attendue avant le, état', read: true, words: ['mes demandes de retrait', 'suivi de mes demandes de retrait', 'demandes de retrait'], run: (ctx) => {
      const l = demandes(ctx), aujourdhui = jourLocal(ctx.now());
      return { text: l.length ? l.map((d) => `- ${d.site} · ${LIBELLE[d.type]} · ${d.envoyee ? `envoyée le ${jourFr(d.envoyee)}, réponse avant le ${jourFr(d.avant ?? d.envoyee)}` : 'pas encore envoyée'} · ${etatDemande(d, aujourdhui)} · ${d.id}`).join('\n') : 'Aucune demande pour l\'instant. Depuis un résultat : « Préparer une lettre », ou note une demande faite en ligne.', data: l.map((d) => ({ id: d.id, site: d.site, type: d.type, etat: d.etat, envoyee: d.envoyee, avant: d.avant })) };
    } },
    { id: 'fiches', label: 'Mes fiches', what: 'Les fiches qu\'on peut chercher : toi, tes sociétés, tes proches (avec la date de leur accord) ; coordonnées masquées', read: true, words: ['mes fiches de vie privée', 'fiches de gygès'], run: (ctx) => {
      const l = fiches(ctx), now = ctx.now();
      return { text: l.length ? l.map((f) => `- ${f.nom} (${GENRES[f.genre]}) · ${resumeMasque(f)}${f.accord ? ` · accord de ${f.accord.par} le ${jourFr(f.accord.le)} (${f.accord.comment})${accordValide(f, now) ? '' : ' — à renouveler'}` : ''}`).join('\n') : 'Aucune fiche. Commence par « Ma fiche ».', data: l.map((f) => ({ id: f.id, genre: f.genre, nom: f.nom, verifiee: f.verifiee })) };
    } },
    { id: 'guide', label: 'Régler un réseau', what: 'Le guide court de confidentialité d\'un réseau : ce qu\'il faut changer pour ne plus être visible de tous', read: true, words: ['guide de confidentialité', 'guide de confidentialite', 'comment régler la confidentialité', 'régler la confidentialité', 'regler la confidentialite', 'passer mon compte en privé'], params: [{ key: 'reseau', label: 'Réseau', kind: 'select', options: RESEAUX, required: true }], run: (_ctx, i) => {
      const g = guideDe(s(i.reseau)); if (!g) throw new Error(`je n'ai pas de guide pour « ${s(i.reseau).slice(0, 30)} » (j'ai : ${RESEAUX.join(', ')})`);
      return { text: `${g.nom} : régler la confidentialité\n${g.etapes.map((e, k) => `${k + 1}. ${e}`).join('\n')}\nLes noms des menus peuvent changer un peu selon la version. L'aide officielle : ${g.aide}` };
    } },
    { id: 'resultat', label: 'Comment le retirer', what: 'Pour un résultat : ce qu\'il montre, pourquoi ce niveau de risque, et la marche à suivre pour le faire retirer', read: true, external: true, quick: false, params: [{ key: 'resultat', label: 'Résultat', kind: 'text', required: true }], run: (ctx, i) => {
      const { r } = resultatDe(ctx, i.resultat), f = ficheDe(ctx, r.fiche), d = demandes(ctx).find((x) => x.resultat === r.id);
      return { text: [`${r.titre}${r.url ? `\n${r.url}` : ''}`, `Genre de site : ${r.categorie}. Risque ${r.risque} : ${r.raison}.`, ...(r.montre.length ? [`Ce que ça montre : ${r.montre.join(', ')}${r.details?.length ? ` (${r.details.join(', ')})` : ''}.`] : []), ...(r.extrait ? [`Extrait : ${r.extrait}`] : []), 'Marche à suivre :', ...procedure(r, f).map((e, k) => `${k + 1}. ${e}`), ...(d ? [`Demande déjà notée : ${LIBELLE[d.type]}, ${d.etat}.`] : [])].join('\n') };
    } },
    { id: 'lettre', label: 'Préparer une lettre', what: 'Une lettre RGPD remplie avec l\'identité de la fiche, en texte, Word et PDF : effacement (art. 17), opposition (art. 21) ou accès (art. 15). La demande est notée « à envoyer ».', quick: false, words: ['prépare une lettre rgpd', 'prepare une lettre rgpd', 'lettre d\'effacement', 'lettre rgpd'],
      params: [{ key: 'resultat', label: 'Résultat', kind: 'text', default: '' }, { key: 'demande', label: 'Ou une demande déjà notée', kind: 'text', default: '' }, { key: 'type', label: 'Lettre', kind: 'select', options: TYPES_LETTRE, default: 'effacement' }, { key: 'contact', label: 'Réponse attendue par', kind: 'select', options: ['e-mail', 'courrier'], default: 'e-mail' }], run: (ctx, i) => {
      const contact = s(i.contact) === 'courrier' ? 'courrier' as const : 'e-mail' as const, type = (TYPES_LETTRE.includes(s(i.type)) ? s(i.type) : 'effacement') as Exclude<TypeLettre, 'relance'>;
      const dem = demandes(ctx); let d: Demande | undefined;
      if (s(i.demande)) d = demandeDe(ctx, i.demande).d;
      else {
        if (!s(i.resultat)) throw new Error('choisis le résultat pour lequel écrire (onglet « Résultats »), ou une demande déjà notée');
        const { r } = resultatDe(ctx, i.resultat);
        if (r.genre !== 'web' && r.genre !== 'profil') throw new Error(r.genre === 'fuite' ? 'une fuite ne se retire pas par une lettre : regarde « Comment le retirer »' : 'pour un nom de domaine, il n\'y a pas de lettre RGPD : regarde « Comment le retirer »');
        d = dem.find((x) => x.resultat === r.id && x.type === type && x.etat === 'à envoyer') ?? { id: `d${empreinte(`${r.id}|${type}|${ctx.now().toISOString()}`).slice(0, 8)}`, fiche: r.fiche, resultat: r.id, site: r.site, url: r.url, type, montre: r.montre, creee: ctx.now().toISOString(), relances: [], etat: 'à envoyer', lettres: [] };
      }
      const f = ficheDe(ctx, d.fiche), quelle = d.type === 'formulaire' ? type : d.type;
      const fichiers = ecrireLettre(ctx, d, f, quelle, contact);
      const suite = { ...d, lettres: [...new Set([...d.lettres, ...fichiers.map((x) => x.nom)])] };
      garderDemandes(ctx, dem.some((x) => x.id === d!.id) ? dem.map((x) => (x.id === d!.id ? suite : x)) : [...dem, suite]);
      return { text: `✉ Lettre prête pour ${d.site} : ${OBJETS[quelle]}.\nTélécharge-la (texte, Word ou PDF), relis-la, signe-la et envoie-la à l'adresse de contact du site (page « mentions légales » ou « confidentialité »). Garde une preuve de l'envoi.\nPuis note « Envoyée » dans l'onglet « Demandes » : le délai d'un mois part de là.`, data: { demande: d.id }, fichiers };
    } },
    { id: 'envoyee', label: 'Noter l\'envoi', what: 'La demande est partie : le délai de réponse (un mois) commence', quick: false, params: [{ key: 'demande', label: 'Demande', kind: 'text', required: true }, { key: 'date', label: 'Envoyée le (vide : aujourd\'hui)', kind: 'text', default: '' }, { key: 'recue', label: 'Reçue le (accusé de réception)', kind: 'text', default: '', help: 'Pour un courrier recommandé : le délai part de la réception.' }], run: (ctx, i) => {
      const { d, l } = demandeDe(ctx, i.demande), aujourdhui = jourLocal(ctx.now()), envoyee = s(i.date) ? jour(i.date) : aujourdhui, recue = s(i.recue) ? jour(i.recue) : envoyee;
      if (!envoyee || !recue) throw new Error('la date n\'est pas lisible (écris 12/11/2026)');
      if (envoyee > aujourdhui || recue < envoyee) throw new Error('la date d\'envoi ne peut pas être dans le futur, ni la réception avant l\'envoi');
      const avant = reponseAvant(recue, d.prolongee);
      garderDemandes(ctx, l.map((x) => (x.id === d.id ? { ...x, etat: 'envoyée' as const, envoyee, recue, avant, rappel: undefined, rappelCnil: undefined } : x)));
      return { text: `📮 Noté : demande à ${d.site} envoyée le ${jourFr(envoyee)}. Réponse attendue avant le ${jourFr(avant)} ; je te préviens si rien n'arrive.` };
    } },
    { id: 'noter_demande', label: 'Noter une demande faite en ligne', what: 'Une demande faite autrement que par lettre (formulaire du site, Google « Résultats vous concernant », liste rouge de l\'opérateur) : pour suivre le délai', quick: false,
      params: [{ key: 'site', label: 'Site ou service', kind: 'text', required: true }, { key: 'par', label: 'Par', kind: 'select', options: ['formulaire du site', 'Google « Résultats vous concernant »', 'formulaire d\'un moteur de recherche', 'liste rouge (opérateur)', 'autre'], default: 'formulaire du site' }, { key: 'date', label: 'Faite le (vide : aujourd\'hui)', kind: 'text', default: '' }, { key: 'resultat', label: 'Résultat concerné', kind: 'text', default: '' }, { ...FICHE_PARAM }], run: (ctx, i) => {
      const site = propre(i.site, 80), aujourdhui = jourLocal(ctx.now()), envoyee = s(i.date) ? jour(i.date) : aujourdhui; if (site.length < 2) throw new Error('indique le site ou le service');
      if (!envoyee || envoyee > aujourdhui) throw new Error('la date n\'est pas lisible ou est dans le futur (écris 12/11/2026)');
      const r = s(i.resultat) ? resultatDe(ctx, i.resultat).r : undefined, f = ficheDe(ctx, r?.fiche ?? i.fiche);
      const d: Demande = { id: `d${empreinte(`${site}|${ctx.now().toISOString()}`).slice(0, 8)}`, fiche: f.id, ...(r ? { resultat: r.id, url: r.url } : {}), site, type: 'formulaire', par: propre(i.par, 60) || 'formulaire du site', montre: r?.montre ?? [], creee: ctx.now().toISOString(), envoyee, recue: envoyee, avant: reponseAvant(envoyee), relances: [], etat: 'envoyée', lettres: [] };
      garderDemandes(ctx, [...demandes(ctx), d]);
      return { text: `📮 Noté : demande à ${site} (${d.par}) faite le ${jourFr(envoyee)}. Réponse attendue avant le ${jourFr(d.avant!)} ; je te préviens si le délai est dépassé.` };
    } },
    { id: 'reponse', label: 'Noter la réponse', what: 'Le site a répondu : c\'est fait, c\'est refusé, ou il annonce qu\'il lui faut deux mois de plus', quick: false, params: [{ key: 'demande', label: 'Demande', kind: 'text', required: true }, { key: 'issue', label: 'Réponse', kind: 'select', options: ['faite', 'refusée', 'prolongée'], required: true }, { key: 'note', label: 'Note', kind: 'text', default: '' }], run: (ctx, i) => {
      const { d, l } = demandeDe(ctx, i.demande), issue = s(i.issue), aujourdhui = jourLocal(ctx.now());
      if (!['faite', 'refusée', 'prolongée'].includes(issue)) throw new Error('réponse attendue : faite, refusée ou prolongée');
      if (issue === 'prolongée') {
        const avant = reponseAvant(d.recue ?? d.envoyee ?? aujourdhui, true);
        garderDemandes(ctx, l.map((x) => (x.id === d.id ? { ...x, prolongee: true, avant, rappel: undefined, note: propre(i.note, 200) || x.note } : x)));
        return { text: `⏳ Noté : ${d.site} prend deux mois de plus (le RGPD le permet s'il te prévient dans le premier mois). Réponse attendue avant le ${jourFr(avant)}.` };
      }
      garderDemandes(ctx, l.map((x) => (x.id === d.id ? { ...x, etat: issue as 'faite' | 'refusée', reponse: aujourdhui, note: propre(i.note, 200) || x.note } : x)));
      if (issue === 'faite') {
        if (d.resultat) garderResultats(ctx, resultats(ctx).map((r) => (r.id === d.resultat && r.etat === 'présent' ? { ...r, etat: 'retiré' as const, retire: ctx.now().toISOString(), nouveau: false } : r)));
        return { text: `✅ Noté : ${d.site} dit que c'est fait. Le résultat est noté « retiré » ; la prochaine vérification dira s'il a vraiment disparu. S'il reste dans Google : ${LIENS.googleObsolete}` };
      }
      return { text: `❌ Noté : ${d.site} refuse. Tu peux saisir la CNIL (${LIENS.cnilPlainte}) en joignant ta demande et sa réponse ; et demander aux moteurs de recherche de ne plus montrer la page (${LIENS.cnilDereferencement}).` };
    } },
    { id: 'relancer', label: 'Préparer la relance', what: 'Pas de réponse dans le délai : une lettre de relance (texte, Word, PDF) qui annonce la plainte à la CNIL', quick: false, words: ['prépare la relance', 'relance la demande de retrait'], params: [{ key: 'demande', label: 'Demande', kind: 'text', required: true }, { key: 'contact', label: 'Réponse attendue par', kind: 'select', options: ['e-mail', 'courrier'], default: 'e-mail' }], run: (ctx, i) => {
      const { d, l } = demandeDe(ctx, i.demande), aujourdhui = jourLocal(ctx.now());
      if (!d.envoyee) throw new Error('cette demande n\'est pas encore notée « envoyée » : note d\'abord la date d\'envoi');
      if (d.etat === 'faite' || d.etat === 'refusée') throw new Error(`cette demande est déjà ${d.etat}`);
      const f = ficheDe(ctx, d.fiche), fichiers = ecrireLettre(ctx, d, f, 'relance', s(i.contact) === 'courrier' ? 'courrier' : 'e-mail');
      garderDemandes(ctx, l.map((x) => (x.id === d.id ? { ...x, etat: 'relancée' as const, relances: [...x.relances, aujourdhui], lettres: [...new Set([...x.lettres, ...fichiers.map((y) => y.nom)])], rappelCnil: undefined } : x)));
      return { text: `✉ Relance prête pour ${d.site} (demande du ${jourFr(d.envoyee)}). Envoie-la ; sans réponse sous quinze jours, tu pourras saisir la CNIL : ${LIENS.cnilPlainte}`, fichiers };
    } },
    { id: 'marquer', label: 'Classer un résultat', what: 'Ce n\'est pas toi (un homonyme), c\'est voulu, c\'est retiré, le profil existe bien, ou le remettre à suivre', quick: false, params: [{ key: 'resultat', label: 'Résultat', kind: 'text', required: true }, { key: 'comme', label: 'Comme', kind: 'select', options: COMMENT, required: true }], run: (ctx, i) => {
      const { r, l } = resultatDe(ctx, i.resultat), c = s(i.comme); if (!COMMENT.includes(c)) throw new Error(`choix attendu : ${COMMENT.join(', ')}`);
      const quand = ctx.now().toISOString();
      const suite: Resultat = c === 'pas moi' || c === 'c\'est voulu' ? { ...r, etat: 'ignoré', pourquoi: c, nouveau: false } : c === 'retiré' ? { ...r, etat: 'retiré', retire: quand, nouveau: false } : c === 'il existe' ? { ...r, etat: 'présent', revu: quand, raison: r.genre === 'profil' ? 'un profil public à ce pseudo (confirmé par toi)' : r.raison, montre: r.montre.length ? r.montre : ['pseudo'] } : { ...r, etat: 'présent', pourquoi: undefined, retire: undefined };
      garderResultats(ctx, l.map((x) => (x.id === r.id ? suite : x)));
      return { text: c === 'pas moi' ? `Écarté : ${r.site} ne parle pas de toi. Il ne sera plus compté ni signalé.` : c === 'c\'est voulu' ? `Écarté : ${r.site}, c'est voulu. Il ne sera plus compté ni signalé.` : c === 'retiré' ? `Noté « retiré » : ${r.site}. La prochaine vérification dira s'il revient.` : c === 'il existe' ? `Noté : le profil existe sur ${r.site}. Il est compté dans tes résultats.` : `Remis à suivre : ${r.site}.` };
    } },
    { id: 'photo', label: 'Analyser une photo', what: 'Ce qu\'une photo dit sans qu\'on le voie : le lieu (GPS), l\'appareil, la date. La copie envoyée est effacée après la lecture.', quiet: true, quick: false, words: ['lieu caché dans la photo', 'lieu cache dans la photo', 'que révèle la photo', 'informations cachées de la photo'],
      params: [{ key: 'fichier', label: 'Photo', kind: 'text', default: '', depot: {}, help: 'Une photo de cet appareil (elle est envoyée, lue, puis effacée d\'Odin), ou son chemin sur la machine d\'Odin.' }, { key: 'lien', label: 'Ou l\'adresse d\'une image (https://…)', kind: 'text', default: '' }, { key: 'resultat', label: 'Résultat concerné', kind: 'text', default: '' }], run: async (ctx, i) => {
      const ref = s(i.fichier).split(',')[0].trim(), lien = s(i.lien); let data: Buffer, nom: string, envoye: string | undefined;
      if (ref) {
        const m = /^photo:([^/\\]{1,200})$/.exec(ref), f = m ? join(ctx.dir, 'photos', basename(m[1])) : ref;
        if (!m && (!isAbsolute(f) || isSecretFile(f))) throw new Error('envoie la photo depuis ton appareil, ou donne son chemin complet sur la machine d\'Odin');
        if (!existsSync(f) || !statSync(f).isFile()) throw new Error('photo introuvable : envoie-la de nouveau');
        data = debut(f); nom = basename(f); if (m) envoye = f;
      } else if (lien) {
        const t = await telecharger(ctx.fetch, lien, { max: 25 * 1024 * 1024, timeoutMs: 30_000 });
        data = t.data; nom = basename(t.url.pathname) || 'image';
      } else throw new Error('choisis une photo à envoyer, ou donne l\'adresse d\'une image');
      try {
        const p = lirePhoto(data), d = direPhoto(p);
        if (p.format === 'inconnu') return { ok: false, text: `${propre(nom, 80)} : je ne reconnais pas une image (JPEG, PNG, WebP, HEIC ou TIFF).${envoye ? ' (La copie envoyée à Odin est effacée.)' : ''}` };
        if (d.lieu && s(i.resultat)) { const { r, l } = resultatDe(ctx, i.resultat); garderResultats(ctx, l.map((x) => (x.id === r.id ? { ...x, montre: [...new Set([...x.montre, 'lieu (dans une photo)'])], risque: 'élevé' as Niveau, raison: 'une photo de cette page donne le lieu exact où elle a été prise' } : x))); }
        const rien = !d.lieu && !p.exif.marque && !p.exif.modele && !p.exif.date;
        return { text: [`📷 ${propre(nom, 80)} (${p.format})`, ...(rien ? ['✓ Rien de caché que je sache lire : ni lieu, ni appareil, ni date. (Beaucoup de réseaux retirent ces informations à l\'envoi ; un e-mail ou un transfert de fichier les garde.)'] : d.lignes), ...(d.lieu ? [POUR_RETIRER_LE_LIEU] : []), ...(envoye ? ['(La copie envoyée à Odin est effacée.)'] : [])].join('\n'), data: { format: p.format, lieu: d.lieu, appareil: Boolean(p.exif.marque || p.exif.modele), date: Boolean(p.exif.date) } };
      } finally { if (envoye) rmSync(envoye, { force: true }); }
    } },
    { id: 'moi', label: 'Ma fiche', what: 'Ton identité à surveiller : nom, villes, adresses, numéros, e-mails, pseudos (les tiens seulement). Elle remplace la fiche d\'avant.', quick: false, params: MOI,
      grave: () => 'enregistrer ta fiche : ces noms, numéros, e-mails et pseudos seront cherchés sur le web (ce sont bien les tiens)', run: (ctx, i) => {
      const l = fiches(ctx), old = l.find((f) => f.genre === 'moi'), now = ctx.now().toISOString();
      const f: Fiche = { id: 'moi', genre: 'moi', ...identifiants('moi', saisieDe(i)), creee: old?.creee ?? now, modifiee: now, ...(old?.verifiee ? { verifiee: old.verifiee } : {}) };
      garderFiches(ctx, [f, ...l.filter((x) => x.genre !== 'moi')]);
      return { text: `🪪 Ta fiche est ${old ? 'mise à jour' : 'créée'} : ${f.nom} · ${resumeMasque(f)}.\n${pl(requetes(f).length, 'recherche')} préparée(s). Lance « Vérifier maintenant » pour voir où tu apparais.` };
    } },
    { id: 'societe', label: 'Fiche d\'une société', what: 'Une de tes sociétés à surveiller : nom, domaines, comptes officiels. Elle remplace la fiche du même nom.', quick: false, params: SOCIETE,
      grave: (i) => `créer la fiche de la société « ${s(i.nom).slice(0, 60)} » : son nom et ses domaines seront cherchés sur le web (c'est bien une société à toi)`, run: (ctx, i) => {
      const l = fiches(ctx), id = `s-${slug(s(i.nom))}`, old = l.find((f) => f.id === id), now = ctx.now().toISOString();
      if (!old && l.filter((f) => f.genre === 'societe').length >= MAX_SOCIETES) throw new Error(`${MAX_SOCIETES} sociétés au plus`);
      const f: Fiche = { id, genre: 'societe', ...identifiants('societe', saisieDe(i)), creee: old?.creee ?? now, modifiee: now, ...(old?.verifiee ? { verifiee: old.verifiee } : {}) };
      garderFiches(ctx, [...l.filter((x) => x.id !== id), f]);
      return { text: `🏢 Fiche de ${f.nom} ${old ? 'mise à jour' : 'créée'} : ${resumeMasque(f)}.\nLance « Vérifier » sur sa carte (onglet « Sociétés ») : fiches et avis, réseaux, faux comptes, noms de domaine qui imitent.` };
    } },
    { id: 'proche', label: 'Un proche, avec son accord', what: 'La fiche d\'un proche, SEULEMENT si son accord est noté : qui l\'a donné, quel jour, comment. Sans accord, pas de fiche.', quick: false, params: PROCHE,
      grave: (i) => `noter l'accord de ${s(i.prenom).slice(0, 40)} ${s(i.nom).slice(0, 40)} et chercher ce qui est public sur cette personne (${MAX_PROCHES} proches au plus)`, run: (ctx, i) => {
      const l = fiches(ctx), now = ctx.now(), acc = accord(i, now), ids = identifiants('proche', saisieDe(i)), id = `p-${slug(ids.nom)}`, old = l.find((f) => f.id === id);
      if (!old && l.filter((f) => f.genre === 'proche').length >= MAX_PROCHES) throw new Error(`${MAX_PROCHES} proches au plus : retire l'accord d'un proche avant d'en ajouter un autre`);
      const f: Fiche = { id, genre: 'proche', ...ids, accord: acc, creee: old?.creee ?? now.toISOString(), modifiee: now.toISOString(), ...(old?.verifiee ? { verifiee: old.verifiee } : {}) };
      garderFiches(ctx, [...l.filter((x) => x.id !== id), f]);
      return { text: `🤝 Fiche de ${etiquette(f)} ${old ? 'mise à jour' : 'créée'}, avec son accord (donné par ${acc.par} le ${jourFr(acc.le)}, ${acc.comment}).\nL'accord vaut ${ACCORD_MOIS} mois ; il se retire à tout moment, et tout ce qui a été trouvé est alors effacé.` };
    } },
    { id: 'retirer_accord', label: 'Retirer l\'accord d\'un proche', what: 'Le proche ne veut plus : sa fiche, ses résultats, ses demandes et ses lettres sont effacés', quick: false, params: [{ key: 'fiche', label: 'Proche', kind: 'text', required: true }],
      grave: (i) => `effacer la fiche de « ${s(i.fiche).slice(0, 40)} », ses résultats, ses demandes et ses lettres`, run: (ctx, i) => {
      const f = ficheDe(ctx, i.fiche); if (f.genre !== 'proche') throw new Error('cette fiche n\'est pas celle d\'un proche (pour toi ou une société : « Effacer une fiche »)');
      const n = effacerFiche(ctx, f);
      return { text: `🧹 Accord retiré : la fiche de ${etiquette(f)} est effacée, avec ${pl(n.resultats, 'résultat')} et ${pl(n.demandes, 'demande')}. Odin ne cherche plus rien sur cette personne.` };
    } },
    { id: 'effacer_fiche', label: 'Effacer une fiche', what: 'Efface ta fiche ou celle d\'une société, avec ses résultats, ses demandes et ses lettres', quick: false, params: [{ key: 'fiche', label: 'Fiche', kind: 'text', required: true }],
      grave: (i) => `effacer la fiche « ${s(i.fiche).slice(0, 40)} », ses résultats, ses demandes et ses lettres`, run: (ctx, i) => {
      const f = ficheDe(ctx, i.fiche), n = effacerFiche(ctx, f);
      return { text: `🧹 Fiche ${f.genre === 'moi' ? 'effacée (la tienne)' : `de ${etiquette(f)} effacée`}, avec ${pl(n.resultats, 'résultat')} et ${pl(n.demandes, 'demande')}.` };
    } },
    { id: 'cle_fuites', label: 'Clé Have I Been Pwned', what: 'Ta clé du service Have I Been Pwned (fuites connues) : rangée dans le coffre, jamais affichée', quick: false, params: [{ key: 'cle', label: 'Clé (32 caractères)', kind: 'password', default: '', help: 'Elle se prend sur haveibeenpwned.com/API/Key (abonnement payant du service). Vide : dit seulement si une clé est rangée.' }], run: async (ctx, i) => {
      const cle = s(i.cle);
      if (!cle) return { text: cleFuites(ctx) ? 'Une clé Have I Been Pwned est rangée dans le coffre : tes e-mails sont vérifiés à chaque recherche. Elle n\'est jamais affichée.' : `Pas de clé dans le coffre. Sans clé, vérifie toi-même sur ${LIENS.fuites} (tape ton adresse e-mail).` };
      if (!cleHibpValide(cle)) throw new Error('la clé n\'a pas la bonne forme (32 caractères, chiffres et lettres de a à f)');
      const r = await ctx.call('brisingamen', 'ajouter', { nom: 'Have I Been Pwned (clé de Gygès)', identifiant: 'hibp-api-key', mot_de_passe: cle, site: 'https://haveibeenpwned.com/API/Key', coffre: 'Personnel' }, 'ranger la clé Have I Been Pwned dans le coffre');
      if (r.ok === false) throw new Error(`la clé n'a pas pu aller dans le coffre : ${propre(r.text, 160)}`);
      return { text: '🔐 Clé rangée dans le coffre (Thésauros), jamais affichée. Tes e-mails seront cherchés dans les fuites connues à chaque vérification.' };
    } },
  ],
  view(ctx) {
    const l = fiches(ctx), now = ctx.now(), aujourdhui = jourLocal(now), moi = l.find((f) => f.genre === 'moi'), res = resultats(ctx), dem = demandes(ctx);
    const nomDe = (id: string) => { const f = l.find((x) => x.id === id); return f ? (f.genre === 'moi' ? 'toi' : f.nom) : '—'; };
    const societes = new Set(l.filter((f) => f.genre === 'societe').map((f) => f.id));
    const presents = res.filter((r) => r.etat === 'présent').sort((a, b) => (ORDRE[a.risque] - ORDRE[b.risque]) || b.vu.localeCompare(a.vu));
    const n = (lv: Niveau) => presents.filter((r) => r.risque === lv).length;
    const suivies = dem.filter((d) => d.etat === 'envoyée' || d.etat === 'relancée'), retard = suivies.filter((d) => d.avant && d.avant < aujourdhui);
    const prochaine = l.filter((f) => f.verifiee).map((f) => plusJours(f.verifiee!.slice(0, 10), 30)).sort()[0];
    const quoiMontre = (r: Resultat) => `${r.montre.length ? `${r.montre.join(', ')}${r.details?.length ? ` (${r.details.join(', ')})` : ''}` : '—'}${r.titre ? ` — « ${r.titre.slice(0, 90)} »` : ''}`;
    const rang = (r: Resultat) => ({ cells: [r.url || r.site, `${r.risque}${r.nouveau ? ' · nouveau' : ''}`, quoiMontre(r), r.categorie, nomDe(r.fiche), jourFr(r.vu)], tone: TON[r.risque], actions: [{ action: 'resultat', label: societes.has(r.fiche) ? 'Que faire' : 'Comment le retirer', input: { resultat: r.id } }, { action: 'marquer', label: societes.has(r.fiche) ? 'C\'est à moi' : 'Pas moi', input: { resultat: r.id, comme: societes.has(r.fiche) ? 'c\'est voulu' : 'pas moi' } }, { action: 'marquer', label: 'Retiré', input: { resultat: r.id, comme: 'retiré' } }] });
    const carte = (f: Fiche) => ({
      title: f.nom, sub: f.genre === 'moi' ? 'toi' : f.genre === 'societe' ? 'société' : `proche · accord de ${f.accord?.par ?? '?'} le ${f.accord ? jourFr(f.accord.le) : '?'}`,
      badge: !accordValide(f, now) ? 'accord à renouveler' : f.verifiee ? `vérifiée le ${jourFr(f.verifiee)}` : 'jamais vérifiée', tone: (!accordValide(f, now) ? 'attention' : f.verifiee ? 'bon' : 'neutre') as Tone, meta: resumeMasque(f),
      actions: [...(accordValide(f, now) ? [{ action: 'chercher', label: 'Vérifier', input: f.genre === 'moi' ? {} : { fiche: f.id } }] : []), f.genre === 'proche' ? { action: 'retirer_accord', label: 'Retirer l\'accord', input: { fiche: f.id } } : { action: 'effacer_fiche', label: 'Effacer', input: { fiche: f.id } }],
    });
    const choixResultats = presents.filter((r) => !societes.has(r.fiche) && (r.genre === 'web' || r.genre === 'profil')).slice(0, 60).map((r) => `${r.id} · ${r.site} · ${r.categorie}`);
    const choixDemandes = dem.slice(-40).reverse().map((d) => `${d.id} · ${d.site} · ${LIBELLE[d.type]}`);
    const choixRelances = suivies.slice(-40).reverse().map((d) => `${d.id} · ${d.site} · envoyée le ${jourFr(d.envoyee ?? d.creee)}`);
    const sections: Section[] = [
      // ---- Moi
      { kind: 'steps', title: 'Marche à suivre', onglet: 'Moi', items: [
        { title: 'Remplis ta fiche', detail: 'Ton nom, ta ville, tes numéros, tes e-mails, tes pseudos : seulement les tiens. Ils restent sur cette machine.', done: Boolean(moi) },
        { title: 'Lance la recherche', detail: moi?.verifiee ? `Dernière recherche : le ${jourFr(moi.verifiee)}.` : 'Odin cherche où tu apparais : moteurs de recherche (par Pythie), profils à tes pseudos, fuites connues de tes e-mails.', done: Boolean(moi?.verifiee), ...(moi ? { action: 'chercher', input: {}, button: 'Chercher' } : {}) },
        { title: 'Regarde ce qui est à risque', detail: `${n('élevé')} élevé, ${n('moyen')} moyen : onglet « Résultats ». « Comment le retirer » donne la marche à suivre ; « Pas moi » écarte un homonyme.`, done: Boolean(moi?.verifiee) && n('élevé') + n('moyen') === 0 },
        { title: 'Demande le retrait', detail: 'Formulaire du site, demande à Google, ou lettre RGPD prête à signer (texte, Word, PDF).', done: dem.length > 0 },
        { title: 'Note tes demandes', detail: 'Le site a un mois pour répondre : Odin te prévient quand le délai est dépassé, puis prépare la relance.', done: dem.some((d) => d.envoyee) },
        { title: 'Revérification chaque mois', detail: prochaine ? `Prochaine : vers le ${jourFr(prochaine)}. Ce qui est nouveau t'est signalé ; ce qui a disparu est noté « retiré ».` : 'Automatique après la première recherche.', done: Boolean(prochaine) },
      ] },
      { kind: 'cards', title: 'Tes fiches', onglet: 'Moi', empty: 'Aucune fiche : remplis « Ma fiche » ci-dessous.', items: l.filter((f) => f.genre !== 'societe').map(carte) },
      { kind: 'form', title: 'Ma fiche', onglet: 'Moi', action: 'moi', submit: 'Enregistrer ma fiche', params: MOI.map((p) => ({ ...p, default: moi ? ({ prenom: moi.prenom ?? '', nom: moi.famille ?? '', autres_noms: moi.noms.join(', '), villes: moi.villes.join(', '), adresses: moi.adresses.join('\n'), telephones: moi.telephones.join(', '), emails: moi.emails.join(', '), pseudos: moi.pseudos.join(', ') } as Record<string, string>)[p.key] ?? '' : p.default })) },
      { kind: 'form', title: 'Analyser une photo', onglet: 'Moi', action: 'photo', submit: 'Lire ce qu\'elle cache', params: [{ key: 'fichier', label: 'Photo', kind: 'text', default: '', depot: {}, help: 'Envoie la photo telle qu\'elle sort de ton téléphone : Odin lit le lieu (GPS), l\'appareil et la date, puis efface sa copie.' }] },
      { kind: 'form', title: 'Régler la confidentialité d\'un réseau', onglet: 'Moi', action: 'guide', submit: 'Voir le guide', params: [{ key: 'reseau', label: 'Réseau', kind: 'select', options: RESEAUX, required: true }] },
      { kind: 'form', title: 'Un proche, avec son accord', onglet: 'Moi', action: 'proche', submit: 'Noter l\'accord et créer la fiche', params: PROCHE },
      { kind: 'form', title: 'Fuites connues : ta clé Have I Been Pwned', onglet: 'Moi', action: 'cle_fuites', submit: 'Ranger dans le coffre', params: [{ key: 'cle', label: 'Clé', kind: 'password', default: '', help: `${cleFuites(ctx) ? 'Une clé est déjà rangée dans le coffre.' : 'Pas de clé pour l\'instant.'} Sans clé : vérifie toi-même sur haveibeenpwned.com.` }] },
      { kind: 'text', title: 'Ce que Gygès ne fait jamais', onglet: 'Moi', text: `Il ne cherche que tes fiches : toi, tes sociétés, et un proche qui a dit oui (${MAX_PROCHES} au plus, accord noté et à redonner chaque année). Il ne se connecte nulle part, ne passe ni captcha ni page de connexion, et ne devine pas les comptes cachés derrière une adresse e-mail. Tes coordonnées restent sur cette machine, masquées dans les alertes, et ne sont jamais envoyées à une IA.` },
      // ---- Résultats
      { kind: 'table', title: 'Ce qui est visible', onglet: 'Résultats', columns: ['Adresse', 'Risque', 'Ce que ça montre', 'Genre de site', 'Pour', 'Vu depuis le'], empty: moi?.verifiee ? 'Rien de visible : aucun résultat ne parle de toi.' : 'Pas encore de recherche : lance « Vérifier maintenant ».', rows: presents.filter((r) => !societes.has(r.fiche)).slice(0, 80).map(rang) },
      { kind: 'table', title: 'À vérifier toi-même', onglet: 'Résultats', columns: ['Lien à ouvrir', 'Quoi', 'Pour', 'Pourquoi'], empty: 'Aucun lien en attente.', rows: res.filter((r) => r.etat === 'à vérifier').slice(0, 80).map((r) => ({ cells: [r.url, r.titre, nomDe(r.fiche), r.extrait], actions: [{ action: 'marquer', label: 'Il existe', input: { resultat: r.id, comme: 'il existe' } }, { action: 'marquer', label: 'Il n\'existe pas', input: { resultat: r.id, comme: 'pas moi' } }] })) },
      { kind: 'form', title: 'Préparer une lettre', onglet: 'Résultats', action: 'lettre', submit: 'Préparer la lettre', params: [{ key: 'resultat', label: 'Résultat', kind: 'select', options: choixResultats.length ? choixResultats : ['(aucun résultat pour l\'instant)'], required: true }, { key: 'type', label: 'Lettre', kind: 'select', options: TYPES_LETTRE, default: 'effacement', help: 'Effacement : faire retirer. Opposition : refuser la revente ou le démarchage. Accès : savoir ce que le site a sur toi et d\'où il le tient.' }, { key: 'contact', label: 'Réponse attendue par', kind: 'select', options: ['e-mail', 'courrier'], default: 'e-mail', help: 'La lettre ne donne au site que ton nom, l\'adresse de la page et de quoi te répondre.' }] },
      { kind: 'table', title: 'Retirés ou écartés', onglet: 'Résultats', columns: ['Adresse', 'État', 'Pour', 'Depuis le'], empty: 'Rien pour l\'instant.', rows: res.filter((r) => r.etat === 'retiré' || r.etat === 'ignoré').slice(-60).reverse().map((r) => ({ cells: [r.url || r.site, r.etat === 'retiré' ? 'retiré (n\'apparaît plus)' : `écarté (${r.pourquoi ?? 'par toi'})`, nomDe(r.fiche), jourFr(r.retire ?? r.revu)], tone: (r.etat === 'retiré' ? 'bon' : 'neutre') as Tone, actions: [{ action: 'marquer', label: 'Remettre à suivre', input: { resultat: r.id, comme: 'à suivre' } }] })) },
      { kind: 'text', title: 'Les trois niveaux de risque', onglet: 'Résultats', text: 'Élevé : ton adresse postale, ou ton numéro avec ton nom, sont visibles par tous ; un mot de passe a fuité. Moyen : un e-mail visible, une fiche d\'annuaire ou de revendeur de données, un profil public à ton nom. Faible : ton nom est cité (article, registre), ou c\'est peut-être un homonyme.' },
      // ---- Demandes
      { kind: 'table', title: 'Tes demandes de retrait', onglet: 'Demandes', columns: ['Site', 'Demande', 'Envoyée le', 'Réponse avant le', 'État'], empty: 'Aucune demande. Depuis l\'onglet « Résultats » : « Préparer une lettre » ; ou note ci-dessous une demande faite en ligne.',
        rows: [...dem].reverse().slice(0, 80).map((d) => ({ cells: [d.site, `${LIBELLE[d.type]}${d.par ? ` · ${d.par}` : ''}`, d.envoyee ? jourFr(d.envoyee) : '—', d.avant ? jourFr(d.avant) : '—', etatDemande(d, aujourdhui)], tone: (d.etat === 'faite' ? 'bon' : (d.etat === 'envoyée' || d.etat === 'relancée') && d.avant && d.avant < aujourdhui ? 'mauvais' : d.etat === 'refusée' ? 'attention' : 'neutre') as Tone,
          actions: d.etat === 'à envoyer' ? [{ action: 'envoyee', label: 'Envoyée aujourd\'hui', input: { demande: d.id } }] : d.etat === 'envoyée' || d.etat === 'relancée' ? [{ action: 'reponse', label: 'C\'est fait', input: { demande: d.id, issue: 'faite' } }, { action: 'reponse', label: 'Refusé', input: { demande: d.id, issue: 'refusée' } }, { action: 'reponse', label: 'Délai prolongé', input: { demande: d.id, issue: 'prolongée' } }] : [] })) },
      { kind: 'form', title: 'Préparer la relance', onglet: 'Demandes', action: 'relancer', submit: 'Préparer la relance', params: [{ key: 'demande', label: 'Demande sans réponse', kind: 'select', options: choixRelances.length ? choixRelances : ['(aucune demande envoyée pour l\'instant)'], required: true }, { key: 'contact', label: 'Réponse attendue par', kind: 'select', options: ['e-mail', 'courrier'], default: 'e-mail' }] },
      { kind: 'form', title: 'Reprendre la lettre d\'une demande', onglet: 'Demandes', action: 'lettre', submit: 'Refaire la lettre', params: [{ key: 'demande', label: 'Demande', kind: 'select', options: choixDemandes.length ? choixDemandes : ['(aucune demande pour l\'instant)'], required: true }, { key: 'contact', label: 'Réponse attendue par', kind: 'select', options: ['e-mail', 'courrier'], default: 'e-mail' }] },
      { kind: 'form', title: 'Noter une demande faite en ligne', onglet: 'Demandes', action: 'noter_demande', submit: 'Noter', params: [{ key: 'site', label: 'Site ou service', kind: 'text', required: true }, { key: 'par', label: 'Par', kind: 'select', options: ['formulaire du site', 'Google « Résultats vous concernant »', 'formulaire d\'un moteur de recherche', 'liste rouge (opérateur)', 'autre'], default: 'formulaire du site' }, { key: 'date', label: 'Faite le (vide : aujourd\'hui)', kind: 'text', default: '' }] },
      { kind: 'text', title: 'Le délai, en clair', onglet: 'Demandes', text: `${REGLE_DELAI} Plainte en ligne : ${LIENS.cnilPlainte}` },
      // ---- Sociétés
      { kind: 'cards', title: 'Tes sociétés', onglet: 'Sociétés', empty: 'Aucune société : ajoute-la ci-dessous.', items: l.filter((f) => f.genre === 'societe').map(carte) },
      { kind: 'table', title: 'Visibilité de tes sociétés', onglet: 'Sociétés', columns: ['Adresse', 'Risque', 'Quoi', 'Genre', 'Société', 'Vu depuis le'], empty: 'Rien pour l\'instant : lance « Vérifier » sur une société.', rows: presents.filter((r) => societes.has(r.fiche)).slice(0, 80).map(rang) },
      { kind: 'form', title: 'Fiche d\'une société', onglet: 'Sociétés', action: 'societe', submit: 'Enregistrer la société', params: SOCIETE },
    ];
    return {
      subtitle: l.length ? `${pl(l.length, 'fiche')} · ${pl(presents.length, 'résultat')} visible${presents.length > 1 ? 's' : ''}${n('élevé') ? `, dont ${n('élevé')} à risque élevé` : ''} · ${pl(suivies.length, 'demande')} en cours` : 'Commence par ta fiche, puis lance la recherche.',
      kpis: [{ label: 'Risque élevé', value: String(n('élevé')), tone: n('élevé') ? 'mauvais' : 'bon' }, { label: 'Risque moyen', value: String(n('moyen')), tone: n('moyen') ? 'attention' : 'bon' }, { label: 'Demandes en cours', value: String(suivies.length), tone: retard.length ? 'mauvais' : 'neutre', hint: retard.length ? `${retard.length} au délai dépassé` : '' }, { label: 'Retirés', value: String(res.filter((r) => r.etat === 'retiré').length), tone: 'bon' }],
      onglets: ['Moi', 'Résultats', 'Demandes', 'Sociétés'], sections,
    };
  },
  // Deux fois par jour : les délais dépassés, les accords à renouveler, et la revérification du mois (une fiche par passage).
  watch: { every: 12 * 3600, async run(ctx) {
    const now = ctx.now(), aujourdhui = jourLocal(now);
    // 1. Demandes : le délai légal est passé sans réponse → rappel ; relancée sans réponse quinze jours plus tard → plainte.
    let dem = demandes(ctx), change = false;
    for (const d of dem) {
      if (d.etat !== 'envoyée' && d.etat !== 'relancée') continue;
      if (d.avant && d.avant < aujourdhui && !d.rappel) {
        ctx.alert({ level: 'moyenne', key: `delai:${d.id}`, title: `Demande de retrait à ${d.site} : délai dépassé, pas de réponse`, detail: `Envoyée le ${jourFr(d.envoyee ?? d.creee)}, réponse attendue avant le ${jourFr(d.avant)} (un mois${d.prolongee ? ', porté à trois' : ''} : RGPD, article 12).`, steps: ['Si le site a répondu entre-temps : note-le dans l\'onglet « Demandes ».', 'Sinon : « Préparer la relance », et envoie-la.', `Toujours rien quinze jours après : plainte à la CNIL (${LIENS.cnilPlainte}).`], fix: { action: 'relancer', label: 'Préparer la relance', input: { demande: d.id } } });
        d.rappel = aujourdhui; change = true;
      }
      const relance = d.relances.at(-1);
      if (d.etat === 'relancée' && relance && plusJours(relance, 15) < aujourdhui && !d.rappelCnil) {
        ctx.alert({ level: 'moyenne', key: `cnil:${d.id}`, title: `Demande de retrait à ${d.site} : toujours rien après la relance`, detail: `Relancée le ${jourFr(relance)}. Tu peux saisir la CNIL : ${LIENS.cnilPlainte}`, steps: ['Rassemble la copie de ta demande, de ta relance et la preuve des envois.', 'Dépose la plainte en ligne sur le site de la CNIL.', 'Note la suite dans l\'onglet « Demandes ».'] });
        d.rappelCnil = aujourdhui; change = true;
      }
    }
    if (change) { garderDemandes(ctx, dem); dem = demandes(ctx); }
    // 2. Proches : un accord de plus de douze mois se redemande (aucune recherche tant qu'il n'est pas noté de nouveau).
    const l = fiches(ctx);
    for (const f of l) if (f.genre === 'proche' && !accordValide(f, now)) ctx.alert({ level: 'info', key: `accord:${f.id}`, title: `L'accord de ${etiquette(f)} a plus de ${ACCORD_MOIS} mois`, detail: 'Odin ne cherche plus rien sur cette personne. Redemande-lui son accord et note-le de nouveau, ou retire la fiche.' });
    // 3. La revérification du mois : la fiche vérifiée il y a le plus longtemps (trente jours au moins), une seule par passage.
    const due = l.filter((f) => f.verifiee && accordValide(f, now) && now.getTime() - Date.parse(f.verifiee) >= 30 * 864e5).sort((a, b) => a.verifiee!.localeCompare(b.verifiee!))[0];
    if (due) { const b = await verifier(ctx, due, 'tout'); annoncer(ctx, due, b); }
    // 4. Les photos envoyées et jamais lues (page fermée avant la fin) ne restent pas.
    try { const d = join(ctx.dir, 'photos'); for (const f of readdirSync(d)) { const p = join(d, f); if (now.getTime() - statSync(p).mtimeMs > 3_600_000) rmSync(p, { force: true }); } } catch { /* pas de dossier d'arrivée */ }
  } },
};
