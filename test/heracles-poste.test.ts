// Héraclès : carte de l'espace, programmes au démarrage (désactiver / relancer), programmes installés
// (désinstaller, jamais un paquet essentiel), nettoyage d'un autre poste et nettoyage planifié ; tout ce qui
// efface ou change la machine est grave (accord). Les lectures de sortie des commandes sont essayées à part (pures) ;
// le parcours « sur cette machine » passe par de fausses commandes (Linux seulement : sous Windows, Héraclès lit le
// registre et les dossiers « Démarrage » du vrai PC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandeDesinstaller, lireDemarrage, lireDesinstall, lireDu, lireProgrammes, lireRun, scriptNettoyage } from '../src/valhalla/gefjon/poste.ts';
import { nettoyageDu, type PlanNettoyage } from '../src/valhalla/modules/gefjon.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const SORTIE_DEMARRAGE = [
  '@@systemd', 'cups.service                 enabled enabled', 'ssh.service enabled enabled', 'getty@.service enabled enabled',
  '@@desktop /home/fatima/.config/autostart/discord.desktop', 'Name=Discord', 'Exec=/usr/bin/discord --start-minimized',
  '@@desktop /home/fatima/.config/autostart/tracker.desktop', 'Hidden=true', 'X-Odin-Desactive=true',
  '@@desktop /etc/xdg/autostart/tracker.desktop', 'Name=Tracker', 'Exec=/usr/libexec/tracker',
  '@@desktop /etc/xdg/autostart/nm-applet.desktop', 'Name=Réseau', 'Exec=nm-applet',
  '@@plist /Users/f/Library/LaunchAgents/com.spotify.webhelper.plist', '@@plist /Library/LaunchDaemons/com.vendor.daemon.plist',
  '@@home /Users/f',
].join('\n');

test('lectures pures : du, démarrage (Linux, Mac, Windows), programmes (apt, flatpak, snap, Mac, Windows)', () => {
  const du = lireDu('4\t/home/f/.config\n1048576\t/home/f/Vidéos\n2048\t/home/f/Documents\n1054724\t/home/f\n', '/home/f');
  assert.equal(du.total, 1054724 * 1024); assert.deepEqual(du.items.map((x) => x.chemin), ['/home/f/Vidéos', '/home/f/Documents', '/home/f/.config']);
  const d = lireDemarrage(SORTIE_DEMARRAGE);
  assert.deepEqual(d.filter((x) => x.genre === 'service').map((x) => x.nom), ['cups', 'ssh', 'getty@']);
  const tracker = d.find((x) => x.id === 'session:tracker.desktop')!; assert.equal(tracker.actif, false, 'la surcharge d\'Odin (Hidden=true) l\'emporte');
  assert.equal(d.filter((x) => x.id === 'session:tracker.desktop').length, 1);
  assert.equal(d.find((x) => x.nom === 'Discord')?.actif, true); assert.equal(d.find((x) => x.nom === 'Réseau')?.actif, true);
  assert.equal(d.find((x) => x.id === 'launchd:com.spotify.webhelper.plist')?.desactivable, true); assert.equal(d.find((x) => x.id === 'launchd:com.vendor.daemon.plist')?.desactivable, false);
  const run = lireRun('\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n    OneDrive    REG_SZ    "C:\\Users\\f\\OneDrive.exe" /background\r\n    Teams    REG_EXPAND_SZ    %LOCALAPPDATA%\\Teams.exe\r\n', 'ton compte');
  assert.deepEqual(run.map((x) => x.nom), ['OneDrive', 'Teams']); assert.ok(run.every((x) => !x.desactivable));
  const p = lireProgrammes('@@apt\nlibc6\t2.40\t12000\trequired\nvlc\t3.0.21\t5000\toptional\nlinux-image-6.12\t6.12\t400000\toptional\n@@flatpak\norg.gimp.GIMP\t2.10.38\n@@snap\nName  Version  Rev\ncore22  2024  1\nspotify  1.2  80\n@@mac\n512000\t/Applications/Firefox.app\n100\t/Applications/Safari.app\n');
  assert.equal(p.find((x) => x.nom === 'libc6')?.desinstallable, false); assert.equal(p.find((x) => x.nom === 'linux-image-6.12')?.desinstallable, false);
  assert.equal(p.find((x) => x.nom === 'vlc')?.octets, 5000 * 1024); assert.equal(p.find((x) => x.id === 'flatpak:org.gimp.GIMP')?.desinstallable, true);
  assert.equal(p.find((x) => x.nom === 'core22')?.desinstallable, false); assert.equal(p.find((x) => x.nom === 'spotify')?.desinstallable, true);
  assert.equal(p.find((x) => x.nom === 'Firefox')?.desinstallable, true); assert.equal(p.find((x) => x.nom === 'Safari')?.desinstallable, false);
  const w = lireDesinstall('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\7-Zip\r\n    DisplayName    REG_SZ    7-Zip 24.08 (x64)\r\n    DisplayVersion    REG_SZ    24.08\r\n    EstimatedSize    REG_DWORD    0x1400\r\n    UninstallString    REG_SZ    "C:\\Program Files\\7-Zip\\Uninstall.exe"\r\n\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\KB123\r\n    DisplayName    REG_SZ    Mise à jour\r\n    ParentKeyName    REG_SZ    OperatingSystem\r\n');
  assert.deepEqual(w.map((x) => [x.nom, x.octets]), [['7-Zip 24.08 (x64)', 0x1400 * 1024]]);
  // Commandes de désinstallation : jamais un paquet essentiel, jamais un nom qui serait lu comme une option.
  assert.deepEqual(commandeDesinstaller(p.find((x) => x.nom === 'vlc')!), { cmd: 'apt-get', args: ['remove', '-y', '--', 'vlc'], sudo: true });
  assert.throws(() => commandeDesinstaller(p.find((x) => x.nom === 'libc6')!), /ne se désinstalle pas/);
  assert.throws(() => commandeDesinstaller({ id: 'apt:-oAPT::x', nom: 'x', source: 'apt', desinstallable: true }), /refusé/);
  assert.deepEqual(commandeDesinstaller(p.find((x) => x.nom === 'Firefox')!).args.slice(-1), ['/Applications/Firefox.app']);
  assert.equal(commandeDesinstaller(w[0]).cmd, 'winget');
  // Nettoyage d'un autre poste : mêmes exclusions qu'ici.
  const t = scriptNettoyage('temporaires', true); assert.ok(t.sudo && /-mtime \+7/.test(t.script) && /! -name "systemd-private-\*"/.test(t.script) && /rm -rf/.test(t.script));
  assert.match(scriptNettoyage('caches', false).script, /! -name "huggingface"/); assert.throws(() => scriptNettoyage('documents', true), /inconnue/);
});

