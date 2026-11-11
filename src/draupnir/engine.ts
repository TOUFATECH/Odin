// Draupnir — l'anneau d'Odin qui se recrée tout seul : le moteur d'automatisations d'Odin.
// Même principe qu'un éditeur à nœuds (déclencheur → étapes → branches) mais écrit pour Odin :
// les données circulent en « éléments » ({ json }), chaque nœud reçoit les éléments du précédent
// et en renvoie, sur une ou plusieurs sorties (ex. « Si » : oui / non).
// Expressions : {{ $json.champ }}, {{ $node["Nom"].json.champ }}, {{ $now }}, {{ $today }}, {{ $index }}.
// Aucune évaluation de code : uniquement des chemins (pas d'injection possible par les données).

export interface Item { json: Record<string, unknown> }
export interface FlowNode { id?: string; name: string; type: string; params: Record<string, unknown>; position?: [number, number]; disabled?: boolean; note?: string }
export interface Link { node: string; input?: number }
export interface Workflow {
  id: string; name: string; active: boolean; nodes: FlowNode[];
  /** De qui vers qui : connexions[nomDuNœud][sortie] = [{ node: nomCible }]. */
  connections: Record<string, Link[][]>;
  settings?: { retry?: number; notifyOnError?: boolean; description?: string };
  createdAt?: string; updatedAt?: string; origin?: string;
}
export interface NodeRun { count: number; items: Array<Record<string, unknown>>; ms: number; error?: string; outputs?: number[] }
export interface Execution {
  id: string; workflowId: string; name: string; mode: 'manuel' | 'déclencheur' | 'test'; trigger?: string;
  status: 'succès' | 'erreur' | 'en cours'; startedAt: string; ms: number; nodes: Record<string, NodeRun>; error?: string; failedNode?: string;
  /** Réponse du webhook (nœud « Répondre »). */
  response?: { status: number; body: unknown };
}

export interface Deps {
  /** Les outils d'Odin dont les nœuds se servent (Saga, Runes, IA, messages, web). */
  saga?: {
    search(q: string, n: number): Array<{ title: string; path: string; snippet: string; type: string }>;
    read(note: string): { title: string; path: string; body: string; meta: Record<string, unknown> } | undefined;
    create(title: string, type: string, body: string, meta: Record<string, unknown>): string;
    append(note: string, text: string, section?: string): string;
    attention(): Array<{ kind: string; title: string; path: string; when?: string }>;
    rows(base: string): Array<{ path: string; title: string; meta: Record<string, unknown> }>;
  };
  ask?(text: string): Promise<string>;
  /** Agent Odin complet (outils, sous Heimdall, contenu non fiable). */
  agent?(text: string): Promise<string>;
  /** Exécute une autre automatisation et renvoie les éléments de sa dernière étape. */
  runFlow?(idOrName: string, items: Item[], depth: number): Promise<Item[]>;
  /** Identifiant rangé dans le coffre (jamais copié dans les journaux). */
  secret?(name: string): string | undefined;
  /** Code JavaScript dans un processus isolé. */
  code?(source: string, items: Item[]): Promise<unknown>;
  notify?(text: string): Promise<void>;
  fetch?: typeof fetch;
  sleep?(ms: number): Promise<void>;
  now?(): Date;
}

export interface Param { key: string; label: string; kind: 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'json' | 'cron'; options?: string[]; default?: unknown; help?: string; required?: boolean }
export interface NodeDef {
  type: string; label: string; group: 'Déclencheurs' | 'Saga' | 'Runes' | 'Odin' | 'Logique' | 'Données' | 'Web';
  what: string; trigger?: boolean; params: Param[];
  /** Noms des sorties (une par défaut). Peut dépendre des réglages (aiguillage). */
  outputs?: string[] | ((params: Record<string, unknown>) => string[]);
  /** Entrées nommées (fusion, comparaison) : le nœud attend que toutes ses branches aient fini. */
  inputs?: string[];
  run(c: RunCtx, items: Item[]): Promise<Item[][]> | Item[][];
}
export interface RunCtx {
  deps: Deps; node: FlowNode; wf: Workflow;
  /** Réglage du nœud, expressions résolues pour cet élément. */
  p(key: string, item?: Item, index?: number): unknown;
  s(key: string, item?: Item, index?: number): string;
  /** Éléments reçus sur chaque entrée (nœuds à plusieurs entrées). */
  inputs: Item[][];
  respond(status: number, body: unknown): void;
  depth: number;
}

