// `npm run banc:outils` : télécharge les outils tiers dont le banc a besoin et qui ne s'installent
// pas par le gestionnaire de paquets : MediaMTX (serveur de flux de caméras) et les serveurs MCP
// officiels du protocole (référence, filesystem, memory).
// Rien n'est installé dans le système : tout va dans ~/.cache/odin-banc.

import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sh, TOOLS } from './lib.ts';

const MEDIAMTX = 'v1.15.3';

/** Serveurs MCP officiels (référence du protocole) : pour essayer Interprète contre de vrais serveurs tiers. */
async function mcp(): Promise<void> {
  const dir = join(TOOLS, 'mcp');
  if (existsSync(join(dir, 'node_modules', '.bin', 'mcp-server-everything'))) { console.log(`✓ Serveurs MCP officiels déjà là (${dir})`); return; }
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, 'package.json'))) writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'odin-banc-mcp', private: true }));
  console.log('Installation des serveurs MCP officiels (npm)…');
  const r = await sh('npm', ['install', '--no-audit', '--no-fund', '--prefix', dir, '@modelcontextprotocol/server-everything', '@modelcontextprotocol/server-filesystem', '@modelcontextprotocol/server-memory'], { timeoutMs: 300_000 });
  if (r.code) { console.error(`✗ Échec : ${r.err.trim().split('\n').pop()}`); process.exitCode = 1; return; }
  console.log(`✓ Serveurs MCP officiels prêts (${dir})`);
}

async function main(): Promise<void> {
  mkdirSync(TOOLS, { recursive: true });
  await mcp();
  const dest = join(TOOLS, 'mediamtx');
  if (existsSync(dest)) { console.log(`✓ MediaMTX déjà là (${dest})`); return; }
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'arm' ? 'armv7' : 'amd64';
  const os = process.platform === 'darwin' ? 'darwin' : 'linux';
  const url = `https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX}/mediamtx_${MEDIAMTX}_${os}_${arch}.tar.gz`;
  console.log(`Téléchargement de MediaMTX ${MEDIAMTX} (${os}/${arch})…`);
  const r = await sh('sh', ['-c', `curl -fsSL -m 180 "${url}" | tar -xz -C "${TOOLS}" mediamtx`], { timeoutMs: 200_000 });
  if (r.code || !existsSync(dest)) { console.error(`✗ Échec : ${r.err.trim() || 'archive illisible'}\n  Télécharge-le à la main (${url}) et indique son chemin : BANC_MEDIAMTX=/chemin/mediamtx`); process.exit(1); }
  chmodSync(dest, 0o755);
  console.log(`✓ MediaMTX prêt (${dest})`);
}
void main();
