// Réseau, lot R1 (maquette validée le 23/11) : « propriétaire seul » et « qui a fait quoi » pour Vortex (VPN) et
// Sphinx (DNS, DHCP).
//
// - `auProprietaireSeul` : toute action qui écrit (et les lectures qui montrent un secret : QR code, fichier de
//   configuration) est réservée au propriétaire en personne. La garde est celle d'Odin (Valhalla.act) : ni une
//   automatisation, ni un autre assistant, ni un lien entre applis lancé sans lui, ni un membre, ni une conversation
//   marquée. Une seule règle, posée ici, pour tous les chemins (page, parole, outil de l'IA, Telegram, Talos, MCP).
// - `avecJournal` : chacune de ces actions laisse une ligne : qui, quoi, quand, résultat. Jamais un secret dedans :
//   seuls les réglages déclarés de l'action sont recopiés (pas ceux qui ressemblent à une clé ou un mot de passe),
//   coupés court ; une longue suite de caractères (une clé) est masquée.
// - `actionJournal` : la lecture de ce journal, elle aussi au propriétaire seul (il dit qui a touché à quoi).
import { AsyncLocalStorage } from 'node:async_hooks';
import { journalDe } from '../base/journal.ts';
import { agissant } from '../sso/acces.ts';
import type { Action, ActionResult, ModCtx } from '../types.ts';

/** Une ligne du journal : qui, quoi (l'action et ses réglages simples), quand, résultat. */
export interface Acte { t: number; qui: string; action: string; quoi: string; ok: boolean; resultat: string }

const CLE_SECRETE = /^(cle|cles|key|secret|mot_de_passe|password|pass|token|jeton|psk|priv|prive|conf|cert|certificat|qr)$/i;
const propre = (t: string, n: number) => [...t.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, '[masqué]').replace(/\s+/g, ' ').trim()].slice(0, n).join('');

/** Les réglages simples de l'action (ceux qu'elle déclare), sans rien de secret. */
function resume(a: Action, input: Record<string, unknown>): string {
  const out: string[] = [];
  for (const p of a.params ?? []) {
    if (p.kind === 'password' || CLE_SECRETE.test(p.key)) continue;
    const v = input[p.key]; if (v === undefined || v === '' || (typeof v === 'object' && v !== null)) continue;
    const t = propre(String(v), 60); if (t) out.push(`${p.key} : ${t}`);
  }
  return out.slice(0, 8).join(' · ');
}

/** Posé par le réflexe de sécurité qui coupe une machine (quarantaine de Hydre) : le journal dit « Odin seul », pas « propriétaire ». */
export const parReflexe = new AsyncLocalStorage<string>();

const journal = (ctx: ModCtx, nom: string) => journalDe<Acte>(ctx, nom, 'qui-a-fait.jsonl', { garder: 5000, quand: (e) => e.t });

function noter(ctx: ModCtx, nom: string, e: Acte): void { try { journal(ctx, nom).ajouter(e); } catch { /* le journal ne bloque jamais l'action */ } }

/** Les actions qui écrivent, et `secretes` (des lectures qui montrent un secret), deviennent « propriétaire seul ». */
export function auProprietaireSeul(l: Action[], secretes: string[] = []): Action[] {
  return l.map((a) => (a.proprietaireSeul !== undefined || (a.read && !secretes.includes(a.id)) ? a : { ...a, proprietaireSeul: true }));
}

/** Chaque action « propriétaire seul » note qui l'a lancée, quoi, quand et le résultat (réussi ou non). */
export function avecJournal(nom: string, l: Action[]): Action[] {
  return l.map((a) => (a.proprietaireSeul === undefined ? a : {
    ...a,
    run: async (ctx: ModCtx, input: Record<string, unknown>): Promise<ActionResult> => {
      // La garde a déjà laissé passer : c'est le propriétaire (ou une étape interne d'une action qu'il a lancée).
      const q = agissant(), base = { t: ctx.now().getTime(), qui: q ? `membre ${propre(q.login, 40)}` : parReflexe.getStore() ?? 'propriétaire', action: a.label, quoi: resume(a, input) };
      try {
        const r = await a.run(ctx, input);
        noter(ctx, nom, { ...base, ok: r.ok !== false, resultat: propre(String(r.text ?? '').split('\n')[0], 160) });
        return r;
      } catch (e) { noter(ctx, nom, { ...base, ok: false, resultat: propre((e as Error).message, 160) }); throw e; }
    },
  }));
}

/** « Qui a fait quoi » : les dernières lignes, les plus récentes d'abord. */
export function actionJournal(nom: string, appli: string): Action {
  return {
    // Une lecture, mais pas marquée « read » : elle est au propriétaire seul (l'IA ne la lance pas seule), et le banc figé de
    // Soul photographie les lectures du catalogue (test/soul-banc/jeux/actions-monde.json, sous empreinte).
    id: 'qui_a_fait', label: 'Qui a fait quoi', what: `Chaque changement fait dans ${appli} : qui, quoi, quand, résultat (aucun secret dedans)`, proprietaireSeul: true, quick: false, quiet: true,
    params: [{ key: 'n', label: 'Combien de lignes', kind: 'number', default: 50 }],
    words: ['qui a fait quoi', 'journal des changements'],
    run: (ctx, i) => {
      const n = Math.min(500, Math.max(1, Number(i.n) || 50)), l = journal(ctx, nom).tout().slice(-n).reverse();
      const quand = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
      return { text: l.length ? [`${appli} · qui a fait quoi (${l.length}) :`, ...l.map((x) => `- ${quand(x.t)} · ${x.qui} · ${x.action}${x.quoi ? ` (${x.quoi})` : ''} · ${x.ok ? 'fait' : 'pas fait'}${x.resultat ? ` : ${x.resultat}` : ''}`)].join('\n') : `${appli} : aucun changement noté pour l'instant.`, data: { actes: l } };
    },
  };
}
