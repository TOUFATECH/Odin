// Ullr contre du réel : les vraies sources de signatures (téléchargées sur Internet), de vraies archives
// faites par les outils du système, le vrai disque de la machine, et le fichier de test standard des
// antivirus (EICAR). Aucun vrai malware n'est téléchargé ni créé : seulement des empreintes, des listes
// d'adresses, des règles de détection, et des échantillons inoffensifs écrits ici.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { wireReflexes } from '../../../src/valhalla/links.ts';
import { ruleSet, ullr } from '../../../src/valhalla/modules/ullr.ts';
import { allModules } from '../../../src/valhalla/odin.ts';
import { sh, until, wait, type Scenario } from '../lib.ts';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const WEBSHELL = '<?php eval(base64_decode($_POST["c"])); ?>';

export const antivirus: Scenario = {
  id: 'antivirus', title: 'Ullr (antivirus) : vraies sources, vraies archives, vrai disque', mode: 'réel',
  what: 'Mise à jour depuis les vraies sources publiques, paquet signé et testé, fichier EICAR détecté à l\'arrivée et dans de vraies archives, aucune fausse alerte sur les programmes de la machine, paquet altéré refusé.',
  async run(t) {
    await t.need('zip', 'tar');
    const online = await fetch('https://raw.githubusercontent.com/AssoEchap/stalkerware-indicators/master/ioc.yaml', { method: 'HEAD', signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false);
    if (!online) t.skip('les sources de signatures (GitHub) ne sont pas joignables depuis cette machine');
    const keyWas = process.env.ABUSE_CH_KEY; if (!keyWas) t.note('Pas de clé abuse.ch (ABUSE_CH_KEY) : MalwareBazaar, ThreatFox et URLhaus ne sont pas essayés en ligne ici (leurs formats le sont dans les tests).');
    const brain = t.tmp('banc-av-cerveau-');
    const { v, home, alerts, sent } = t.valhalla(allModules({ paths: { home: brain, workspace: join(brain, 'workspace') }, cfg: { venus: { url: '' }, voice: {} } } as never));
    const unwire = wireReflexes(v); t.onEnd(unwire);
    const ctx = v.ctx('ullr'), act = (a: string, i: Record<string, unknown> = {}) => v.act('ullr', a, i);

    // 1. Mise à jour depuis les vraies sources.
    const t0 = Date.now(), up = await act('mettre_a_jour');
    t.match(up.text, /✓ OpenPhish \(flux public\) : \d+ hameçonnage/, 'OpenPhish : vraies pages d\'hameçonnage du moment téléchargées');
    t.match(up.text, /✓ Stalkerware Indicators : \d{3,} logiciels espions/, 'Stalkerware Indicators : vrais indicateurs d\'applis espionnes');
    t.match(up.text, /✓ signature-base \(règles YARA\) : \d+ règles/, 'signature-base : vrais fichiers de règles YARA');
    t.match(up.text, /✓ CISA KEV : \d{3,} failles/, 'CISA KEV : vrai catalogue des failles exploitées');
    t.match(up.text, /Base version 1 activée \(signée, testée\)/, `paquet construit, testé (EICAR + fichiers sains), signé et activé en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const rules = ruleSet(ctx).rules.length, m = JSON.parse(readFileSync(join(ctx.dir, 'signatures', 'v1', 'manifeste.json'), 'utf8')) as { iocs: number; rules: Record<string, { imported: number; skipped: number }>; sources: Array<{ id: string; count: number }> };
    const imported = Object.values(m.rules).reduce((a, r) => a + r.imported, 0), skipped = Object.values(m.rules).reduce((a, r) => a + r.skipped, 0);
    t.ok(rules > 100 && imported > 100, `${rules} règles en service, dont ${imported} règles YARA comprises par le moteur`, up.text);
    t.note(`Règles YARA écartées car hors du sous-ensemble compris (modules, boucles, positions) : ${skipped} sur ${imported + skipped}. Mises de côté après essai sur des fichiers sains : ${((ctx.settings.disabledRules as string[] | undefined) ?? []).length}.`);
    t.ok(m.iocs > 1000, `${m.iocs} indicateurs (sites d'hameçonnage, applis et serveurs espions)`);
    t.ok(existsSync(join(ctx.dir, 'signatures', 'v1', 'manifeste.sig')), 'le paquet a sa signature');

    // 2. Les vraies données servent : une vraie page d'hameçonnage du flux, un vrai site d'appli espionne.
    const feed = await fetch('https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt').then((r) => r.text()), phish = feed.split('\n').find((l) => /^https?:\/\//.test(l))!.trim();
    t.match((await act('adresse', { lien: phish })).text, /⚠ Adresse connue comme dangereuse \(hameçonnage/, 'une page d\'hameçonnage réelle du flux est reconnue');
    const yaml = await fetch('https://raw.githubusercontent.com/AssoEchap/stalkerware-indicators/master/ioc.yaml').then((r) => r.text()), spy = /websites:\s*\n\s*-\s+(\S+)/.exec(yaml)?.[1] ?? '';
    t.match((await act('adresse', { lien: `https://${spy}/` })).text, /logiciel espion/, 'le site d\'une vraie appli espionne est reconnu');
    for (const good of ['https://toufatech.com', 'https://www.service-public.fr/', 'https://github.com/TOUFATECH/Odin']) t.match((await act('adresse', { lien: good })).text, /^✓ Rien de suspect/, `site normal non signalé : ${good}`);
    t.match((await act('failles')).text, /\d+ failles exploitées connues/, 'failles exploitées comparées aux logiciels installés ici');

    // 3. Critère d'acceptation : le fichier EICAR est détecté dès son arrivée, sans rien demander.
    const inbox = join(home, 'workspace', 'inbox'); mkdirSync(inbox, { recursive: true });
    ullr.start!(ctx); await wait(300);
    const before = Date.now(); writeFileSync(join(inbox, 'eicar.com'), EICAR);
    t.ok(await until(() => alerts.some((a) => a.title === 'Ullr : Test antivirus EICAR'), 10_000), `fichier EICAR détecté à l'arrivée en ${((Date.now() - before) / 1000).toFixed(1)} s`);
    t.ok(existsSync(join(inbox, 'eicar.com')), 'fichier de test laissé en place (il est inoffensif)');
    writeFileSync(join(inbox, 'recu.php'), WEBSHELL);
    t.ok(await until(() => !existsSync(join(inbox, 'recu.php')), 10_000), 'une vraie menace qui arrive (porte dérobée PHP) est mise en quarantaine toute seule');
    t.ok(sent.some((s) => /Manip faite par réflexe : Ullr · Mettre en quarantaine/.test(s)), 'tu es prévenu, avec « garde » ou « annule »');
    const manip = v.manips({ module: 'ullr' })[0];
    t.ok((await v.decide(manip.id, false)).ok && readFileSync(join(inbox, 'recu.php'), 'utf8') === WEBSHELL, '« annule » remet le fichier à sa place, identique');

    // 4. De vraies archives, faites par les outils du système.
    const work = t.tmp('banc-av-'), arch = join(home, 'archives'); mkdirSync(arch);
    writeFileSync(join(work, 'eicar.com'), EICAR); writeFileSync(join(work, 'lisezmoi.txt'), 'rien de spécial');
    await sh('zip', ['-9', '-j', join(arch, 'max.zip'), join(work, 'eicar.com'), join(work, 'lisezmoi.txt')]);
    await sh('zip', ['-0', '-j', join(arch, 'stocke.zip'), join(work, 'eicar.com')]);
    await sh('zip', ['-j', join(work, 'interieur.zip'), join(work, 'eicar.com')]); await sh('zip', ['-j', join(arch, 'double.zip'), join(work, 'interieur.zip')]);
    await sh('tar', ['-czf', join(arch, 'sauvegarde.tar.gz'), '-C', work, 'eicar.com', 'lisezmoi.txt']);
    await sh('tar', ['-cf', join(arch, 'sauvegarde.tar'), '-C', work, 'eicar.com']);
    await sh('sh', ['-c', `gzip -c '${join(work, 'eicar.com')}' > '${join(arch, 'seul.gz')}'`]);
    await sh('zip', ['-j', '-P', 'motdepasse', join(arch, 'verrou.zip'), join(work, 'eicar.com')]);
    const r = await act('analyser', { dossier: arch });
    for (const f of ['max.zip', 'stocke.zip', 'double.zip', 'sauvegarde.tar.gz', 'sauvegarde.tar', 'seul.gz']) t.ok(new RegExp(`Test antivirus EICAR — .*${f.replace(/\./g, '\\.')}`).test(r.text), `EICAR trouvé dans ${f}`, r.text);
    t.ok(!/verrou\.zip/.test(r.text), 'archive à mot de passe : le contenu n\'est pas lisible, Ullr ne prétend pas l\'avoir analysé');
    const rep = await act('rapport');
    t.match(rep.text, /7 fichiers[\s\S]*base de signatures version 1[\s\S]*empreinte [a-f0-9]{64} · trouvé par règle · action : fichier de test, laissé en place/, 'rapport horodaté : chemin, empreinte, règle, gravité, action, version des signatures');

    // 5. Le vrai disque : aucun programme de la machine n'est pris pour un virus (avec les vraies règles YARA).
    const sys = await act('analyser', { dossier: '/usr/bin' }), d = sys.data as { fichiers: number; detections: number };
    const last = (ctx.settings.reports as Array<{ files: number; ms: number; bytes: number }>)[0];
    t.ok(d.fichiers > 200 && d.detections === 0, `${d.fichiers} programmes du système analysés : aucune fausse alerte`, sys.text.slice(0, 600));
    t.note(`Vitesse mesurée : ${Math.round(last.files / (last.ms / 1000))} fichiers/s, ${(last.bytes / 1e6 / (last.ms / 1000)).toFixed(1)} Mo/s (un seul cœur, ${rules} règles).`);
    // …ni les fichiers d'Odin lui-même, qui contiennent pourtant le texte de ses règles.
    const self = await act('analyser', { dossier: join(dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'src') });
    t.ok((self.data as { detections: number }).detections === 0, 'Ullr ne se prend pas lui-même pour un virus (ses fichiers contiennent le texte de ses règles)', self.text.slice(0, 600));
    t.ok(v.manips({ module: 'ullr' }).filter((x) => x.action === 'isoler').length === 1, 'rien d\'autre n\'a été déplacé pendant ces analyses');

    // 6. Paquet altéré : refusé au redémarrage, les règles de base restent en service, tu es prévenu.
    ullr.stop?.();
    const bin = join(ctx.dir, 'signatures', 'v1', 'indicateurs.bin'), raw = readFileSync(bin); raw[10] ^= 0xff; writeFileSync(bin, raw);
    ullr.start!(ctx);
    t.ok(alerts.some((a) => /paquet de signatures refusé/.test(a.title) && /indicateurs\.bin.*modifié/.test(a.detail ?? '')), 'un paquet de signatures modifié sur le disque est refusé (signature et empreintes vérifiées)');
    t.match((await act('adresse', { lien: phish })).text, /Rien de suspect|Score de risque/, 'la liste altérée n\'est plus utilisée');
    writeFileSync(join(arch, 'encore.com'), EICAR);
    t.match((await act('fichier', { chemin: join(arch, 'encore.com') })).text, /^⚠ Test antivirus EICAR/, 'les règles de base restent en service');
    t.ok(readdirSync(join(ctx.dir, 'signatures')).includes('cle-signatures.json'), 'la clé de signature reste sur cette machine (fichier interdit aux outils de fichiers d\'Odin)');
    ullr.stop?.();
  },
};