// ---------------------------------------------------------------- Expressions

type Scope = { $json: unknown; $node: Record<string, { json: unknown; items: unknown[] }>; $now: string; $today: string; $index: number; $items: unknown[]; $workflow: { id: string; name: string } };

/** Lit un chemin comme `$json.a.b`, `$json["clé"]`, `$node["Nom"].json.x`, `$items[0].titre`. */
export function readPath(expr: string, scope: Scope): unknown {
  const m = /^\s*(\$[a-z]+)/i.exec(expr);
  if (!m) return undefined;
  let cur: unknown = (scope as unknown as Record<string, unknown>)[m[1]];
  let rest = expr.slice(m[0].length).trim();
  while (rest) {
    let mm: RegExpExecArray | null;
    if ((mm = /^\.\s*([\p{L}\p{N}_$-]+)/u.exec(rest))) { cur = get(cur, mm[1]); rest = rest.slice(mm[0].length); }
    else if ((mm = /^\[\s*(["'])(.*?)\1\s*\]/.exec(rest))) { cur = get(cur, mm[2]); rest = rest.slice(mm[0].length); }
    else if ((mm = /^\[\s*(\d+)\s*\]/.exec(rest))) { cur = get(cur, Number(mm[1])); rest = rest.slice(mm[0].length); }
    else return undefined;
    rest = rest.trim();
  }
  return cur;
}
function get(o: unknown, k: string | number): unknown {
  if (o === null || o === undefined) return undefined;
  if (typeof o !== 'object') return k === 'length' && typeof o === 'string' ? o.length : undefined;
  if (k === '__proto__' || k === 'constructor' || k === 'prototype') return undefined;
  return Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string | number, unknown>)[k] : k === 'length' && Array.isArray(o) ? o.length : undefined;
}
const show = (v: unknown) => v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** Résout les {{ … }} d'une valeur (texte, liste, objet). Une expression seule garde son type. */
export function resolve(v: unknown, scope: Scope): unknown {
  if (typeof v === 'string') {
    const one = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(v);
    if (one) return readPath(one[1], scope);
    return v.includes('{{') ? v.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, e: string) => show(readPath(e, scope))) : v;
  }
  if (Array.isArray(v)) return v.map((x) => resolve(x, scope));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, scope)]));
  return v;
}

// ---------------------------------------------------------------- Exécution

const MAX_STEPS = 1000, MAX_ITEMS = 10_000, KEEP = 20;
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function outputsOf(def: NodeDef, params: Record<string, unknown>): string[] {
  const o = typeof def.outputs === 'function' ? def.outputs(params) : def.outputs;
  return o?.length ? o : ['sortie'];
}

