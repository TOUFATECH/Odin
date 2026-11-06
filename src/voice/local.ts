// Voix 100 % locale et gratuite : Whisper (whisper.cpp) pour comprendre tes vocaux, Piper pour
// répondre à voix haute (voix d'homme française « tom »). Rien ne sort de la machine, aucune clé.
// Odin installe tout lui-même dans ~/.odin/voice (compilation de whisper.cpp, quelques minutes).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasCommand } from '../learn/environment.ts';
import { withAdmin } from '../machines/access.ts';

export const voiceHome = (home = process.env.ODIN_HOME ?? join(homedir(), '.odin')) => join(home, 'voice');
const WHISPER_MODELS = ['small', 'base', 'medium', 'large-v3-turbo', 'tiny'];
export const PIPER_VOICE = 'fr_FR-tom-medium';

/** Programme et modèle Whisper locaux, s'ils sont installés. */
export function localWhisper(home?: string): { bin: string; model: string } | undefined {
  const d = voiceHome(home);
  const bin = [join(d, 'whisper.cpp/build/bin/whisper-cli')].find((p) => existsSync(p)) ?? (hasCommand('whisper-cli') ? 'whisper-cli' : undefined);
  const model = WHISPER_MODELS.map((m) => join(d, 'models', `ggml-${m}.bin`)).find((p) => existsSync(p));
  return bin && model && hasCommand('ffmpeg') ? { bin, model } : undefined;
}
/** Programme et voix Piper locaux, s'ils sont installés. */
export function localPiper(home?: string): { bin: string; model: string } | undefined {
  const d = voiceHome(home);
  const bin = [join(d, 'piper/piper')].find((p) => existsSync(p)) ?? (hasCommand('piper') ? 'piper' : undefined);
  const model = join(d, 'piper-voices', `${PIPER_VOICE}.onnx`);
  return bin && existsSync(model) ? { bin, model } : undefined;
}

function run(cmd: string, args: string[], opts: { input?: string; env?: NodeJS.ProcessEnv; timeout?: number; cwd?: string } = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...opts.env }, cwd: opts.cwd });
    let out = '', err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), opts.timeout ?? 120_000);
    p.stdout.on('data', (b) => { out += b; }); p.stderr.on('data', (b) => { err += b; if (err.length > 200_000) err = err.slice(-100_000); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, out, err }); });
    if (opts.input != null) p.stdin.end(opts.input); else p.stdin.end();
  });
}

