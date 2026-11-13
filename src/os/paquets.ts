// Odin OS — applis Linux et ponts de compatibilité (Windows, Android), pour Odin Store et Odin Install.
// Actif seulement dans une image Odin OS : sur une machine où Odin est simplement installé, on ne touche pas à ses paquets.
// Les installations passent par apt (paquets signés du dépôt Ubuntu) et tournent en tâche de fond.

import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { Refus, resoudre } from './fichiers.ts';
import { affichage, cible, ponts, surOdinOS } from './systeme.ts';
import { admin, lancerTache } from './taches.ts';

const NOM_PAQUET = /^[a-z0-9][a-z0-9+.-]{0,80}$/;
/** Paquets dont le retrait casserait Odin OS : jamais retirés depuis le bureau. */
const PROTEGES = /^(nodejs|libnode\d*|sudo|apt|dpkg|libc6|bash|systemd.*|udev|dbus.*|labwc|python3(-gi)?|gir1\.2-(gtk|webkit).*|libwebkitgtk.*|linux-(image|modules).*|init|base-files|coreutils|util-linux|login|passwd|mount|e2fsprogs|ca-certificates|live-boot.*|initramfs-tools.*|grub.*)$/;
const PONT = '/usr/local/lib/odin-os/pont';

const lancer = (cmd: string, args: string[], delai = 30_000): Promise<{ code: number; out: string }> => new Promise((fin) => {
  execFile(cmd, args, { timeout: delai, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LANG: 'C.UTF-8', DEBIAN_FRONTEND: 'noninteractive' } }, (e, out, err) => fin({ code: e ? (typeof (e as NodeJS.ErrnoException).code === 'number' ? Number((e as NodeJS.ErrnoException).code) : 1) : 0, out: `${out}${err}` }));
});
const possible = (): string | undefined => (surOdinOS() && existsSync('/usr/bin/apt-get') ? undefined : 'Les applis Linux s\'installent dans une image Odin OS (Docker, LXC, PC). Ici, Odin tourne sur ta machine et ne touche pas à ses paquets.');

