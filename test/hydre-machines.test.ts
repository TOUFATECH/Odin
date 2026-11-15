// Hydre · ce que les machines de ce PC gagnent : disque agrandi (jamais réduit), adresse fixe changée (vérifiée
// libre), console d'un LXC et clavier d'une VM (touches QMP), modèles et machines créées depuis un modèle.
// Le parcours se fait avec un faux LXC (aucun vrai conteneur créé, aucune commande réelle lancée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { disqueLxc, qcodes, TOUCHES } from '../src/valhalla/ymir/local.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

test('clavier d\'une VM : texte → touches QMP (clavier américain), accents refusés ; disque d\'un LXC en boucle', () => {
  assert.deepEqual(qcodes('ls -A\n'), [['l'], ['s'], ['spc'], ['minus'], ['shift', 'a'], ['ret']]);
  assert.deepEqual(qcodes('a:"|'), [['a'], ['shift', 'semicolon'], ['shift', 'apostrophe'], ['shift', 'backslash']]);
  assert.throws(() => qcodes('é'), /impossible à taper/);
  assert.deepEqual(TOUCHES['ctrl-alt-suppr'], ['ctrl', 'alt', 'delete']);
  assert.equal(disqueLxc('lxc.uts.name = x\nlxc.rootfs.path = loop:/l/x/rootdev\n'), '/l/x/rootdev');
  assert.equal(disqueLxc('lxc.rootfs.path = dir:/l/x/rootfs\n'), undefined);
});

function fauxLxc() {
  const calls: string[][] = [], state = new Map<string, string>();
  const run = async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (cmd === 'sh') return { code: /lxc-|ip$|truncate|resize2fs/.test(args[1]) ? 0 : 1, out: '', err: '' };
    if (cmd === 'ping') return { code: ['10.0.3.60', '10.0.3.90'].includes(args.at(-1)!) ? 0 : 1, out: '', err: '' }; // .60 et .90 répondent déjà
    const P = args[args.indexOf('-P') + 1], name = args[args.indexOf('-n') + 1];
    if (cmd === 'lxc-create') { mkdirSync(join(P, name, 'rootfs', 'etc'), { recursive: true }); writeFileSync(join(P, name, 'config'), `lxc.include = /usr/share/lxc/config/common.conf\nlxc.rootfs.path = loop:${join(P, name, 'rootdev')}\nlxc.uts.name = ${name}\n`); writeFileSync(join(P, name, 'rootdev'), ''); return { code: 0, out: '', err: '' }; }
    if (cmd === 'lxc-start') { state.set(name, 'RUNNING'); return { code: 0, out: '', err: '' }; }
    if (cmd === 'lxc-stop') { state.set(name, 'STOPPED'); return { code: 0, out: '', err: '' }; }
    if (cmd === 'lxc-info') return existsSync(join(P, name)) ? { code: 0, out: `Name: ${name}\nState: ${state.get(name) ?? 'STOPPED'}\n`, err: '' } : { code: 1, out: '', err: 'absent' };
    if (cmd === 'lxc-copy') { cpSync(join(P, name), join(P, args[args.indexOf('-N') + 1]), { recursive: true }); return { code: 0, out: '', err: '' }; }
    if (cmd === 'lxc-attach') { const c = args.at(-1)!; return c === 'df -h' ? { code: 0, out: '\x1b[1mFilesystem\x1b[0m  Size\n/dev/loop0  16G\n', err: '' } : { code: 127, out: '', err: `sh: ${c}: not found` }; }
    if (['lxc-cgroup', 'ip', 'df', 'truncate', 'e2fsck', 'resize2fs', 'lxc-destroy'].includes(cmd)) return { code: 0, out: '', err: '' };
    return { code: 1, out: '', err: `commande inattendue ${cmd}` };
  };
  return { run, calls, state };
}

