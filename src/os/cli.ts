// Odin OS — ligne de commande : « odin os … ».
//   odin os                          état : version, où il tourne, images construites
//   odin os essai                    adresse du bureau dans le navigateur (rien à installer)
//   odin os installer --docker       conteneur Docker (options : --port=7788 --nom=odin-os --lan)
//   odin os installer --lxc          conteneur LXC, Proxmox ou LXC classique (--id=120 --stockage=local-lvm --pont=vmbr0)
//   odin os installer --navigateur   comme « essai »
//   odin os images                   images construites : taille et empreinte SHA-256
//   odin os terminal on|off          ouvre ou ferme le vrai terminal du bureau sur cette machine

import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig, odinPaths } from '../config.ts';
import { adresseEssai, DOSSIER_IMAGES, imagesConstruites, installerDocker, installerLxc, type Outils } from './installer.ts';
import { cible, fichierTerminal, surOdinOS, terminalAutorise } from './systeme.ts';
import { BASE_OS, VERSION_OS } from './version.ts';

const outils: Outils = {
  run: (cmd, args, o) => new Promise((fin) => { const racine = process.getuid?.() === 0; execFile(o?.sudo && !racine ? 'sudo' : cmd, o?.sudo && !racine ? [cmd, ...args] : args, { timeout: o?.timeoutMs ?? 60_000, maxBuffer: 16 * 1024 * 1024 }, (e, out, err) => fin({ code: e ? (typeof (e as NodeJS.ErrnoException).code === 'number' ? Number((e as NodeJS.ErrnoException).code) : 1) : 0, out: String(out), err: String(err) || (e ? e.message : '') })); }),
  has: (cmd) => new Promise((fin) => execFile('sh', ['-c', 'command -v "$1"', 'sh', cmd], (e) => fin(!e))),
};
const option = (flags: Set<string>, nom: string): string | undefined => { for (const f of flags) if (f.startsWith(`--${nom}=`)) return f.slice(nom.length + 3); return undefined; };
const taille = (o: number) => (o >= 2 ** 30 ? `${(o / 2 ** 30).toFixed(2).replace('.', ',')} Go` : o >= 2 ** 20 ? `${Math.round(o / 2 ** 20)} Mo` : o >= 1024 ? `${Math.round(o / 1024)} Ko` : `${o} octets`);

export async function osCommande(pos: string[], flags: Set<string>): Promise<void> {
  const paths = odinPaths(), sous = pos[0] ?? 'etat';
  const essai = () => {
    const url = adresseEssai(loadConfig(paths));
    console.log(`Bureau Odin OS : ${url}\n  écran téléphone : ${url}?ecran=mobile\n  démonstration sans tes données : ${url}?essai\nOdin doit tourner (odin web, ou son service). Rien n'est installé : c'est cet Odin qui sert le bureau.`);
    if (process.stdout.isTTY && !flags.has('--no-open') && process.env.DISPLAY) spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref();
  };
  switch (sous) {
    case 'etat': {
      const img = imagesConstruites();
      console.log(`Odin OS ${VERSION_OS} (base ${BASE_OS.nom})`);
      console.log(surOdinOS() ? `Cet Odin tourne dans une image Odin OS (${cible()}).` : 'Cet Odin tourne sur sa machine : « odin os essai » ouvre le bureau dans le navigateur.');
      console.log(`Docker : ${await outils.has('docker') ? 'présent' : 'absent'} · LXC : ${await outils.has('pct') ? 'Proxmox (pct)' : await outils.has('lxc-create') ? 'lxc-create' : 'absent'}`);
      console.log(`Terminal du bureau : ${terminalAutorise(paths) ? 'ouvert' : 'fermé'}`);
      console.log(img.length ? `Images construites (${DOSSIER_IMAGES}) :\n${img.map((i) => `  ${i.fichier}  ${taille(i.taille)}`).join('\n')}` : 'Aucune image construite ici : sudo os/build/images.sh');
      console.log('\nSuite : odin os essai · odin os installer --docker · odin os installer --lxc · odin os images');
      return;
    }
    case 'essai': case 'navigateur': return essai();
    case 'installer': case 'install': {
      if (flags.has('--navigateur')) return essai();
      if (flags.has('--docker')) { console.log('Installation dans Docker… (la première fois, l\'image est chargée ou construite : quelques minutes)'); const r = await installerDocker(outils, { nom: option(flags, 'nom'), port: Number(option(flags, 'port')) || undefined, lan: flags.has('--lan') }); console.log(r.text); if (!r.ok) process.exitCode = 1; return; }
      if (flags.has('--lxc')) { console.log('Installation dans LXC…'); const r = await installerLxc(outils, { nom: option(flags, 'nom'), id: Number(option(flags, 'id')) || undefined, stockage: option(flags, 'stockage'), pont: option(flags, 'pont') }); console.log(r.text); if (!r.ok) process.exitCode = 1; return; }
      console.log('Où installer Odin OS ?\n  odin os installer --navigateur   l\'essayer tout de suite, sans rien installer\n  odin os installer --docker       dans un conteneur Docker (--port=7788 --nom=odin-os --lan)\n  odin os installer --lxc          dans un conteneur LXC : Proxmox ou LXC classique (--id=120 --stockage=local-lvm --pont=vmbr0)\nPC, machine virtuelle, Windows et téléphone : voir docs/odin-os.md (images ISO, WSL, APK).');
      return;
    }
    case 'images': {
      const img = imagesConstruites();
      if (!img.length) { console.log(`Aucune image dans ${DOSSIER_IMAGES}.\nPour les construire sur une machine Linux (Ubuntu ou Debian, en root) : sudo os/build/images.sh\nDétails et prérequis : docs/odin-os.md`); return; }
      for (const i of img) console.log(`${i.fichier}\n  taille  : ${taille(i.taille)} (${i.taille} octets)\n  SHA-256 : ${i.sha256}`);
      return;
    }
    case 'terminal': {
      const f = fichierTerminal(paths);
      if (pos[1] === 'on') { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, `ouvert le ${new Date().toISOString()}\n`, { mode: 0o600 }); console.log('Terminal du bureau ouvert : depuis Odin OS (/os/), il lance de vraies commandes sur cette machine, avec les droits d\'Odin.\nPour le refermer : odin os terminal off'); return; }
      if (pos[1] === 'off') { if (existsSync(f)) rmSync(f); console.log(surOdinOS() ? 'Dans une image Odin OS, le terminal reste ouvert : c\'est le système d\'Odin.' : 'Terminal du bureau fermé : seules les commandes d\'Odin répondent.'); return; }
      console.log(`Terminal du bureau : ${terminalAutorise(paths) ? 'ouvert' : 'fermé'} · odin os terminal on|off`);
      return;
    }
    default: console.log('Usage : odin os [etat|essai|installer --docker|--lxc|--navigateur|images|terminal on|off]');
  }
}