/** Les applis à fenêtre installées (fichiers .desktop), pour le lanceur du bureau. */
export function applisLinux(dossiers = ['/usr/share/applications', join(homedir(), '.local', 'share', 'applications')]): Array<{ id: string; nom: string; resume: string; exec: string }> {
  const liste: Array<{ id: string; nom: string; resume: string; exec: string }> = [];
  for (const d of dossiers) {
    let noms: string[] = []; try { noms = readdirSync(d).filter((f) => f.endsWith('.desktop')); } catch { continue; }
    for (const f of noms.slice(0, 400)) {
      let t = ''; try { t = readFileSync(join(d, f), 'utf8'); } catch { continue; }
      const section = /\[Desktop Entry\]([\s\S]*?)(?=\n\[|$)/.exec(t)?.[1] ?? '', v = (k: string) => new RegExp(`^${k}=(.*)$`, 'm').exec(section)?.[1]?.trim() ?? '';
      if (v('Type') !== 'Application' || v('NoDisplay') === 'true' || v('Hidden') === 'true' || v('Terminal') === 'true' || !v('Exec')) continue;
      const id = f.replace(/\.desktop$/, ''); if (!/^[\w.@+-]{1,120}$/.test(id) || liste.some((x) => x.id === id)) continue;
      liste.push({ id, nom: v('Name\\[fr\\]') || v('Name') || id, resume: v('Comment\\[fr\\]') || v('Comment') || v('GenericName'), exec: v('Exec') });
    }
  }
  return liste.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}
/** Découpe la ligne Exec d'un fichier .desktop (sans les codes %f, %U…), sans passer par un interpréteur de commandes. */
export function decouperExec(exec: string): string[] {
  const mots = exec.match(/"(?:\\.|[^"\\])*"|\S+/g) ?? [];
  return mots.map((m) => (m.startsWith('"') ? m.slice(1, -1).replace(/\\(.)/g, '$1') : m)).filter((m) => !/^%[a-zA-Z]$/.test(m)).map((m) => m.replace(/%[a-zA-Z]/g, ''));
}
function ouvrirFenetre(cmd: string, args: string[]): { ok: boolean; text?: string; error?: string } {
  const ecran = affichage(); if (!ecran) return { ok: false, error: 'Cette appli a une fenêtre : elle s\'ouvre sur l\'image PC d\'Odin OS. Ici (sans écran), utilise sa commande dans le Terminal.' };
  try { const p = spawn(cmd, args, { detached: true, stdio: 'ignore', cwd: homedir(), env: { ...process.env, WAYLAND_DISPLAY: ecran.socket, XDG_RUNTIME_DIR: ecran.dossier, XDG_SESSION_TYPE: 'wayland', GDK_BACKEND: 'wayland,x11', QT_QPA_PLATFORM: 'wayland;xcb', DISPLAY: process.env.DISPLAY ?? ':0', HOME: homedir() } }); p.on('error', () => undefined); p.unref(); return { ok: true, text: 'Je l\'ouvre…' }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Point d'entrée d'Odin Store : chercher, installer, retirer, lancer, installer un pont, mettre à jour. */
export async function paquets(action: string, nom: string): Promise<Record<string, unknown>> {
  if (action === 'applis') return { ok: true, applis: possible() ? [] : applisLinux().map(({ id, nom: n, resume }) => ({ id, nom: n, resume })) };
  const refus = possible(); if (refus) return { ok: false, error: refus };
  switch (action) {
    case 'chercher': {
      const mot = nom.toLowerCase().replace(/[^a-z0-9+. -]/g, '').trim().slice(0, 60); if (mot.length < 2) return { ok: true, paquets: [] };
      let r = await lancer('apt-cache', ['search', '--names-only', mot]);
      if (!r.out.trim()) { await lancer(...admin('apt-get', ['update', '-q']), 120_000); r = await lancer('apt-cache', ['search', '--names-only', mot]); }
      const trouves = r.out.split('\n').map((l) => /^(\S+) - (.*)$/.exec(l)).filter((m): m is RegExpExecArray => Boolean(m) && NOM_PAQUET.test(m![1])).map((m) => ({ nom: m[1], resume: m[2] }));
      // D'abord le nom exact, puis ceux qui commencent par le mot ; sans les paquets techniques (-dev, -dbg, lib…).
      const tries = trouves.filter((p) => !/(-dev|-dbg|-dbgsym|-doc|-data|-common)$/.test(p.nom) && (!p.nom.startsWith('lib') || p.nom === mot)).sort((a, b) => Number(b.nom === mot) - Number(a.nom === mot) || Number(b.nom.startsWith(mot)) - Number(a.nom.startsWith(mot)) || a.nom.localeCompare(b.nom)).slice(0, 40);
      const etat = await lancer('dpkg-query', ['-W', '-f=${Package} ${db:Status-Abbrev}\n', ...tries.map((p) => p.nom)]);
      const installes = new Set(etat.out.split('\n').filter((l) => /\sii\s*$/.test(l)).map((l) => l.split(' ')[0]));
      return { ok: true, paquets: tries.map((p) => ({ ...p, installe: installes.has(p.nom) })) };
    }
    case 'installer': {
      if (!NOM_PAQUET.test(nom)) return { ok: false, error: 'Nom de paquet invalide.' };
      return lancerTache(`Installation de ${nom}`, ...admin('bash', ['-c', 'apt-get update -q && exec apt-get install -y --no-install-recommends -- "$1"', 'odin-os', nom]));
    }
    case 'retirer': {
      if (!NOM_PAQUET.test(nom)) return { ok: false, error: 'Nom de paquet invalide.' };
      // Simulation d'abord : si le retrait emporterait un paquet vital d'Odin OS, on refuse.
      const sim = await lancer('apt-get', ['-s', 'remove', '--', nom]);
      const emportes = [...sim.out.matchAll(/^Remv (\S+)/gm)].map((m) => m[1]);
      const vital = [nom, ...emportes].find((p) => PROTEGES.test(p));
      if (vital) return { ok: false, error: `Retirer « ${nom} » emporterait « ${vital} », dont Odin OS a besoin. Je ne le fais pas.` };
      if (!emportes.length) return { ok: false, error: `« ${nom} » n'est pas installé.` };
      return lancerTache(`Retrait de ${nom}`, ...admin('apt-get', ['remove', '-y', '--', nom]));
    }
    case 'fichier': {
      let c: string; try { c = resoudre(nom); } catch (e) { return { ok: false, error: (e as Refus).message }; }
      if (!/\.deb$/i.test(c) || !existsSync(c)) return { ok: false, error: 'Ce n\'est pas un paquet .deb.' };
      return lancerTache(`Installation de ${basename(c)}`, ...admin('bash', ['-c', 'apt-get update -q; exec apt-get install -y --no-install-recommends -- "$1"', 'odin-os', c]));
    }
    case 'lancer': {
      const a = applisLinux().find((x) => x.id === nom); if (!a) return { ok: false, error: 'Appli inconnue.' };
      const [cmd, ...args] = decouperExec(a.exec); if (!cmd) return { ok: false, error: 'Commande de lancement vide.' };
      return ouvrirFenetre(cmd, args);
    }
    case 'ouvrir': {
      let c: string; try { c = resoudre(nom); } catch (e) { return { ok: false, error: (e as Refus).message }; }
      if (!existsSync(c)) return { ok: false, error: 'Fichier introuvable.' };
      if (/\.(exe|msi|bat)$/i.test(c)) { if (!ponts().windows.installe) return { ok: false, error: 'Odin Bridge Windows n\'est pas installé.' }; return /\.msi$/i.test(c) ? ouvrirFenetre('wine', ['msiexec', '/i', c]) : ouvrirFenetre('wine', [c]); }
      if (/\.apk$/i.test(c)) { if (!ponts().android.installe) return { ok: false, error: 'Odin Bridge Android n\'est pas installé.' }; const r = await lancer('waydroid', ['app', 'install', c], 120_000); return r.code === 0 ? { ok: true, text: 'Appli Android installée : elle apparaît dans Waydroid.' } : { ok: false, error: r.out.slice(-400) || 'Installation refusée par Waydroid (est-il démarré ?).' }; }
      return { ok: false, error: 'Je ne sais pas ouvrir ce type de fichier.' };
    }
    case 'pont': {
      const p = ponts()[nom as 'windows' | 'android' | 'mac']; if (!p) return { ok: false, error: 'Pont inconnu.' };
      if (p.installe) return { ok: true, text: 'Ce pont est déjà installé.' };
      if (!p.possible) return { ok: false, error: p.pourquoi ?? 'Ce pont ne s\'installe pas ici.' };
      if (!existsSync(PONT)) return { ok: false, error: 'L\'installeur des ponts est absent de cette image.' };
      return lancerTache(`Installation du pont ${nom}`, ...admin(PONT, [nom]), { env: { ODIN_OS_CIBLE: cible() } });
    }
    case 'maj': return lancerTache('Mises à jour du système', ...admin('bash', ['-c', 'apt-get update -q && apt-get -y dist-upgrade && echo && echo "Système à jour."']));
    default: return { ok: false, error: 'Action inconnue.' };
  }
}
