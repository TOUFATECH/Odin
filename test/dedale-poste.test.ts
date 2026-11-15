// Dédale sur un autre poste : lecture des dépôts par SSH (script lancé là-bas, ici essayé avec le vrai sh et le vrai
// git sous Linux), lecture d'un dépôt d'un Windows par son partage de fichiers (HEAD, journal, config), et refus
// clairs : poste inconnu, Windows joint par son partage pour une mise à jour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lireDepotsSsh, lireDernierLog, lireHead, lireOrigine, SCRIPT_DEPOTS } from '../src/valhalla/ivaldi/poste.ts';
import { lireJournal, lireStatut, masquer } from '../src/valhalla/modules/ivaldi.ts';
import { saveMachine } from '../src/machines/access.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

test('lectures pures : sortie du script SSH, HEAD, dernier commit, origine (jeton masqué)', () => {
  const l = lireDepotsSsh('@@depot /home/f/code/site\n# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -0\n1 .M N... 100644 100644 100644 a b x.ts\n@@log\nabcdef1234567\x1fFatima\x1f1763200000\x1fCorrige le menu\n@@origine\nhttps://f:ghp_secret@github.com/f/site.git\n@@depot /home/f/code/vide\n@@log\n@@origine\n');
  assert.ok(l !== 'sansgit'); const [a, b] = l as Exclude<typeof l, 'sansgit'>;
  assert.equal(a.chemin, '/home/f/code/site'); const st = lireStatut(a.statut); assert.equal(st.branche, 'main'); assert.equal(st.avance, 2); assert.equal(st.modifies, 1);
  assert.equal(lireJournal(a.log)[0].sujet, 'Corrige le menu'); assert.equal(masquer(a.origine), 'https://github.com/f/site.git');
  assert.equal(b.chemin, '/home/f/code/vide'); assert.equal(lireDepotsSsh('@@sansgit\n'), 'sansgit');
  assert.equal(lireHead('ref: refs/heads/feature/menu\n'), 'feature/menu'); assert.equal(lireHead('0123456789abcdef\n'), '(détachée)'); assert.equal(lireHead(''), undefined);
  const d = lireDernierLog('0000000 1111111 A <a@b> 1763100000 +0100\tclone: from x\n1111111 2222222 Fatima Ali <f@x.fr> 1763200000 +0100\tcommit: Corrige le menu\n');
  assert.deepEqual(d, { id: '2222222', auteur: 'Fatima Ali', at: 1763200000000, sujet: 'Corrige le menu' });
  assert.equal(lireOrigine('[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://x/y.git\n[remote "origin"]\n\turl = git@github.com:f/site.git\n\tfetch = +refs/heads/*\n'), 'git@github.com:f/site.git');
});

test('le script SSH trouve et lit les dépôts (vrai sh, vrai git)', { skip: process.platform !== 'linux' ? 'demande sh et git de Linux' : false }, async () => {
  const h = mkdtempSync(join(tmpdir(), 'dedale-p-')), r = join(h, 'code', 'site'); mkdirSync(join(h, 'code', 'node_modules', 'x', '.git'), { recursive: true }); mkdirSync(r, { recursive: true });
  const run = (cmd: string, args: string[], cwd = h) => new Promise<string>((ok, ko) => execFile(cmd, args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@b', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@b' } }, (e, out) => (e ? ko(e) : ok(out))));
  try {
    await run('git', ['init', '-q', '-b', 'main'], r); writeFileSync(join(r, 'a.txt'), 'a'); await run('git', ['add', '.'], r); await run('git', ['commit', '-qm', 'Premier'], r); writeFileSync(join(r, 'a.txt'), 'b');
    const l = lireDepotsSsh(await run('sh', ['-c', SCRIPT_DEPOTS, 'odin', join(h, 'code')]));
    assert.ok(l !== 'sansgit'); assert.deepEqual(l.map((x) => x.chemin), [r], 'node_modules sauté');
    assert.equal(lireStatut(l[0].statut).modifies, 1); assert.equal(lireJournal(l[0].log)[0].sujet, 'Premier');
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test('refus clairs sur un autre poste : inconnu, Windows joint par son partage pour une mise à jour ; la page propose « Sur quel poste ? »', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dedale-q-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: (async () => ({ code: 1, out: '', err: '' })) as never, fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {}, autonomy: () => 'equilibre' });
  try {
    assert.match((await v.act('ivaldi', 'depots', { poste: 'poste-inconnu' })).text, /poste « poste-inconnu » inconnu/);
    const w = saveMachine(home, { host: '192.168.1.40', label: 'PC de Fatima', user: 'Fatima', via: 'smb' });
    assert.equal((await v.act('ivaldi', 'mettre_a_jour', { depot: 'site', poste: w.id }, { auto: true })).ok, false, 'grave sur un autre poste');
    assert.match((await v.act('ivaldi', 'mettre_a_jour', { depot: 'site', poste: w.id })).text, /partage de fichiers : Dédale y lit les dépôts/);
    assert.match((await v.act('ivaldi', 'recuperer', { poste: 'PC de Fatima' })).text, /partage de fichiers/);
    const page = await v.modules().find((m) => m.id === 'ivaldi')!.view(v.ctx('ivaldi'), new URLSearchParams());
    assert.ok(page.postes?.choix.some((c) => c.nom === 'PC de Fatima' && c.sys === 'Windows'));
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});
