// Automatisations : Odin installe et pilote n8n (le vrai, auto-hébergé sur sa machine, pour ton usage
// personnel) au lieu d'en recopier le code — on garde ainsi ses centaines d'intégrations et ses mises
// à jour. Odin le relie au Cerveau dans les deux sens :
//   n8n → Odin : un nœud « Requête HTTP » appelle /api/hook avec une clé dédiée et limitée (capturer,
//                écrire une note, compléter une note, te prévenir, demander quelque chose à Odin) ;
//   Odin → n8n : chaque changement du Cerveau peut prévenir des adresses n8n (déclencheur Webhook).
// Une automatisation décrite en français devient un workflow n8n (JSON), créé désactivé : tu testes,
// puis tu l'actives.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

export interface N8nCfg { url: string; key?: string }
export interface Workflow { id: string; name: string; active: boolean; updatedAt?: string; nodes?: Array<{ name: string; type: string; typeVersion?: number; position?: number[]; parameters?: Record<string, unknown> }>; connections?: Record<string, unknown>; tags?: Array<{ name: string }> }
export interface Execution { id: string; workflowId: string; status?: string; finished?: boolean; mode?: string; startedAt?: string; stoppedAt?: string }

export const lanIp = () => Object.values(networkInterfaces()).flat().find((n) => n && n.family === 'IPv4' && !n.internal)?.address ?? '127.0.0.1';

async function call<T>(c: N8nCfg, path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  if (!c.key) throw new Error('clé API n8n absente : crée-la dans n8n (Paramètres → n8n API) et donne-la à Odin');
  const r = await fetch(`${c.url.replace(/\/$/, '')}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { 'X-N8N-API-KEY': c.key, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  if (r.status === 401) throw new Error('clé API n8n refusée (expirée ou fausse)');
  if (!r.ok) throw new Error(`n8n : HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (r.status === 204 ? {} : await r.json()) as T;
}

/** État : n8n répond-il ? la clé marche-t-elle ? */
export async function n8nStatus(c: N8nCfg): Promise<{ up: boolean; keyOk: boolean; error?: string; workflows?: number }> {
  const up = await fetch(`${c.url.replace(/\/$/, '')}/healthz`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false);
  if (!up) return { up: false, keyOk: false };
  if (!c.key) return { up: true, keyOk: false };
  try { const r = await call<{ data: Workflow[] }>(c, '/workflows?limit=250'); return { up: true, keyOk: true, workflows: r.data.length }; } catch (e) { return { up: true, keyOk: false, error: (e as Error).message }; }
}
export const listWorkflows = async (c: N8nCfg) => (await call<{ data: Workflow[] }>(c, '/workflows?limit=250')).data;
export const getWorkflow = (c: N8nCfg, id: string) => call<Workflow>(c, `/workflows/${encodeURIComponent(id)}`);
export const setActive = (c: N8nCfg, id: string, on: boolean) => call<Workflow>(c, `/workflows/${encodeURIComponent(id)}/${on ? 'activate' : 'deactivate'}`, { method: 'POST' });
export const listExecutions = async (c: N8nCfg, workflowId?: string, limit = 20) => (await call<{ data: Execution[] }>(c, `/executions?limit=${limit}${workflowId ? `&workflowId=${encodeURIComponent(workflowId)}` : ''}`)).data;
export async function createWorkflow(c: N8nCfg, wf: { name: string; nodes: Workflow['nodes']; connections: Record<string, unknown> }): Promise<Workflow> {
  return call<Workflow>(c, '/workflows', { method: 'POST', body: { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: 'v1' } } });
}

/** Vérifie la forme d'un workflow avant de l'envoyer (n8n renvoie des erreurs peu lisibles sinon). Pur. */
export function checkWorkflow(wf: unknown): string | undefined {
  const w = wf as { name?: unknown; nodes?: unknown; connections?: unknown };
  if (!w || typeof w !== 'object') return 'pas un objet';
  if (typeof w.name !== 'string' || !w.name.trim()) return 'nom manquant';
  if (!Array.isArray(w.nodes) || !w.nodes.length) return 'aucun nœud';
  const names = new Set<string>();
  for (const n of w.nodes as Array<Record<string, unknown>>) {
    if (typeof n.name !== 'string' || typeof n.type !== 'string') return 'nœud sans nom ou sans type';
    if (!/^(n8n-nodes-base|@n8n\/n8n-nodes-langchain)\.[A-Za-z0-9]+$/.test(n.type)) return `type de nœud inconnu : ${n.type}`;
    if (names.has(n.name)) return `deux nœuds s'appellent « ${n.name} »`;
    names.add(n.name);
    if (!Array.isArray(n.position)) n.position = [0, 0];
    if (typeof n.typeVersion !== 'number') n.typeVersion = 1;
    if (!n.parameters || typeof n.parameters !== 'object') n.parameters = {};
  }
  if (!w.connections || typeof w.connections !== 'object') return 'connexions manquantes';
  for (const [from, outs] of Object.entries(w.connections as Record<string, { main?: Array<Array<{ node: string }>> }>)) {
    if (!names.has(from)) return `connexion depuis un nœud inconnu : ${from}`;
    for (const branch of outs.main ?? []) for (const to of branch ?? []) if (!names.has(to.node)) return `connexion vers un nœud inconnu : ${to.node}`;
  }
  if (!(w.nodes as Array<{ type: string }>).some((n) => /trigger|webhook|cron|schedule/i.test(n.type))) return 'il faut un déclencheur (planning, webhook, RSS, mail…)';
  return undefined;
}

