// Zéphyr — l'analyse du Wi-Fi de la maison, sans rien toucher : les réseaux autour (nmcli ou iw), l'encombrement
// des canaux, et la note de sécurité du Wi-Fi avec ce qu'il faut corriger (le plus urgent en premier).

export interface Net { ssid: string; bssid?: string; chan: number; freq?: number; signal: number; security: string; wps?: boolean; mine?: boolean }

/** Coupe une ligne de `nmcli -t` : les « : » échappés (\:) restent dans le champ. */
function fields(line: string): string[] {
  const out: string[] = []; let cur = '';
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '\\' && i + 1 < line.length) { cur += line[++i]; continue; } if (c === ':') { out.push(cur); cur = ''; continue; } cur += c; }
  out.push(cur); return out;
}
/** `nmcli -t -f IN-USE,SSID,BSSID,CHAN,FREQ,SIGNAL,SECURITY dev wifi list` → réseaux (SIGNAL en %). */
export function parseNmcli(out: string): Net[] {
  return out.split('\n').map((l) => l.trimEnd()).filter(Boolean).map((l) => {
    const [use, ssid, bssid, chan, freq, signal, sec] = fields(l);
    return { ssid: ssid ?? '', bssid: bssid || undefined, chan: Number(chan) || 0, freq: Number.parseInt(freq ?? '', 10) || undefined, signal: Number(signal) || 0, security: (sec ?? '').trim() || 'ouvert', mine: use?.trim() === '*' };
  }).filter((n) => n.chan > 0);
}
/** `iw dev <carte> scan` → réseaux, avec le WPS (que nmcli ne montre pas) ; signal converti de dBm en %. */
export function parseIw(out: string): Net[] {
  const nets: Net[] = [];
  for (const block of out.split(/\n(?=BSS [0-9a-f:]{17})/i)) {
    const bssid = /^BSS ([0-9a-f:]{17})/im.exec(block)?.[1]; if (!bssid) continue;
    const freq = Number(/freq:\s*([\d.]+)/.exec(block)?.[1]) || undefined, dbm = Number(/signal:\s*(-?[\d.]+)\s*dBm/.exec(block)?.[1]);
    const chan = Number(/primary channel:\s*(\d+)/.exec(block)?.[1] ?? /DS Parameter set: channel (\d+)/.exec(block)?.[1]) || (freq ? chanOf(freq) : 0);
    const rsn = /\bRSN:/.test(block), wpa = /\bWPA:/.test(block), sae = /Authentication suites:.*\bSAE\b/.test(block), psk = /Authentication suites:.*\bPSK\b/.test(block), wep = /capability:.*Privacy/.test(block) && !rsn && !wpa;
    const security = sae && psk ? 'WPA2 WPA3' : sae ? 'WPA3' : rsn ? 'WPA2' : wpa ? 'WPA1' : wep ? 'WEP' : 'ouvert';
    nets.push({ ssid: /SSID: (.*)/.exec(block)?.[1]?.trim() ?? '', bssid, chan, freq, signal: Number.isFinite(dbm) ? Math.max(0, Math.min(100, Math.round(2 * (dbm + 100)))) : 0, security, wps: /\bWPS:/.test(block), mine: /-- associated/.test(block) });
  }
  return nets.filter((n) => n.chan > 0);
}
export const chanOf = (mhz: number) => (mhz >= 2412 && mhz <= 2472 ? (mhz - 2407) / 5 : mhz === 2484 ? 14 : mhz >= 5000 && mhz < 5900 ? (mhz - 5000) / 5 : mhz >= 5955 ? (mhz - 5950) / 5 : 0);

/** Le niveau de chiffrement, du pire au meilleur. */
export type Secu = 'ouvert' | 'WEP' | 'WPA' | 'WPA2' | 'WPA2/WPA3' | 'WPA3';
export function secuOf(s: string): Secu {
  const x = s.toUpperCase();
  if (/WPA3|SAE/.test(x)) return /WPA2|PSK/.test(x.replace(/WPA3-?PERSONAL|SAE/g, '')) ? 'WPA2/WPA3' : 'WPA3';
  if (/WPA2|RSN|11I/.test(x)) return 'WPA2';
  if (/WPA/.test(x)) return 'WPA';
  if (/WEP/.test(x)) return 'WEP';
  return 'ouvert';
}

/** Encombrement d'un canal 2,4 GHz : les voisins qui le chevauchent (±4 canaux), pondérés par leur force. */
export function crowd(nets: Net[], chan: number, skip?: string): number {
  return nets.filter((n) => n.chan <= 14 && n.bssid !== skip && !n.mine && Math.abs(n.chan - chan) < 5).reduce((k, n) => k + (Math.abs(n.chan - chan) === 0 ? 1 : 0.5) * (n.signal >= 60 ? 1.5 : n.signal >= 35 ? 1 : 0.5), 0);
}
/** Le meilleur canal 2,4 GHz parmi 1, 6, 11 (les seuls qui ne se chevauchent pas). */
export function bestChannel(nets: Net[], now?: number): { now?: number; nowCrowd: number; best: number; bestCrowd: number; voisins: number } {
  const c = [1, 6, 11].map((ch) => ({ ch, k: crowd(nets, ch) })).sort((a, b) => a.k - b.k || (a.ch === now ? -1 : 0));
  return { now, nowCrowd: now ? crowd(nets, now) : 0, best: c[0].ch, bestCrowd: c[0].k, voisins: now ? nets.filter((n) => n.chan <= 14 && !n.mine && n.chan === now).length : 0 };
}

