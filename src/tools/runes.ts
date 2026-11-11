// Runes : pages et bases d'Odin (comme un espace de travail Notion), dans le même coffre que Saga.
//   runes_base  : bases (lister, schéma, créer, propriétés, vues, automatisations de base) ;
//   runes_fiche : fiches d'une base (chercher selon une vue ou un filtre, ajouter, modifier) ;
//   runes_page  : sous-pages, commentaires, historique.

import { wrapUntrusted } from '../heimdall/injection.ts';
import { Runes, PROP_TYPES, type Prop, type View } from '../runes/runes.ts';
import { brainOf } from './brain.ts';
import { obj, str, type Tool, type ToolContext } from './registry.ts';

const s = (v: unknown) => String(v ?? '');
const cache = new WeakMap<object, Runes>();
export function runesOf(ctx: Pick<ToolContext, 'home' | 'careCfg' | 'workspace'>): Runes { const v = brainOf(ctx); let r = cache.get(v); if (!r) { r = new Runes(v); cache.set(v, r); } return r; }
const json = (v: unknown) => { if (v && typeof v === 'object') return v as Record<string, unknown>; try { return JSON.parse(s(v) || '{}'); } catch { throw new Error('JSON invalide'); } };

export const runesBase: Tool = {
  name: 'runes_base',
  description: `Bases de données de Runes (projets, tâches, clients, commandes… avec propriétés typées : ${PROP_TYPES.join(', ')}). « lister » ; « schema » (propriétés et vues) ; « creer » (nom + proprietes JSON [{"label":"Prix","type":"nombre"}]) ; « propriete » (ajouter : propriete JSON) ; « vue » (vue JSON {name,type: table|tableau|calendrier|galerie|liste|chronologie|formulaire, groupBy, date, filters:[{prop,op,value}], sorts:[{prop,dir}]}) ; « automatisation » (JSON {when:{prop,to},then:{kind:"définir"|"prévenir",…}}) ; « exporter » (CSV).`,
  risk: 'write',
  schema: obj({ action: { type: 'string', enum: ['lister', 'schema', 'creer', 'propriete', 'vue', 'automatisation', 'exporter'] }, base: str('base (identifiant ou nom)'), nom: str('nom de la nouvelle base'), proprietes: str('JSON'), propriete: str('JSON'), vue: str('JSON'), automatisation: str('JSON') }, ['action']),
  summarize: (i) => `runes ${s(i.action)} ${s(i.base || i.nom)}`,
  lookup: (i) => ['lister', 'schema', 'exporter'].includes(s(i.action)),
  async run(i, ctx) {
    const r = runesOf(ctx), a = s(i.action);
    if (a === 'lister') return r.bases().map((b) => `- ${b.name} (id ${b.id}, dossier ${b.folder}) : ${r.rows(b.id).length} fiche(s)`).join('\n');
    if (a === 'creer') { const b = r.createBase(s(i.nom), ([] as Array<Partial<Prop> & { label: string }>).concat(i.proprietes ? json(i.proprietes) as never : [])); return `✅ Base « ${b.name} » créée (${b.props.map((p) => `${p.label}: ${p.type}`).join(', ')}).`; }
    const b = r.base(s(i.base));
    if (a === 'schema') return `${b.name}\nPropriétés : ${b.props.map((p) => `${p.label} [${p.key}] (${p.type}${p.options ? ` : ${p.options.map((o) => o.name).join('|')}` : ''}${p.formula ? ` = ${p.formula}` : ''})`).join(' ; ')}\nVues : ${b.views.map((v) => `${v.name} (${v.type}, id ${v.id})`).join(', ')}`;
    if (a === 'propriete') { const nb = r.addProp(b.id, json(i.propriete) as Partial<Prop> & { label: string }); return `✅ Propriété ajoutée à ${nb.name}.`; }
    if (a === 'vue') { const nb = r.saveView(b.id, json(i.vue) as Partial<View> & { name: string; type: View['type'] }); return `✅ Vue enregistrée (${nb.views.length} vues).`; }
    if (a === 'automatisation') { const au = json(i.automatisation); const nb = r.updateBase(b.id, { automations: [...(b.automations ?? []), { id: Math.random().toString(36).slice(2, 8), ...au } as never] }); return `✅ Automatisation de base ajoutée (${nb.automations!.length}).`; }
    if (a === 'exporter') return r.exportCsv(b.id);
    return 'action inconnue';
  },
};

