// Faux services de voix pour les essais. Chacun parle le même protocole que le vrai, vérifie ce qu'Odin envoie
// VRAIMENT (adresse, en-têtes, corps) et rend un vrai petit son. Rien ne sort de la machine.
//
// - ElevenLabs : d'après sa documentation d'API lue en novembre 2026 (POST /v1/text-to-speech/{voix}, GET /v2/voices
//   par pages, POST /v1/voices/add en multipart, DELETE /v1/voices/{voix}, clé dans l'en-tête xi-api-key).
// - Serveur HTTP de Piper : version actuelle (piper-tts 1.3 à 1.8 : POST /synthesize en JSON, « / » est une page web)
//   et ancienne (piper-tts 1.2 : POST / avec le texte brut), d'après leur code source. Comme le vrai, il rend le WAV
//   sans dire que c'en est un (type « text/html ») : Odin doit regarder le son, pas l'étiquette.
// - Programme Piper : un petit script qui prend les mêmes options que le vrai et écrit un vrai WAV.
// - Vrai Piper : s'il est dans le dossier du banc (`npm run banc:outils`), les essais s'en servent à la place du faux.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLS } from '../lib.ts';
import { parseMultipart } from './telegram.ts';

/** Vrais petits sons (un ton de 0,6 s) : un MP3 et un Ogg/Opus fabriqués avec ffmpeg, gardés ici pour ne dépendre de rien. */
export const PETIT_MP3 = Buffer.from('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', 'base64');
export const PETIT_OGG = Buffer.from('T2dnUwACAAAAAAAAAACVvA/xAAAAAFDVJecBE09wdXNIZWFkAQE4AYC7AAAAAABPZ2dTAAAAAAAAAAAAAJW8D/EBAAAAOFzMrAE+T3B1c1RhZ3MNAAAATGF2ZjYwLjE2LjEwMAEAAAAdAAAAZW5jb2Rlcj1MYXZjNjAuMzEuMTAyIGxpYm9wdXNPZ2dTAAS4cQAAAAAAAJW8D/ECAAAAbWxgBR8yIiMrJyckKC8oLTUsJCUpKB0fGRoXMyseKB0qGBsRSIIut2xWt/QAAeXNngFGUIWXtzyTyRdZwxGaQd8AnvLXOrYji9/f7ABDXS1wlpp/VmRIpIhXrJiFA1dPznsYFAwSqTONowX+mL04HAzkM343fqwISJwbUk/ZyaE+fK7ZaeDnUfznvh1PUqnalp8X3KPIYqJCIuBInBtSVs4iKX9lHbjjGzQFOnuOkmfCxAEAJqVoclpbWG+XdQQY0RDuPORCSJwbn3Wc/EXQxgBm5z1062W3Q2jR/rxew/MNdqZ5NCHPJ1vL2nwESJwbV0vdsA9/7eUzngPMbRSjhnvvTfECX8uN+jYwHs1l6iBUR6RhSJwbn3Wc/ElKIjSvyFu7KzJTQ8IbXS8YcGEdlZwajNNtCNEuSJwbUlFFAKzjEFOXFsJnAPmGujTyT3BLeebG03xzsWUy8Zq9TESh4EicG1JWzh/qEUL6mZm6jJY5zpXVh5LKW3rMQDI3ecnG2vSgQ2GElk9uHVclJwmASJwbn3Wc/EXQxgfacQLrmR1xJmDsIT0phQ6fVIF9CoYa0jh7kKCKgEicG1dL3bAKpJzrlmYYQ4eRFIBOaRfvUu8Ypz18cALKe/zz8yYaAuUI/NVvc0icG1G0HL+mXBeDXu4gDNPhO9buC1VzwTDVX1L7LcHr57hLuXEEh4T71UKK2LJ6OOoYgGnASJwbUlbOI3aAr8w/bCQJ8YVd7vvHe4EuV1a55shKCWJUcyZtUh000hKdJ/BInJOSVs4f6hDwbyL7VhFqAfGWQDuld9LFMXRx+fwOkHjt7OBInJOSVs4f1o0LU5hMcC4x79pzAfcLN1Gchu0auXZmk6mmLp7/SJyTl2baUYuIs9jq2DpVlmUjLrIcICAkbWH1lMK1rnx6gxGCwCRrCIBInJOSVs4f6wsq3K4K94m8l4ZE52vDuyNdFZYwr3oJKAIMyNEvpqvYSJyTklbOI3Zyj/I/FXRTcvALqzHEgLhkoj6knv9InJOSVs4iKX8ixv4ieS7C73LYIkvclCjaf2r2c/aASJy5QFW2U4lFxsqO2C9as9CHv97PfLWo60idaQdLfnofaLaJVz+7jpieJjOGrtt4f1SASJ1pzBBZ0lfA93UfQSkReheVJ8gaDqBInuPWr8Emci5NmpHi16NVz2bhv4YkRsOBr+8Zi2y68erlsRdDz+jh7HVRzI/GgYkBsaBIoG+n/8GNgVQFK0UiBJGqfmz97b0+9Tr+fMEeF2y4JUiti/8AVmOQU4gzSJ/x9IA2QzzrYDvyVKvJ4zooGAc5b/yNLLj0iMbASKBYChjpgUmYtTuxOGzSBvoH3zfgKRpkf7TbPfeDR7CWczHZmWJxwEif8fSANkM6o6NWFNJ+DbiLNvsRtotZePQ9xqw1SKBvp//BjYFUCHzc7/WEbxSWkn2cE+QxVbOy7rZkGsvWikIASCKofE7gSJ/6ktn9H1xfsBRSFZG0H9vm6Eqe/03cSJ/6ktn9H10/JNiTw0AntxSIA5faTwMM9xBgSAYZ5fAR5sJ1EMCpqkeIqMg=', 'base64');