/** Audio (ogg, webm, mp3…) → texte, avec whisper.cpp sur la machine. */
export async function transcribeLocal(audio: Uint8Array, language = 'fr', home?: string): Promise<string> {
  const w = localWhisper(home);
  if (!w) throw new Error('Whisper local non installé');
  const dir = mkdtempSync(join(tmpdir(), 'odin-ecoute-'));
  try {
    const src = join(dir, 'in.audio'), wav = join(dir, 'in.wav');
    writeFileSync(src, audio);
    const c = await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeout: 60_000 });
    if (c.code !== 0) throw new Error(`conversion audio impossible : ${c.err.slice(-200)}`);
    const r = await run(w.bin, ['-m', w.model, '-l', language || 'fr', '-nt', '-np', '-t', String(Math.min(8, Math.max(2, (await import('node:os')).availableParallelism?.() ?? 4))), '-f', wav], { timeout: 300_000 });
    if (r.code !== 0) throw new Error(`Whisper local : ${r.err.slice(-300)}`);
    return r.out.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Texte → WAV, avec Piper sur la machine (voix d'homme française). */
export async function speakLocal(text: string, home?: string): Promise<Uint8Array> {
  const p = localPiper(home);
  if (!p) throw new Error('Piper local non installé');
  const dir = mkdtempSync(join(tmpdir(), 'odin-voix-'));
  try {
    const out = join(dir, 'out.wav');
    const r = await run(p.bin, ['--model', p.model, '--output_file', out], { input: text, timeout: 120_000, env: { LD_LIBRARY_PATH: join(voiceHome(home), 'piper') } });
    if (r.code !== 0 || !existsSync(out)) throw new Error(`Piper local : ${r.err.slice(-300)}`);
    return new Uint8Array(readFileSync(out));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Script d'installation (bash) : paquets manquants, whisper.cpp compilé, modèle, Piper et sa voix. Pur. */
export function installScript(opts: { stt: boolean; tts: boolean; model: string }): string {
  return `set -e
need(){ command -v "$1" >/dev/null 2>&1; }
MISSING=""
for p in git cmake make g++ ffmpeg curl; do need $p || MISSING="$MISSING $p"; done
if [ -n "$MISSING" ]; then
  echo "Paquets à installer :$MISSING"
  if need apt-get; then sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $(echo $MISSING | sed 's/g++/build-essential/; s/make//')
  elif need dnf; then sudo dnf install -y -q $(echo $MISSING | sed 's/g++/gcc-c++/')
  elif need pacman; then sudo pacman -S --noconfirm --needed $(echo $MISSING | sed 's/g++/gcc/')
  elif need apk; then sudo apk add $MISSING build-base
  else echo "Installe d'abord :$MISSING"; exit 1; fi
fi
${opts.stt ? `echo "→ Whisper (compréhension des vocaux)"
[ -d whisper.cpp/.git ] || git clone -q --depth 1 https://github.com/ggml-org/whisper.cpp whisper.cpp
cmake -S whisper.cpp -B whisper.cpp/build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON >/dev/null
cmake --build whisper.cpp/build -j"$(nproc)" --config Release --target whisper-cli >/dev/null
mkdir -p models
if [ ! -s models/ggml-${opts.model}.bin ]; then
  curl -fsSL -o models/ggml-${opts.model}.bin.part https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${opts.model}.bin
  mv models/ggml-${opts.model}.bin.part models/ggml-${opts.model}.bin
fi
` : ''}${opts.tts ? `echo "→ Piper (voix d'Odin)"
case "$(uname -m)" in x86_64) PA=x86_64;; aarch64|arm64) PA=aarch64;; armv7l) PA=armv7l;; *) echo "Processeur non pris en charge par Piper"; exit 1;; esac
if [ ! -x piper/piper ]; then
  curl -fsSL -o piper.tgz "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_$PA.tar.gz"
  tar xzf piper.tgz && rm -f piper.tgz
fi
mkdir -p piper-voices
for e in onnx onnx.json; do
  [ -s piper-voices/${PIPER_VOICE}.$e ] || curl -fsSL -o piper-voices/${PIPER_VOICE}.$e "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/tom/medium/${PIPER_VOICE}.$e"
done
` : ''}echo "Terminé."
`;
}

/** Installe la voix locale (peut prendre plusieurs minutes : compilation et téléchargement ~500 Mo). */
export async function installLocalVoice(opts: { stt?: boolean; tts?: boolean; model?: string; home?: string } = {}): Promise<{ ok: boolean; log: string; stt: boolean; tts: boolean }> {
  const home = opts.home ?? process.env.ODIN_HOME ?? join(homedir(), '.odin');
  const d = voiceHome(home); mkdirSync(d, { recursive: true });
  const model = WHISPER_MODELS.includes(opts.model ?? '') ? opts.model! : 'small';
  const a = withAdmin(installScript({ stt: opts.stt !== false, tts: opts.tts !== false, model }), home);
  const r = await run('bash', ['-c', a.command], { env: a.env, timeout: 45 * 60_000, cwd: d });
  const log = `${r.out}\n${r.err}`.trim().split('\n').slice(-25).join('\n');
  return { ok: r.code === 0, log: r.code === 0 ? log : `${log}${a.hint ? `\n${a.hint}` : ''}`, stt: Boolean(localWhisper(home)), tts: Boolean(localPiper(home)) };
}