// ---------------- Pont n8n → Odin ----------------

/** Clé dédiée aux automatisations (n'ouvre que /api/hook, pas l'interface ni les réglages). */
export function hookToken(home: string): string {
  const f = join(home, 'hook-token');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  const t = randomBytes(24).toString('hex');
  mkdirSync(home, { recursive: true });
  writeFileSync(f, t, { mode: 0o600 });
  return t;
}

/** Nœud « Requête HTTP » prêt à coller dans n8n pour appeler Odin. Pur. */
export function odinNode(name: string, odinUrl: string, token: string, body: Record<string, string>, position: [number, number]): NonNullable<Workflow['nodes']>[number] {
  return {
    name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position,
    parameters: {
      method: 'POST', url: `${odinUrl.replace(/\/$/, '')}/api/hook`, sendHeaders: true,
      headerParameters: { parameters: [{ name: 'x-odin-hook', value: token }] },
      sendBody: true, specifyBody: 'json', jsonBody: `=${JSON.stringify(body)}`,
      options: { allowUnauthorizedCerts: true, timeout: 300000 },
    },
  };
}
const link = (from: string, to: string) => ({ [from]: { main: [[{ node: to, type: 'main', index: 0 }]] } });

/** Modèles prêts : chacun relie un déclencheur au Cerveau ou à Odin. */
export function templates(odinUrl: string, token: string): Array<{ id: string; name: string; what: string; wf: { name: string; nodes: Workflow['nodes']; connections: Record<string, unknown> } }> {
  const sched = (name: string, rule: Record<string, unknown>) => ({ name, type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0], parameters: { rule: { interval: [rule] } } });
  return [
    { id: 'point-matin', name: 'Point du matin depuis le Cerveau', what: 'Chaque jour à 7 h 30, Odin fait le point (tâches, échéances, projets) et te l\'envoie.',
      wf: { name: 'Odin · point du matin', nodes: [sched('Chaque matin', { field: 'days', triggerAtHour: 7, triggerAtMinute: 30 }), odinNode('Odin', odinUrl, token, { action: 'ask', send: 'oui', text: 'Fais-moi le point du jour depuis mon Cerveau : tâches à faire et en retard, échéances proches, projets qui n\'avancent plus. Court.' }, [260, 0])], connections: link('Chaque matin', 'Odin') } },
    { id: 'taches-retard', name: 'Relance des tâches en retard', what: 'Chaque soir à 19 h, Odin regarde les tâches du Cerveau en retard et te les rappelle.',
      wf: { name: 'Odin · tâches en retard', nodes: [sched('Chaque soir', { field: 'days', triggerAtHour: 19, triggerAtMinute: 0 }), odinNode('Odin', odinUrl, token, { action: 'ask', send: 'si-utile', text: 'Liste les tâches du Cerveau dont l\'échéance est passée ou demain, et propose quoi faire. Si rien : réponds RIEN.' }, [260, 0])], connections: link('Chaque soir', 'Odin') } },
    { id: 'rss', name: 'Flux RSS → Captures', what: 'Chaque nouvel article d\'un flux (blog, actualité, chaîne YouTube) est résumé et rangé dans le Cerveau.',
      wf: { name: 'Odin · flux vers le Cerveau', nodes: [{ name: 'Nouvel article', type: 'n8n-nodes-base.rssFeedReadTrigger', typeVersion: 1, position: [0, 0], parameters: { feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=REMPLACE-MOI', pollTimes: { item: [{ mode: 'everyHour' }] } } }, odinNode('Capturer', odinUrl, token, { action: 'capture', source: '{{ $json.link }}' }, [260, 0])], connections: link('Nouvel article', 'Capturer') } },
    { id: 'webhook-capture', name: 'Envoyer au Cerveau depuis n\'importe où', what: 'Une adresse n8n qui reçoit un texte ou un lien (raccourci iPhone, formulaire, autre appli) et le capture.',
      wf: { name: 'Odin · entrée du Cerveau', nodes: [{ name: 'Reçu', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], parameters: { httpMethod: 'POST', path: 'odin-capture', responseMode: 'onReceived' } }, odinNode('Capturer', odinUrl, token, { action: 'capture', source: '{{ $json.body.texte || $json.body.lien || JSON.stringify($json.body) }}' }, [260, 0])], connections: link('Reçu', 'Capturer') } },
    { id: 'surveille-site', name: 'Surveiller un site', what: 'Toutes les 15 min, vérifie qu\'un site répond ; sinon Odin te prévient.',
      wf: { name: 'Odin · surveillance de site', nodes: [sched('Toutes les 15 min', { field: 'minutes', minutesInterval: 15 }), { name: 'Tester le site', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [240, 0], parameters: { url: 'https://example.com', options: { response: { response: { neverError: true, fullResponse: true } }, timeout: 15000 } } }, { name: 'En panne ?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [480, 0], parameters: { conditions: { conditions: [{ leftValue: '={{ $json.statusCode }}', rightValue: 400, operator: { type: 'number', operation: 'gte' } }], combinator: 'and', options: { caseSensitive: true, typeValidation: 'loose' } } } }, odinNode('Prévenir', odinUrl, token, { action: 'notify', text: '⚠ Le site surveillé ne répond plus (code {{ $json.statusCode }}).' }, [720, 0])], connections: { ...link('Toutes les 15 min', 'Tester le site'), ...link('Tester le site', 'En panne ?'), 'En panne ?': { main: [[{ node: 'Prévenir', type: 'main', index: 0 }], []] } } } },
    { id: 'cerveau-change', name: 'Quand le Cerveau change', what: 'Reçoit chaque note créée ou modifiée (titre, type, chemin) pour enchaîner ce que tu veux : Notion, Google Sheets, mail…',
      wf: { name: 'Odin · le Cerveau a changé', nodes: [{ name: 'Note du Cerveau', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], parameters: { httpMethod: 'POST', path: 'odin-cerveau', responseMode: 'onReceived' } }, { name: 'À compléter', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [260, 0], parameters: {} }], connections: link('Note du Cerveau', 'À compléter') } },
  ];
}

/** Consigne pour qu'une IA écrive un workflow n8n valide qui parle à Odin. */
export function workflowPrompt(odinUrl: string, token: string): string {
  return `Tu écris un workflow n8n (JSON) à partir d'une demande d'automatisation en français.
Réponds UNIQUEMENT par un objet JSON {"name":"…","nodes":[…],"connections":{…},"explication":"2-4 phrases en français : ce qu'il fait, ce qu'il faut régler (identifiants, adresses)"}.
Règles :
- Nœuds n8n officiels uniquement (type "n8n-nodes-base.xxx"), chacun avec name unique, type, typeVersion, position [x,y] (espacées de 240), parameters.
- Un déclencheur : scheduleTrigger (rule.interval : [{"field":"days","triggerAtHour":7,"triggerAtMinute":30}] ou minutes/hours), webhook (httpMethod, path), rssFeedReadTrigger (feedUrl), emailReadImap, gmailTrigger, telegramTrigger, etc.
- Puis httpRequest, if, switch, set, code (JavaScript), merge, splitInBatches, wait, et les nœuds d'applis (googleSheets, notion, gmail, slack, discord, telegram…) quand la demande les cite (ils demanderont des identifiants dans n8n : dis-le dans l'explication).
- Pour parler à Odin et à son Cerveau, utilise un nœud httpRequest POST ${odinUrl.replace(/\/$/, '')}/api/hook, en-tête x-odin-hook: ${token}, corps JSON avec "action" parmi :
  capture {source} (lien, texte : résumé et rangé) · note {titre, type, contenu} · ajouter {note, texte, section} · notify {text} (prévenir le propriétaire) · ask {text, send:"oui"|"si-utile"} (demander à Odin, qui peut agir et répondre).
  Paramètres du nœud : method "POST", url, sendHeaders true, headerParameters {parameters:[{name:"x-odin-hook",value:"…"}]}, sendBody true, specifyBody "json", jsonBody "={…}" (expressions n8n {{ }} permises).
- connections : {"Nom du nœud":{"main":[[{"node":"Suivant","type":"main","index":0}]]}}.
- Jamais de mot de passe ni de clé inventés : laisse « REMPLACE-MOI » là où il en faut un.`;
}

export function composeFile(timezone: string, webhookHost: string): string {
  return `# n8n installé par Odin (usage personnel, auto-hébergé)
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      - N8N_SECURE_COOKIE=false
      - N8N_DIAGNOSTICS_ENABLED=false
      - N8N_PERSONALIZATION_ENABLED=false
      - N8N_PUBLIC_API_DISABLED=false
      - GENERIC_TIMEZONE=${timezone}
      - TZ=${timezone}
      - WEBHOOK_URL=http://${webhookHost}:5678/
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - n8n_data:/home/node/.n8n
volumes:
  n8n_data: {}
`;
}