/** Un vrai WAV fabriqué ici (ton pur, 16 bits, un canal). La cadence et la hauteur permettent de reconnaître deux voix. */
export function wav(seconds = 0.5, rate = 22050, hz = 220): Buffer {
  const n = Math.max(1, Math.round(seconds * rate)), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 9000), 44 + i * 2);
  return b;
}
/** Cadence annoncée par un WAV (octets 24 à 27 de son en-tête). */
export const wavRate = (b: Uint8Array) => Buffer.from(b).readUInt32LE(24);
/** Durée d'un WAV simple (en-tête de 44 octets, 16 bits, un canal). */
export const wavSeconds = (b: Uint8Array) => (b.byteLength - 44) / 2 / wavRate(b);

const has = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
export const FFPROBE = has('ffprobe'), FFMPEG = has('ffmpeg');
/** Ce que ffprobe lit dans un son (rien si ffprobe n'est pas installé ou si le son est illisible). */
export function sonde(data: Uint8Array): { format: string; codec: string; duree: number; cadence: number; canaux: number } | undefined {
  if (!FFPROBE) return undefined;
  const d = mkdtempSync(join(tmpdir(), 'odin-sonde-'));
  try {
    writeFileSync(join(d, 'son'), data);
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name,duration:stream=codec_name,sample_rate,channels', '-of', 'json', join(d, 'son')], { encoding: 'utf8' });
    if (r.status !== 0) return undefined;
    const j = JSON.parse(r.stdout) as { format?: { format_name?: string; duration?: string }; streams?: Array<{ codec_name?: string; sample_rate?: string; channels?: number }> };
    return { format: j.format?.format_name ?? '', codec: j.streams?.[0]?.codec_name ?? '', duree: Number(j.format?.duration ?? 0), cadence: Number(j.streams?.[0]?.sample_rate ?? 0), canaux: j.streams?.[0]?.channels ?? 0 };
  } finally { rmSync(d, { recursive: true, force: true }); }
}
/** Volume moyen d'un son en décibels (ffmpeg) : un silence complet tourne autour de −91 dB. */
export function volume(data: Uint8Array): number | undefined {
  if (!FFMPEG) return undefined;
  const d = mkdtempSync(join(tmpdir(), 'odin-volume-'));
  try {
    writeFileSync(join(d, 'son'), data);
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', join(d, 'son'), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr); return m ? Number(m[1]) : undefined;
  } finally { rmSync(d, { recursive: true, force: true }); }
}

export interface Hit { method: string; path: string; query: URLSearchParams; headers: IncomingHttpHeaders; body: Buffer; json?: Record<string, unknown>; form?: Record<string, string | { name: string; type: string; data: Buffer }> }
type Reply = { status?: number; type?: string; body: string | Buffer | Record<string, unknown> };
async function serve(handler: (h: Hit) => Reply | Promise<Reply>): Promise<{ url: string; hits: Hit[]; close(): Promise<void> }> {
  const hits: Hit[] = [];
  const srv: Server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => void (async () => {
      const u = new URL(req.url ?? '/', 'http://x'), body = Buffer.concat(parts), ct = String(req.headers['content-type'] ?? '');
      const h: Hit = { method: req.method ?? 'GET', path: u.pathname, query: u.searchParams, headers: req.headers, body };
      if (/json/.test(ct)) { try { h.json = JSON.parse(body.toString('utf8')) as Record<string, unknown>; } catch { /* corps illisible */ } }
      if (/multipart/.test(ct)) h.form = parseMultipart(body, ct);
      hits.push(h);
      let r: Reply; try { r = await handler(h); } catch (e) { r = { status: 500, body: { detail: (e as Error).message } }; }
      const out = Buffer.isBuffer(r.body) || typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      res.writeHead(r.status ?? 200, { 'content-type': r.type ?? (Buffer.isBuffer(r.body) ? 'application/octet-stream' : typeof r.body === 'string' ? 'text/plain; charset=utf-8' : 'application/json') });
      res.end(out);
    })());
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, hits, close: () => new Promise<void>((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }) };
}

