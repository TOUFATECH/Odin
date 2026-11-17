// Un VRAI Odin (passerelle, interface web, applis dont Pégase et Persona) pour les essais de Pégase.
// Lancé par les essais dans un processus à part : node --experimental-strip-types applications/pegase/test/outils/odin-reel.ts
// Écrit sur la sortie une ligne JSON { url, port } puis obéit aux commandes de l'entrée standard :
//   accord <code> oui|non   le propriétaire répond à une demande de profil (comme sur l'écran d'Odin)
//   etat                    rend les appareils et les données reçues (pour vérifier la synchro)
//   ecrire <json>           Odin écrit lui-même un enregistrement (comme un autre appareil)
//   fin                     arrête tout
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// L'application Odin n'est pas sur cette branche (odin-os) : on la prend dans ODIN_RACINE (une copie de la branche main),
// par défaut le dossier « odin » à côté de « applications » (là où la fabrication la récupère).
const RACINE = process.env.ODIN_RACINE ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'odin');
const depuis = (chemin: string) => import(pathToFileURL(join(RACINE, chemin)).href);
const { T } = await depuis('test/banc/lib.ts');
const { vraiOdin } = await depuis('test/banc/odin-vrai.ts');
const { valhallaOf } = await depuis('src/valhalla/odin.ts');
const { relierProprietaire } = await depuis('src/valhalla/sso/etat.ts');

const t = new T();
const v = await vraiOdin(t, { compte: true });
// Le compte d'Odin devient la personne « propriétaire » (groupe admin) de Persona, comme à sa 1re connexion SSO.
relierProprietaire(valhallaOf()!.ctx('var'));
const dire = (x: unknown) => process.stdout.write(`${JSON.stringify(x)}\n`);
dire({ url: v.url, port: v.port });
const rl = createInterface({ input: process.stdin });
rl.on('line', async (ligne) => {
  const [cmd, ...rest] = ligne.trim().split(' ');
  try {
    if (cmd === 'accord') {
      const st = await v.json('/api/state');
      const pr = (st.body.pairRequests as Array<{ id: string; code: string }>).find((x) => x.code === rest[0]);
      if (!pr) return dire({ ok: false, erreur: 'demande introuvable' });
      v.web.pairDecide(pr.id, rest[1] === 'oui');
      return dire({ ok: true });
    }
    if (cmd === 'api') { // api <méthode> <chemin> <jeton> [json]
      const [meth, chemin, jeton, ...corps] = rest;
      const r = await fetch(v.url + chemin, { method: meth, headers: { authorization: `Bearer ${jeton}`, ...(corps.length ? { 'content-type': 'application/json' } : {}) }, body: corps.length ? corps.join(' ') : undefined });
      return dire({ status: r.status, body: await r.json().catch(() => null) });
    }
    if (cmd === 'plume') { // plume [json] : l'état de Plume du propriétaire, ou le changer (comme Réglages → Plume d'Odin)
      const r = rest.length ? await v.json('/api/plume/reglages', JSON.parse(rest.join(' '))) : await v.json('/api/plume/etat');
      return dire({ status: r.status, body: r.body });
    }
    if (cmd === 'fin') { await t.end(); dire({ ok: true }); process.exit(0); }
    dire({ ok: false, erreur: `commande inconnue : ${cmd}` });
  } catch (e) { dire({ ok: false, erreur: String((e as Error).message) }); }
});