/** Exécute une automatisation à partir d'un nœud de départ (le déclencheur) et de ses éléments. */
export async function execute(wf: Workflow, catalog: Map<string, NodeDef>, deps: Deps, start: { node?: string; items?: Item[]; mode?: Execution['mode']; depth?: number; stopAfter?: string; pinned?: Record<string, Array<Record<string, unknown>>> } = {}): Promise<Execution> {
  const now = deps.now?.() ?? new Date();
  const first = start.node ? wf.nodes.find((n) => n.name === start.node || n.id === start.node) : wf.nodes.find((n) => catalog.get(n.type)?.trigger);
  const ex: Execution = { id: rid(), workflowId: wf.id, name: wf.name, mode: start.mode ?? 'manuel', trigger: first?.name, status: 'en cours', startedAt: now.toISOString(), ms: 0, nodes: {} };
  const t0 = Date.now();
  if (!first) { ex.status = 'erreur'; ex.error = 'aucun déclencheur'; return ex; }
  const outputsSeen: Record<string, Item[]> = {};
  const queue: Array<{ node: FlowNode; items: Item[]; input: number; inputs?: Item[][] }> = [{ node: first, items: start.items?.length ? start.items : [{ json: {} }], input: 0 }];
  let steps = 0;
  const byName = new Map(wf.nodes.map((n) => [n.name, n]));
  // Nœuds à plusieurs entrées : on garde ce qui arrive jusqu'à ce qu'aucune branche en cours ne puisse encore les atteindre.
  const waiting = new Map<string, Item[][]>();
  const reach = (from: string, to: string, seen = new Set<string>()): boolean => { if (from === to) return true; if (seen.has(from)) return false; seen.add(from); return (wf.connections[from] ?? []).some((o) => (o ?? []).some((l) => reach(l.node, to, seen))); };
  const flush = () => {
    for (const [name, ins] of [...waiting]) {
      if (queue.some((q) => reach(q.node.name, name))) continue;
      waiting.delete(name);
      queue.push({ node: byName.get(name)!, items: ins.flat(), input: 0, inputs: ins });
    }
  };
  const response = (status: number, body: unknown) => { ex.response = { status, body }; };
  while (queue.length || waiting.size) {
    if (!queue.length) { flush(); if (!queue.length) break; }
    if (++steps > MAX_STEPS) { ex.status = 'erreur'; ex.error = `plus de ${MAX_STEPS} étapes : boucle probable`; break; }
    const { node, items, input, inputs } = queue.shift()!;
    const def0 = catalog.get(node.type);
    if (def0?.inputs && def0.inputs.length > 1 && !inputs) {
      const box = waiting.get(node.name) ?? def0.inputs.map(() => [] as Item[]);
      box[Math.min(input, box.length - 1)].push(...items);
      waiting.set(node.name, box);
      continue;
    }
    const def = catalog.get(node.type);
    const t1 = Date.now();
    let outs: Item[][];
    try {
      if (!def) throw new Error(`type de nœud inconnu : ${node.type}`);
      if (node.disabled) outs = [items];
      else {
        const tries = Math.max(0, Math.min(5, Number(wf.settings?.retry ?? 0)));
        for (let k = 0; ; k++) {
          const pin = start.pinned?.[node.name];
          if (pin) { outs = [pin.map((j) => ({ json: { ...j } }))]; break; }
          try { outs = await runNode(def, node, wf, deps, items, outputsSeen, inputs ?? [items], response, start.depth ?? 0); break; } catch (e) {
            if (k >= tries) throw e;
            await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(1000 * 2 ** k);
          }
        }
      }
    } catch (e) {
      const msg = (e as Error).message;
      ex.nodes[node.name] = { count: 0, items: [], ms: Date.now() - t1, error: msg };
      ex.status = 'erreur'; ex.error = msg; ex.failedNode = node.name;
      break;
    }
    outs = outs!.map((o) => o.slice(0, MAX_ITEMS));
    const all = outs.flat();
    outputsSeen[node.name] = [...(outputsSeen[node.name] ?? []), ...all];
    const prev = ex.nodes[node.name];
    ex.nodes[node.name] = { count: (prev?.count ?? 0) + all.length, items: [...(prev?.items ?? []), ...all.map((i) => i.json)].slice(0, KEEP), ms: (prev?.ms ?? 0) + Date.now() - t1, outputs: outs.map((o) => o.length) };
    if (start.stopAfter && node.name === start.stopAfter) continue; // « exécuter jusqu'ici »
    const links = wf.connections[node.name] ?? [];
    outs.forEach((o, i) => { if (!o.length) return; for (const l of links[i] ?? []) { const next = byName.get(l.node); if (next) queue.push({ node: next, items: o.map((x) => ({ json: { ...x.json } })), input: l.input ?? 0 }); } });
  }
  if (ex.status === 'en cours') ex.status = 'succès';
  ex.ms = Date.now() - t0;
  return ex;
}

