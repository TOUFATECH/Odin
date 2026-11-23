// Genèse · Suivi et fin (lot S7), relecture adverse : ce qu'un « Recommencer » ou un « Annuler » ne doit JAMAIS permettre.
// SÛRETÉ : aucun serveur n'écoute ; chaque PC est SIMULÉ (PxeHttp.simuler). Aucun vrai PC, aucun vrai disque. Dossiers temporaires neufs.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { after, test } from 'node:test';
import * as SV from '../src/valhalla/thjalfi/suivi.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const X = SV as unknown as Record<string, any>;
const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const FIX = join(import.meta.dirname, 'fixtures', 'thjalfi');
const isoDir = (dir: string) => { mkdirSync(dir, { recursive: true }); for (const f of readdirSync(FIX)) writeFileSync(join(dir, f.replace(/\.gz$/, '')), gunzipSync(readFileSync(join(FIX, f)))); return dir; };

const A = '52:54:00:3a:91:0c', B = '52:54:00:7e:12:a4', C = '52:54:00:c1:5b:77';
const IP_A = '192.168.1.21', IP_B = '192.168.1.22', IP_C = '192.168.1.23';
const UBU = 'ubuntu-24-04-3-live-server-amd64';
const SERIE_A = 'serie=PC1A2B3C&uuid=4c4c4544-0042-3510-8051-b4c04f4e3732';


