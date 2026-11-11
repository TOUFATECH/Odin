// Forseti — le centre de sécurité : toutes les alertes de tous les modules au même endroit, la chasse
// (mode « Vígríðr » : recherche dans les alertes, le journal des connexions et les journaux système),
// la surveillance des fichiers sensibles et les contrôles de conformité (avec un score).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { connect } from 'node:tls';
import type { Level, ModCtx, Module } from '../types.ts';

const rd = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return undefined; } };
const WATCHED = ['/etc/passwd', '/etc/group', '/etc/sudoers', '/etc/ssh/sshd_config', '/etc/hosts', '/etc/crontab', '/etc/ld.so.preload', `${homedir()}/.ssh/authorized_keys`, '/root/.ssh/authorized_keys'];
/** Empreinte d'un fichier (contenu si lisible, sinon taille + date). */
export function fingerprint(f: string): string | undefined {
  if (!existsSync(f)) return undefined;
  const c = rd(f); if (c !== undefined) return createHash('sha256').update(c).digest('hex');
  try { const s = statSync(f); return `${s.size}:${s.mtimeMs}`; } catch { return undefined; }
}
export function sshdRisks(conf: string): string[] {
  const v = (k: string) => new RegExp(`^\\s*${k}\\s+(\\S+)`, 'mi').exec(conf)?.[1]?.toLowerCase();
  const out: string[] = [];
  if (v('PermitRootLogin') === 'yes') out.push('connexion SSH directe en root autorisée');
  if ((v('PasswordAuthentication') ?? 'yes') === 'yes') out.push('SSH accepte les mots de passe (clés recommandées)');
  if (v('PermitEmptyPasswords') === 'yes') out.push('SSH accepte les mots de passe vides');
  return out;
}
function certDays(host: string): Promise<number | undefined> {
  return new Promise((res) => {
    const s = connect({ host, port: 443, servername: host, timeout: 8000, rejectUnauthorized: false }, () => { const c = s.getPeerCertificate(); s.end(); res(c?.valid_to ? Math.floor((Date.parse(c.valid_to) - Date.now()) / 86_400_000) : undefined); });
    s.on('error', () => res(undefined)); s.on('timeout', () => { s.destroy(); res(undefined); });
  });
}
export async function checks(ctx: ModCtx): Promise<Array<{ name: string; ok: boolean; detail: string }>> {
  const out: Array<{ name: string; ok: boolean; detail: string }> = [];
  const sshd = rd('/etc/ssh/sshd_config');
  if (sshd !== undefined) { const r = sshdRisks(sshd); out.push({ name: 'SSH durci', ok: !r.length, detail: r.join(' ; ') || 'root interdit, clés seulement' }); }
  const nft = await ctx.has('nft') ? await ctx.run('nft', ['list', 'ruleset'], { sudo: true }) : { code: 1, out: '' };
  const ipt = !nft.out && await ctx.has('iptables') ? await ctx.run('iptables', ['-S'], { sudo: true }) : { code: 1, out: '' };
  out.push({ name: 'Pare-feu actif', ok: /hook input|chain .*input/i.test(nft.out) || /-A INPUT/.test(ipt.out), detail: nft.out || ipt.out ? 'règles présentes' : 'aucune règle lisible' });
  if (await ctx.has('apt')) { const r = await ctx.run('apt', ['list', '--upgradable'], { timeoutMs: 60_000 }); const sec = r.out.split('\n').filter((l) => /-security/.test(l)).length; out.push({ name: 'Mises à jour de sécurité appliquées', ok: sec === 0, detail: sec ? `${sec} en attente` : 'à jour' }); }
  out.push({ name: 'Mises à jour automatiques', ok: existsSync('/etc/apt/apt.conf.d/20auto-upgrades') && /Unattended-Upgrade "1"/.test(rd('/etc/apt/apt.conf.d/20auto-upgrades') ?? ''), detail: 'paquet unattended-upgrades' });
  out.push({ name: 'Pas de préchargement de bibliothèque', ok: !(rd('/etc/ld.so.preload') ?? '').trim(), detail: '/etc/ld.so.preload vide (sinon : rootkit possible)' });
  for (const d of (ctx.settings.domains as string[] | undefined) ?? []) { const days = await certDays(d); out.push({ name: `Certificat ${d}`, ok: days !== undefined && days > 14, detail: days === undefined ? 'injoignable' : `expire dans ${days} jours` }); }
  return out;
}