async function runNode(def: NodeDef, node: FlowNode, wf: Workflow, deps: Deps, items: Item[], seen: Record<string, Item[]>, inputs: Item[][], respond: (s: number, b: unknown) => void, depth: number): Promise<Item[][]> {
  const nowD = deps.now?.() ?? new Date();
  const scopeFor = (item?: Item, index = 0): Scope => ({
    $json: item?.json ?? {}, $index: index, $items: items.map((i) => i.json), $now: nowD.toISOString(), $today: nowD.toISOString().slice(0, 10),
    $node: Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, { json: v[0]?.json ?? {}, items: v.map((i) => i.json) }])),
    $workflow: { id: wf.id, name: wf.name },
  });
  const c: RunCtx = {
    deps, node, wf, inputs, respond, depth,
    p: (key, item, index) => resolve(node.params?.[key] ?? def.params.find((x) => x.key === key)?.default, scopeFor(item ?? items[0], index ?? 0)),
    s: (key, item, index) => show(c.p(key, item, index)),
  };
  const out = await def.run(c, items);
  const n = outputsOf(def, node.params ?? {}).length;
  while (out.length < n) out.push([]);
  return out;
}

// ---------------------------------------------------------------- Vérification

/** Vérifie une automatisation (types connus, noms uniques, liens valides, un déclencheur). Renvoie l'erreur ou undefined. */
export function checkFlow(wf: Partial<Workflow>, catalog: Map<string, NodeDef>): string | undefined {
  if (!wf || typeof wf !== 'object') return 'automatisation vide';
  if (!String(wf.name ?? '').trim()) return 'il manque un nom';
  if (!Array.isArray(wf.nodes) || !wf.nodes.length) return 'aucun nœud';
  const names = new Set<string>();
  for (const n of wf.nodes) {
    if (!n || typeof n.name !== 'string' || !n.name.trim()) return 'nœud sans nom';
    if (names.has(n.name)) return `deux nœuds s'appellent « ${n.name} »`;
    names.add(n.name);
    if (!catalog.has(n.type)) return `type de nœud inconnu : ${n.type}`;
    for (const p of catalog.get(n.type)!.params) if (p.required && (n.params?.[p.key] === undefined || n.params?.[p.key] === '')) return `« ${n.name} » : réglage manquant « ${p.label} »`;
  }
  if (!wf.nodes.some((n) => catalog.get(n.type)?.trigger)) return 'il faut un déclencheur';
  for (const [from, outs] of Object.entries(wf.connections ?? {})) {
    if (!names.has(from)) return `lien depuis un nœud inconnu : ${from}`;
    if (!Array.isArray(outs)) return `liens mal formés pour ${from}`;
    for (const o of outs) for (const l of o ?? []) if (!names.has(l?.node)) return `lien vers un nœud inconnu : ${l?.node}`;
  }
  return undefined;
}

/** Complète une automatisation venue d'ailleurs (IA, import) : identifiants, positions, dates. */
export function normalize(wf: Partial<Workflow>): Workflow {
  const nodes = (wf.nodes ?? []).map((n, i) => ({ id: n.id || rid(), name: String(n.name), type: String(n.type), params: n.params ?? {}, position: n.position ?? [40 + i * 200, 200] as [number, number], ...(n.disabled ? { disabled: true } : {}), ...(n.note ? { note: n.note } : {}) }));
  const t = new Date().toISOString();
  return { id: wf.id || rid(), name: String(wf.name ?? 'Automatisation'), active: Boolean(wf.active), nodes, connections: wf.connections ?? {}, settings: { retry: 0, notifyOnError: true, ...(wf.settings ?? {}) }, createdAt: wf.createdAt ?? t, updatedAt: t, ...(wf.origin ? { origin: wf.origin } : {}) };
}
