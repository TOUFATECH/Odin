// Svalinn — la Livebox d'Orange par son interface locale (l'API « sysbus » de sa page d'administration, /ws).
// Odin se connecte avec le mot de passe que TU lui as donné (rangé dans le coffre) : jamais de mot de passe deviné,
// jamais d'accès forcé. Lecture : modèle, logiciel, Wi-Fi (nom, chiffrement, WPS, canaux), invités, UPnP, accès à
// distance, appareils. Écriture : seulement un changement que tu as accepté, après une sauvegarde de l'état.
// NB : écrit d'après l'API publique de la Livebox (projets libres qui la pilotent) ; vérifié contre une fausse box
// dans les tests, pas encore contre une vraie.
import type { Change } from './analyse.ts';

type Fetch = typeof fetch;
export interface Radio { id: string; band: string; channel?: number; auto?: boolean }
export interface Vap { id: string; ssid: string; security: string; wps?: boolean; enabled?: boolean; band?: string; guest?: boolean }
export interface Device { name: string; mac: string; ip?: string; active: boolean; wifi: boolean; band?: string; signal?: number }
export interface BoxState { brand: string; model?: string; firmware?: string; wanIp?: string; vaps: Vap[]; radios: Radio[]; guest?: boolean; upnp?: boolean; remote?: boolean; devices: Device[]; at: string }