test('nettoyage planifié : une fois dans l\'heure choisie, chaque jour, le dimanche ou le 1er du mois', () => {
  const p = (o: Partial<PlanNettoyage>): PlanNettoyage => ({ id: 'ici', poste: '', nomPoste: 'cette machine', categories: ['temporaires'], quand: 'jour', heure: 4, ...o });
  assert.equal(nettoyageDu(p({}), new Date(2026, 10, 15, 4, 2)), true); assert.equal(nettoyageDu(p({}), new Date(2026, 10, 15, 5, 2)), false);
  assert.equal(nettoyageDu(p({ dernier: new Date(2026, 10, 15, 4, 0).toISOString() }), new Date(2026, 10, 15, 4, 30)), false, 'pas deux fois');
  assert.equal(nettoyageDu(p({ quand: 'semaine' }), new Date(2026, 10, 15, 4, 0)), true); assert.equal(nettoyageDu(p({ quand: 'semaine' }), new Date(2026, 10, 16, 4, 0)), false);
  assert.equal(nettoyageDu(p({ quand: 'mois' }), new Date(2026, 11, 1, 4, 0)), true); assert.equal(nettoyageDu(p({ quand: 'mois' }), new Date(2026, 11, 2, 4, 0)), false);
});

const monde = (run: (cmd: string, args: string[], o?: { sudo?: boolean }) => Promise<{ code: number; out: string; err: string }>) => {
  const home = mkdtempSync(join(tmpdir(), 'heracles-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: run as never, fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {}, autonomy: () => 'equilibre' });
  v.ctx('gefjon').saveSettings({ dossier: home });
  return { v, home, fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
};

test('cette machine : planifier un nettoyage demande l\'accord une fois ; la page a ses onglets et « Sur quel poste ? »', async () => {
  const w = monde(async () => ({ code: 1, out: '', err: '' }));
  try {
    assert.equal((await w.v.act('gefjon', 'planifier_nettoyage', { categories: 'temporaires, caches', quand: 'semaine', heure: 3 }, { auto: true })).ok, false);
    assert.match((await w.v.act('gefjon', 'planifier_nettoyage', { categories: 'documents' })).text, /catégories possibles/);
    assert.match((await w.v.act('gefjon', 'planifier_nettoyage', { categories: 'temporaires, caches', quand: 'semaine', heure: 3 })).text, /🗓 Nettoyage de cette machine : temporaires, caches, chaque dimanche à 3 h/);
    const page = await w.v.modules().find((m) => m.id === 'gefjon')!.view(w.v.ctx('gefjon'), new URLSearchParams());
    assert.deepEqual(page.onglets, ['Nettoyer', 'Espace', 'Démarrage', 'Programmes']); assert.ok(page.postes && page.postes.actuel === '');
    assert.ok(page.side?.some((x) => /Nettoyage planifié : temporaires, caches/.test(x.title)));
    assert.match((await w.v.act('gefjon', 'retirer_nettoyage', {})).text, /Plus de nettoyage planifié/);
    assert.match((await w.v.act('gefjon', 'carte', { poste: 'poste-inconnu' })).text, /inconnu/);
  } finally { w.fin(); }
});

test('cette machine (Linux) : démarrage désactivé puis relancé, programme désinstallé, paquet essentiel refusé', { skip: process.platform === 'win32' ? 'sous Windows, Héraclès lit le vrai registre' : false }, async () => {
  const lances: Array<{ cmd: string; args: string[]; sudo?: boolean }> = [];
  let ssh = true, vlc = true;
  const w = monde(async (cmd, args, o) => {
    lances.push({ cmd, args, sudo: o?.sudo });
    if (cmd === 'sh' && /command -v du/.test(args.join(' '))) return { code: 0, out: '', err: '' };
    if (cmd === 'sh' && /@@systemd/.test(args[1] ?? '')) return { code: 0, out: SORTIE_DEMARRAGE.replace('ssh.service enabled enabled', ssh ? 'ssh.service enabled enabled' : ''), err: '' };
    if (cmd === 'sh' && /dpkg-query/.test(args[1] ?? '')) return { code: 0, out: `@@apt\nlibc6\t2.40\t12000\trequired\n${vlc ? 'vlc\t3.0\t5000\toptional\n' : ''}`, err: '' };
    if (cmd === 'sh' && /du -x -k -d 1/.test(args[1] ?? '')) return { code: 0, out: `@@/home/f\n2048\t/home/f/Documents\n9000\t/home/f/Vidéos\n11100\t/home/f\n`, err: '' };
    if (cmd === 'systemctl') { ssh = args[0] === 'enable'; return { code: 0, out: '', err: '' }; }
    if (cmd === 'apt-get') { vlc = false; return { code: 0, out: '', err: '' }; }
    return { code: 1, out: '', err: '' };
  });
  try {
    const k = await w.v.act('gefjon', 'carte', {}); assert.match(k.text, /\/home\/f : 11 Mo\n- 9 Mo · \/home\/f\/Vidéos/);
    const d = (await w.v.act('gefjon', 'demarrage', {})).data as Array<{ id: string }>; assert.ok(d.some((x) => x.id === 'service:ssh.service'));
    assert.equal((await w.v.act('gefjon', 'desactiver_demarrage', { id: 'service:ssh.service' }, { auto: true })).ok, false, 'grave');
    assert.match((await w.v.act('gefjon', 'desactiver_demarrage', { id: 'service:ssh.service' })).text, /ssh ne se lance plus au démarrage/);
    assert.deepEqual(lances.find((x) => x.cmd === 'systemctl'), { cmd: 'systemctl', args: ['disable', '--now', 'ssh.service'], sudo: true });
    assert.match((await w.v.act('gefjon', 'desactiver_demarrage', { id: 'service:inexistant.service' })).text, /plus dans la liste/);
    assert.match((await w.v.act('gefjon', 'programmes', {})).text, /2 programme\(s\)/);
    assert.match((await w.v.act('gefjon', 'desinstaller', { id: 'apt:libc6' })).text, /ne se désinstalle pas/);
    assert.equal((await w.v.act('gefjon', 'desinstaller', { id: 'apt:vlc' }, { auto: true })).ok, false, 'grave');
    assert.match((await w.v.act('gefjon', 'desinstaller', { id: 'apt:vlc' })).text, /🗑 vlc désinstallé/);
    assert.deepEqual(lances.find((x) => x.cmd === 'apt-get'), { cmd: 'apt-get', args: ['remove', '-y', '--', 'vlc'], sudo: true });
    const page = await w.v.modules().find((m) => m.id === 'gefjon')!.view(w.v.ctx('gefjon'), new URLSearchParams());
    assert.ok(page.sections.some((x) => x.kind === 'bars' && x.onglet === 'Espace'));
  } finally { w.fin(); }
});
