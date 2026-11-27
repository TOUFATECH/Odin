// La source des widgets branchée sur le vrai Odin : ce que « la donnée d'un widget » (index.ts) peut lire. Une source
// par lecture de page : chaque appli n'est lue qu'une fois, même si plusieurs widgets la montrent.
import type { Valhalla } from '../service.ts';
import type { View } from '../types.ts';
import { meteoAncienne, regionActuelle, weather } from '../modules/gladsheim.ts';
import { sitesVeille } from '../modules/idunn.ts';
import { rendezVousAVenir } from '../modules/frigg.ts';
import { history } from '../modules/volva.ts';
import { etatSauvegardes } from '../modules/sindri.ts';
import { pubsBloquees } from '../modules/vidarr.ts';
import { fuseauOdin } from '../../draupnir/rythme.ts';
import { draupnirOf } from '../../tools/draupnir.ts';
import { talosGet } from '../../web/talos-api.ts';
import type { SourceWidget } from './sorte.ts';
import { join } from 'node:path';
import { fichierEpingles, lireEpingles, traiterEpingles } from '../../web/epingles-api.ts';
import { agissant } from '../sso/acces.ts';
import { PROPRIETAIRE } from '../snotra/partout.ts';
import { DEFAULT_LIMITS } from '../eir/collect.ts';
import { lireDernier } from '../durinn/suivi.ts';
import { posteDe } from '../postes.ts';
import { homeDevices, homeScenes, sceneRisk } from '../modules/midgard.ts';
import { cameraNames } from '../modules/himinbjorg.ts';
import { isIP } from 'node:net';
import { NETWORK, isPaused, state as etatAriane, throughput } from '../ran.ts';
import { appareilsReseauBranches, reseauEntierLu } from './reseau.ts';
import { paroleOf } from '../parole.ts';
import { aEcouter, enCours } from '../modules/aegir.ts';
import { conversationsBranchees } from './medias.ts';

const s = (v: unknown) => String(v ?? '');