// ---------------- Avec Odin, PC simulés ----------------
interface Monde { v: Valhalla; dir: string; pc: (mac: string, q?: string, ip?: string) => Promise<string>; get: (p: string, ip?: string) => Promise<{ status: number; body: string }>; avance: (ms: number) => void; veille: () => void; fin: () => void }
async function monde(): Promise<Monde> {
  const home = mkdtempSync(join(tmpdir(), 'odin-s7-')); dossiers.push(home);
  const saved = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'ef'.repeat(32);
  let t = new Date(2026, 10, 23, 14, 0).getTime();
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('aucun réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(t) } as never);
  await v.act('eitri', 'dossier', { chemin: isoDir(join(home, 'iso')) });
  v.ctx('thjalfi').saveSettings({ ip: '192.168.1.10', mode: 'aucun' });
  const mod = v.modules().find((m) => m.id === 'thjalfi') as unknown as { serveurSimule: (c: unknown) => { simuler: (m: string, u: string, f: string) => Promise<{ status: number; body: string }> }; watch: { run: (c: unknown) => void } };
  const h = mod.serveurSimule(v.ctx('thjalfi'));
  const get = (p: string, ip = IP_A) => h.simuler('GET', p, ip);
  const pc = async (mac: string, q = '', ip = IP_A) => (await get(`/menu.ipxe?mac=${mac}&fw=efi${q ? `&${q}` : ''}`, ip)).body;
  return { v, dir: join(home, 'valhalla', 'thjalfi'), pc, get, avance: (ms) => { t += ms; }, veille: () => mod.watch.run(v.ctx('thjalfi')), fin: () => { v.stop(); if (saved === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = saved; } };
}
const suivi = async (w: Monde) => { const r = await w.v.act('thjalfi', 'deploiement_suivi', {}); assert.notEqual(r.ok, false, r.text); return (r.data as { lots: Array<Record<string, any>> }).lots; };
const pcDe = (lot: Record<string, any>, nom: string) => (lot.pcs as Array<Record<string, any>>).find((p) => p.nom === nom)!;
const autorisees = (w: Monde) => { try { return JSON.parse(readFileSync(join(w.dir, 'deploiements-autorises.json'), 'utf8')) as Array<Record<string, any>>; } catch { return []; } };
/** Le PC charge le système : le noyau indiqué par son menu (même chemin que par le réseau). */
async function charge(w: Monde, mac: string, ip: string) {
  const r = await w.get(`/f/${UBU}/casper/vmlinuz?m=${mac}`, ip); assert.ok(r.status < 400, `noyau servi (${r.status})`);
}
const jeton = (menu: string) => /seed\/([\w-]+)\//.exec(menu)![1];


test("S7 relecture · « Recommencer » après « ce n'est pas le PC autorisé » : jamais rattaché à l'appareil qui a recopié l'adresse", async () => {
  const w = await monde();
  try {
    await w.pc(C, 'serie=CCC333', IP_C); // le vrai PC, vu il y a plus de 24 h
    w.avance(25 * 3600_000);
    const r = await w.v.act('thjalfi', 'deployer', { pcs: [C], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' });
    assert.notEqual(r.ok, false, r.text);
    assert.equal(autorisees(w).at(-1)!.serie, 'CCC333');
    // Un autre appareil démarre avec l'adresse de C : refusé, rien n'est effacé.
    assert.doesNotMatch(await w.pc(C, 'serie=FAUX999', '192.168.1.99'), /autoinstall|seed\//);
    const [lot] = await suivi(w); const p = pcDe(lot, 'pc-01');
    assert.equal(p.etat, 'refusée');
    assert.equal(p.recommencable, false, 'refusé parce que ce n\'est pas le PC autorisé : pas de « Recommencer » en un clic');
    const rec = await w.v.act('thjalfi', 'recommencer', { autorisation: p.autorisation, phrase: 'effacer 1 pc' });
    assert.equal(rec.ok, false, rec.text);
    assert.ok(!autorisees(w).some((a) => a.serie === 'FAUX999'), 'aucune autorisation pour l\'appareil qui a recopié l\'adresse');
    assert.doesNotMatch(await w.pc(C, 'serie=FAUX999', '192.168.1.99'), /autoinstall|seed\//, 'l\'autre appareil n\'est jamais effacé');
  } finally { w.fin(); }
});

test("S7 relecture · « Recommencer » : l'appareil vu avec cette adresse a changé depuis l'autorisation → refusé (jamais « le dernier venu »)", async () => {
  const w = await monde();
  try {
    await w.pc(C, 'serie=CCC333', IP_C);
    assert.notEqual((await w.v.act('thjalfi', 'deployer', { pcs: [C], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' })).ok, false);
    const [lot0] = await suivi(w); const p0 = pcDe(lot0, 'pc-01');
    assert.notEqual((await w.v.act('thjalfi', 'deploiement_annuler', { autorisation: p0.autorisation })).ok, false);
    w.avance(25 * 3600_000); // plus de 24 h : la première identité n'est plus dans la fenêtre
    await w.pc(C, 'serie=AUTRE42', '192.168.1.98'); // un autre appareil avec l'adresse de C, au menu ordinaire
    const rec = await w.v.act('thjalfi', 'recommencer', { autorisation: p0.autorisation, phrase: 'effacer 1 pc' });
    assert.equal(rec.ok, false, rec.text);
    assert.ok(!autorisees(w).some((a) => a.serie === 'AUTRE42'));
  } finally { w.fin(); }
});

test("S7 relecture · refusé au démarrage, puis installation lancée à la main au menu ordinaire : la page ne dit pas « rien n'est effacé »", async () => {
  const w = await monde();
  try {
    await w.pc(C, 'serie=CCC333', IP_C);
    assert.notEqual((await w.v.act('thjalfi', 'deployer', { pcs: [C], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' })).ok, false);
    assert.doesNotMatch(await w.pc(C, 'serie=FAUX999', '192.168.1.99'), /autoinstall|seed\//);
    await charge(w, C, '192.168.1.99'); // quelqu'un choisit le système à la main au menu ordinaire
    const [lot] = await suivi(w); const p = pcDe(lot, 'pc-01');
    assert.equal(p.etat, 'refusée');
    assert.equal(p.disque, 'peut-être', 'une installation a été lancée à la main après : Odin ne peut pas dire que le disque est intact');
    assert.doesNotMatch(`${p.raison} ${p.ligne}`, /rien n'est effacé/);
  } finally { w.fin(); }
});

test("S7 relecture · le déroulement ne montre que du texte nettoyé (ce qu'un PC envoie)", async () => {
  const w = await monde();
  try {
    await w.pc(A, SERIE_A);
    assert.notEqual((await w.v.act('thjalfi', 'deployer', { pcs: [A], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' })).ok, false);
    const m = await w.pc(A, SERIE_A); const tok = jeton(m);
    await charge(w, A, IP_A); await w.get(`/seed/${tok}/user-data`);
    await w.get(`/etat/${tok}?e=logiciels`);
    await w.get(`/etat/${tok}?e=logiciel&ok=1&nom=${encodeURIComponent('<img src=x onerror=alert(1)>‮\u0007' + 'x'.repeat(500))}`);
    const [lot] = await suivi(w); const p = pcDe(lot, 'pc-01');
    for (const e of p.deroulement) { assert.doesNotMatch(e.detail, /[<>‮\u0007]/, e.detail); assert.ok(e.detail.length <= 160, String(e.detail.length)); }
    assert.ok(!JSON.stringify(lot).includes(tok));
  } finally { w.fin(); }
});