// ---------------- ElevenLabs

/** Les formats que la documentation d'ElevenLabs accepte pour `output_format`. */
const FORMATS = /^(alaw_8000|ulaw_8000|mp3_(22050_32|24000_48|44100_(32|64|96|128|192))|opus_48000_(32|64|96|128|192)|pcm_(8000|16000|22050|24000|32000|44100|48000)|wav_(8000|16000|22050|24000|32000|44100|48000))$/;
export interface ElevenVoice { voice_id: string; name: string; category: string }
export interface ElevenSim {
  url: string; key: string; hits: Hit[];
  /** Les voix du compte (les deux voix prêtes à l'emploi dont Odin se sert par défaut, puis celles qu'on ajoute). */
  voices: ElevenVoice[];
  /** Ce qui a été dit : voix, texte, modèle, format, dans l'ordre. */
  said: Array<{ voice: string; text: string; model: string; format: string }>;
  /** Les enregistrements reçus pour une copie de voix. */
  samples: Array<{ name: string; description: string; file: { name: string; type: string; data: Buffer }; voice_id: string }>;
  deleted: string[];
  close(): Promise<void>;
}
/**
 * Faux ElevenLabs. `verify` : il demande une vérification de la voix copiée. `panne` : toutes ses réponses sont cette
 * erreur ; avec `echo`, il répète dans sa réponse la clé qu'il a reçue (pour vérifier qu'Odin ne la montre jamais).
 * `ancien` : il ne connaît pas /v2/voices. `avant` : appelé juste avant de créer une voix copiée.
 */
export async function elevenSim(o: { key?: string; verify?: boolean; panne?: { status: number; echo?: boolean }; ancien?: boolean; pageMax?: number; avant?: () => void } = {}): Promise<ElevenSim> {
  const key = o.key ?? 'sk_faux_elevenlabs_0123456789abcdef';
  const voices: ElevenVoice[] = [{ voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', category: 'premade' }, { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', category: 'premade' }];
  const said: ElevenSim['said'] = [], samples: ElevenSim['samples'] = [], deleted: string[] = [];
  const s = await serve((h): Reply => {
    const got = String(h.headers['xi-api-key'] ?? '');
    if (o.panne) return { status: o.panne.status, body: { detail: { status: 'panne', message: o.panne.echo ? `Request failed for key ${got}` : 'Something went wrong' } } };
    if (got !== key) return { status: 401, body: { detail: { status: 'invalid_api_key', message: 'Invalid API key' } } };
    const tts = /^\/v1\/text-to-speech\/([^/]+)$/.exec(h.path);
    if (tts && h.method === 'POST') {
      const format = h.query.get('output_format') ?? 'mp3_44100_128', b = h.json ?? {};
      if (!FORMATS.test(format)) return { status: 422, body: { detail: [{ loc: ['query', 'output_format'], msg: 'Input should be a valid output format', type: 'enum' }] } };
      if (typeof b.text !== 'string' || !b.text) return { status: 422, body: { detail: [{ loc: ['body', 'text'], msg: 'Field required', type: 'missing' }] } };
      if (b.model_id !== undefined && typeof b.model_id !== 'string') return { status: 422, body: { detail: [{ loc: ['body', 'model_id'], msg: 'Input should be a valid string', type: 'string_type' }] } };
      const voice = decodeURIComponent(tts[1]);
      if (!voices.some((v) => v.voice_id === voice)) return { status: 404, body: { detail: { status: 'voice_not_found', message: `A voice with the voice_id ${voice} was not found.` } } };
      said.push({ voice, text: b.text, model: String(b.model_id ?? 'eleven_multilingual_v2'), format });
      // La documentation ne dit pas quel type accompagne l'Opus : le faux ne l'annonce pas, Odin doit lire le son.
      return /^opus/.test(format) ? { type: 'application/octet-stream', body: PETIT_OGG } : { type: 'audio/mpeg', body: PETIT_MP3 };
    }
    if (h.path === '/v2/voices' && h.method === 'GET') {
      if (o.ancien) return { status: 404, body: { detail: 'Not Found' } };
      const size = Number(h.query.get('page_size') ?? 10);
      if (!(size >= 1 && size <= 100)) return { status: 422, body: { detail: [{ loc: ['query', 'page_size'], msg: 'Input should be less than or equal to 100', type: 'less_than_equal' }] } };
      const per = Math.min(size, o.pageMax ?? size), from = Number(h.query.get('next_page_token') ?? 0), page = voices.slice(from, from + per), more = from + per < voices.length;
      return { body: { voices: page, has_more: more, total_count: voices.length, next_page_token: more ? String(from + per) : null } };
    }
    if (h.path === '/v1/voices' && h.method === 'GET') return { body: { voices } };
    if (h.path === '/v1/voices/add' && h.method === 'POST') {
      const f = h.form ?? {}, file = f.files;
      if (typeof f.name !== 'string' || !f.name) return { status: 422, body: { detail: [{ loc: ['body', 'name'], msg: 'Field required', type: 'missing' }] } };
      if (!file || typeof file === 'string' || !file.data.length) return { status: 422, body: { detail: [{ loc: ['body', 'files'], msg: 'Field required', type: 'missing' }] } };
      o.avant?.();
      const voice_id = `copie${samples.length + 1}VoixFausse`;
      voices.push({ voice_id, name: f.name, category: 'cloned' });
      samples.push({ name: f.name, description: typeof f.description === 'string' ? f.description : '', file, voice_id });
      return { body: { voice_id, requires_verification: Boolean(o.verify) } };
    }
    const del = /^\/v1\/voices\/([^/]+)$/.exec(h.path);
    if (del && h.method === 'DELETE') {
      const id = decodeURIComponent(del[1]), i = voices.findIndex((v) => v.voice_id === id);
      if (i < 0) return { status: 400, body: { detail: { status: 'voice_does_not_exist', message: `A voice with the voice_id ${id} does not exist.` } } };
      voices.splice(i, 1); deleted.push(id);
      return { body: { status: 'ok' } };
    }
    return { status: 404, body: { detail: 'Not Found' } };
  });
  return { url: s.url, key, hits: s.hits, voices, said, samples, deleted, close: s.close };
}

