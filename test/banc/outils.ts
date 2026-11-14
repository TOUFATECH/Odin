// `npm run banc:outils` : télécharge les outils tiers dont le banc a besoin et qui ne s'installent
// pas par le gestionnaire de paquets : MediaMTX (serveur de flux de caméras), les serveurs MCP
// officiels du protocole (référence, filesystem, memory), et Piper avec deux voix françaises (la voix locale).
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

/**
 * La voix locale pour de vrai (essais de test/voix.test.ts) : le programme Piper — le même que celui qu'Odin installe —,
 * deux voix françaises (homme, femme) et le serveur HTTP de Piper dans son propre environnement Python.
 * Chaque étape qui échoue est dite ; les essais se rabattent alors sur un faux Piper.
 */
async function voix(): Promise<void> {
  const dir = join(TOOLS, 'voix'), voices = join(dir, 'piper-voices');
  mkdirSync(voices, { recursive: true });
  if (!existsSync(join(dir, 'piper', 'piper'))) {
    if (process.platform !== 'linux') { console.log('✗ Piper : programme autonome fourni pour Linux seulement (les essais prendront le faux Piper)'); return; }
    const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'arm' ? 'armv7l' : 'x86_64';
    console.log('Téléchargement de Piper…');
    const r = await sh('sh', ['-c', `curl -fsSL -m 300 "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_${arch}.tar.gz" | tar -xz -C "${dir}"`], { timeoutMs: 320_000 });
    if (r.code || !existsSync(join(dir, 'piper', 'piper'))) { console.error(`✗ Piper : ${r.err.trim().split('\n').pop() || 'archive illisible'}`); return; }
  }
  // Les voix d'Odin viennent de HuggingFace. Si ce site est fermé ici, deux voix françaises publiées sur GitHub les
  // remplacent pour les essais : « gilles » tient la place de « tom », et « siwis » y est dans une version plus ancienne.
  for (const [name, hf, gh, old] of [['fr_FR-tom-medium', 'fr/fr_FR/tom/medium', 'voice-fr-gilles-low', 'fr-gilles-low'], ['fr_FR-siwis-medium', 'fr/fr_FR/siwis/medium', 'voice-fr-siwis-medium', 'fr-siwis-medium']]) {
    if (existsSync(join(voices, `${name}.onnx`)) && existsSync(join(voices, `${name}.onnx.json`))) continue;
    console.log(`Téléchargement de la voix ${name}…`);
    let r = await sh('sh', ['-c', `cd "${voices}" && for e in onnx onnx.json; do curl -fsSL -m 300 -o "${name}.$e.part" "https://huggingface.co/rhasspy/piper-voices/resolve/main/${hf}/${name}.$e" && mv "${name}.$e.part" "${name}.$e" || exit 1; done`], { timeoutMs: 640_000 });
    if (r.code) {
      r = await sh('sh', ['-c', `cd "${voices}" && rm -f ./*.part && curl -fsSL -m 300 "https://github.com/rhasspy/piper/releases/download/v0.0.2/${gh}.tar.gz" | tar -xz ${old}.onnx ${old}.onnx.json && mv ${old}.onnx ${name}.onnx && mv ${old}.onnx.json ${name}.onnx.json`], { timeoutMs: 320_000 });
      if (!r.code) console.log(`  HuggingFace injoignable : la voix « ${old} » publiée sur GitHub prend la place de « ${name} »`);
    }
    if (r.code) { console.error(`✗ Voix ${name} : ${r.err.trim().split('\n').pop() || 'téléchargement impossible'}`); return; }
  }
  console.log(`✓ Piper et ses deux voix françaises prêts (${dir})`);
  if (existsSync(join(dir, 'venv', 'bin', 'flask'))) { console.log('✓ Serveur HTTP de Piper déjà là'); return; }
  console.log('Installation du serveur HTTP de Piper (piper-tts[http], dans son propre environnement Python)…');
  const r = await sh('sh', ['-c', `python3 -m venv "${dir}/venv" && "${dir}/venv/bin/pip" install --quiet --disable-pip-version-check "piper-tts[http]"`], { timeoutMs: 600_000 });
  if (r.code || !existsSync(join(dir, 'venv', 'bin', 'flask'))) console.error(`✗ Serveur HTTP de Piper : ${(r.err || r.out).trim().split('\n').pop() || 'Python ou pip indisponible'} (l'essai du vrai serveur sera sauté)`);
  else console.log('✓ Serveur HTTP de Piper prêt');
}

async function main(): Promise<void> {
  mkdirSync(TOOLS, { recursive: true });
  // `npm run banc:outils -- voix` : seulement les outils de la voix.
  if (process.argv[2] === 'voix') return voix();
  await mcp();
  await voix();
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