export const forseti: Module = {
  id: 'forseti', name: 'Forseti', family: 'Sécurité',
  what: 'Le centre de sécurité : toutes les alertes, la chasse aux menaces, les fichiers sensibles et la conformité.',
  does: ['fil unique des alertes de tous les modules (gravité, module, recherche, « vu »)', 'chasse (mode Vígríðr) : recherche dans les alertes, le journal des connexions et les journaux système', 'surveillance des fichiers sensibles (comptes, sudo, SSH, clés autorisées…)', 'contrôles de conformité avec un score', 'expiration des certificats de tes sites', 'envoie les alertes graves sur ta messagerie'],
  from: ['Wazuh', 'Security Onion'], upstream: ['wazuh/wazuh', 'Security-Onion-Solutions/securityonion'],
  modes: ['Vígríðr · chasse aux menaces'],
  words: ['securite', 'sécurité', 'alerte', 'alertes', 'conformite', 'conformité', 'menace', 'menaces', 'chasse', 'audit', 'certificat', 'siem', 'incident'],
  actions: [
    { id: 'alertes', label: 'Dernières alertes', what: 'Les alertes récentes, les plus graves d\'abord', read: true, params: [{ key: 'gravite', label: 'Gravité minimale', kind: 'select', options: ['info', 'moyenne', 'haute', 'critique'], default: 'moyenne' }], words: ['alertes', 'quoi de neuf', 'incidents'], run: (ctx, i) => { const a = ctx.alerts({ level: (String(i.gravite || 'moyenne') as Level), limit: 30 }); return { text: a.map((x) => `- [${x.level}] ${x.at.slice(5, 16).replace('T', ' ')} ${x.module} — ${x.title}${x.count > 1 ? ` (×${x.count})` : ''}`).join('\n') || '✓ Aucune alerte.', data: a }; } },
    { id: 'chercher', label: 'Chasser', what: 'Cherche dans les alertes, le journal des connexions et les journaux système', read: true, params: [{ key: 'q', label: 'Chercher (IP, nom, mot)', kind: 'text', required: true }], words: ['cherche', 'chasse', 'trace'], run: async (ctx, i) => {
      const q = String(i.q).trim(); const a = ctx.alerts({ q, limit: 20 });
      const geri = await ctx.call('geri', 'journal').catch(() => ({ data: [] }));
      const conns = ((geri.data as Array<{ prog: string; dest: string; last: string }>) ?? []).filter((r) => `${r.prog} ${r.dest}`.includes(q)).slice(0, 20);
      const sys = await ctx.has('journalctl') ? (await ctx.run('journalctl', ['--since', '-7d', '-o', 'short-iso', '--no-pager', '-q', '-g', q.replace(/[^\w.:@-]/g, '')], { sudo: true, timeoutMs: 30_000 })).out.split('\n').filter(Boolean).slice(-20) : [];
      return { text: `Alertes (${a.length}) :\n${a.map((x) => `- ${x.at.slice(0, 16)} ${x.module} — ${x.title}`).join('\n') || '—'}\n\nConnexions (${conns.length}) :\n${conns.map((c) => `- ${c.prog} → ${c.dest} (${c.last.slice(0, 16)})`).join('\n') || '—'}\n\nJournaux système (${sys.length}) :\n${sys.join('\n') || '—'}`, data: { alerts: a, conns, sys } };
    } },
    { id: 'conformite', label: 'Contrôle de conformité', what: 'Score et points à corriger', read: true, words: ['conformite', 'conformité', 'durcissement', 'score'], run: async (ctx) => { const c = await checks(ctx); const ok = c.filter((x) => x.ok).length; return { text: `Score : ${ok}/${c.length}\n${c.map((x) => `${x.ok ? '✓' : '✗'} ${x.name} — ${x.detail}`).join('\n')}`, data: c }; } },
    { id: 'vu', label: 'Marquer comme vu', what: 'Les alertes ne sont plus « nouvelles »', params: [{ key: 'ids', label: 'Identifiants (virgules) ou « tout »', kind: 'text', required: true }], run: (ctx, i) => { const ids = String(i.ids) === 'tout' ? ctx.alerts({ limit: 1000 }).map((a) => a.id) : String(i.ids).split(',').map((x) => x.trim()); ctx.ack(ids); return { text: `✓ ${ids.length} alerte(s) marquée(s) comme vues.` }; } },
    { id: 'domaines', label: 'Sites à surveiller', what: 'Domaines dont surveiller le certificat', params: [{ key: 'domaines', label: 'Domaines (virgules)', kind: 'text', required: true }], run: (ctx, i) => { const d = String(i.domaines).split(/[\s,]+/).filter((x) => /^[\w.-]+\.[a-z]{2,}$/i.test(x)); ctx.saveSettings({ domains: d }); return { text: `🔐 Certificats surveillés : ${d.join(', ')}` }; } },
  ],
  async view(ctx, q) {
    const level = (q.get('gravite') as Level) || undefined, search = q.get('q') ?? '';
    const all = ctx.alerts({ limit: 500 }), shown = ctx.alerts({ level, q: search || undefined, limit: 80 });
    const day = all.filter((a) => Date.now() - Date.parse(a.at) < 86_400_000);
    const c = await checks(ctx), ok = c.filter((x) => x.ok).length;
    const t = (l: Level) => (l === 'critique' ? 'mauvais' : l === 'haute' ? 'attention' : 'neutre') as 'mauvais' | 'attention' | 'neutre';
    return {
      subtitle: 'Toutes les alertes de tes modules, triées',
      tabs: ['Alertes', 'Vígríðr · chasse', 'Conformité'],
      kpis: [{ label: 'Alertes 24 h', value: String(day.length) }, { label: 'Critiques 24 h', value: String(day.filter((a) => a.level === 'critique').length), tone: day.some((a) => a.level === 'critique') ? 'mauvais' : 'bon' }, { label: 'Non vues', value: String(all.filter((a) => !a.ack).length) }, { label: 'Conformité', value: `${ok}/${c.length}`, pct: Math.round((ok / Math.max(1, c.length)) * 100), tone: ok === c.length ? 'bon' : 'attention' }],
      sections: [
        { kind: 'table', title: search ? `Résultats pour « ${search} »` : 'Alertes récentes', columns: ['Gravité', 'Quand', 'Module', 'Alerte', 'Détail'], empty: '✓ Aucune alerte.', rows: shown.map((a) => ({ cells: [a.level, a.at.slice(5, 16).replace('T', ' '), ctx.modules().find((m) => m.id === a.module)?.name ?? a.module, `${a.title}${a.count > 1 ? ` (×${a.count})` : ''}`, a.detail ?? ''], tone: a.ack ? 'neutre' : t(a.level), actions: a.ack ? [] : [{ action: 'vu', label: 'Vu', input: { ids: a.id } }] })) },
      ],
      side: [
        { kind: 'form', title: 'Vígríðr · chasser', action: 'chercher', submit: 'Chercher', params: forseti.actions[1].params! },
        { kind: 'list', title: 'Conformité', items: c.map((x) => ({ title: x.name, detail: x.detail, tone: x.ok ? 'bon' : 'mauvais', meta: x.ok ? '✓' : '✗' })) },
      ],
    };
  },
  watch: { every: 300, async run(ctx) {
    const base = (ctx.settings.fim as Record<string, string> | undefined) ?? {}, now: Record<string, string> = {};
    for (const f of WATCHED) { const fp = fingerprint(f); if (fp) now[f] = fp; if (base[f] && fp && base[f] !== fp) { ctx.alert({ level: /passwd|sudoers|authorized_keys|ld\.so\.preload/.test(f) ? 'critique' : 'haute', title: `Fichier sensible modifié : ${f}`, detail: 'Vérifie que c\'est toi (compte ajouté, clé SSH, sudo…).', key: `fim:${f}:${fp}` }); ctx.emit('fichier_modifie', { fichier: f }); } }
    ctx.saveSettings({ fim: { ...base, ...now } });
    const lastC = Number(ctx.settings.checkedAt ?? 0);
    if (ctx.now().getTime() - lastC > 6 * 3600_000) { for (const x of await checks(ctx)) if (!x.ok) ctx.alert({ level: /Certificat/.test(x.name) ? 'haute' : 'info', title: `Conformité : ${x.name}`, detail: x.detail, key: `chk:${x.name}` }); ctx.saveSettings({ checkedAt: ctx.now().getTime() }); }
  } },
};