export interface Facts { security?: Secu; wps?: boolean; defaultPassword?: boolean; upnp?: boolean; remoteAdmin?: boolean; firmwareOld?: boolean; channel?: ReturnType<typeof bestChannel>; guest?: boolean; band?: string }
export interface Fix { id: string; title: string; detail: string; level: 'urgent' | 'important' | 'conseil' | 'à vérifier'; button: string; points: number; change?: Change }
export type Change = { kind: 'wps'; on: boolean } | { kind: 'securite'; mode: 'WPA2' | 'WPA2/WPA3' | 'WPA3' } | { kind: 'canal'; chan: number } | { kind: 'upnp'; on: boolean } | { kind: 'distance'; on: boolean } | { kind: 'invites'; on: boolean } | { kind: 'mot_de_passe' };

/** La note sur 100 et la liste de ce qu'il faut corriger (le plus urgent d'abord). Rien d'inconnu ne fait perdre de points : il est « à vérifier ». */
export function assess(f: Facts): { note: number; fixes: Fix[]; verdict: string } {
  const fixes: Fix[] = [];
  const s = f.security;
  if (s === 'ouvert') fixes.push({ id: 'chiffrement', title: 'Wi-Fi sans mot de passe', detail: 'tout le monde peut entrer et lire ce qui passe', level: 'urgent', button: 'Corriger', points: 60, change: { kind: 'securite', mode: 'WPA2/WPA3' } });
  else if (s === 'WEP') fixes.push({ id: 'chiffrement', title: 'Chiffrement WEP', detail: 'cassé en quelques minutes : passer en WPA2/WPA3', level: 'urgent', button: 'Corriger', points: 50, change: { kind: 'securite', mode: 'WPA2/WPA3' } });
  else if (s === 'WPA') fixes.push({ id: 'chiffrement', title: 'Chiffrement WPA (ancien)', detail: 'passer en WPA2/WPA3', level: 'urgent', button: 'Corriger', points: 35, change: { kind: 'securite', mode: 'WPA2/WPA3' } });
  else if (s === 'WPA2') fixes.push({ id: 'chiffrement', title: 'Chiffrement WPA2 seul', detail: 'passer en WPA2/WPA3 mixte (tes vieux appareils gardent WPA2)', level: 'important', button: 'Corriger', points: 12, change: { kind: 'securite', mode: 'WPA2/WPA3' } });
  else if (!s) fixes.push({ id: 'chiffrement', title: 'Chiffrement inconnu', detail: 'relie la box ou lance l\'analyse depuis une machine en Wi-Fi', level: 'à vérifier', button: 'Vérifier', points: 0 });
  if (f.wps === true) fixes.push({ id: 'wps', title: 'WPS activé', detail: 'un voisin peut entrer en quelques heures (code PIN)', level: 'urgent', button: 'Couper', points: 18, change: { kind: 'wps', on: false } });
  if (f.defaultPassword === true) fixes.push({ id: 'mot_de_passe', title: 'Mot de passe d\'origine de la box', detail: 'imprimé sous la box : à changer (Odin le garde dans le coffre)', level: 'important', button: 'Corriger', points: 15, change: { kind: 'mot_de_passe' } });
  if (f.remoteAdmin === true) fixes.push({ id: 'distance', title: 'Box visible depuis Internet', detail: 'accès à distance ouvert', level: 'important', button: 'Fermer', points: 12, change: { kind: 'distance', on: false } });
  if (f.firmwareOld === true) fixes.push({ id: 'firmware', title: 'Logiciel de la box ancien', detail: 'une mise à jour corrige des failles', level: 'important', button: 'Voir', points: 10 });
  if (f.upnp === true) fixes.push({ id: 'upnp', title: 'UPnP ouvert', detail: 'n\'importe quel appareil peut ouvrir un port vers Internet', level: 'conseil', button: 'Couper', points: 8, change: { kind: 'upnp', on: false } });
  const c = f.channel;
  if (c?.now && c.now <= 14 && c.best !== c.now && c.nowCrowd - c.bestCrowd >= 1.5) fixes.push({ id: 'canal', title: `Canal ${c.now} encombré`, detail: `${c.voisins} voisin${c.voisins > 1 ? 's' : ''} dessus · le ${c.best} est plus libre`, level: 'conseil', button: 'Changer', points: 5, change: { kind: 'canal', chan: c.best } });
  const order = { urgent: 0, important: 1, conseil: 2, 'à vérifier': 3 };
  fixes.sort((a, b) => order[a.level] - order[b.level] || b.points - a.points);
  const note = Math.max(0, Math.min(100, 100 - fixes.reduce((k, x) => k + x.points, 0)));
  return { note, fixes, verdict: note >= 90 ? 'très bien' : note >= 75 ? 'bien' : note >= 50 ? 'à améliorer' : 'dangereux' };
}

/** Le texte d'un QR code Wi-Fi (l'appareil photo d'un téléphone le reconnaît). */
export function wifiQr(ssid: string, password: string, sec: 'WPA' | 'nopass' = 'WPA'): string {
  const e = (x: string) => x.replace(/([\\;,:"])/g, '\\$1');
  return `WIFI:T:${sec};S:${e(ssid)};${sec === 'nopass' ? '' : `P:${e(password)};`};`;
}
