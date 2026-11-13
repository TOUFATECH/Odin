// Cyclope contre un VRAI flux de caméra RTSP : un serveur de flux (MediaMTX) protégé par mot de
// passe, une « caméra » qui publie une image fixe puis une scène qui change (ffmpeg). Odin prend une
// photo, enregistre un clip, détecte le mouvement, envoie l'alerte avec la photo, respecte les heures.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { himinbjorg } from '../../../src/valhalla/modules/himinbjorg.ts';
import { findTool, freePort, sh, until, wait, type Scenario, type T } from '../lib.ts';

const SCENE_CALME = 'color=c=0x707070:s=320x180:r=5';
const SCENE_INTRUS = 'color=c=0x707070:s=320x180:r=5,drawbox=x=20:y=10:w=190:h=160:color=white:t=fill';

function publish(t: T, port: number, pw: string, scene: string) {
  return t.spawn('ffmpeg', ['-nostdin', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', scene, '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', '5', '-f', 'rtsp', '-rtsp_transport', 'tcp', `rtsp://editeur:${pw}@127.0.0.1:${port}/portail`]);
}

export const cameras: Scenario = {
  id: 'cameras', title: 'Cyclope ↔ caméra RTSP', mode: 'réel',
  what: 'Un vrai serveur de flux RTSP avec mot de passe et une caméra simulée par ffmpeg : photo, clip, détection de mouvement, alerte avec photo, heures de surveillance, panne.',
  async run(t) {
    await t.need('ffmpeg', 'ffprobe');
    const mtx = await findTool('mediamtx', 'BANC_MEDIAMTX');
    if (!mtx) t.skip('serveur de flux MediaMTX absent : lance « npm run banc:outils » (ou BANC_MEDIAMTX=/chemin/mediamtx)');
    const port = await freePort(), pubPw = randomBytes(9).toString('hex'), readPw = randomBytes(9).toString('hex');
    const dir = t.tmp(), yml = join(dir, 'mediamtx.yml');
    writeFileSync(yml, `logLevel: warn\nrtsp: yes\nrtspAddress: 127.0.0.1:${port}\nrtspTransports: [tcp]\nrtmp: no\nhls: no\nwebrtc: no\nsrt: no\nauthInternalUsers:\n- user: editeur\n  pass: ${pubPw}\n  ips: []\n  permissions:\n  - action: publish\n    path:\n- user: odin\n  pass: ${readPw}\n  ips: []\n  permissions:\n  - action: read\n    path:\npaths:\n  all_others:\n`);
    const server = t.spawn(mtx!, [yml]);
    const url = `rtsp://127.0.0.1:${port}/portail`;
    const readable = async () => (await sh('ffprobe', ['-v', 'error', '-rtsp_transport', 'tcp', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', `rtsp://odin:${readPw}@127.0.0.1:${port}/portail`], { timeoutMs: 8000 })).out.includes('h264');
    let cam = publish(t, port, pubPw, SCENE_CALME);
    if (!(await until(readable, 20_000, 500))) { t.ok(false, 'le serveur de flux et la caméra d\'essai démarrent', `${server.log().slice(-300)} | ${cam.log().slice(-300)}`); return; }

    const { v, alerts, events, notified } = t.valhalla([himinbjorg]);
    const ctx = v.ctx('himinbjorg');
    const hadEnv = process.env.CAMERA_PORTAIL; t.onEnd(() => { if (hadEnv === undefined) delete process.env.CAMERA_PORTAIL; else process.env.CAMERA_PORTAIL = hadEnv; });

    const refused = await v.act('himinbjorg', 'ajouter', { nom: 'Portail', adresse: `rtsp://odin:${readPw}@127.0.0.1:${port}/portail` });
    t.ok(refused.ok === false && /coffre/.test(refused.text), 'un mot de passe écrit dans l\'adresse est refusé (il va dans le coffre)', refused.text);
    const add = await v.act('himinbjorg', 'ajouter', { nom: 'Portail', adresse: url, mouvement: true });
    t.ok(add.ok, 'caméra ajoutée', add.text);
    t.ok(!JSON.stringify(ctx.settings).includes(readPw), 'aucun mot de passe dans les réglages de l\'appli');

    // Sans identifiants : refus propre, et jamais d'adresse avec mot de passe dans le message.
    delete process.env.CAMERA_PORTAIL;
    const noCred = await v.act('himinbjorg', 'photo', { camera: 'Portail' });
    t.ok(noCred.ok === false && /identifiants refusés/.test(noCred.text), 'sans identifiants : « identifiants refusés par la caméra »', noCred.text);
    process.env.CAMERA_PORTAIL = `odin:${readPw}`;

    const photo = await v.act('himinbjorg', 'photo', { camera: 'portail' });
    const pf = (photo.data as { file?: string } | undefined)?.file ?? '';
    t.ok(photo.ok && existsSync(pf) && readFileSync(pf).subarray(0, 2).toString('hex') === 'ffd8', 'photo prise sur le flux (JPEG valide)', photo.text);
    t.match((await sh('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', pf])).out.trim(), /^320,180$/, 'la photo a la taille du flux (320×180)');

    const rec = await v.act('himinbjorg', 'enregistrer', { camera: 'Portail', secondes: 5 });
    const cf = (rec.data as { file?: string } | undefined)?.file ?? '';
    const dur = Number((await sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', cf])).out.trim());
    t.ok(rec.ok && existsSync(cf) && dur >= 3 && dur <= 8, 'clip de 5 secondes enregistré et lisible', `${rec.text} · durée ${dur}`);

    // Détection de mouvement : scène calme (deux lectures), puis quelqu'un entre dans l'image.
    ctx.saveSettings({ clipSeconds: 5 });
    await himinbjorg.watch!.run(ctx); await himinbjorg.watch!.run(ctx);
    t.ok(!alerts.length && !events.some((e) => e.type === 'mouvement'), 'scène calme : aucune alerte', JSON.stringify(alerts));
    cam.kill('SIGKILL'); await wait(500);
    cam = publish(t, port, pubPw, SCENE_INTRUS);
    await until(readable, 15_000, 500);
    await himinbjorg.watch!.run(ctx);
    const al = alerts.find((a) => a.title === 'Mouvement : Portail');
    t.ok(al && al.level === 'haute', 'la scène change → alerte « Mouvement : Portail »', JSON.stringify(alerts));
    t.ok(al?.photo && existsSync(al.photo) && statSync(al.photo).size > 500, 'une photo du moment est jointe à l\'alerte');
    await wait(50);
    t.ok(notified.some((n) => /Mouvement : Portail/.test(n.text) && n.photo === al?.photo), 'le message pour ta messagerie part avec la photo');
    const ev = events.find((e) => e.type === 'mouvement');
    t.ok(ev && Number(ev.data.part) >= 20 && ev.data.surveillé === true, 'événement « mouvement » émis avec la part de l\'image qui a changé', JSON.stringify(ev));
    t.ok(await until(() => events.some((e) => e.type === 'clip' && existsSync(String(e.data.fichier))), 25_000, 500), 'un clip du mouvement est enregistré tout seul');
    const view = await himinbjorg.view(ctx, new URLSearchParams());
    t.ok(view.kpis?.some((k) => k.label === 'Mouvements 24 h' && Number(k.value) >= 1), 'la page compte le mouvement');

    // Heures de surveillance : hors plage, le mouvement est noté mais ne dérange pas.
    const h = new Date().getHours(), off = `${(h + 2) % 24}-${(h + 3) % 24}`;
    ctx.saveSettings({ cams: [{ ...(ctx.settings.cams as Array<Record<string, unknown>>)[0], hours: off }] });
    cam.kill('SIGKILL'); await wait(500);
    cam = publish(t, port, pubPw, SCENE_CALME);
    await until(readable, 15_000, 500);
    const before = alerts.length, evBefore = events.filter((e) => e.type === 'mouvement').length;
    await himinbjorg.watch!.run(ctx);
    t.ok(alerts.length === before && events.filter((e) => e.type === 'mouvement').length === evBefore + 1, `hors des heures surveillées (${off} h) : mouvement noté, pas d'alerte`);

    // Panne : la caméra ne répond plus → alerte, sans identifiants dans le texte.
    cam.kill('SIGKILL'); server.kill('SIGKILL'); await wait(800);
    await himinbjorg.watch!.run(ctx);
    const down = alerts.find((a) => /Caméra Portail injoignable/.test(a.title));
    t.ok(down && /injoignable/.test(down.detail ?? ''), 'caméra en panne → alerte « injoignable »', JSON.stringify(alerts.slice(-1)));
    t.ok(!JSON.stringify(alerts).includes(readPw) && !JSON.stringify(notified).includes(readPw), 'le mot de passe de la caméra n\'apparaît dans aucune alerte');
  },
};
