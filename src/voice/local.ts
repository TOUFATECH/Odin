// Voix 100 % locale et gratuite : Whisper (whisper.cpp) pour comprendre tes vocaux, Piper pour
// répondre à voix haute (voix française d'homme « tom » ou de femme « siwis »). Rien ne sort de la machine, aucune clé.
// Odin installe tout lui-même dans ~/.odin/voice (compilation de whisper.cpp, quelques minutes).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasCommand } from '../learn/environment.ts';
import { ADMIN_HINT, adminDiagnosis, sudoRefused, withAdmin } from '../machines/access.ts';

export const voiceHome = (home = process.env.ODIN_HOME ?? join(homedir(), '.odin')) => join(home, 'voice');
const WHISPER_MODELS = ['small', 'base', 'medium', 'large-v3-turbo', 'tiny'];
export const PIPER_VOICE = 'fr_FR-tom-medium';
/** Voix de femme française de Piper. */
export const PIPER_VOICE_F = 'fr_FR-siwis-medium';
const PIPER_PATH: Record<string, string> = { [PIPER_VOICE]: 'fr/fr_FR/tom/medium', [PIPER_VOICE_F]: 'fr/fr_FR/siwis/medium' };

/** Voix Piper par langue (téléchargées à la première utilisation, ~60 Mo chacune). */
export const PIPER_LANG: Record<string, string> = {
  en: 'en/en_US/lessac/medium', es: 'es/es_ES/davefx/medium', de: 'de/de_DE/thorsten/medium', it: 'it/it_IT/riccardo/x_low',
  pt: 'pt/pt_BR/faber/medium', ar: 'ar/ar_JO/kareem/medium', sw: 'sw/sw_CD/lanfrica/medium', nl: 'nl/nl_BE/nathalie/medium',
  ru: 'ru/ru_RU/dmitri/medium', tr: 'tr/tr_TR/dfki/medium', zh: 'zh/zh_CN/huayan/medium', pl: 'pl/pl_PL/darkman/medium',
};
const piperName = (path: string) => { const [, loc, who, q] = path.split('/'); return `${loc}-${who}-${q}`; };

/** Voix Piper pour une langue (autre que le français) : téléchargée si besoin, depuis le dépôt officiel. */
export async function ensurePiperVoice(lang: string, home?: string): Promise<string | undefined> {
  const path = PIPER_LANG[lang];
  if (!path) return undefined;
  const d = join(voiceHome(home), 'piper-voices'), name = piperName(path);
  const model = join(d, `${name}.onnx`);
  if (existsSync(model) && existsSync(`${model}.json`)) return model;
  mkdirSync(d, { recursive: true });
  for (const ext of ['onnx', 'onnx.json']) {
    const r = await fetch(`https://huggingface.co/rhasspy/piper-voices/resolve/main/${path}/${name}.${ext}`, { signal: AbortSignal.timeout(300_000) });
    if (!r.ok) return undefined;
    writeFileSync(join(d, `${name}.${ext}.part`), new Uint8Array(await r.arrayBuffer()));
    renameSync(join(d, `${name}.${ext}.part`), join(d, `${name}.${ext}`));
  }
  return model;
}

