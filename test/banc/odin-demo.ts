// Lance un VRAI Odin de démonstration (compte de test créé, applis démarrées) et le laisse tourner :
// pour regarder l'interface, faire des captures, ou passer un scanner de sécurité externe.
//   node test/banc/odin-demo.ts            → affiche l'adresse, le cookie de session et la clé d'API
//   BANC_DEMO_PORT=7790 node test/banc/odin-demo.ts
// Tout est dans un dossier temporaire, effacé à l'arrêt (Ctrl+C).

import { T } from './lib.ts';
import { COMPTE, vraiOdin } from './odin-vrai.ts';

const t = new T();
const od = await vraiOdin(t, { compte: true, script: Array.from({ length: 50 }, () => ({ text: 'Bien reçu.' })) });
console.log(JSON.stringify({ url: od.url, session: od.session, cle: od.token, email: COMPTE.email, motDePasse: COMPTE.password, dossier: od.o.paths.home }));
const stop = async () => { await t.end(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
setInterval(() => {}, 60_000);
