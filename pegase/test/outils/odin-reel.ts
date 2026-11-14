// Un VRAI Odin (passerelle, interface web, applis dont Pégase et Persona) pour les essais de Pégase.
// Lancé par les essais dans un processus à part : node --experimental-strip-types pegase/test/outils/odin-reel.ts
// Écrit sur la sortie une ligne JSON { url, port } puis obéit aux commandes de l'entrée standard :
//   accord <code> oui|non   le propriétaire répond à une demande de profil (comme sur l'écran d'Odin)
//   etat                    rend les appareils et les données reçues (pour vérifier la synchro)
//   ecrire <json>           Odin écrit lui-même un enregistrement (comme un autre appareil)
//   fin                     arrête tout
import { createInterface } from 'node:readline';
import { T } from '../../../test/banc/lib.ts';
import { vraiOdin } from '../../../test/banc/odin-vrai.ts';
import { valhallaOf } from '../../../src/valhalla/odin.ts';
import { relierProprietaire } from '../../../src/valhalla/sso/etat.ts';

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
    if (cmd === 'fin') { await t.end(); dire({ ok: true }); process.exit(0); }
    dire({ ok: false, erreur: `commande inconnue : ${cmd}` });
  } catch (e) { dire({ ok: false, erreur: String((e as Error).message) }); }
});
