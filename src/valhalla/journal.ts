// Le lien de toutes les applis avec la mémoire d'Odin (le Cerveau) : chaque jour, une note par jour réunit
// ce que les applis ont fait, signalé et vu (événements, alertes, actions, chiffres clés). Odin y pioche pour
// ses idées et ses réponses (« qu'est-ce qui s'est passé hier ? », « depuis quand le disque se remplit ? »).
// Jamais de secret : les champs sensibles sont retirés et le texte passe par le masqueur d'Odin ; les secrets
// restent dans le coffre (Thésauros). Les notes de plus de 90 jours partent à la corbeille du Cerveau.
import type { Vault } from '../brain/vault.ts';
import type { Valhalla } from './service.ts';

const DIR = 'Odin/Journal des applis';
const SECRET = /(pass|mot_de_passe|token|jeton|secret|cle|clé|key|cookie|hash|empreinte|password|authorization|credential)/i;
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hm = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
/** Les données d'un événement, sans secret, courtes. Pur. */
export function clean(data: Record<string, unknown> | undefined): string {
  return Object.entries(data ?? {}).filter(([k, v]) => !SECRET.test(k) && v !== undefined && v !== null && v !== '' && typeof v !== 'object').slice(0, 6).map(([k, v]) => `${k} : ${String(v).replace(/\s+/g, ' ').slice(0, 80)}`).join(' · ');
}
interface Line { at: Date; module: string; text: string }

export class AppJournal {
  private lines: Line[] = []; private timer?: ReturnType<typeof setInterval>; private lastSnap = '';
  private readonly on: Array<[string, (...a: any[]) => void]> = [];
  private v: Valhalla; private vault: Vault; private redact: (t: string) => string; private now: () => Date;
  constructor(v: Valhalla, vault: Vault, redact: (t: string) => string = (t) => t, now: () => Date = () => new Date(), everyMs = 5 * 60_000) {
    this.v = v; this.vault = vault; this.redact = redact; this.now = now;
    const add = (module: string, text: string) => { this.lines.push({ at: this.now(), module, text: this.redact(text).slice(0, 300) }); if (this.lines.length > 2000) this.lines.splice(0, 500); };
    const ev = (e: { module: string; type: string; data?: Record<string, unknown> }) => add(e.module, `${e.type.replace(/_/g, ' ')}${clean(e.data) ? ` — ${clean(e.data)}` : ''}`);
    const al = (a: { module: string; level: string; title: string; detail?: string }) => add(a.module, `alerte ${a.level} : ${a.title}${a.detail ? ` — ${a.detail.split('\n')[0].slice(0, 160)}` : ''}`);
    const ac = (a: { module: string; action: string; ok: boolean; by: string }) => { const f = v.action(a.module, a.action); if (f?.a.read) return; add(a.module, `${a.ok ? 'fait' : 'raté'} : ${f?.a.label ?? a.action} (par ${a.by})`); };
    for (const [n, f] of [['event', ev], ['alert', al], ['action', ac]] as const) { v.events.on(n, f); this.on.push([n, f as (...a: any[]) => void]); }
    this.timer = setInterval(() => { void this.flush(); }, everyMs); this.timer.unref?.();
  }
  /** Écrit ce qui s'est passé dans la note du jour (et, une fois par jour, l'état des applis). */
  async flush(): Promise<number> {
    const now = this.now(), today = day(now), take = this.lines.splice(0), byDay = new Map<string, Line[]>();
    for (const l of take) { const d = day(l.at); byDay.set(d, [...(byDay.get(d) ?? []), l]); }
    let n = 0;
    for (const [d, ls] of byDay) {
      const path = `${DIR}/${d}.md`;
      if (!this.vault.read(path)) this.vault.write(path, { type: 'journal', tags: ['journal', 'applis'], 'tenue par': 'Odin' }, `# Journal des applis · ${d}\n\nCe que les applis d'Odin ont fait, signalé et vu ce jour-là (sans aucun secret). Voir aussi [[Les applis d'Odin]].\n`, { quiet: true });
      const mods = [...new Set(ls.map((l) => l.module))];
      for (const m of mods) {
        const name = this.v.module(m)?.name ?? m;
        this.vault.append(path, ls.filter((l) => l.module === m).map((l) => `- ${hm(l.at)} · ${l.text}`).join('\n'), `[[${name}]]`);
        n += ls.filter((l) => l.module === m).length;
      }
    }
    // Une fois par jour : les chiffres clés de chaque appli (ce que montre sa page), pour suivre l'évolution.
    if (this.lastSnap !== today) {
      this.lastSnap = today; const rows: string[] = [];
      for (const m of this.v.modules()) {
        try { const view = await Promise.race([m.view(this.v.ctx(m.id), new URLSearchParams()), new Promise<never>((_, ko) => setTimeout(() => ko(new Error('lent')), 2500))]); const k = (view.kpis ?? []).slice(0, 4).map((x) => `${x.label} : ${x.value}`).join(' · '); if (k) rows.push(`- [[${m.name}]] — ${this.redact(k).slice(0, 240)}`); } catch { /* appli lente */ }
      }
      if (rows.length) {
        const path = `${DIR}/${today}.md`;
        if (!this.vault.read(path)) this.vault.write(path, { type: 'journal', tags: ['journal', 'applis'], 'tenue par': 'Odin' }, `# Journal des applis · ${today}\n\nCe que les applis d'Odin ont fait, signalé et vu ce jour-là (sans aucun secret). Voir aussi [[Les applis d'Odin]].\n`, { quiet: true });
        this.vault.append(path, rows.join('\n'), 'État des applis');
      }
      // Au-delà de 90 jours : à la corbeille du Cerveau (récupérable).
      const limit = day(new Date(now.getTime() - 90 * 864e5));
      for (const note of this.vault.all()) { const m = /^Odin\/Journal des applis\/(\d{4}-\d{2}-\d{2})\.md$/.exec(note.path); if (m && m[1] < limit) this.vault.trash(note.path, { quiet: true }); }
    }
    return n;
  }
  async stop(): Promise<void> { clearInterval(this.timer); for (const [n, f] of this.on) this.v.events.off(n, f); try { await this.flush(); } catch { /* disque plein */ } }
}