export const runesRow: Tool = {
  name: 'runes_fiche',
  description: 'Fiches d\'une base Runes. « chercher » (vue = id de vue, ou filtre JSON [{"prop":"statut","op":"égal","value":"fait"}], q = texte) ; « ajouter » (titre + proprietes JSON + texte) ; « modifier » (fiche = chemin ou titre + proprietes JSON).',
  risk: 'write',
  schema: obj({ action: { type: 'string', enum: ['chercher', 'ajouter', 'modifier'] }, base: str('base'), vue: str('id de vue'), filtre: str('JSON'), q: str('texte à chercher'), titre: str('titre de la fiche'), fiche: str('chemin ou titre'), proprietes: str('JSON'), texte: str('contenu de la fiche') }, ['action']),
  summarize: (i) => `runes ${s(i.action)} ${s(i.titre || i.fiche || i.base)}`,
  lookup: (i) => s(i.action) === 'chercher',
  async run(i, ctx) {
    const r = runesOf(ctx), a = s(i.action);
    if (a === 'modifier') { const u = r.updateRow(s(i.fiche), json(i.proprietes)); return `✅ ${u.path} mis à jour${u.fired.length ? ` (${u.fired.length} automatisation(s) de base déclenchée(s))` : ''}.`; }
    const b = r.base(s(i.base));
    if (a === 'ajouter') return `✅ Fiche créée : ${r.addRow(b.id, s(i.titre) || 'Sans titre', json(i.proprietes), s(i.texte))}`;
    if (i.filtre) r.saveView(b.id, { id: '_odin', name: 'Recherche d\'Odin', type: 'table', filters: json(i.filtre) as never });
    const q = r.query(b.id, i.filtre ? '_odin' : s(i.vue) || undefined, { q: s(i.q) });
    const text = q.rows.slice(0, 50).map((x) => `- [[${x.title}]] ${Object.entries(x.values).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ')}`).join('\n') || 'Aucune fiche.';
    return q.rows.some((x) => x.meta.fiable === false) ? { output: wrapUntrusted('runes', text), tainted: true } : `${q.rows.length} fiche(s) (${q.view.name}) :\n${text}`;
  },
};

export const runesPage: Tool = {
  name: 'runes_page',
  description: 'Pages de Runes : « sous_page » (parent + titre + texte), « enfants » (parent), « commenter » (page + texte), « commentaires », « historique » (versions), « restaurer » (page + version = date en ms).',
  risk: 'write',
  schema: obj({ action: { type: 'string', enum: ['sous_page', 'enfants', 'commenter', 'commentaires', 'historique', 'restaurer'] }, page: str('page (chemin ou titre)'), parent: str('page parente'), titre: str('titre'), texte: str('texte'), version: str('date de la version (ms)') }, ['action']),
  summarize: (i) => `runes ${s(i.action)} ${s(i.page || i.parent)}`,
  lookup: (i) => ['enfants', 'commentaires', 'historique'].includes(s(i.action)),
  async run(i, ctx) {
    const r = runesOf(ctx), a = s(i.action);
    if (a === 'sous_page') return `✅ Sous-page : ${r.childPage(s(i.parent), s(i.titre), s(i.texte))}`;
    if (a === 'enfants') return r.children(s(i.parent || i.page)).map((c) => `- [[${c.title}]]`).join('\n') || 'Aucune sous-page.';
    if (a === 'commenter') { r.comment(s(i.page), 'Odin', s(i.texte)); return '✅ Commentaire ajouté.'; }
    if (a === 'commentaires') return r.comments(s(i.page)).map((c) => `- ${c.at.slice(0, 16)} ${c.by}${c.done ? ' (résolu)' : ''} : ${c.text}`).join('\n') || 'Aucun commentaire.';
    if (a === 'historique') return r.history(s(i.page)).map((h) => `- ${new Date(h.at).toLocaleString('fr-FR')} (version ${h.at})`).join('\n') || 'Pas d\'historique.';
    if (a === 'restaurer') return `✅ Version restaurée : ${r.restoreVersion(s(i.page), Number(i.version))}`;
    return 'action inconnue';
  },
};

export const RUNES_TOOLS: Tool[] = [runesBase, runesRow, runesPage];
