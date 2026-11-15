// Phénix · image disque complète. Le poste est simulé (faux SSH) : un disque de 16 Mo avec une table, une partition
// libre (partclone), la partition du système montée (dd) et une mémoire d'échange. L'image est faite, rangée,
// vérifiée ; refaite après un petit changement (seul le morceau changé est nouveau) ; remise sur un autre disque
// (grave) et comparée octet par octet ; refus d'écrire sur le disque du système qui tourne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandeEcriture, commandeLecture, essaisImage, lireDisposition, partitionDe, planifier, scriptSonde, type AccesPoste } from '../src/valhalla/sindri/image.ts';
import { encoder } from '../src/machines/windows.ts';
import { saveMachine } from '../src/machines/access.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const M = 1024 * 1024;
const SONDE = 'disque /dev/sda 16777216\npartition /dev/sda1 1 1048576 6291456 ext4 -\npartition /dev/sda2 2 7340032 7340032 ext4 /\npartition /dev/sda3 3 14680064 1048576 swap -\npartclone ext4\n';

test('disposition et pièces : début, fin, partclone si libre, dd si montée, échange non copié ; commandes sûres', () => {
  const d = lireDisposition('linux', SONDE), p = planifier('linux', d);
  assert.deepEqual(p.map((x) => [x.nom, x.format, x.offset, x.taille]), [['debut', 'brut', 0, M], ['fin', 'brut', 15 * M, M], ['partition-1', 'partclone', M, 6 * M], ['partition-2', 'brut', 7 * M, 7 * M], ['partition-3', 'vide', 14 * M, M]]);
  assert.equal(commandeLecture('linux', d, p[3]), "sudo dd if='/dev/sda' bs=1M iflag=skip_bytes,count_bytes skip=7340032 count=7340032 status=none");
  assert.equal(commandeLecture('linux', d, p[2]), "sudo partclone.ext4 -c -s '/dev/sda1' -o -");
  assert.equal(commandeEcriture('linux', '/dev/nvme0n1', p[2]), "sudo partclone.ext4 -r -s - -o '/dev/nvme0n1p1'");
  assert.equal(partitionDe('/dev/sdb', 2), '/dev/sdb2');
  assert.throws(() => scriptSonde('linux', '/dev/sda; rm -rf /'), /invalide/); assert.throws(() => commandeEcriture('linux', '/dev/sdb$(x)', p[0]), /invalide/);
  // Windows : volumes par VSS, le reste en brut sur le disque physique.
  const w = lireDisposition('windows', `{"ok":true,"disque":"\\\\\\\\.\\\\PhysicalDrive0","taille":${64 * M},"partitions":[{"numero":1,"offset":${M},"taille":${100 * 1024 * 1024 / 4},"lettre":"","fs":"System"},{"numero":3,"offset":${30 * M},"taille":${30 * M},"lettre":"C","fs":"Basic"}]}`);
  const pw = planifier('windows', w);
  assert.equal(pw.find((x) => x.nom === 'partition-3')?.vss, 'C'); assert.equal(pw.find((x) => x.nom === 'partition-1')?.vss, undefined);
  const lecture = Buffer.from(commandeLecture('windows', w, pw.find((x) => x.nom === 'partition-3')!).split(' ').at(-1)!, 'base64').toString('utf16le');
  assert.match(lecture, /Win32_ShadowCopy -MethodName Create/); assert.match(lecture, /Remove-CimInstance/);
  // Mac : hdiutil puis asr.
  const mac = lireDisposition('mac', 'disque /dev/disk0 500107862016\nhdiutil\n'); assert.equal(planifier('mac', mac)[0].format, 'dmg');
  assert.match(commandeEcriture('mac', '/dev/disk2', planifier('mac', mac)[0]), /asr restore --source .* --target '\/dev\/disk2' --erase --noprompt/);
  if (process.platform === 'win32') {
    for (const sc of [lecture, Buffer.from(commandeLecture('windows', w, pw[0]).split(' ').at(-1)!, 'base64').toString('utf16le'), scriptSonde('windows')]) {
      const r = spawnSync('powershell', ['-NoProfile', '-EncodedCommand', encoder('$e=$null;$t=[Console]::In.ReadToEnd();[void][Management.Automation.Language.Parser]::ParseInput($t,[ref]$null,[ref]$e);$e | ForEach-Object { $_.Message }')], { input: sc, encoding: 'utf8', windowsHide: true });
      assert.equal(r.stdout.trim(), '', 'PowerShell accepte le script');
    }
  }
});

