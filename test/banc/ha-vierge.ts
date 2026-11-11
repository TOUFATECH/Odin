// Prépare un Home Assistant tout neuf pour le banc : crée le compte du propriétaire (étape
// « bienvenue » de Home Assistant) puis un jeton d'accès longue durée, exactement comme tu le
// ferais à la main dans ton profil. Utilisé seulement sur un Home Assistant lancé par le banc.

export interface HaAccess { url: string; token: string }

export async function onboard(url: string, password: string): Promise<HaAccess> {
  const client_id = `${url}/`;
  const steps = await (await fetch(`${url}/api/onboarding`)).json() as Array<{ step: string; done: boolean }>;
  if (steps.find((s) => s.step === 'user')?.done) throw new Error('ce Home Assistant a déjà un propriétaire : donne son adresse et un jeton (BANC_HA_URL, BANC_HA_TOKEN)');
  const u = await fetch(`${url}/api/onboarding/users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id, name: 'Odin (banc)', username: 'odin', password, language: 'fr' }) });
  if (!u.ok) throw new Error(`création du compte refusée (HTTP ${u.status})`);
  const { auth_code } = await u.json() as { auth_code: string };
  const tk = await fetch(`${url}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id, grant_type: 'authorization_code', code: auth_code }) });
  if (!tk.ok) throw new Error(`jeton refusé (HTTP ${tk.status})`);
  const { access_token } = await tk.json() as { access_token: string };
  // Jeton longue durée : demandé par la connexion temps réel de Home Assistant.
  const token = await new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/api/websocket`);
    const timer = setTimeout(() => { ws.close(); reject(new Error('Home Assistant ne répond pas (connexion temps réel)')); }, 20_000);
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as { type: string; id?: number; success?: boolean; result?: string; error?: { message?: string } };
      if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token }));
      else if (m.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, type: 'auth/long_lived_access_token', client_name: 'Odin (banc)', lifespan: 30 }));
      else if (m.type === 'auth_invalid') { clearTimeout(timer); ws.close(); reject(new Error('jeton provisoire refusé')); }
      else if (m.type === 'result' && m.id === 1) { clearTimeout(timer); ws.close(); if (m.success && m.result) resolve(m.result); else reject(new Error(m.error?.message ?? 'jeton longue durée refusé')); }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('connexion temps réel impossible')); };
  });
  return { url, token };
}

/** Configuration minimale : API, entités de démonstration (lumières, prises, volets, clim, lecteurs, serrure…). */
export const HA_CONFIG = (port: number) => `# Home Assistant du banc d'essai d'Odin
homeassistant:
  name: Maison du banc
  unit_system: metric
  time_zone: Indian/Mayotte
  country: YT
  language: fr
http:
  server_host: 127.0.0.1
  server_port: ${port}
api:
demo:
tts:
  - platform: demo
logger:
  default: warning
`;

/** Commandes sur la connexion temps réel (ranger une entité dans une pièce…), dans l'ordre. */
export async function wsCalls(a: HaAccess, calls: Array<Record<string, unknown>>): Promise<Array<{ success: boolean; result?: unknown; error?: { message?: string } }>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${a.url.replace(/^http/, 'ws')}/api/websocket`), out: Array<{ success: boolean; result?: unknown; error?: { message?: string } }> = [];
    const timer = setTimeout(() => { ws.close(); reject(new Error('Home Assistant ne répond pas')); }, 30_000);
    const next = () => { if (out.length === calls.length) { clearTimeout(timer); ws.close(); resolve(out); } else ws.send(JSON.stringify({ id: out.length + 1, ...calls[out.length] })); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as { type: string; success?: boolean; result?: unknown; error?: { message?: string } };
      if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: a.token }));
      else if (m.type === 'auth_ok') next();
      else if (m.type === 'auth_invalid') { clearTimeout(timer); ws.close(); reject(new Error('jeton refusé')); }
      else if (m.type === 'result') { out.push({ success: Boolean(m.success), result: m.result, error: m.error }); next(); }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('connexion temps réel impossible')); };
  });
}
