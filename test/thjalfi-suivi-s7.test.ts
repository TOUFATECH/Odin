// Genèse · Suivi et fin d'un déploiement (maquette « Genèse · Systèmes », lot S7, côté serveur) : chaque PC d'un
// déploiement en six étapes nommées (Réseau, Chargeur, Système, Installation, Logiciels, Fini), en direct ; « Annuler » dit
// si le disque a déjà été touché ; « Recommencer » repasse par la vérification du lot S6 (phrase « effacer 1 pc », identité
// revérifiée au démarrage, nouveau mot de passe au coffre) : jamais un effacement sans nouvelle autorisation ; la fin.
// SÛRETÉ : aucun serveur n'écoute (ni DHCP, ni TFTP, ni HTTP) : chaque PC est SIMULÉ par les demandes qu'il ferait
// (PxeHttp.simuler, le même traitement que par le réseau). Aucun vrai PC, aucun vrai disque. Dossiers temporaires neufs.
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

// ---------------- Les règles pures ----------------
test('S7 · six étapes nommées, et le disque : jamais « touché » avant que le PC lise son fichier de réponses', () => {
  assert.deepEqual([...X.ETAPES_NOMMEES], ['Réseau', 'Chargeur', 'Système', 'Installation', 'Logiciels', 'Fini']);
  assert.equal(X.disqueTouche('auto', 1), 'non', 'au menu');
  assert.equal(X.disqueTouche('auto', 2, 'auto'), 'non', 'système envoyé, réponses pas encore lues');
  assert.equal(X.disqueTouche('auto', 3, 'auto'), 'oui', 'fichier de réponses lu : le disque est écrit');
  assert.equal(X.disqueTouche('auto', 5), 'oui');
  assert.equal(X.disqueTouche('menu', 2), 'peut-être', 'proposé au menu : installation à la main possible');
  assert.equal(X.disqueTouche('auto', 2, 'manuelle'), 'peut-être');
  assert.match(X.texteAnnulation({ nom: 'pc-01', etat: 'attente', disque: 'non', prochain: false }), /pas encore démarré.*pas touché/);
  assert.match(X.texteAnnulation({ nom: 'pc-01', etat: 'en cours', disque: 'oui', prochain: false }), /déjà effacé/);
  assert.match(X.texteAnnulation({ nom: 'pc-01', etat: 'en cours', disque: 'non', prochain: false }), /pas encore touché/);
  assert.match(X.texteAnnulation({ nom: 'pc-01', etat: 'en cours', disque: 'peut-être', prochain: false }), /ne peut pas savoir/);
});

