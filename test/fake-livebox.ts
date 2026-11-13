// Une fausse Livebox pour les tests de Zéphyr : l'API « sysbus » (/ws) avec connexion, lecture et réglages.
export interface FakeBox { calls: Array<{ service: string; method: string; parameters: Record<string, unknown> }>; state: { wps: boolean; mode: string; chan: number; upnp: boolean; remote: boolean; guest: boolean; wifiActive: number }; password: string }
export function fakeLivebox(password = 'mot-de-passe-box'): { box: FakeBox; handle: (url: string, init?: RequestInit) => Response | undefined } {
  const box: FakeBox = { calls: [], password, state: { wps: true, mode: 'WPA2-Personal', chan: 6, upnp: true, remote: true, guest: false, wifiActive: 4 } };
  const handle = (url: string, init?: RequestInit): Response | undefined => {
    const u = new URL(url);
    if (u.pathname === '/' && (init?.method ?? 'GET') === 'GET') return new Response('<html><title>Livebox</title><script src="sah.js"></script></html>');
    if (u.pathname !== '/ws') return undefined;
    const b = JSON.parse(String(init?.body ?? '{}')) as { service: string; method: string; parameters: Record<string, unknown> }, h = new Headers(init?.headers);
    if (b.method === 'createContext') return b.parameters.password === box.password ? new Response(JSON.stringify({ status: 0, data: { contextID: 'ctx-123' } }), { headers: { 'set-cookie': 'sess=abc; Path=/' } }) : Response.json({ status: 1, errors: [{ description: 'Permission denied' }] });
    if (h.get('authorization') !== 'X-Sah ctx-123') return Response.json({ status: null, errors: [{ description: 'Permission denied' }] });
    box.calls.push(b); const st = box.state, p = b.parameters;
    const ok = (status: unknown) => Response.json({ status });
    switch (`${b.service}.${b.method}`) {
      case 'DeviceInfo.get': return ok({ ModelName: 'Livebox 6', SoftwareVersion: 'SG30_sip-fr-6.62.12.1', ExternalIPAddress: '90.0.0.1' });
      case 'NeMo.Intf.lan.getMIBs': return ok({ wlanradio: { wifi0_bcm: { OperatingFrequencyBand: '2.4GHz', Channel: st.chan, AutoChannelEnable: true }, wifi1_bcm: { OperatingFrequencyBand: '5GHz', Channel: 44 } }, wlanvap: { wl0: { SSID: 'Maison', LLIntf: 'wifi0_bcm', VAPStatus: 'Up', Security: { ModeEnabled: st.mode }, WPS: { Enable: st.wps } }, eth4: { SSID: 'Maison', LLIntf: 'wifi1_bcm', VAPStatus: 'Up', Security: { ModeEnabled: st.mode }, WPS: { Enable: st.wps } } } });
      case 'NMC.Guest.get': return ok({ Enable: st.guest });
      case 'NMC.Guest.set': st.guest = p.Enable === true; return ok(true);
      case 'UPnP-IGD.get': return ok({ Enable: st.upnp });
      case 'UPnP-IGD.set': st.upnp = p.Enable === true; return ok(true);
      case 'RemoteAccess.get': return ok({ Enable: st.remote });
      case 'RemoteAccess.disable': st.remote = false; return ok(true);
      case 'RemoteAccess.enable': st.remote = true; return ok(true);
      case 'Devices.get': return ok([...Array.from({ length: 4 }, (_, i) => ({ Name: `Téléphone ${i + 1}`, PhysAddress: `aa:bb:cc:00:00:0${i}`, IPAddress: `192.168.1.${10 + i}`, Active: i < st.wifiActive, InterfaceName: 'wl0', OperatingFrequencyBand: '5GHz', SignalStrength: -50 })), { Name: 'PC bureau', PhysAddress: 'aa:bb:cc:00:00:99', IPAddress: '192.168.1.20', Active: true, InterfaceName: 'eth1' }]);
      default: {
        if (b.method === 'setWLANConfig') {
          const m = p.mibs as { wlanvap?: Record<string, { WPS?: { Enable: boolean }; Security?: { ModeEnabled: string } }>; wlanradio?: Record<string, { Channel: number }> };
          for (const v of Object.values(m.wlanvap ?? {})) { if (v.WPS) st.wps = v.WPS.Enable; if (v.Security) st.mode = v.Security.ModeEnabled; }
          for (const r of Object.values(m.wlanradio ?? {})) st.chan = r.Channel;
          return ok(true);
        }
        return Response.json({ status: null, errors: [{ description: `inconnu : ${b.service}.${b.method}` }] });
      }
    }
  };
  return { box, handle };
}
