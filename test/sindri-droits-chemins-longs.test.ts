// L'agent de Phénix (agent.py) et les chemins de plus de 260 caractères sous Windows : la sauvegarde lit un fichier
// profond (il n'est plus sauté en silence, son chemin noté reste celui d'origine, sans préfixe) et la restauration
// le remet, dossiers compris. Les vérifications de dossier (« vers », dossiers sauvegardés) restent les mêmes.
// L'agent est chargé tel quel par Python ; Odin est remplacé par un faux qui rend les morceaux.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trouverPython } from '../src/voice/orphee.ts';

const py = trouverPython();
const AGENT = fileURLToPath(new URL('../src/valhalla/sindri/agent.py', import.meta.url));

const SCRIPT = String.raw`
import hashlib, importlib.util, json, os, re, shutil, sys
spec = importlib.util.spec_from_file_location("agent", sys.argv[1]); a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
a.journal = lambda texte: None  # rien n'est écrit à côté de l'agent du dépôt
racine = sys.argv[2]
# Le préfixe des chemins longs, propre à l'essai (indépendant de l'agent).
L = lambda p: "\\\\?\\" + os.path.abspath(p)
docs = os.path.join(racine, "Documents")
profond = os.path.join(docs, *["un-dossier-au-nom-assez-long-%02d" % i for i in range(10)])
f = os.path.join(profond, "note.txt")
out = {"longueur": len(f)}
# Le fichier profond est posé par l'essai (avec le préfixe) : sans lui, Windows refuse.
os.makedirs(L(profond)); open(L(f), "wb").write(b"version 1")
exclus = [re.compile(x, re.I) for x in a.EXCLUS]
out["vus"] = list(a.parcourir([docs], exclus))
out["morceaux"] = a.empreintes(f)
# Restauration : un faux Odin rend le fichier ; « vers » est un dossier à part dans le profil.
donnees = b"version 1"
sha = hashlib.sha256(donnees).hexdigest()
class FauxOdin:
    fin = None
    def json(self, m, chemin, o=None):
        if m == "GET":
            return {"vers": "Restauré par Odin 2026-11-23 20h10", "fichiers": [{"path": f, "size": len(donnees), "mtime": 1700000000000, "mode": 420, "morceaux": [{"id": "x", "sha": sha}]}]}
        FauxOdin.fin = o; return {}
    def appel(self, m, chemin, corps=b"", entetes=None):
        return 200, donnees
c = {"profil": racine, "dossiers": [docs]}
a.restaurer(FauxOdin(), c, {"tache": "t1"})
out["fin"] = FauxOdin.fin
remis = os.path.join(racine, "Restauré par Odin 2026-11-23 20h10", re.sub(r"^([A-Za-z]):", r"\1", f).lstrip("\\/"))
out["remis_long"] = len(remis)
out["remis"] = open(L(remis), "rb").read().decode()
# Un « vers » qui sort du profil reste refusé, avant toute écriture.
class Mechant(FauxOdin):
    def json(self, m, chemin, o=None):
        return {"vers": "..\\ailleurs", "fichiers": []} if m == "GET" else {}
try:
    a.restaurer(Mechant(), c, {"tache": "t2"}); out["vers_refuse"] = False
except RuntimeError:
    out["vers_refuse"] = True
shutil.rmtree(L(racine), ignore_errors=True)
print(json.dumps(out))
`;

test('agent de Phénix : sauvegarde et restauration d\'un fichier au chemin de plus de 260 caractères (Windows)', { skip: process.platform !== 'win32' ? 'seulement sous Windows' : !py && 'Python 3 absent', timeout: 60_000 }, () => {
  const racine = mkdtempSync(join(tmpdir(), 'phenix-long-')), script = join(racine, '..', `essai-long-${process.pid}.py`);
  writeFileSync(script, SCRIPT);
  try {
    const r = spawnSync(py!.cmd, [...py!.args, script, AGENT, racine], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const o = JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { longueur: number; vus: string[]; morceaux: string[]; fin: { fait: number; erreurs: string[] }; remis_long: number; remis: string; vers_refuse: boolean };
    assert.ok(o.longueur > 260, `chemin de ${o.longueur} caractères`);
    assert.equal(o.vus.length, 1, 'le fichier profond est vu par la sauvegarde');
    assert.ok(!o.vus[0].startsWith('\\\\?\\'), 'le chemin noté reste sans préfixe');
    assert.equal(o.morceaux.length, 1, 'et il est lu');
    assert.ok(o.remis_long > 260, `restauré à ${o.remis_long} caractères`);
    assert.deepEqual(o.fin, { fait: 1, erreurs: [] }, 'restauré, dossiers compris');
    assert.equal(o.remis, 'version 1');
    assert.equal(o.vers_refuse, true, 'un dossier de restauration qui sort du profil reste refusé');
  } finally { rmSync(racine, { recursive: true, force: true }); rmSync(script, { force: true }); }
});