/** Un faux poste Linux : ses disques sont des tampons en mémoire ; dd, partclone, mkswap et la sonde sont imités. */
function fauxPoste(disques: Record<string, Buffer>, systeme = '/dev/sda') {
  const appels: string[] = [];
  const range = (cmd: string) => ({ off: Number(/(?:skip|seek)=(\d+)/.exec(cmd)?.[1] ?? 0), n: Number(/count=(\d+)/.exec(cmd)?.[1] ?? 0) });
  const disque = (cmd: string) => /(?:if|of)='([^']+)'/.exec(cmd)?.[1] ?? '';
  const acces: AccesPoste = {
    nom: 'faux',
    async executer(cmd) {
      appels.push(cmd);
      if (cmd === 'uname -s') return { code: 0, out: 'Linux\n' };
      if (cmd.includes('lsblk -nsro') && cmd.includes('/sys/block')) return { code: 0, out: SONDE };
      if (cmd.includes('blockdev --getsize64') && cmd.includes('echo "systeme')) { const d = /d='([^']+)'/.exec(cmd)![1]; return disques[d] ? { code: 0, out: `taille ${disques[d].length}\nsysteme ${systeme}\n` } : { code: 3, out: `erreur disque cible introuvable : ${d}` }; }
      if (/partprobe/.test(cmd)) return { code: 0, out: '' };
      if (/sha256sum/.test(cmd)) { const { off, n } = range(cmd); return { code: 0, out: `${createHash('sha256').update(disques[disque(cmd)].subarray(off, off + n)).digest('hex')}  -\n` }; }
      return { code: 1, out: `inattendu : ${cmd}` };
    },
    async lire(cmd, sortie) {
      appels.push(cmd);
      let b: Buffer;
      if (cmd.startsWith('sudo dd if=')) { const { off, n } = range(cmd); b = disques[disque(cmd)].subarray(off, off + n); }
      else if (cmd.startsWith('sudo partclone.ext4 -c')) b = Buffer.concat([Buffer.from('PCLN'), disques['/dev/sda'].subarray(M, 7 * M)]);
      else return { code: 1, out: `inattendu : ${cmd}` };
      for (let k = 0; k < b.length;) { const n = 1 + Math.floor(Math.random() * 300_000); sortie(Buffer.from(b.subarray(k, k + n))); k += n; } // en morceaux de tailles quelconques, comme un vrai flux
      return { code: 0, out: '' };
    },
    async ecrire(cmd, entree) {
      appels.push(cmd);
      const parts: Buffer[] = []; for await (const x of entree) parts.push(x); const b = Buffer.concat(parts);
      const cible = /-o '([^']+)'/.exec(cmd)?.[1] ?? disque(cmd);
      if (cmd.startsWith('sudo dd of=')) { b.copy(disques[cible], range(cmd).off); return { code: 0, out: '' }; }
      if (cmd.startsWith('sudo partclone.ext4 -r')) { assert.equal(cible, '/dev/sdb1'); assert.equal(b.subarray(0, 4).toString(), 'PCLN'); b.subarray(4).copy(disques['/dev/sdb'], M); return { code: 0, out: '' }; }
      if (cmd.startsWith('sudo mkswap')) return { code: 0, out: '' };
      return { code: 1, out: `inattendu : ${cmd}` };
    },
  };
  return { acces, appels };
}

test('image disque d\'un poste : faite, vérifiée, refaite (seul le changé est nouveau), remise sur un autre disque (grave)', { timeout: 120_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'phenix-img-')), avant = process.env.SINDRI_PASSWORD; process.env.SINDRI_PASSWORD = 'mot-de-passe-de-test';
  const sda = randomBytes(16 * M), sdb = Buffer.alloc(16 * M), faux = fauxPoste({ '/dev/sda': sda, '/dev/sdb': sdb });
  essaisImage.acces = () => faux.acces;
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: (async () => ({ code: 1, out: '', err: '' })) as never, fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {}, autonomy: () => 'equilibre' });
  saveMachine(home, { label: 'serveur', host: '192.168.1.5', user: 'admin' }); saveMachine(home, { label: 'secours', host: '192.168.1.6', user: 'admin' });
  try {
    assert.match((await v.act('sindri', 'image_plan', { machine: 'serveur', depot: join(home, 'images'), tous_les: 7, garder: 2 })).text, /💿 Plan « Image · serveur » : image de son disque système tous les 7 jour\(s\)/);
    const i1 = await v.act('sindri', 'sauvegarder', { plan: 'Image · serveur' });
    assert.match(i1.text, /💿 Image de serveur \(\/dev\/sda, 16 Mo\) : 5 pièce\(s\), .*relue et vérifiée/, i1.text); assert.match(i1.text, /à chaud/);
    // Un seul Mo change dans la partition du système : la nouvelle image n'ajoute que lui.
    randomBytes(M).copy(sda, 9 * M);
    const i2 = await v.act('sindri', 'sauvegarder', { plan: 'Image · serveur' });
    assert.match(i2.text, /, 1 Mo de nouveau/, i2.text);
    const l = (await v.act('sindri', 'instantanes', { plan: 'Image · serveur' })).data as Array<{ id: string }>; assert.equal(l.length, 2);
    assert.match((await v.act('sindri', 'verifier', {})).text, /✓ Image · serveur/);
    // Remettre : grave ; jamais sur le disque du système qui tourne.
    assert.equal((await v.act('sindri', 'image_restaurer', { instantane: l[0].id, machine: 'secours', disque: '/dev/sdb' }, { auto: true })).ok, false);
    assert.match((await v.act('sindri', 'image_restaurer', { instantane: l[0].id, machine: 'secours', disque: '/dev/sda' })).text, /porte le système qui tourne/);
    const r = await v.act('sindri', 'image_restaurer', { instantane: l[0].id, machine: 'secours', disque: '/dev/sdb' });
    assert.match(r.text, /remise sur secours:\/dev\/sdb : 5 pièce\(s\), 3 relue\(s\) et vérifiée\(s\)/, r.text);
    const hors = (b: Buffer) => Buffer.concat([b.subarray(0, 14 * M), b.subarray(15 * M)]); // la mémoire d'échange n'est pas copiée
    assert.ok(hors(sdb).equals(hors(sda)), 'le disque remis est identique, octet par octet');
    assert.ok(faux.appels.some((c) => c.startsWith("sudo mkswap '/dev/sdb3'")), 'mémoire d\'échange recréée');
    assert.ok(faux.appels.indexOf(faux.appels.find((c) => /partprobe/.test(c))!) < faux.appels.indexOf(faux.appels.find((c) => c.startsWith('sudo partclone.ext4 -r'))!), 'table relue avant les partitions');
  } finally { delete essaisImage.acces; v.stop(); rmSync(home, { recursive: true, force: true }); if (avant === undefined) delete process.env.SINDRI_PASSWORD; else process.env.SINDRI_PASSWORD = avant; }
});