// ---------------- Serveur HTTP de Piper

export interface PiperSim { url: string; hits: Hit[]; said: Array<{ text: string; voice?: string; length_scale?: number }>; close(): Promise<void> }
/** Le son que rend le faux Piper pour une voix : « siwis » (femme) à 22 050 Hz, les autres (homme) à 16 000 Hz. */
const piperWav = (voice: string | undefined, text: string, scale = 1) => (/siwis/.test(voice ?? '') ? wav(Math.max(0.3, text.length * 0.05 * scale), 22050, 330) : wav(Math.max(0.3, text.length * 0.05 * scale), 16000, 150));
/** Faux serveur Piper : `actuel` (POST /synthesize, « / » est une page web) ou `ancien` (POST / avec le texte brut). */
export async function piperSim(kind: 'actuel' | 'ancien', o: { voix?: string } = {}): Promise<PiperSim> {
  const said: PiperSim['said'] = [];
  const page = '<!DOCTYPE html>\n<html lang="en"><head><title>Piper</title></head><body><h1>Piper</h1></body></html>';
  const s = await serve((h): Reply => {
    if (kind === 'actuel') {
      if (h.path === '/' && h.method === 'GET') return { type: 'text/html; charset=utf-8', body: page };
      if (h.path === '/' ) return { status: 405, type: 'text/html; charset=utf-8', body: '<!doctype html><title>405 Method Not Allowed</title>' };
      if (h.path === '/synthesize' && h.method === 'POST') {
        const b = JSON.parse(h.body.toString('utf8')) as { text?: string; voice?: string; length_scale?: number }; // comme le vrai : le corps est lu en JSON quel que soit son type
        if (!b.text?.trim()) return { status: 500, type: 'text/html; charset=utf-8', body: '<!doctype html><title>500 Internal Server Error</title>' };
        said.push({ text: b.text, voice: b.voice, length_scale: b.length_scale });
        return { type: 'text/html; charset=utf-8', body: piperWav(b.voice ?? o.voix, b.text, b.length_scale ?? 1) };
      }
      return { status: 404, type: 'text/html; charset=utf-8', body: '<!doctype html><title>404 Not Found</title>' };
    }
    if (h.path === '/' && (h.method === 'POST' || h.method === 'GET')) {
      const text = (h.method === 'POST' ? h.body.toString('utf8') : h.query.get('text') ?? '').trim();
      if (!text) return { status: 500, type: 'text/html; charset=utf-8', body: '<!doctype html><title>500 Internal Server Error</title>' };
      said.push({ text });
      return { type: 'text/html; charset=utf-8', body: piperWav(o.voix, text) };
    }
    return { status: 404, type: 'text/html; charset=utf-8', body: '<!doctype html><title>404 Not Found</title>' };
  });
  return { url: s.url, hits: s.hits, said, close: s.close };
}