test('S7 · pcDeDeploiement : attente, expirée, refusée au démarrage, remplacée — sans jamais montrer un jeton ni un mot de passe', () => {
  const now = 1_000_000;
  const a = (o: Record<string, unknown> = {}) => ({ id: 'x', lot: 'l', mac: A, iso: UBU, isoNom: 'Ubuntu', facon: 'auto', nom: 'pc-01', cree: now - 10, expire: now + 1000, mdp: 'SECRET-CHIFFRE', ...o });
  const vide = { live: {}, hist: [], now };
  const at = X.pcDeDeploiement(a(), vide);
  assert.equal(at.etat, 'attente'); assert.equal(at.etape, -1); assert.equal(at.disque, 'non'); assert.equal(at.annulable, true); assert.equal(at.recommencable, false);
  assert.match(at.ligne, /allume-le/);
  assert.equal(X.pcDeDeploiement(a({ expire: now - 1 }), vide).etat, 'expirée');
  assert.equal(X.pcDeDeploiement(a({ expire: now - 1 }), vide).recommencable, true);
  const ref = X.pcDeDeploiement(a({ annulee: { at: now, raison: `numéro de série différent (PC ${A} au démarrage)` } }), vide);
  assert.equal(ref.etat, 'refusée'); assert.match(ref.raison, /rien n'est effacé/);
  assert.equal(ref.recommencable, false, 'ce n\'était pas le PC autorisé : vérifier le PC, puis « Déployer » (jamais « Recommencer » en un clic)');
  assert.equal(X.pcDeDeploiement(a({ annulee: { at: now, raison: `partage Windows absent (PC ${A} au démarrage)` } }), vide).recommencable, true, 'refusé pour un réglage : « Recommencer » une fois réglé');
  assert.equal(X.pcDeDeploiement(a({ annulee: { at: now, raison: 'remplacée par un nouveau déploiement' } }), vide).etat, 'remplacée');
  assert.equal(X.pcDeDeploiement(a({ annulee: { at: now, raison: 'x' } }), { ...vide, relance: true }).recommencable, false, 'déjà recommencé : pas deux fois');
  assert.equal(X.pcDeDeploiement(a({ expire: now - 1 }), { ...vide, bloque: true }).recommencable, false, 'bloqué : débloquer d\'abord');
  assert.equal(X.pcDeDeploiement(a({ mac: '', expire: now - 1 }), vide).recommencable, false, '« le prochain PC », jamais démarré : aucun PC à recommencer');
  const tout = JSON.stringify(X.lotsDeDeploiement([a({ consommee: { at: now - 5, mac: A, token: 'JETON-SECRET' } }), a({ id: 'y', mac: B })], vide));
  assert.doesNotMatch(tout, /JETON-SECRET|SECRET-CHIFFRE/, 'ni jeton ni mot de passe chiffré dans ce que voit la page');
});

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

test('S7 · « deploiement_suivi », « deploiement_annuler », « recommencer » : propriétaire seul', async () => {
  const w = await monde();
  try {
    const acts = w.v.modules().find((m) => m.id === 'thjalfi')!.actions;
    for (const id of ['deploiement_suivi', 'deploiement_annuler', 'recommencer']) {
      const a = acts.find((x) => x.id === id); assert.ok(a, id); assert.equal(a!.proprietaireSeul, true, id);
      for (const qui of [{ qui: 'member' as const }, { qui: 'guest' as const }, { auto: true }, { by: 'automatisation' as const }]) {
        const r = await w.v.act('thjalfi', id, { autorisation: 'x', phrase: 'effacer 1 pc' }, qui);
        assert.equal(r.ok, false, `${id} ${JSON.stringify(qui)}`); assert.equal(r.data, undefined, 'rien ne fuit');
      }
    }
    assert.equal(typeof acts.find((x) => x.id === 'deploiement_annuler')!.grave, 'function', 'annuler : ton accord, avec ce qui arrive au disque');
    assert.equal(typeof acts.find((x) => x.id === 'recommencer')!.grave, 'function', 'recommencer efface : action grave');
    assert.deepEqual(await suivi(w), [], 'aucun déploiement');
  } finally { w.fin(); }
});

test('S7 · un déploiement suivi PC par PC jusqu\'à la fin ; Annuler avant le démarrage : rien n\'est effacé, le PC n\'est plus autorisé', async () => {
  const w = await monde();
  try {
    await w.pc(A, SERIE_A); // A vu au menu
    const r = await w.v.act('thjalfi', 'deployer', { pcs: [A, B], iso: UBU, facon: 'auto', phrase: 'effacer 2 pc' });
    assert.notEqual(r.ok, false, r.text);
    let [lot] = await suivi(w);
    assert.equal(lot.chiffres.total, 2); assert.equal(lot.chiffres.attente, 2); assert.equal(lot.fini, false);
    const [pa, pb] = [pcDe(lot, 'pc-01'), pcDe(lot, 'pc-02')];
    assert.equal(pa.mac, A); assert.equal(pa.etat, 'attente'); assert.equal(pa.disque, 'non'); assert.equal(pa.etape, -1);

    // B : annulé avant d'avoir démarré. La confirmation le dit, et B n'est plus jamais effacé par cette autorisation.
    const act = w.v.modules().find((m) => m.id === 'thjalfi')!.actions.find((x) => x.id === 'deploiement_annuler')!;
    assert.match(act.grave!({ autorisation: pb.autorisation }, w.v.ctx('thjalfi')) ?? '', /pas encore démarré.*pas touché/);
    const an = await w.v.act('thjalfi', 'deploiement_annuler', { autorisation: pb.autorisation });
    assert.notEqual(an.ok, false, an.text); assert.match(an.text, /pas touché/);
    assert.doesNotMatch(await w.pc(B, 'serie=BBB111', IP_B), /autoinstall|seed\//, 'B annulé : le menu ordinaire, rien d\'automatique');
    assert.ok(autorisees(w).find((x) => x.mac === B)!.annulee, 'autorisation annulée dans le fichier');

    // A démarre : vérifié, menu de déploiement → étape « Chargeur » ; puis le système, l'installation, les logiciels, la fin.
    const m = await w.pc(A, SERIE_A); assert.match(m, /autoinstall/);
    [lot] = await suivi(w);
    assert.equal(pcDe(lot, 'pc-01').etat, 'en cours'); assert.equal(pcDe(lot, 'pc-01').etape, 1); assert.equal(pcDe(lot, 'pc-01').disque, 'non');
    await charge(w, A, IP_A);
    [lot] = await suivi(w);
    assert.equal(pcDe(lot, 'pc-01').etape, 2, 'Système'); assert.equal(pcDe(lot, 'pc-01').disque, 'non', 'réponses pas encore lues : disque intact');
    const tok = jeton(m);
    assert.equal((await w.get(`/seed/${tok}/user-data`)).status, 200);
    [lot] = await suivi(w);
    assert.equal(pcDe(lot, 'pc-01').etape, 3, 'Installation'); assert.equal(pcDe(lot, 'pc-01').disque, 'oui', 'fichier de réponses lu : le disque est écrit');
    assert.match(w.v.modules().find((x) => x.id === 'thjalfi')!.actions.find((x) => x.id === 'deploiement_annuler')!.grave!({ autorisation: pa.autorisation }, w.v.ctx('thjalfi')) ?? '', /déjà effacé/, 'Annuler dit que le disque est déjà touché');
    await w.get(`/etat/${tok}?e=logiciels`); await w.get(`/etat/${tok}?e=logiciel&nom=firefox&ok=1`); await w.get(`/etat/${tok}?e=logiciel&nom=vlc&ok=1`);
    [lot] = await suivi(w);
    assert.equal(pcDe(lot, 'pc-01').etape, 4, 'Logiciels'); assert.equal(pcDe(lot, 'pc-01').logiciels.ok, 2);
    assert.equal((await w.get(`/etat/${tok}?e=fini&nom=pc-01&ip=${IP_A}`)).status, 200);
    [lot] = await suivi(w);
    const fa = pcDe(lot, 'pc-01');
    assert.equal(fa.etat, 'prêt'); assert.equal(fa.etape, 5); assert.equal(fa.pct, 100); assert.equal(fa.ip, IP_A); assert.equal(fa.recommencable, false, 'prêt : pas de « Recommencer »');
    assert.ok(fa.deroulement.some((e: { etape: string }) => e.etape === 'Installation'), 'le déroulement nomme les étapes');
    assert.equal(lot.fini, true, 'tous les PC ont fini (prêt ou annulé) : la fin');
    assert.equal(lot.chiffres.prets, 1); assert.equal(lot.chiffres.annulees, 1);
    const tout = JSON.stringify(lot); assert.ok(!tout.includes(tok), 'le jeton ne sort jamais vers la page');
    const rec = await w.v.act('thjalfi', 'recommencer', { autorisation: fa.autorisation, phrase: 'effacer 1 pc' });
    assert.equal(rec.ok, false, 'un PC prêt ne se recommence pas d\'ici'); assert.match(rec.text, /Déployer/);
  } finally { w.fin(); }
});

test('S7 · Annuler en pleine installation (disque déjà effacé), puis Recommencer : phrase vérifiée, nouvelle autorisation, même nom, une seule fois', async () => {
  const w = await monde();
  try {
    await w.pc(C, 'serie=CCC333', IP_C);
    assert.notEqual((await w.v.act('thjalfi', 'deployer', { pcs: [C], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' })).ok, false);
    const m = await w.pc(C, 'serie=CCC333', IP_C); const tok = jeton(m);
    await charge(w, C, IP_C); await w.get(`/seed/${tok}/user-data`, IP_C);
    let [lot] = await suivi(w); const pc = pcDe(lot, 'pc-01');
    assert.equal(pc.disque, 'oui');
    const an = await w.v.act('thjalfi', 'deploiement_annuler', { autorisation: pc.autorisation });
    assert.notEqual(an.ok, false, an.text); assert.match(an.text, /déjà effacé/);
    { const r = await w.get(`/seed/${tok}/user-data`, IP_C); assert.ok(r.status >= 400, 'annulé : plus aucun fichier de réponses'); assert.doesNotMatch(r.body ?? '', /autoinstall/); }
    [lot] = await suivi(w);
    assert.equal(pcDe(lot, 'pc-01').etat, 'annulée'); assert.equal(pcDe(lot, 'pc-01').recommencable, true); assert.equal(lot.fini, true);

    // Recommencer : sans la phrase exacte, rien n'est autorisé ; le PC qui redémarre n'est pas effacé.
    for (const phrase of ['', 'effacer 2 pc', 'oui']) {
      const r = await w.v.act('thjalfi', 'recommencer', { autorisation: pc.autorisation, phrase });
      assert.equal(r.ok, false, `phrase « ${phrase} »`);
    }
    w.avance(30 * 60_000 + 1000); // l'adresse coupée par l'annulation ne l'est plus
    assert.doesNotMatch(await w.pc(C, 'serie=CCC333', IP_C), /autoinstall|seed\//, 'sans nouvelle autorisation : jamais d\'effacement');
    const avant = autorisees(w).length;
    const rec = await w.v.act('thjalfi', 'recommencer', { autorisation: pc.autorisation, phrase: 'effacer 1 pc' });
    assert.notEqual(rec.ok, false, rec.text);
    const l = autorisees(w); assert.equal(l.length, avant + 1, 'une NOUVELLE autorisation');
    const neuve = l.at(-1)!; assert.equal(neuve.mac, C); assert.equal(neuve.nom, 'pc-01', 'le même nom'); assert.notEqual(neuve.lot, pc.lot); assert.ok(neuve.mdp, 'nouveau mot de passe, chiffré');
    assert.equal(neuve.serie, 'CCC333', 'l\'identité vue est revérifiée au démarrage');
    const lots = await suivi(w);
    assert.equal(lots[0].pcs[0].etat, 'attente', 'le déploiement recommencé est le plus récent');
    assert.equal(pcDe(lots[1], 'pc-01').relance, true); assert.equal(pcDe(lots[1], 'pc-01').recommencable, false);
    const deux = await w.v.act('thjalfi', 'recommencer', { autorisation: pc.autorisation, phrase: 'effacer 1 pc' });
    assert.equal(deux.ok, false, 'pas deux fois'); assert.match(deux.text, /déjà été recommencé/);
    // L'identité est revérifiée : un autre appareil avec l'adresse de C n'est pas effacé.
    assert.doesNotMatch(await w.pc(C, 'serie=AUTRE999', '192.168.1.99'), /autoinstall|seed\//);
  } finally { w.fin(); }
});

test('S7 · sans nouvelles : « abandonnée », avec sa raison, et « Recommencer » proposé ; le délai qui reste est estimé honnêtement', async () => {
  const w = await monde();
  try {
    await w.pc(A, SERIE_A);
    assert.notEqual((await w.v.act('thjalfi', 'deployer', { pcs: [A], iso: UBU, facon: 'auto', phrase: 'effacer 1 pc' })).ok, false);
    const m = await w.pc(A, SERIE_A); await charge(w, A, IP_A); await w.get(`/seed/${jeton(m)}/user-data`);
    let [lot] = await suivi(w);
    assert.equal(lot.resteMin, null, 'aucune installation réussie de ce système vue : pas d\'estimation inventée');
    w.avance(31 * 60_000); w.veille();
    [lot] = await suivi(w);
    const p = pcDe(lot, 'pc-01');
    assert.equal(p.etat, 'abandonnée'); assert.match(p.raison, /signe de vie/); assert.equal(p.recommencable, true); assert.equal(p.disque, 'oui');
    assert.equal(lot.fini, true); assert.equal(lot.chiffres.rates, 1);
  } finally { w.fin(); }
});
