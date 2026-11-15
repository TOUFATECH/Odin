// Genèse · le menu de démarrage par le réseau (PXE) propose les images de la bibliothèque d'ISO commune (l'espace
// ISO d'Andromède, partagé avec Hydre) : une image prête (complète et passée par l'antivirus) est proposée ; une
// image en cours de téléchargement ou en quarantaine ne l'est jamais ; une ISO déposée dans le dossier apparaît au
// scan suivant, sans autre manipulation. Faux poste PXE (il demande le menu comme iPXE), petites ISO d'essai.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { intelOf } from '../src/valhalla/modules/ullr.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';

const FIX = join(import.meta.dirname, 'fixtures', 'thjalfi');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('menu PXE : l\'image prête est proposée ; pas celle en cours ni celle en quarantaine ; une ISO déposée apparaît au scan suivant', async () => {
  const home = mkdtempSync(join(tmpdir(), 'genese-bib-')), dir = join(home, 'iso');
  const cle = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'cd'.repeat(32);
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('réseau coupé'); }) as never, notify: async () => {}, autonomy: () => 'equilibre' } as never);
  try {
    // L'espace ISO : une image d'Ubuntu (prête), une image en cours de téléchargement, une image piégée.
    mkdirSync(dir, { recursive: true });
    const ubuntu = gunzipSync(readFileSync(join(FIX, readdirSync(FIX).find((f) => /^ubuntu/.test(f))!))), debian = gunzipSync(readFileSync(join(FIX, readdirSync(FIX).find((f) => /^debian/.test(f))!)));
    writeFileSync(join(dir, 'ubuntu-24.04.3-live-server-amd64.iso'), ubuntu);
    mkdirSync(join(dir, 'Rocky'), { recursive: true }); writeFileSync(join(dir, 'Rocky', '.Rocky-9.6-x86_64-minimal.iso.part'), Buffer.alloc(4096, 1));
    const piege = Buffer.concat([debian, Buffer.from(`ajout piégé (simulé) ${Math.random()}`)]); writeFileSync(join(dir, 'debian-13.1.0-amd64-netinst.iso'), piege);
    await v.act('eitri', 'dossier', { chemin: dir });
    await v.act('ullr', 'etat');
    intelOf(v.ctx('ullr')).build([{ hashes: [{ sha: sha(piege), family: 'Agent-simulé' }], stamp: { id: 'essai', at: new Date().toISOString(), count: 1, licence: 'essai' } }]);
    const boot = join(home, 'valhalla', 'thjalfi', 'boot'); mkdirSync(boot, { recursive: true }); writeFileSync(join(boot, 'undionly.kpxe'), 'KPXE'); writeFileSync(join(boot, 'ipxe.efi'), 'EFI');
    v.ctx('thjalfi').saveSettings({ ports: { http: 0, tftp: 0, dhcp: 0, pxe: 0, client: 0 }, ip: '127.0.0.1', mode: 'aucun' });
    const base = /http:\/\/127\.0\.0\.1:\d+/.exec((await v.act('thjalfi', 'allumer')).text)![0];
    const get = async (p: string) => { const x = await fetch(`${base}${p}`); return { status: x.status, text: await x.text() }; };
    // Le poste a reçu son adresse et démarre en PXE : il demande le menu.
    const menu = (await get('/menu.ipxe?mac=52-54-00-bb-00-01&fw=efi')).text;
    assert.match(menu, /item e-ubuntu-24-04-3-live-server-amd64 ubuntu-24\.04\.3-live-server-amd64/, 'l\'image prête est proposée');
    assert.doesNotMatch(menu, /rocky/i, 'une image en cours de téléchargement n\'est pas proposée');
    assert.doesNotMatch(menu, /debian/i, 'une image en quarantaine n\'est jamais proposée');
    assert.ok(!existsSync(join(dir, 'debian-13.1.0-amd64-netinst.iso')), 'l\'image piégée a quitté l\'espace ISO');
    assert.ok((v.ctx('ullr').settings.quarantine as Array<{ nom?: string }>).some((q) => q.nom === 'debian-13.1.0-amd64-netinst.iso'));
    // Elle n'est pas servie non plus si on la demande directement ; l'image prête, oui.
    assert.equal((await get('/iso/debian-13-1-0-amd64-netinst.iso')).status, 404);
    assert.equal((await fetch(`${base}/iso/ubuntu-24-04-3-live-server-amd64.iso`, { headers: { range: 'bytes=0-9' } })).status, 206);
    // La même bibliothèque que Hydre : l'état de chaque image.
    const b = (await v.act('ymir', 'isos_pxe')).data as { dossier: string; images: Array<{ nom: string; etat: string }>; enCours: Array<{ nom: string; recu: number }>; quarantaine: Array<{ nom: string; menace: string }> };
    assert.equal(b.dossier, dir); assert.deepEqual(b.images.map((x) => `${x.nom}:${x.etat}`), ['ubuntu-24.04.3-live-server-amd64.iso:prête']);
    assert.deepEqual(b.enCours.map((x) => `${x.nom}:${x.recu}`), ['Rocky-9.6-x86_64-minimal.iso:4096']); assert.deepEqual(b.quarantaine.map((x) => `${x.nom}:${x.menace}`), ['debian-13.1.0-amd64-netinst.iso:Malware connu : Agent-simulé']);
    // La page de Genèse : la même liste, avec l'état de chacune.
    const vue = await v.module('thjalfi')!.view(v.ctx('thjalfi'), new URLSearchParams());
    const cartes = vue.sections.find((s) => s.kind === 'cards' && s.title === 'ISO (Andromède)') as { items: Array<{ title: string; badge?: string }> };
    assert.deepEqual(cartes.items.map((c) => c.title), ['ubuntu-24.04.3-live-server-amd64']);
    const attente = vue.sections.find((s) => s.title === 'Images pas encore démarrables') as { items: Array<{ title: string; detail: string }> };
    assert.match(attente.items.find((x) => /Rocky/.test(x.title))!.detail, /en cours de téléchargement .* une fois complète et passée par l'antivirus/);
    assert.match(attente.items.find((x) => /debian/.test(x.title))!.detail, /en quarantaine \(Malware connu : Agent-simulé\) : jamais proposée/);
    // Une ISO déposée dans le dossier (à la main) : au scan suivant, elle est dans le menu, sans autre manipulation.
    copyFileSync(join(dir, 'ubuntu-24.04.3-live-server-amd64.iso'), join(dir, 'ubuntu-24.04.4-live-server-amd64.iso'));
    const menu2 = (await get('/menu.ipxe?mac=52-54-00-bb-00-01&fw=efi')).text;
    assert.match(menu2, /item e-ubuntu-24-04-4-live-server-amd64 /); assert.match(menu2, /item e-ubuntu-24-04-3-live-server-amd64 /);
    assert.equal(((await v.act('ymir', 'bibliotheque_iso')).data as { isos: Array<{ nom: string; antivirus?: { verdict: string } }> }).isos.find((x) => /24\.04\.4/.test(x.nom))!.antivirus?.verdict, 'sain', 'analysée avant d\'être proposée');
    // Une ancienne version rangée dans « old » reste visible dans la page, mais n'est pas proposée au démarrage.
    mkdirSync(join(dir, 'old'), { recursive: true }); copyFileSync(join(dir, 'ubuntu-24.04.3-live-server-amd64.iso'), join(dir, 'old', 'ubuntu-24.04.2-live-server-amd64.iso'));
    const menu3 = (await get('/menu.ipxe?mac=52-54-00-bb-00-01&fw=efi')).text;
    assert.doesNotMatch(menu3, /24-04-2/);
    const vue3 = await v.module('thjalfi')!.view(v.ctx('thjalfi'), new URLSearchParams());
    assert.equal((vue3.sections.find((s) => s.kind === 'cards' && s.title === 'ISO (Andromède)') as { items: Array<{ title: string; badge?: string }> }).items.find((c) => /24\.04\.2/.test(c.title))!.badge, 'ancienne version (old)');
  } finally { v.stop(); if (cle === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = cle; rmSync(home, { recursive: true, force: true }); }
});
