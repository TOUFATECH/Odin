// Porte « Mathésis lit un dossier ouvert » : les fichiers fabriqués sont donnés à lire (ouvrir_dossier, puis 3 tours) ;
// on regarde ce qui est lu, rangé en mémoire, retrouvable par recall (avec et sans les souvenirs « non fiables »), et si
// les fichiers restent.   node --disable-warning=ExperimentalWarning test/controle/medias/mathesis-dossier.ts <dossier des fichiers>
import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const { ouvrir } = await import('../banc.ts');
const SRC = process.argv[2] ?? 'medias-fabriques';
const s = await ouvrir({ applis: true, approuver: true });
const { valhallaOf } = await import('../../../src/valhalla/odin.ts');
const { fileNousOdin } = await import('../../../src/brain/nous/file-odin.ts');
const v = valhallaOf()!;
const dos = join(s.o.paths.workspace, 'a-lire'); mkdirSync(dos, { recursive: true });
for (const f of readdirSync(SRC).filter((x) => !x.startsWith('_') && x !== 'verite.json')) copyFileSync(join(SRC, f), join(dos, f));
const act = async (a: string, i: Record<string, unknown>) => { try { const r = await v.act('mathesis', a, i, { by: 'toi' } as never) as any; return String(r?.text ?? r); } catch (e) { return 'Erreur : ' + (e as Error).message; } };
const m0 = s.o.muninn.listMemories(5000).length, f0 = fileNousOdin.taille();
console.log('OUVRIR', (await act('ouvrir_dossier', { chemin: dos })).slice(0, 300));
for (let k = 0; k < 3; k++) console.log('TOUR', (await act('tour', {})).replace(/\s+/g, ' ').slice(0, 500));
const mems = s.o.muninn.listMemories(5000);
console.log('souvenirs +', mems.length - m0, 'file Soul +', fileNousOdin.taille() - f0);
for (const m of mems.slice(0, 12)) console.log(' -', m.origin, m.content.slice(0, 140));
for (const q of ['loyer', 'loué', 'Total due', 'facture', 'Lagon bleu', 'Tokyo', 'plombier']) console.log('recall', q, '→', s.o.muninn.recall(q, 2, true).map((m) => m.content.slice(0, 80)).join(' | '));
console.log('fichiers encore là :', readdirSync(dos).length);
s.fermer(); process.exit(0);
