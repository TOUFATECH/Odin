// Banc d'essai virtuel d'Odin : `npm run banc` (tout) ou `npm run banc -- docker pare-feu` (au choix).
// Sortie : un tableau lisible + un rapport JSON (test/banc/rapport.json).

import { writeFileSync } from 'node:fs';
import { runScenario, type Result, type Scenario } from './lib.ts';
import { cameras } from './scenarios/cameras.ts';
import { docker } from './scenarios/docker.ts';
import { github } from './scenarios/github.ts';
import { homeassistant } from './scenarios/homeassistant.ts';
import { mcp } from './scenarios/mcp.ts';
import { mcpServeur } from './scenarios/mcp-serveur.ts';
import { parefeu } from './scenarios/parefeu.ts';
import { pieges } from './scenarios/pieges.ts';
import { proxmox } from './scenarios/proxmox.ts';
import { relais } from './scenarios/relais.ts';
import { securite } from './scenarios/securite.ts';
import { tasmota } from './scenarios/tasmota.ts';
import { telegram } from './scenarios/telegram.ts';
import { telegramReel } from './scenarios/telegram-reel.ts';
import { venus } from './scenarios/venus.ts';
import { vpn } from './scenarios/vpn.ts';

/** Vrais services d'abord, puis ceux dont le protocole est rejoué par un simulateur. */
export const SCENARIOS: Scenario[] = [securite, docker, parefeu, pieges, vpn, cameras, venus, homeassistant, relais, github, mcp, mcpServeur, proxmox, tasmota, telegram, telegramReel];
/** Scénarios sans rien d'autre que Node : rejoués aussi par `npm test`. */
export const SIMULES: Scenario[] = [proxmox, tasmota, telegram];

const ICON = { réussi: '✅', échoué: '❌', ignoré: '⏭️ ' } as const;

async function main(): Promise<void> {
  const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (process.argv.includes('--liste')) { for (const s of SCENARIOS) console.log(`${s.id.padEnd(16)} ${s.mode.padEnd(14)} ${s.what}`); return; }
  const todo = want.length ? SCENARIOS.filter((s) => want.includes(s.id)) : SCENARIOS;
  const unknown = want.filter((w) => !SCENARIOS.some((s) => s.id === w));
  if (unknown.length) { console.error(`Scénario inconnu : ${unknown.join(', ')}. Disponibles : ${SCENARIOS.map((s) => s.id).join(', ')}`); process.exit(2); }
  const results: Result[] = [];
  // Une erreur qui échappe à un scénario (minuterie oubliée d'une appli…) ne doit pas arrêter le banc :
  // elle est comptée comme un échec du scénario en cours, avec son message.
  let stray: Error | undefined;
  process.on('uncaughtException', (e) => { stray = e; });
  process.on('unhandledRejection', (e) => { stray = e instanceof Error ? e : new Error(String(e)); });
  for (const s of todo) {
    process.stdout.write(`▶ ${s.title} (${s.mode})…\n`);
    const r = await runScenario(s);
    if (stray) { r.checks.push({ name: 'aucune erreur hors scénario', ok: false, detail: (stray as Error).stack?.split('\n').slice(0, 3).join(' | ') ?? String(stray) }); r.status = 'échoué'; stray = undefined; }
    results.push(r);
    console.log(`${ICON[r.status]} ${r.title} — ${r.status}${r.why ? ` : ${r.why}` : ''} (${r.checks.filter((c) => c.ok).length}/${r.checks.length} vérifications, ${(r.ms / 1000).toFixed(1)} s)`);
    for (const c of r.checks) console.log(`     ${c.ok ? '✓' : '✗'} ${c.name}${c.ok || !c.detail ? '' : `\n         → ${c.detail}`}`);
    for (const n of r.notes) console.log(`     · ${n}`);
  }
  const n = (st: Result['status']) => results.filter((r) => r.status === st).length;
  console.log(`\nBilan : ${n('réussi')} réussi(s), ${n('échoué')} échoué(s), ${n('ignoré')} ignoré(s) · ${results.reduce((a, r) => a + r.checks.length, 0)} vérifications.`);
  try { writeFileSync(new URL('./rapport.json', import.meta.url), JSON.stringify({ date: new Date().toISOString(), results }, null, 2)); } catch { /* lecture seule */ }
  // Des minuteries de modules peuvent rester armées : on sort franchement.
  process.exit(n('échoué') ? 1 : 0);
}
if (import.meta.url === `file://${process.argv[1]}`) void main();
