// Le serveur MCP d'Odin (/mcp) essayé avec le VRAI client officiel du protocole (le SDK
// @modelcontextprotocol/sdk, transport « Streamable HTTP ») : un autre assistant se branche sur
// Odin, voit ses applis comme des outils, les utilise ; sans jeton il est refusé, et aucune action
// grave ne lui est ouverte.

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Gateway } from '../../../src/bifrost/gateway.ts';
import { WebChannel, ensureWebToken } from '../../../src/web/server.ts';
import { coreModules, startValhalla, valhallaOf } from '../../../src/valhalla/odin.ts';
import { frigg } from '../../../src/valhalla/modules/frigg.ts';
import { makeOdin } from '../../helpers.ts';
import { freePort, TOOLS, type Scenario } from '../lib.ts';

const DIR = join(TOOLS, 'mcp');
// Client officiel : connexion, liste des outils, quelques appels ; le résultat sort en JSON.
const CLIENT = `import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const out = {};
try {
  const transport = new StreamableHTTPClientTransport(new URL(process.env.BANC_URL), { requestInit: { headers: process.env.BANC_TOKEN ? { Authorization: 'Bearer ' + process.env.BANC_TOKEN } : {} } });
  const client = new Client({ name: 'client-officiel-du-banc', version: '1.0.0' });
  await client.connect(transport);
  out.server = client.getServerVersion(); out.instructions = client.getInstructions();
  const tools = (await client.listTools()).tools; out.tools = tools.map((t) => ({ name: t.name, readOnly: t.annotations?.readOnlyHint, actions: t.inputSchema?.properties?.action?.enum }));
  const text = (r) => ({ text: r.content.map((c) => c.text).join('\\n'), isError: Boolean(r.isError) });
  for (const [key, name, args] of JSON.parse(process.env.BANC_CALLS)) { try { out[key] = text(await client.callTool({ name, arguments: args })); } catch (e) { out[key] = { text: String(e.message), isError: true, thrown: true }; } }
  await client.close();
} catch (e) { out.error = String(e && e.message || e); }
console.log(JSON.stringify(out));
`;

export const mcpServeur: Scenario = {
  id: 'mcp-serveur', title: 'Serveur MCP d\'Odin ↔ client officiel', mode: 'réel',
  what: 'Le client officiel du protocole MCP se branche sur l\'adresse /mcp d\'un vrai Odin : jeton exigé, applis vues comme des outils, appels réels, actions graves absentes.',
  async run(t) {
    if (!existsSync(join(DIR, 'node_modules', '@modelcontextprotocol', 'sdk'))) t.skip('client MCP officiel absent : lance « npm run banc:outils »');
    const env = { MQTT_PASSWORD: process.env.MQTT_PASSWORD, BRISINGAMEN_KEY: process.env.BRISINGAMEN_KEY };
    t.onEnd(() => { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
    const o = makeOdin([{ text: 'ok' }]); t.onEnd(() => o.cleanup());
    const port = await freePort(), token = ensureWebToken(o.paths);
    const gw = new Gateway(o, { owners: { web: ['*'] } });
    gw.add(new WebChannel(o, { scanNetwork: async () => undefined }, { port, host: '127.0.0.1', token, access: 'local' }));
    await gw.start(); t.onEnd(() => gw.stop());
    const stop = startValhalla(o, async () => {}, { modules: [...coreModules(o), frigg] }); t.onEnd(stop);
    const v = valhallaOf()!;
    v.ctx('frigg').saveSettings({ services: [{ name: 'Coupe', minutes: 30, price: 15 }], hours: { 0: '8:00-20:00', 1: '8:00-20:00', 2: '8:00-20:00', 3: '8:00-20:00', 4: '8:00-20:00', 5: '8:00-20:00', 6: '8:00-20:00' } });
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const script = join(DIR, 'client-du-banc.mjs'); writeFileSync(script, CLIENT);
    const client = async (tok: string, calls: unknown[]) => {
      const p = t.spawn(process.execPath, [script], { env: { ...process.env, BANC_URL: `http://127.0.0.1:${port}/mcp`, BANC_TOKEN: tok, BANC_CALLS: JSON.stringify(calls) }, cwd: DIR });
      await new Promise<void>((r) => p.on('exit', () => r()));
      try { return JSON.parse(p.log().trim().split('\n').pop() ?? '{}') as Record<string, { text: string; isError: boolean } & Record<string, unknown>> & { error?: string; server?: { name: string; version: string }; instructions?: string; tools?: Array<{ name: string; readOnly?: boolean; actions?: string[] }> }; } catch { return { error: p.log().slice(-300) } as never; }
    };

    const no = await client('', []);
    t.ok(Boolean(no.error) && !no.tools, 'sans jeton : le client officiel est refusé', JSON.stringify(no).slice(0, 200));
    const wrong = await client('jeton-faux-0000000000000000', []);
    t.ok(Boolean(wrong.error) && !wrong.tools, 'jeton faux : refusé aussi', JSON.stringify(wrong).slice(0, 200));

    const r = await client(token, [
      ['applis', 'odin_applis', {}],
      ['conseil', 'odin_conseil', { besoin: 'j\'ai besoin de prendre rendez-vous' }],
      ['creneaux', 'odin_frigg', { action: 'creneaux', entree: { service: 'Coupe', jour: day } }],
      ['reserver', 'odin_frigg', { action: 'reserver', entree: { service: 'Coupe', jour: day, heure: '10:00', nom: 'Client MCP', contact: 'mcp@exemple.fr' } }],
      ['annuler', 'odin_frigg', { action: 'annuler', entree: { id: 'x' } }],
      ['inconnu', 'odin_nexistepas', {}],
    ]);
    t.ok(!r.error && r.server?.name === 'odin', 'avec le jeton : la connexion et la négociation du protocole réussissent (client officiel)', r.error ?? JSON.stringify(r.server));
    t.match(r.instructions ?? '', /actions graves/, 'Odin annonce ses règles au client (pas d\'action grave par MCP)');
    const fr = r.tools?.find((x) => x.name === 'odin_frigg');
    t.ok((r.tools?.length ?? 0) >= 6 && fr && fr.actions?.includes('reserver') && !fr.actions?.includes('annuler'), 'les applis d\'Odin sont listées comme outils ; « annuler » (grave) n\'y figure pas', JSON.stringify(fr));
    t.match(r.applis?.text ?? '', /Chronos \(Données\) : Les rendez-vous/, 'outil « odin_applis » : la liste des applis');
    t.match(r.conseil?.text ?? '', /\*\*Chronos\*\*/, 'outil « odin_conseil » : Odin choisit Chronos pour le besoin');
    t.match(r.creneaux?.text ?? '', /10:00/, 'action de lecture par MCP : créneaux libres');
    t.ok(r.reserver && !r.reserver.isError && (v.ctx('frigg').settings.bookings as Array<{ name: string }>).some((b) => b.name === 'Client MCP'), 'action simple par MCP : la réservation est bien créée dans Odin', JSON.stringify(r.reserver));
    t.ok(r.annuler?.isError === true && /Action inconnue|grave/.test(r.annuler.text) && (v.ctx('frigg').settings.bookings as Array<{ status: string }>)[0].status !== 'annulé', 'action grave par MCP : refusée, rien n\'est annulé', JSON.stringify(r.annuler));
    t.ok(r.inconnu?.isError === true, 'outil inconnu : erreur propre du protocole', JSON.stringify(r.inconnu));
  },
};