/** Programme et modèle Whisper locaux, s'ils sont installés. */
export function localWhisper(home?: string): { bin: string; model: string } | undefined {
  const d = voiceHome(home);
  const bin = [join(d, 'whisper.cpp/build/bin/whisper-cli')].find((p) => existsSync(p)) ?? (hasCommand('whisper-cli') ? 'whisper-cli' : undefined);
  const model = WHISPER_MODELS.map((m) => join(d, 'models', `ggml-${m}.bin`)).find((p) => existsSync(p));
  return bin && model && hasCommand('ffmpeg') ? { bin, model } : undefined;
}
/** Programme et voix Piper locaux, s'ils sont installés. */
export function localPiper(home?: string, voice = ''): { bin: string; model: string } | undefined {
  const d = voiceHome(home);
  const bin = [join(d, 'piper/piper')].find((p) => existsSync(p)) ?? (hasCommand('piper') ? 'piper' : undefined);
  // La voix demandée (homme « tom » ou femme « siwis ») si elle est installée, sinon celle qui l'est.
  const want = /siwis|femme|female/i.test(voice) ? [PIPER_VOICE_F, PIPER_VOICE] : [PIPER_VOICE, PIPER_VOICE_F];
  const model = want.map((v) => join(d, 'piper-voices', `${v}.onnx`)).find((p) => existsSync(p));
  return bin && model ? { bin, model } : undefined;
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

export interface Segment { start: number; end: number; text: string }
export interface Heard { text: string; language: string; segments: Segment[] }

/** « [00:01:02.500 --> 00:01:05.000]  texte » (sortie de whisper.cpp) → segments horodatés. Pur. */
export function parseWhisperOut(out: string): Segment[] {
  const ts = (x: string) => { const [h, m, s] = x.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(s); };
  const segs: Segment[] = [];
  for (const m of out.matchAll(/\[(\d+:\d+:\d+(?:\.\d+)?)\s*-->\s*(\d+:\d+:\d+(?:\.\d+)?)\]\s*(.*)/g)) {
    const text = m[3].replace(/\[[^\]]*\]|\([^)]*musique[^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim();
    if (text) segs.push({ start: ts(m[1]), end: ts(m[2]), text });
  }
  return segs;
}

/** Audio (ogg, webm, mp3, vidéo…) → texte horodaté et langue parlée, avec whisper.cpp sur la machine. */
export async function hearLocal(audio: Uint8Array | { file: string }, language = 'auto', home?: string, timeoutMs = 300_000): Promise<Heard> {
  const w = localWhisper(home);
  if (!w) throw new Error('Whisper local non installé');
  const dir = mkdtempSync(join(tmpdir(), 'odin-ecoute-'));
  try {
    const src = 'file' in audio ? audio.file : join(dir, 'in.audio'), wav = join(dir, 'in.wav');
    if (!('file' in audio)) writeFileSync(src, audio);
    const c = await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeout: Math.max(60_000, timeoutMs / 3) });
    if (c.code !== 0) throw new Error(`conversion audio impossible : ${c.err.slice(-200)}`);
    // Langue détectée toute seule (« auto ») : il te répond dans la langue que tu parles.
    // (Sans -np : la ligne « auto-detected language » est écrite dans les journaux, les résultats restent seuls sur la sortie.)
    const lang = !language || language === 'fr' ? 'auto' : language;
    const r = await run(w.bin, ['-m', w.model, '-l', lang, '-t', String(Math.min(8, Math.max(2, (await import('node:os')).availableParallelism?.() ?? 4))), '-f', wav], { timeout: timeoutMs });
    if (r.code !== 0) throw new Error(`Whisper local : ${r.err.slice(-300)}`);
    const segments = parseWhisperOut(r.out);
    const detected = /auto-detected language:\s*([a-z]{2,3})/i.exec(r.err)?.[1] ?? (lang === 'auto' ? 'fr' : lang);
    const text = segments.length ? segments.map((x) => x.text).join(' ') : r.out.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    return { text, language: detected, segments };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
/** Audio → texte (compatibilité). */
export async function transcribeLocal(audio: Uint8Array, language = 'auto', home?: string): Promise<string> { return (await hearLocal(audio, language, home)).text; }

/** Texte → WAV, avec Piper sur la machine (voix française d'homme ou de femme, ou voix de la langue demandée). */
/** `rate` : vitesse de parole (1 = normale, 1,2 = plus vite). */
export async function speakLocal(text: string, home?: string, voice = '', lang = 'fr', rate = 1): Promise<Uint8Array> {
  const base = localPiper(home, voice);
  if (!base) throw new Error('Piper local non installé');
  const other = lang && lang !== 'fr' ? await ensurePiperVoice(lang, home).catch(() => undefined) : undefined;
  const p = { bin: base.bin, model: other ?? base.model };
  const dir = mkdtempSync(join(tmpdir(), 'odin-voix-'));
  try {
    const out = join(dir, 'out.wav');
    const scale = Math.min(1.5, Math.max(0.7, 1 / (rate || 1))).toFixed(2);
    const r = await run(p.bin, ['--model', p.model, '--output_file', out, ...(scale !== '1.00' ? ['--length_scale', scale] : [])], { input: text, timeout: 120_000, env: { LD_LIBRARY_PATH: join(voiceHome(home), 'piper') } });
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
  elif need brew; then brew install $(echo $MISSING | sed 's/g++//; s/make//') || true; need g++ || { echo "Il manque les outils de développement d'Apple : lance « xcode-select --install », puis redis-moi « installe la voix locale »."; exit 1; }
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
for v in ${PIPER_VOICE} ${PIPER_VOICE_F}; do
  case $v in ${PIPER_VOICE}) P=${PIPER_PATH[PIPER_VOICE]};; *) P=${PIPER_PATH[PIPER_VOICE_F]};; esac
  for e in onnx onnx.json; do
    [ -s piper-voices/$v.$e ] || curl -fsSL -o piper-voices/$v.$e "https://huggingface.co/rhasspy/piper-voices/resolve/main/$P/$v.$e"
  done
done
` : ''}echo "Terminé."
`;
}

let installing: Promise<boolean> | undefined;
/**
 * Voix locale prête, installée toute seule au besoin (une seule installation à la fois).
 * `onStart` est appelé si l'installation démarre (pour prévenir le propriétaire).
 */
export function ensureLocalVoice(onStart?: (msg: string) => void, home?: string, o: { quiet?: boolean } = {}): Promise<boolean> {
  if (localWhisper(home)) return Promise.resolve(true);
  // Il manque des outils et Odin n'est pas administrateur : inutile d'annoncer une installation qui échouerait
  // aussitôt, et de recommencer à chaque vocal. On le dit une fois par demande, avec la marche à suivre.
  const blocked = voiceBlocked(home);
  if (blocked) { waitAdmin(home, true); lastFailure = blocked; if (!o.quiet) onStart?.(`⚠ ${blocked}`); return Promise.resolve(false); }
  if (!installing) {
    onStart?.('🎙 J\'installe de quoi comprendre tes vocaux et te répondre en audio (gratuit, rien ne sort de chez toi). Ça prend 5 à 15 minutes la première fois ; je réponds à ton vocal dès que c\'est prêt.');
    installing = installLocalVoice({ home }).then((r) => {
      if (!r.ok) console.error('[voix] installation :', r.log.slice(-400));
      if (!r.stt && r.needsAdmin) waitAdmin(home, true); // l'installation repartira seule quand Odin aura les droits
      if (r.stt) { lastFailure = undefined; onStart?.(`✅ C'est installé : je comprends tes vocaux${r.tts ? ' et je te réponds en audio, dans la langue que tu parles' : ''}.`); }
      // L'échec est dit une seule fois : par celui qui attend la réponse (o.quiet), sinon ici.
      else { lastFailure = voiceFailure(r.log, r.needsAdmin, r.advice); if (!o.quiet) onStart?.(lastFailure); }
      return r.stt;
    }).catch((e) => { console.error('[voix]', (e as Error).message); return false; }).finally(() => { installing = undefined; });
  }
  return installing;
}

/** Installe la voix locale (peut prendre plusieurs minutes : compilation et téléchargement ~500 Mo). */
export async function installLocalVoice(opts: { stt?: boolean; tts?: boolean; model?: string; home?: string } = {}): Promise<{ ok: boolean; log: string; stt: boolean; tts: boolean; needsAdmin: boolean; advice?: string }> {
  const home = opts.home ?? process.env.ODIN_HOME ?? join(homedir(), '.odin');
  const d = voiceHome(home); mkdirSync(d, { recursive: true });
  const model = WHISPER_MODELS.includes(opts.model ?? '') ? opts.model! : 'small';
  const a = withAdmin(installScript({ stt: opts.stt !== false, tts: opts.tts !== false, model }), home);
  const r = await run('bash', ['-c', a.command], { env: a.env, timeout: 45 * 60_000, cwd: d });
  const log = `${r.out}\n${r.err}`.trim().split('\n').slice(-25).join('\n');
  // Le conseil sur les droits n'est ajouté que si sudo a vraiment refusé ; sinon l'erreur affichée est la vraie.
  const needsAdmin = r.code !== 0 && Boolean(a.hint) && sudoRefused(`${r.out}\n${r.err}`);
  return { ok: r.code === 0, log: needsAdmin ? `${log}\n${a.hint}` : log, stt: Boolean(localWhisper(home)), tts: Boolean(localPiper(home)), needsAdmin, advice: needsAdmin ? a.hint : undefined };
}

/** Ce qu'Odin dit quand l'installation de l'écoute échoue : le vrai motif, et quoi faire en une étape. */
export function voiceFailure(log: string, needsAdmin: boolean, advice = ''): string {
  const lines = log.split('\n').map((l) => l.trim()).filter(Boolean);
  if (needsAdmin) {
    // La vraie cause (mot de passe demandé, service verrouillé, sudo absent…) et la marche à suivre viennent du diagnostic.
    const missing = /Paquets à installer\s*:\s*(.+)/.exec(log)?.[1]?.trim().split(/\s+/).join(', ');
    return `⚠ Pour installer l'écoute${missing ? `, il manque ${missing} sur ce poste, et` : ','} il me faut les droits administrateur.\n${advice || ADMIN_HINT}\nDès que je les ai, je relance l'installation tout seul. (Autre voie : une clé OpenAI dans Réglages → Voix.)`;
  }
  const real = lines.filter((l) => !/^sudo: /.test(l) && l !== 'Terminé.').at(-1)?.slice(0, 220) ?? 'erreur inconnue';
  return `⚠ L'installation de l'écoute a échoué : ${real}. Dis-moi « installe la voix locale » pour réessayer, ou ajoute une clé OpenAI dans Réglages → Voix.`;
}

let lastFailure: string | undefined;
/** Pourquoi la dernière installation de l'écoute n'a pas abouti (pour le dire à celui qui attend). */
export const lastVoiceFailure = () => lastFailure;
const TOOLS = ['git', 'cmake', 'make', 'g++', 'ffmpeg', 'curl'];
/**
 * L'écoute ne peut pas s'installer maintenant : il manque des outils du système et Odin n'est pas
 * administrateur pour les ajouter. Rend la phrase à dire (cause réelle + marche à suivre), sinon undefined.
 */
export function voiceBlocked(home?: string, has: (c: string) => boolean = hasCommand, diag = adminDiagnosis): string | undefined {
  if (process.platform !== 'linux' || localWhisper(home)) return undefined;
  const missing = TOOLS.filter((c) => !has(c)); if (!missing.length) return undefined;
  const d = diag(home ?? process.env.ODIN_HOME ?? join(homedir(), '.odin')); if (d.ok) return undefined;
  return `Je ne peux pas encore écouter tes vocaux : il manque ${missing.join(', ')} sur ce poste pour installer l'écoute, et je ne suis ${d.state}.\n${d.fix}\nDès que j'ai les droits, je l'installe tout seul. (Autre voie : une clé OpenAI dans Réglages → Voix.)`;
}

/** Une installation attend les droits administrateur : elle repart toute seule dès qu'Odin les a. */
const waitFile = (home?: string) => join(voiceHome(home), 'attend-les-droits');
function waitAdmin(home: string | undefined, on: boolean): void { try { if (on) { mkdirSync(voiceHome(home), { recursive: true }); writeFileSync(waitFile(home), new Date().toISOString()); } else if (existsSync(waitFile(home))) rmSync(waitFile(home)); } catch { /* facultatif */ } }
export const voiceWaitsAdmin = (home?: string) => existsSync(waitFile(home));
/** À appeler quand Odin vient de recevoir les droits administrateur. Rend true si une installation repart. */
export function resumeVoiceInstall(notify?: (msg: string) => void, home?: string): boolean {
  if (!voiceWaitsAdmin(home) || localWhisper(home)) { waitAdmin(home, false); return false; }
  waitAdmin(home, false);
  void ensureLocalVoice(notify, home);
  return true;
}