// ---------------- Piper sur la machine (vrai s'il est là, sinon un faux programme)

/** Le dossier du vrai Piper du banc (programme et les deux voix françaises), s'il est installé. */
export function vraiPiper(): string | undefined {
  const d = process.env.BANC_VOIX ?? join(TOOLS, 'voix');
  return ['piper/piper', 'piper-voices/fr_FR-tom-medium.onnx', 'piper-voices/fr_FR-tom-medium.onnx.json', 'piper-voices/fr_FR-siwis-medium.onnx', 'piper-voices/fr_FR-siwis-medium.onnx.json'].every((f) => existsSync(join(d, f))) ? d : undefined;
}
/** Le Python du banc où le serveur HTTP de Piper est installé (piper-tts[http]), s'il y est. */
export function vraiServeurPiper(): string | undefined {
  const py = join(process.env.BANC_VOIX ?? join(TOOLS, 'voix'), 'venv', 'bin', 'python');
  return vraiPiper() && existsSync(py) && existsSync(join(py, '..', 'flask')) ? py : undefined;
}
/** Le faux programme Piper : mêmes options que le vrai (--model, --output_file, --length_scale), texte sur l'entrée, un vrai WAV en sortie. */
const fauxPiper = (journal: string) => `#!/usr/bin/env node
const fs = require('node:fs'), a = process.argv.slice(2), opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : ''; };
fs.appendFileSync(${JSON.stringify(journal)}, a.join(' ') + '\\n');
const model = opt('--model'), out = opt('--output_file'), scale = Number(opt('--length_scale') || 1);
if (!model || !fs.existsSync(model) || !out) { console.error('faux piper : modèle ou sortie manquant'); process.exit(2); }
let text = ''; process.stdin.on('data', (d) => { text += d; }); process.stdin.on('end', () => {
  if (!text.trim()) { console.error('faux piper : rien à dire'); process.exit(1); }
  const femme = /siwis/.test(model), rate = femme ? 22050 : 16000, hz = femme ? 330 : 150, n = Math.max(1, Math.round(Math.max(0.3, text.length * 0.05 * scale) * rate)), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 9000), 44 + i * 2);
  fs.writeFileSync(out, b);
});
`;
export interface MaisonVoix { /** à mettre dans ODIN_HOME */ home: string; /** le vrai Piper du banc sert (sinon le faux programme) */ vrai: boolean; /** les lancements de Piper (ses options), dans l'ordre */ appels(): string[]; end(): void }
/**
 * Prépare un dossier d'Odin où la voix locale est installée : le vrai Piper du banc s'il existe, sinon un faux
 * programme. Dans les deux cas, chaque lancement est noté (ses options disent quelle voix a servi).
 */
export function maisonVoix(): MaisonVoix {
  const home = mkdtempSync(join(tmpdir(), 'odin-voix-maison-')), vrai = vraiPiper(), journal = join(home, 'appels-piper.log'), prog = join(home, 'voice', 'piper', 'piper');
  mkdirSync(join(home, 'voice', 'piper'), { recursive: true });
  if (vrai) {
    // Le vrai programme, lancé à travers un petit relais qui note ses options.
    writeFileSync(prog, `#!/bin/sh\necho "$@" >> '${journal}'\nexec '${join(vrai, 'piper', 'piper')}' "$@"\n`);
    symlinkSync(join(vrai, 'piper-voices'), join(home, 'voice', 'piper-voices'), 'dir');
  } else {
    writeFileSync(prog, fauxPiper(journal));
    mkdirSync(join(home, 'voice', 'piper-voices'), { recursive: true });
    for (const v of ['fr_FR-tom-medium', 'fr_FR-siwis-medium']) { writeFileSync(join(home, 'voice', 'piper-voices', `${v}.onnx`), 'faux modèle'); writeFileSync(join(home, 'voice', 'piper-voices', `${v}.onnx.json`), '{}'); }
  }
  chmodSync(prog, 0o755);
  return { home, vrai: Boolean(vrai), appels: () => (existsSync(journal) ? readFileSync(journal, 'utf8').split('\n').filter(Boolean) : []), end: () => rmSync(home, { recursive: true, force: true }) };
}