const CT = 'application/x-sah-ws-4-call+json';
export class Livebox {
  host: string; private pw: string; private user: string; private f: Fetch; private ctx = ''; private cookie = '';
  constructor(host: string, password: string, o: { user?: string; fetch?: Fetch } = {}) { this.host = host; this.pw = password; this.user = o.user ?? 'admin'; this.f = o.fetch ?? fetch; }
  private async post(body: unknown, auth: string): Promise<{ json: Record<string, unknown>; res: Response }> {
    const res = await this.f(`http://${this.host}/ws`, { method: 'POST', headers: { 'content-type': CT, authorization: auth, ...(this.ctx ? { 'x-context': this.ctx } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`la box répond ${res.status}`);
    return { json: await res.json() as Record<string, unknown>, res };
  }
  async login(): Promise<void> {
    const { json, res } = await this.post({ service: 'sah.Device.Information', method: 'createContext', parameters: { applicationName: 'webui', username: this.user, password: this.pw } }, 'X-Sah-Login');
    const id = (json.data as { contextID?: string } | undefined)?.contextID;
    if (!id || json.status !== 0) throw new Error('mot de passe de la box refusé (Odin ne réessaie pas en boucle : vérifie-le dans le coffre)');
    this.ctx = id; this.cookie = (res.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;=]+=)/).map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
  }
  async call(service: string, method: string, parameters: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.ctx) await this.login();
    const { json } = await this.post({ service, method, parameters }, `X-Sah ${this.ctx}`);
    if (Array.isArray(json.errors) && json.errors.length) throw new Error(`la box refuse ${service}.${method} : ${String((json.errors[0] as { description?: string }).description ?? 'erreur')}`);
    return json;
  }
  async read(now = new Date()): Promise<BoxState> {
    const safe = async <T>(p: Promise<T>): Promise<T | undefined> => { try { return await p; } catch { return undefined; } };
    const info = (await safe(this.call('DeviceInfo', 'get')))?.status as Record<string, unknown> | undefined;
    const mibs = ((await safe(this.call('NeMo.Intf.lan', 'getMIBs', { mibs: 'wlanvap wlanradio' })))?.status ?? {}) as { wlanvap?: Record<string, Record<string, unknown>>; wlanradio?: Record<string, Record<string, unknown>> };
    const radios: Radio[] = Object.entries(mibs.wlanradio ?? {}).map(([id, r]) => ({ id, band: bandOf(String(r.OperatingFrequencyBand ?? '')), channel: Number(r.Channel) || undefined, auto: r.AutoChannelEnable === true }));
    const vaps: Vap[] = Object.entries(mibs.wlanvap ?? {}).map(([id, v]) => { const sec = (v.Security ?? {}) as Record<string, unknown>, wps = (v.WPS ?? {}) as Record<string, unknown>; return { id, ssid: String(v.SSID ?? ''), security: String(sec.ModeEnabled ?? ''), wps: wps.Enable === true, enabled: v.VAPStatus ? v.VAPStatus === 'Up' : undefined, band: radios.find((r) => String(v.LLIntf ?? '').includes(r.id))?.band, guest: /guest/i.test(id) }; });
    const guest = (await safe(this.call('NMC.Guest', 'get')))?.status as Record<string, unknown> | undefined;
    const upnp = (await safe(this.call('UPnP-IGD', 'get')))?.status as Record<string, unknown> | undefined;
    const remote = (await safe(this.call('RemoteAccess', 'get')))?.status as Record<string, unknown> | undefined;
    const devs = ((await safe(this.call('Devices', 'get', { expression: 'lan and not self' })))?.status ?? []) as Array<Record<string, unknown>>;
    return {
      brand: 'Livebox', model: str(info?.ModelName) ?? str(info?.ProductClass), firmware: str(info?.SoftwareVersion), wanIp: str(info?.ExternalIPAddress), vaps, radios,
      guest: guest ? guest.Enable === true : undefined, upnp: upnp ? upnp.Enable === true : undefined, remote: remote ? remote.Enable === true : undefined,
      devices: Array.isArray(devs) ? devs.map((d) => ({ name: String(d.Name ?? d.HostName ?? d.PhysAddress ?? '?'), mac: String(d.PhysAddress ?? d.Key ?? ''), ip: str(d.IPAddress), active: d.Active === true, wifi: /wl|wifi/i.test(String(d.InterfaceName ?? d.Layer2Interface ?? '')) || d.SignalStrength !== undefined, band: str(d.OperatingFrequencyBand) ? bandOf(String(d.OperatingFrequencyBand)) : undefined, signal: typeof d.SignalStrength === 'number' ? d.SignalStrength : undefined })) : [],
      at: now.toISOString(),
    };
  }
  /** Un changement accepté. Rend l'inverse (pour revenir en arrière). */
  async apply(c: Change, st: BoxState): Promise<Change | undefined> {
    const vaps = st.vaps.filter((v) => !v.guest);
    switch (c.kind) {
      case 'wps': for (const v of vaps) await this.call(`NeMo.Intf.${v.id}`, 'setWLANConfig', { mibs: { wlanvap: { [v.id]: { WPS: { Enable: c.on } } } } }); return { kind: 'wps', on: !c.on };
      case 'securite': { const mode = c.mode === 'WPA3' ? 'WPA3-Personal' : c.mode === 'WPA2' ? 'WPA2-Personal' : 'WPA2-WPA3-Personal'; const before = vaps[0]?.security; for (const v of vaps) await this.call(`NeMo.Intf.${v.id}`, 'setWLANConfig', { mibs: { wlanvap: { [v.id]: { Security: { ModeEnabled: mode } } } } }); return before ? { kind: 'securite', mode: /WPA3/i.test(before) ? (/WPA2/i.test(before) ? 'WPA2/WPA3' : 'WPA3') : 'WPA2' } : undefined; }
      case 'canal': { const r = st.radios.find((x) => x.band === '2,4 GHz'); if (!r) throw new Error('radio 2,4 GHz introuvable'); await this.call(`NeMo.Intf.${r.id}`, 'setWLANConfig', { mibs: { wlanradio: { [r.id]: { Channel: c.chan, AutoChannelEnable: false } } } }); return r.channel ? { kind: 'canal', chan: r.channel } : undefined; }
      case 'upnp': await this.call('UPnP-IGD', 'set', { Enable: c.on }); return { kind: 'upnp', on: !c.on };
      case 'distance': await this.call('RemoteAccess', c.on ? 'enable' : 'disable', {}); return { kind: 'distance', on: !c.on };
      case 'invites': await this.call('NMC.Guest', 'set', { Enable: c.on }); return { kind: 'invites', on: !c.on };
      case 'mot_de_passe': throw new Error('le mot de passe de la box se change dans sa page (Odin te guide et range le nouveau dans le coffre)');
    }
  }
}
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const bandOf = (b: string) => (/2\.?4/.test(b) ? '2,4 GHz' : /6/.test(b) && !/5/.test(b) ? '6 GHz' : /5/.test(b) ? '5 GHz' : b);
/** La page d'une box de cette marque répond-elle ? (la Livebox sert /ws et sa page « sah ») */
export async function isLivebox(host: string, f: Fetch = fetch): Promise<boolean> {
  try { const r = await f(`http://${host}/`, { signal: AbortSignal.timeout(4000) }); const t = (await r.text()).slice(0, 20000); return /livebox|sah\b|sahpairing|orange/i.test(t); } catch { return false; }
}