export function sourceOdin(v: Valhalla, maintenant: () => number = Date.now): SourceWidget {
  const vues = new Map<string, Promise<View | null>>();
  let alertes: Array<{ appli: string }> | undefined, aVoir: ReturnType<NonNullable<SourceWidget['alertesAVoir']>> | undefined;
  let automatismes: ReturnType<NonNullable<SourceWidget['automatismes']>> | undefined;
  let stockage: ReturnType<NonNullable<SourceWidget['stockage']>> | undefined;
  let appareilsMaison: ReturnType<NonNullable<SourceWidget['appareilsMaison']>> | undefined;
  // Une appli désactivée (Applis) n'est pas là pour un widget.
  const appli = (id: string) => { const m = v.module(id); return m && m.id === id && v.estActive(m.id) ? m : undefined; };
  return {
    appli: (id) => { const m = appli(id); return m ? { id: m.id, name: m.name, family: m.family } : undefined; },
    vue: (id) => {
      const m = appli(id); if (!m) return Promise.resolve(null);
      if (!vues.has(id)) vues.set(id, Promise.resolve().then(() => m.view(v.ctx(id), new URLSearchParams())).catch(() => null));
      return vues.get(id)!;
    },
    action: (id, action, input) => {
      if (!appli(id)) return undefined;
      const f = v.action(id, action); if (!f || f.m.id !== id) return undefined;
      const ctx = v.ctx(f.m.id), seul = typeof f.a.proprietaireSeul === 'function' ? f.a.proprietaireSeul(input, ctx) : f.a.proprietaireSeul === true;
      return { label: f.a.label, grave: Boolean(f.a.grave?.(input, ctx)), proprietaireSeul: seul };
    },
    meteo: async () => {
      const w = await weather(v.ctx('gladsheim')); if (!w) return undefined;
      const a = meteoAncienne();
      return { donnee: { ...w }, at: w.at, ancien: a.ancien, motif: a.motif };
    },
    lieu: () => {
      const g = v.ctx('gladsheim');
      return { choisi: Boolean(s(g.settings.ville)), nom: s(g.settings.villeNom) || s(g.settings.ville), fuseau: s(g.settings.fuseau), heure12: regionActuelle(g).heure === '12h' };
    },
    maintenant,
    // Les alertes pas encore vues, lues comme une appli les lit (le contexte de Hestia, pas le journal entier) : au nom
    // d'un membre, Valhalla retire déjà celles de Sphinx qui ne sont pas de son appareil. Rien que l'appli de chacune.
    alertesNonVues: () => (alertes ??= v.ctx('gladsheim').alerts({ limit: Number.MAX_SAFE_INTEGER }).filter((a) => !a.ack).map((a) => ({ appli: a.module }))),
    // La liste des mêmes alertes : rien que ce qu'elle montre (ni le détail, ni les données d'une alerte).
    alertesAVoir: () => (aVoir ??= v.ctx('gladsheim').alerts({ limit: Number.MAX_SAFE_INTEGER }).filter((a) => !a.ack)
      .map((a) => ({ id: a.id, appli: a.module, nomAppli: v.module(a.module)?.name ?? a.module, titre: s(a.title), niveau: s(a.level), at: Date.parse(a.at) || 0 }))),
    // Les sites d'Arachné, si elle est là et activée.
    sitesVeille: () => (appli('idunn') ? sitesVeille(v.ctx('idunn')) : undefined),
    // Les rendez-vous de Chronos et les recherches de Pythie, si elles sont là et activées (au propriétaire seul : listes.ts).
    rendezVous: () => { if (!appli('frigg')) return undefined; const f = s(v.ctx('gladsheim').settings.fuseau); return { fuseau: fuseauOdin(f), liste: rendezVousAVenir(v.ctx('frigg'), f) }; },
    recherches: () => (appli('volva') ? history(v.ctx('volva')).map((h) => ({ id: s(h.id), q: s(h.q), at: Number(h.at) || 0 })) : undefined),
    // Les sauvegardes de Phénix et les comptes de Sphinx, s'ils sont là et activés (au propriétaire seul : listes.ts).
    sauvegardes: () => { if (!appli('sindri')) return undefined; const f = fuseauOdin(s(v.ctx('gladsheim').settings.fuseau)); return { fuseau: f, ...etatSauvegardes(v.ctx('sindri'), f) }; },
    blocages: () => { if (!appli('vidarr')) return undefined; const f = fuseauOdin(s(v.ctx('gladsheim').settings.fuseau)); return { fuseau: f, ...pubsBloquees(v.ctx('vidarr'), f) }; },
    // Le widget de n'importe quelle appli : ce que le catalogue en dit (même désactivée : elle le dit), et ses actions
    // rapides, choisies comme sa page les choisit (rapides, sans champ obligatoire). Une action dont on ne sait pas dire si
    // elle est grave est dite grave (le serveur redemande de toute façon l'accord au moment de la lancer).
    ficheAppli: (id) => {
      const m = v.module(id); if (!m || m.id !== id) return undefined;
      const grave = (a: (typeof m.actions)[number]) => { try { return Boolean(a.grave?.({}, v.ctx(m.id))); } catch { return true; } };
      return { id: m.id, name: m.name, family: m.family, what: s(m.what), active: v.estActive(m.id),
        actions: m.actions.filter((a) => a.quick !== false && !(a.params ?? []).some((p) => p.required)).map((a) => ({ id: a.id, label: s(a.label), grave: grave(a) })) };
    },
    // Les applis épinglées de qui regarde, lues comme GET /api/epingles les lit (epingles-api.ts, traiterEpingles) : celles
    // du propriétaire, ou celles du membre au nom de qui la page est lue (widgets-api.ts, auNomDe). Seulement les applis
    // qui existent dans Odin ; le droit d'un membre sur chacune est vérifié par le widget (« raccourcis », applis.ts).
    epingles: (qui) => {
      const cle = qui === 'proprietaire' ? PROPRIETAIRE : agissant()?.login;
      if (!cle || (qui === 'membre' && cle === PROPRIETAIRE)) return undefined;
      const r = traiterEpingles(lireEpingles(fichierEpingles(join(v.dir, '..'))), cle, qui === 'proprietaire', (id) => v.modules().some((m) => m.id === id));
      return r.reponse.ok ? r.reponse.epingles.filter((x) => x.startsWith('appli:')).map((x) => x.slice(6)) : undefined;
    },
    // La liste « Automatismes » de Talos, telle que sa route la rend (une fois par page), si Talos est là, activé et
    // démarré (au propriétaire seul : automatisations.ts). Une lecture qui échoue : rien.
    automatismes: () => (automatismes ??= (appli('draupnir') && draupnirOf()
      ? talosGet(undefined, '/api/draupnir/automatismes', new URLSearchParams()).then((r) => {
        const o = (r ?? {}) as { ok?: unknown; fuseau?: unknown; lignes?: unknown };
        return o.ok === true && Array.isArray(o.lignes) ? { fuseau: s(o.fuseau), lignes: o.lignes as NonNullable<Awaited<ReturnType<NonNullable<SourceWidget['automatismes']>>>>['lignes'] } : undefined;
      }).catch(() => undefined)
      : Promise.resolve(undefined))),
    // La santé de la machine d'Odin : seulement ce que Hygie a déjà rangé (aucune mesure lancée ici), les deux dernières
    // heures, et ses seuils tels que sa page les calcule (ses seuils de départ, puis ses réglages). Hygie ne lit que les
    // fichiers de Linux : ailleurs, rien n'est lu (le widget le dit).
    santeMachine: () => {
      const systeme = process.platform; if (systeme !== 'linux') return { systeme };
      const reglees = (v.ctx('eir').settings.seuils ?? {}) as Record<string, Partial<(typeof DEFAULT_LIMITS)[string]>>;
      const seuils = Object.fromEntries(['cpu', 'mem', 'fs', 'temp'].map((k) => [k, { ...DEFAULT_LIMITS[k], ...(reglees[k] ?? {}) }]));
      const m = v.metrics; if (!m) return { systeme, seuils };
      const t = maintenant(), de = t - 2 * 3_600_000, noms = m.names('eir.'), suite = (n: string) => m.points(n, de, t);
      return { systeme, seuils, mesures: { cpu: suite('eir.cpu'), mem: suite('eir.mem'), disques: noms.filter((n) => n.startsWith('eir.fs.')).map(suite), temperatures: noms.filter((n) => n.startsWith('eir.temp.')).map(suite) } };
    },
    // La dernière lecture des disques de cette machine gardée par Tirésias, sans en relancer une (sa veille la refait).
    // Tirésias ne lit pas les disques sous Windows : rien n'est lu (le widget le dit).
    disquesSante: () => {
      const systeme = process.platform; if (systeme === 'win32') return { systeme };
      const l = lireDernier<{ quand?: unknown; panne?: { quoi?: unknown }; disques?: unknown }>(v.ctx('durinn').dir, 'ici');
      return l && typeof l === 'object' ? { systeme, lecture: { quand: s(l.quand), ...(l.panne ? { panne: s(l.panne.quoi) } : {}), disques: Array.isArray(l.disques) ? l.disques : [] } } : { systeme };
    },
    // Le stockage de la machine d'Odin, lu par les lectures « Disques » et « Partages » de Pyramide telles qu'elles
    // existent (sans poste : la machine d'Odin, jamais un autre), une fois par page, si Pyramide est là et activée. Un
    // système dont Pyramide ne lit pas les disques (Windows) : rien n'est lancé. Une lecture qui échoue : rien.
    stockage: () => (stockage ??= (async () => {
      if (!appli('fensalir')) return undefined;
      const ctx = v.ctx('fensalir'), systeme = await posteDe(ctx, undefined).systeme();
      if (systeme !== 'linux' && systeme !== 'mac') return { systeme, disques: [], volumes: [], partages: [] };
      const lue = async (id: string) => { const f = v.action('fensalir', id); if (!f || f.m.id !== 'fensalir' || f.a.read !== true) throw new Error('lecture absente'); return (await f.a.run(ctx, {})).data; };
      const [d, partages] = await Promise.all([lue('disques'), lue('partages')]);
      const o = (d && typeof d === 'object' ? d : {}) as { disques?: unknown; volumes?: unknown };
      return { systeme, disques: o.disques, volumes: o.volumes, partages };
    })().catch(() => undefined)),
    // Les appareils de la maison, lus comme l'écran de la maison les lit (homeDevices de Midgard, maison-api.ts), une fois
    // par page, si Midgard est là et activée ; avec les unités d'Odin. Seulement la valeur du moment (aucun relevé gardé).
    appareilsMaison: () => (appareilsMaison ??= (appli('midgard')
      ? homeDevices(v.ctx('midgard')).then((liste) => ({ unites: regionActuelle(v.ctx('gladsheim')).unites, appareils: liste.map((x) => {
        const d = x as unknown as Record<string, unknown>, vu = Date.parse(s(d.lastSeen));
        const cles = [d.id, d.valueKey, ...(Array.isArray(d.valueKeys) ? d.valueKeys : [])].map(s).filter(Boolean).join(' ');
        // Ce qui relie une prise à sa mesure : un même sujet d'état, ou un même module Tasmota (l'adresse de son identifiant).
        const tasmota = /^tasmota_([0-9a-f]+)_/i.exec(s(d.id))?.[1], liens = [d.stateTopic, ...(Array.isArray(d.stateTopics) ? d.stateTopics : [])].map(s).filter(Boolean).map((x) => `sujet:${x}`).concat(tasmota ? [`tasmota:${tasmota.toLowerCase()}`] : []);
        return { ids: cles, piece: s(d.room), sorte: s(d.kind), etat: s(d.state), unite: s(d.unit), marche: s(d.on), arret: s(d.off), ...(typeof d.online === 'boolean' ? { enLigne: d.online } : {}), ...(Number.isFinite(vu) ? { vuA: vu } : {}), ...(liens.length ? { liens } : {}),
          // (les widgets d'un appareil : son identifiant et son nom, comme etat.rooms ; reçoit-il des ordres ?)
          id: s(d.id), nom: s(d.name), commandable: Boolean(d.commandTopic) };
      }) })).catch(() => undefined)
      : Promise.resolve(undefined))),
    // Les scènes de Midgard : le nom, le nombre d'étapes, et si elle ouvre la maison, jugé sur la scène que la route
    // lancerait pour ce nom (la première au même nom, sans tenir compte des majuscules : midgard.ts, runScene).
    scenesMaison: () => {
      if (!appli('midgard')) return undefined;
      const liste = homeScenes(v.ctx('midgard')), lancee = (nom: string) => liste.find((x) => s(x.name).toLowerCase() === nom.toLowerCase());
      return liste.map((x) => ({ nom: s(x.name), etapes: Array.isArray(x.steps) ? x.steps.length : 0, ouvre: Boolean(sceneRisk(lancee(s(x.name)))) }));
    },
    // Les caméras de Cyclope, si elle est là et activée : leurs noms seulement (cameraNames), comme l'écran de la maison.
    camerasMaison: () => (appli('himinbjorg') ? cameraNames(v.ctx('himinbjorg')).map(s) : undefined),
    // Les appareils du réseau : le registre d'Odin, par le branchement posé dans allModules (reseau.ts). Aucun balayage.
    appareilsReseau: () => appareilsReseauBranches()?.(),
    // Le débit d'Ariane, seulement si elle est là, activée, pas en pause, et qu'elle lit vraiment TOUT le réseau (un
    // point de capture en marche, aucune machine lue en plus : reseauEntierLu) : la dernière tranche complète de 10 s,
    // comme sa courbe « Débit en direct ». Une seule machine suivie, ou rien de lu : rien.
    debitReseau: () => {
      if (!appli('ran') || isPaused()) return undefined;
      const ctx = v.ctx('ran'), suivis = (Array.isArray(ctx.settings.record) ? ctx.settings.record : []).map(s).filter((x) => isIP(x) || x === NETWORK);
      if (!reseauEntierLu(suivis, NETWORK, (sc) => etatAriane(sc).sources.some((x) => x.on))) return undefined;
      const pas = 10_000, fin = Math.floor(maintenant() / pas) * pas, [b] = throughput(ctx.home, { since: fin - pas, bucketMs: pas, until: fin });
      return b ? { recu: b.entrant / (pas / 1000), envoye: b.sortant / (pas / 1000), at: fin } : undefined;
    },
    // Le moteur de parole d'Odin, le même que la mascotte (le widget « Odin » ne lui demande une phrase que selon sa règle).
    moteurParole: () => paroleOf(),
    // Apollon, si elle est là et activée : les noms de ses radios et de ses listes, et ce qu'elle a lancé (medias.ts).
    apollon: () => { if (!appli('aegir')) return undefined; const c = v.ctx('aegir'), joue = enCours(c); return { ...aEcouter(c), ...(joue ? { joue } : {}) }; },
    // Ses conversations récentes : par le branchement posé dans allModules (medias.ts).
    conversationsRecentes: () => conversationsBranchees()?.(),
  };
}
