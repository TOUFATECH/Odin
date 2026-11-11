import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accessError, clock, detectPlatform, parseVtt, pickTimes, timeline } from '../src/video/video.ts';
import { makeOdin } from './helpers.ts';

test('plateformes : YouTube (vidéo, Short, lien court), TikTok, Instagram, Facebook, fichier', () => {
  assert.deepEqual(detectPlatform('https://youtu.be/dQw4w9WgXcQ?t=42'), { platform: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', kind: 'vidéo' });
  assert.equal(detectPlatform('https://www.youtube.com/shorts/abcDEF12345').kind, 'Short');
  assert.match(detectPlatform('https://m.youtube.com/watch?feature=x').error!, /sans identifiant/);
  assert.equal(detectPlatform('https://vm.tiktok.com/ZMabc/').platform, 'tiktok');
  assert.equal(detectPlatform('https://www.instagram.com/reel/C1x2y3/').kind, 'Reel');
  assert.equal(detectPlatform('https://fb.watch/abc/').platform, 'facebook');
  assert.equal(detectPlatform('inbox/demo.mp4').platform, 'fichier');
  assert.match(accessError('ERROR: [instagram] Requested content is not available, rate-limit reached or login required'), /privée ou demande une connexion/);
  assert.equal(clock(3725), '1:02:05'); assert.equal(clock(65), '1:05');
});

test('sous-titres automatiques « roulants » dédoublonnés, instants choisis, ligne de temps fusionnée', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nBonjour à tous\n\n00:00:03.000 --> 00:00:05.000\nBonjour à tous aujourd\'hui\n\n00:00:05.000 --> 00:00:07.000 align:start\non installe <c>n8n</c>\n\n00:00:40.000 --> 00:00:42.000\nÉtape deux\n';
  const l = parseVtt(vtt);
  assert.deepEqual(l.map((x) => [x.t, x.text]), [[1, 'Bonjour à tous aujourd\'hui on installe n8n'], [40, 'Étape deux']]);
  const t = pickTimes([2, 3, 10.2, 70], 100, 16, 45);
  assert.ok(t.every((x, k) => k === 0 || x - t[k - 1] >= 4), 'pas d\'images trop proches');
  assert.ok(t.includes(45) && t.includes(90), 'couvre toute la vidéo');
  assert.equal(pickTimes(Array.from({ length: 100 }, (_, k) => k * 10), 1000, 12).length, 12);
  const tl = timeline({ lines: l, frames: [{ t: 6, file: 'x', seen: '[0:06] Un terminal. Texte : docker run n8n' }], chapters: [{ start: 0, title: 'Intro' }] });
  assert.equal(tl, '[0:00] 📑 Chapitre : Intro\n[0:01] 💬 Bonjour à tous aujourd\'hui on installe n8n\n[0:06] 👁 Un terminal. Texte : docker run n8n\n[0:40] 💬 Étape deux');
});

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
test('vraie vidéo (fichier) : scènes extraites par FFmpeg, regardées, paroles transcrites, analyse avec instants', { skip: !hasFfmpeg && 'FFmpeg n\'est pas installé sur cette machine' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-vid-'));
  const o = makeOdin([]);
  try {
    const vid = join(o.paths.workspace, 'demo.mp4');
    // 3 scènes de couleurs différentes (changements nets) + un son.
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=5', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=5', '-f', 'lavfi', '-i', 'color=c=green:s=320x240:d=5', '-f', 'lavfi', '-i', 'sine=f=440:d=15', '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vid]);
    const { analyzeVideo, videoAnalyze } = await import('../src/tools/video.ts');
    const seen: number[] = [];
    const ctx = {
      workspace: o.paths.workspace, home: o.paths.home, fullAccess: false, muninn: o.muninn, skills: o.skills, redactor: o.redactor, signal: new AbortController().signal, sessionId: 's', channel: 'web', peer: 'p', isTainted: () => false,
      vision: async (_q: string, imgs: unknown[]) => { seen.push(imgs.length); return (_q.match(/Instants : (.*)$/m)![1].split(', ')).map((t) => `[${t}] Écran uni. Texte : ÉTAPE`).join('\n'); },
      llm: async (system: string, user: string) => { if (system.includes('Résume en 3 phrases')) return 'Une démo.'; assert.match(user, /\[0:0\d\] 👁/); return 'Résumé : trois écrans [0:01] [0:05] [0:10] ✔ montré dans la vidéo.'; },
    } as never;
    const r = await analyzeVideo('demo.mp4', ctx);
    assert.ok(r.meta.duration >= 14 && r.meta.duration <= 16);
    const frames = (r.timeline.match(/👁/g) ?? []).length;
    assert.ok(frames >= 3, `au moins une image par scène (${frames})`);
    assert.ok(existsSync(join(r.dir, 'ligne-de-temps.txt')));
    const out = await videoAnalyze.run({ source: 'demo.mp4', mode: 'résumé', remember: true }, ctx);
    const text = typeof out === 'string' ? out : out.output;
    assert.match(text, /trois écrans \[0:01\]/); assert.match(text, /Enregistré en mémoire/);
    assert.equal((o.muninn.db.prepare("SELECT COUNT(*) n FROM memories WHERE tags LIKE '%video%'").get() as { n: number }).n, 1, 'mémoire avec la source');
    const last = readdirSync(join(o.paths.workspace, 'videos')).find((d) => existsSync(join(o.paths.workspace, 'videos', d, 'analyse-résumé.md')))!;
    assert.match(readFileSync(join(o.paths.workspace, 'videos', last, 'analyse-résumé.md'), 'utf8'), /trois écrans/);
  } finally { o.cleanup(); rmSync(dir, { recursive: true, force: true }); }
});
