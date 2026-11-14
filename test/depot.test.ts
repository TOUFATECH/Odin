// Envoyer un fichier depuis son appareil (ordinateur, téléphone) à une appli : la page l'envoie à Odin, qui le dépose
// là où l'appli reçoit ses fichiers ; l'action reçoit sa référence. Essais sur un vrai Odin (interface web démarrée).
// L'échantillon « dangereux » est le fichier de test standard des antivirus (EICAR), inoffensif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { depotName, uploadName } from '../src/web/server.ts';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const SRT = '1\n00:00:01,000 --> 00:00:03,500\nBonjour Mayotte\n';

test('nom d\'un fichier déposé : rien n\'est écrasé, les noms protégés d\'Odin sont renommés (pur)', () => {
  const d = join(tmpdir(), `depot-${process.pid}-${Date.now()}`); mkdirSync(d, { recursive: true });
  try {
    assert.equal(depotName(d, 'rapport.pdf'), 'rapport.pdf'); writeFileSync(join(d, 'rapport.pdf'), 'x');
    assert.equal(depotName(d, 'rapport.pdf'), 'rapport (2).pdf'); writeFileSync(join(d, 'rapport (2).pdf'), 'x'); assert.equal(depotName(d, 'rapport.pdf'), 'rapport (3).pdf');
    writeFileSync(join(d, 'sans-extension'), 'x'); assert.equal(depotName(d, 'sans-extension'), 'sans-extension (2)');
    for (const n of ['compte.json', 'sessions.json', 'secrets.json', 'machines.json', 'réglages.json', 'serveur-key.pem', 'acme-compte.pem', 'jeton-tunnel']) assert.equal(depotName(d, n), `fichier-${n}`, n);
    assert.equal(depotName(d, uploadName('../../etc/passwd')), 'passwd'); assert.equal(depotName(d, uploadName('C:\\Users\\x\\.bashrc')), 'bashrc'); assert.equal(depotName(d, uploadName('a/b\0c;d|e.txt')), 'b_c_d_e.txt');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('envoyer un fichier à une appli : connexion exigée, endroit fixé par l\'appli, puis conversion et analyse antivirus', { timeout: 120_000 }, async () => {
  const tt = new T();
  try {
    const v = await vraiOdin(tt, { compte: true }), va = valhallaOf()!;
    const H: Record<string, string> = { cookie: v.session, 'x-odin': '1' };
    const envoi = async (mod: string, nom: string, corps: string | Uint8Array, h = H) => {
      const r = await fetch(`${v.url}/api/valhalla/depot?module=${encodeURIComponent(mod)}`, { method: 'POST', headers: { ...h, 'x-filename': encodeURIComponent(nom), 'content-type': 'application/octet-stream' }, body: corps });
      return { status: r.status, body: await r.json().catch(() => ({})) as { ok?: boolean; ref?: string; nom?: string; size?: number; error?: string } };
    };
    const acte = async (module: string, action: string, input: Record<string, unknown>) => (await v.json('/api/valhalla/act', { module, action, input })).body as { ok?: boolean; text?: string };
    const atelier = join(va.ctx('dvalinn').dir, 'atelier'), depots = join(va.ctx('ullr').dir, 'depots');

    // Sans connexion, ou sans l'en-tête qui prouve que la demande vient de la page d'Odin : refusé, rien n'est écrit.
    assert.equal((await envoi('dvalinn', 'a.srt', SRT, { 'x-odin': '1' })).status, 401);
    assert.equal((await envoi('dvalinn', 'a.srt', SRT, { cookie: v.session })).status, 403);
    assert.ok(!existsSync(join(atelier, 'a.srt')));
    // Une appli inconnue, ou qui ne reçoit pas de fichier.
    assert.match((await envoi('nexiste-pas', 'a.srt', SRT)).body.error ?? '', /ne reçoit pas de fichier/);
    assert.match((await envoi('eir', 'a.srt', SRT)).body.error ?? '', /ne reçoit pas de fichier/);
    assert.match((await envoi('../../etc', 'a.srt', SRT)).body.error ?? '', /ne reçoit pas de fichier/);

    // Alchimie : le fichier arrive dans l'atelier, se désigne « atelier:nom », et se convertit.
    let r = await envoi('dvalinn', 'film.srt', SRT); assert.deepEqual(r.body, { ok: true, ref: 'atelier:film.srt', nom: 'film.srt', size: Buffer.byteLength(SRT) });
    assert.equal(readFileSync(join(atelier, 'film.srt'), 'utf8'), SRT); if (process.platform !== 'win32') assert.equal(statSync(join(atelier, 'film.srt')).mode & 0o777, 0o600, 'lisible par Odin seul');
    r = await envoi('dvalinn', 'film.srt', 'autre contenu'); assert.equal(r.body.ref, 'atelier:film (2).srt', 'un deuxième envoi ne remplace pas le premier'); assert.equal(readFileSync(join(atelier, 'film.srt'), 'utf8'), SRT);
    // Un nom piégé ne sort pas de l'atelier ; un nom protégé est renommé ; un fichier vide est refusé sans laisser de trace.
    r = await envoi('dvalinn', '../../../evasion.srt', SRT); assert.equal(r.body.ref, 'atelier:evasion.srt'); assert.ok(existsSync(join(atelier, 'evasion.srt')) && !existsSync(join(va.ctx('dvalinn').dir, '..', 'evasion.srt')));
    r = await envoi('dvalinn', 'compte.json', '{"a":1}'); assert.equal(r.body.ref, 'atelier:fichier-compte.json');
    r = await envoi('dvalinn', 'vide.srt', ''); assert.equal(r.body.ok, false); assert.match(r.body.error ?? '', /vide/); assert.ok(!existsSync(join(atelier, 'vide.srt')));
    r = await envoi('dvalinn', 'Été à Mayotte (final).srt', SRT); assert.equal(r.body.ref, 'atelier:Été à Mayotte _final_.srt');
    let a = await acte('dvalinn', 'convertir', { fichier: 'atelier:film.srt', format: 'vtt' }); assert.equal(a.ok, true, a.text); assert.match(a.text ?? '', /✅ film\.srt → film\.vtt/);
    assert.match(readFileSync(join(atelier, 'film.vtt'), 'utf8'), /^WEBVTT/);
    a = await acte('dvalinn', 'convertir', { fichier: r.body.ref, format: 'vtt' }); assert.equal(a.ok, true, a.text);

    // Reprendre le résultat sur son appareil : l'action dit quels fichiers télécharger, et Odin les remet comme des téléchargements.
    const conv = (await v.json('/api/valhalla/act', { module: 'dvalinn', action: 'convertir', input: { fichier: 'atelier:film.srt', format: 'ass' } })).body as { ok: boolean; module?: string; fichiers?: Array<{ nom: string; ref: string }> };
    assert.equal(conv.module, 'dvalinn'); assert.deepEqual(conv.fichiers, [{ nom: 'film.ass', ref: 'atelier:film.ass' }]);
    const prendre = (q: Record<string, string>, h: Record<string, string> = { cookie: v.session }) => fetch(`${v.url}/api/valhalla/fichier?${new URLSearchParams(q)}`, { headers: h });
    let d = await prendre({ module: 'dvalinn', ref: 'atelier:film.ass' }); assert.equal(d.status, 200);
    assert.equal(d.headers.get('content-type'), 'application/octet-stream'); assert.match(d.headers.get('content-disposition') ?? '', /^attachment; filename="film\.ass"; filename\*=UTF-8''film\.ass$/);
    assert.equal(d.headers.get('x-content-type-options'), 'nosniff'); assert.equal(d.headers.get('content-security-policy'), 'sandbox'); assert.equal(d.headers.get('cache-control'), 'no-store');
    assert.match(await d.text(), /^\[Script Info\]/);
    d = await prendre({ module: 'dvalinn', ref: 'atelier:Été à Mayotte _final_.vtt' }); assert.equal(d.status, 200); assert.match(d.headers.get('content-disposition') ?? '', /filename="_t_ _ Mayotte _final_\.vtt"; filename\*=UTF-8''%C3%89t%C3%A9%20%C3%A0%20Mayotte%20_final_\.vtt$/); await d.arrayBuffer();
    // Le nom reçu est le vrai nom du fichier, parenthèses comprises (un deuxième résultat s'appelle « film (2).ass »).
    await acte('dvalinn', 'convertir', { fichier: 'atelier:film.srt', format: 'ass' }); d = await prendre({ module: 'dvalinn', ref: 'atelier:film (2).ass' });
    assert.equal(d.status, 200); assert.match(d.headers.get('content-disposition') ?? '', /^attachment; filename="film \(2\)\.ass"; filename\*=UTF-8''film%20\(2\)\.ass$/); await d.arrayBuffer();
    // Une page web déposée repart comme un téléchargement : Odin ne l'affiche jamais lui-même.
    await envoi('dvalinn', 'page.html', '<script>alert(1)</script>'); d = await prendre({ module: 'dvalinn', ref: 'atelier:page.html' });
    assert.equal(d.status, 200); assert.equal(d.headers.get('content-type'), 'application/octet-stream'); assert.match(d.headers.get('content-disposition') ?? '', /^attachment/); await d.arrayBuffer();
    // Refus : sans connexion, hors de l'atelier, fichier protégé, lien vers l'extérieur, appli qui ne remet rien, fichier absent, dossier.
    assert.equal((await prendre({ module: 'dvalinn', ref: 'atelier:film.ass' }, {})).status, 401);
    writeFileSync(join(atelier, 'compte.json'), '{"secret":1}'); symlinkSync('/etc/hostname', join(atelier, 'lien-dehors.txt')); mkdirSync(join(atelier, 'sous-dossier'), { recursive: true });
    for (const ref of ['atelier:../../compte.json', '../../../etc/passwd', '/etc/passwd', 'atelier:compte.json', 'atelier:lien-dehors.txt', 'atelier:absent.vtt', 'atelier:sous-dossier', 'inconnu:film.ass', ''])
      assert.equal((await prendre({ module: 'dvalinn', ref })).status, 404, `refusé : ${ref || '(vide)'}`);
    assert.equal((await prendre({ module: 'ullr', ref: 'atelier:film.ass' })).status, 404); assert.equal((await prendre({ module: 'nexiste-pas', ref: 'atelier:film.ass' })).status, 404);
    // La page propose l'envoi sur les bons réglages (et seulement ceux-là).
    const vue = await va.module('dvalinn')!.view(va.ctx('dvalinn'), new URLSearchParams());
    const champ = (titre: string, cle: string) => (vue.sections.find((x) => x.kind === 'form' && x.title === titre) as { params: Array<{ key: string; depot?: { plusieurs?: boolean } }> }).params.find((p) => p.key === cle)!;
    assert.deepEqual(champ('Outils PDF', 'fichiers').depot, { plusieurs: true });
    // « Convertir » : une zone de dépôt (fichier envoyé dans le réglage « fichier »), qui demande d'abord ce que le fichier peut devenir.
    const zone = vue.sections.find((x) => x.kind === 'depot') as { action: string; champ: string; onglet?: string; choix?: { action: string }; lien?: { action: string; champ: string } };
    assert.deepEqual([zone.action, zone.champ, zone.onglet, zone.choix?.action, zone.lien?.action, zone.lien?.champ], ['convertir', 'fichier', 'Convertir', 'possibles', 'depuis_lien', 'lien']);
    assert.deepEqual(vue.onglets, ['Convertir', 'PDF', 'Automatique', 'Outils']);
    const reglage = (cle: string) => va.module('dvalinn')!.actions.find((x) => x.id === 'convertir')!.params!.find((p) => p.key === cle)!;
    assert.deepEqual(reglage('fichier').depot, {}); assert.equal(reglage('format').depot, undefined);

    // Asclépios : le fichier envoyé est analysé, puis sa copie est effacée d'Odin (sain ou non).
    r = await envoi('ullr', 'note.txt', 'Compte rendu de chantier\n'); assert.equal(r.body.ref, join(depots, 'note.txt'));
    a = await acte('ullr', 'fichier', { chemin: r.body.ref }); assert.match(a.text ?? '', /^note\.txt\n✓ Rien de dangereux trouvé .*\n\(La copie envoyée à Odin est effacée\.\)$/, a.text);
    assert.ok(!existsSync(join(depots, 'note.txt')));
    r = await envoi('ullr', 'eicar.com', EICAR); a = await acte('ullr', 'fichier', { chemin: r.body.ref });
    assert.match(a.text ?? '', /^eicar\.com\n⚠ /, a.text); assert.match(a.text ?? '', /C'est le fichier d'essai des antivirus : il est inoffensif\. \(La copie envoyée à Odin est effacée\.\)$/); assert.ok(!existsSync(join(depots, 'eicar.com')));
    // Un fichier reconnu dangereux (ici : un fichier inoffensif dont l'empreinte est déclarée « connue » pour l'essai) : conseil clair, copie effacée aussi.
    const mauvais = `programme inoffensif ${Math.random()}`, hsb = join(tt.tmp(), 'essai.hsb'); writeFileSync(hsb, `${createHash('sha256').update(mauvais).digest('hex')}:${Buffer.byteLength(mauvais)}:Essai.Envoi-1\n`);
    assert.match((await acte('ullr', 'importer', { chemin: hsb })).text ?? '', /1 empreinte\(s\) importée\(s\)/);
    r = await envoi('ullr', 'facture.exe', mauvais); a = await acte('ullr', 'fichier', { chemin: r.body.ref });
    assert.match(a.text ?? '', /^facture\.exe\n⚠ Malware connu : Essai\.Envoi-1 [\s\S]*Ne l'ouvre pas : supprime-le de ton appareil\. \(La copie envoyée à Odin est effacée\.\)$/, a.text); assert.ok(!existsSync(join(depots, 'facture.exe')));
    assert.ok(!(a.text ?? '').includes(depots), 'le chemin interne d\'Odin n\'est pas montré');
    assert.deepEqual(readdirSync(depots), [], 'rien ne reste dans le dossier d\'arrivée de l\'antivirus');
    // Champollion : une photo ou un document envoyé arrive dans son atelier, et se lit.
    r = await envoi('champollion', 'courrier.txt', 'Rendez-vous le 20 novembre 2026 à 14 h à la mairie de Mamoudzou.\n'); assert.equal(r.body.ref, 'atelier:courrier.txt');
    assert.ok(existsSync(join(va.ctx('champollion').dir, 'atelier', 'courrier.txt')));
    a = await acte('champollion', 'lire', { fichier: r.body.ref }); assert.equal(a.ok, true, a.text); assert.match(a.text ?? '', /mairie de Mamoudzou/);
    // Orphée : un vocal envoyé pour être transcrit ; sa copie est effacée, que la transcription réussisse ou non.
    r = await envoi('bragi', 'vocal.mp3', new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4])); const vocal = join(va.ctx('bragi').dir, 'depots', 'vocal.mp3'); assert.equal(r.body.ref, vocal); assert.ok(existsSync(vocal));
    a = await acte('bragi', 'transcrire', { fichier: r.body.ref }); assert.ok(!existsSync(vocal), `copie effacée après la transcription (${a.text})`);
    for (const [mod, action] of [['champollion', 'lire'], ['champollion', 'pdf_cherchable'], ['bragi', 'transcrire'], ['ullr', 'fichier'], ['dvalinn', 'convertir'], ['dvalinn', 'pdf']] as const)
      assert.ok(va.module(mod)!.actions.find((x) => x.id === action)!.params!.some((p) => p.depot) && va.module(mod)!.depot, `${mod}.${action} accepte un fichier envoyé depuis l'appareil`);
    // Un fichier ordinaire de la machine, lui, n'est jamais effacé par l'analyse.
    const ici = join(tt.tmp(), 'rapport.txt'); writeFileSync(ici, 'bonjour'); a = await acte('ullr', 'fichier', { chemin: ici }); assert.match(a.text ?? '', /✓ Rien de dangereux/); assert.ok(existsSync(ici));
  } finally { await tt.end(); }
});