test('LXC : disque agrandi, adresse changée, console, modèle puis machine créée depuis le modèle', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hydre-')), F = fauxLxc();
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: F.run as never, fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {}, autonomy: () => 'equilibre' });
  try {
    const r = await v.act('ymir', 'creer_machine', { genre: 'lxc', modele: 'debian trixie', fin: 'web', coeurs: 2, memoire: 2, disque: 8, apps: '' });
    assert.match(r.text, /✅ .* créée .* 10\.0\.3\.61/);
    const nom = (r.data as { nom: string }).nom, P = join(home, 'valhalla', 'ymir', 'machines', 'lxc');
    // Disque : action grave ; machine en marche refusée ; plus petit refusé ; plus grand → truncate + resize2fs.
    assert.equal((await v.act('ymir', 'disque_machine', { machine: nom, disque: 16 }, { auto: true })).ok, false);
    assert.match((await v.act('ymir', 'disque_machine', { machine: nom, disque: 16 })).text, /arrête d'abord/);
    await v.act('ymir', 'arreter_machine', { machine: nom });
    assert.match((await v.act('ymir', 'disque_machine', { machine: nom, disque: 4 })).text, /ne se réduit pas/);
    assert.match((await v.act('ymir', 'disque_machine', { machine: nom, disque: 16 })).text, /disque de 16 Go — disque et système de fichiers agrandis/);
    assert.ok(F.calls.some((c) => c[0] === 'truncate' && c.includes('16G')) && F.calls.some((c) => c[0] === 'resize2fs'));
    // Adresse : prise → refusée ; hors du réseau → refusée ; libre → écrite dans la configuration.
    assert.match((await v.act('ymir', 'ip_machine', { machine: nom, ip: '10.0.3.90' })).text, /déjà prise/);
    assert.match((await v.act('ymir', 'ip_machine', { machine: nom, ip: '192.168.1.5' })).text, /réseau des machines/);
    assert.match((await v.act('ymir', 'ip_machine', { machine: nom, ip: '10.0.3.77' })).text, /10\.0\.3\.61 → 10\.0\.3\.77 — appliquée au prochain démarrage/);
    assert.match(readFileSync(join(P, nom, 'config'), 'utf8'), /lxc\.net\.0\.ipv4\.address = 10\.0\.3\.77\/24/);
    // Console : machine éteinte → refusée ; en marche → la sortie, sans couleurs.
    assert.match((await v.act('ymir', 'console_machine', { machine: nom, commande: 'df -h' })).text, /éteinte/);
    await v.act('ymir', 'demarrer_machine', { machine: nom });
    assert.equal((await v.act('ymir', 'console_machine', { machine: nom, commande: 'df -h' }, { auto: true })).ok, false, 'grave : jamais lancée par une automatisation');
    const c = await v.act('ymir', 'console_machine', { machine: nom, commande: 'df -h' }); assert.match(c.text, /^Filesystem {2}Size\n\/dev\/loop0 {2}16G$/);
    const c2 = await v.act('ymir', 'console_machine', { machine: nom, commande: 'introuvable' }); assert.equal(c2.ok, false); assert.match(c2.text, /code 127/);
    assert.match((await v.act('ymir', 'clavier_machine', { machine: nom, texte: 'a' })).text, /pour un LXC/);
    // Modèle : en marche refusé ; éteint → modèle, qui ne démarre plus.
    assert.match((await v.act('ymir', 'modele_machine', { machine: nom })).text, /arrête d'abord/);
    await v.act('ymir', 'arreter_machine', { machine: nom });
    assert.match((await v.act('ymir', 'modele_machine', { machine: nom })).text, /est un modèle/);
    assert.match((await v.act('ymir', 'demarrer_machine', { machine: nom })).text, /est un modèle/);
    const tab = (await v.act('ymir', 'tableau_machines')).data as { gabarits: Array<{ nom: string }>; touches: string[] };
    assert.deepEqual(tab.gabarits.map((g) => g.nom), [nom]); assert.ok(tab.touches.includes('entrée'));
    // Depuis le modèle : copie, son adresse, ses ressources, démarrée ; le modèle reste un modèle.
    const n = await v.act('ymir', 'creer_depuis_modele', { modele: nom, nom: 'Web Client 2', coeurs: 1, memoire: 1, disque: 20, ip: '10.0.3.80', apps: '' });
    assert.match(n.text, /✅ web-client-2 créée depuis .* 1 cœur\(s\), 1 Go, 20 Go\) · 10\.0\.3\.80/);
    assert.equal(F.state.get('web-client-2'), 'RUNNING');
    assert.match(readFileSync(join(P, 'web-client-2', 'config'), 'utf8'), /10\.0\.3\.80\/24/);
    const l = (await v.act('ymir', 'locales')).data as Array<{ nom: string; estModele?: boolean }>;
    assert.equal(l.find((x) => x.nom === nom)?.estModele, true); assert.equal(l.find((x) => x.nom === 'web-client-2')?.estModele, undefined);
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});
