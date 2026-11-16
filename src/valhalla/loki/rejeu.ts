// Le rejeu des sessions des pièges de Sirènes (Loki) : chaque attaque est enregistrée, horodatée, pour être
// REJOUÉE au bon rythme — comme un enregistrement de terminal (asciinema/Cowrie) pour les pièges de type
// terminal, ou en FRISE d'événements pour les autres (Web, Modbus…). Tout reste local à Odin : rien n'est
// envoyé dehors. Ce n'est pas un vrai fichier vidéo (lourd et inutile pour des commandes) : c'est un rejeu
// fidèle, rejouable, avec un export (texte horodaté, format asciinema .cast, et un lecteur HTML autonome).
//
// Ce fichier est PUR (sauf les helpers de rangement en bas) : il ne touche ni au réseau ni à aucun service.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Un événement d'une session : « in » = tapé par l'attaquant, « out » = répondu par le faux service, « note » = un fait remarqué (identifiants, commande, capture). `t` = millisecondes depuis le début de la session (pour rejouer au bon rythme). */
export interface SessEvt { t: number; dir: 'in' | 'out' | 'note'; data: string }
/** Une session enregistrée d'un piège : qui s'est connecté, d'où, quand, et tout ce qui s'est dit, horodaté. */
export interface Session {
  id: string; trapId: string; trap: string; proto: string; ip: string; port: number; pays?: string;
  debut: string; start: number; fin?: string; events: SessEvt[];
  octetsIn: number; octetsOut: number;
}

// Garde-fous : une session ne garde pas plus que ça (un robot peut inonder un piège).
const MAX_EVTS = 3000, MAX_DATA = 4000, MAX_OCTETS = 2 * 1024 * 1024;
/** Les pièges de type terminal (rejeu « enregistrement de terminal ») ; les autres se rejouent en frise. */
const TERMINAUX = new Set(['narfi', 'fenrir', 'sshid', 'thrym', 'skrymir', 'jormungandr']);
export const estTerminal = (trapId: string): boolean => TERMINAUX.has(trapId);

/** Ouvre une session (début = maintenant). `now` en millisecondes réelles (pour le rythme) ; `at` = l'heure affichée. */
export function ouvrirSession(o: { id: string; trapId: string; trap: string; proto: string; ip: string; port: number; pays?: string; at: string; now: number }): Session {
  return { id: o.id, trapId: o.trapId, trap: o.trap, proto: o.proto, ip: o.ip, port: o.port, pays: o.pays, debut: o.at, start: o.now, events: [], octetsIn: 0, octetsOut: 0 };
}
/** Ajoute un événement à une session (horodaté par rapport au début), avec les garde-fous de taille. */
export function noter(s: Session, dir: SessEvt['dir'], data: string, now: number): void {
  if (s.fin || s.events.length >= MAX_EVTS || s.octetsIn + s.octetsOut >= MAX_OCTETS) return;
  const texte = String(data).slice(0, MAX_DATA);
  if (!texte) return;
  if (dir === 'in') s.octetsIn += texte.length; else if (dir === 'out') s.octetsOut += texte.length;
  s.events.push({ t: Math.max(0, now - s.start), dir, data: texte });
}
/** Ferme une session (fin = maintenant). */
export function fermerSession(s: Session, at: string): Session { if (!s.fin) s.fin = at; return s; }

/**
 * Branche l'enregistrement sur un vrai socket : tout ce qui arrive (in) et tout ce qui est renvoyé (out) est noté,
 * au bon moment. Fait exprès ici (et pas dans chaque piège) pour enregistrer TOUS les pièges sans les réécrire.
 * Le remplacement de `write` est local et sûr (il rappelle toujours l'écriture d'origine).
 */
export function brancherSocket(sock: { on(ev: string, cb: (d: unknown) => void): unknown; write: (...a: unknown[]) => unknown }, s: Session, now: () => number): void {
  sock.on('data', (d: unknown) => { try { noter(s, 'in', toLatin1(d), now()); } catch { /* données illisibles */ } });
  const ecrire = sock.write.bind(sock) as (...a: unknown[]) => unknown;
  sock.write = (...a: unknown[]) => { try { noter(s, 'out', toLatin1(a[0]), now()); } catch { /* rien */ } return ecrire(...a); };
}
const toLatin1 = (d: unknown): string => typeof d === 'string' ? d : Buffer.isBuffer(d) ? d.toString('latin1') : d == null ? '' : String(d);

/** Une image du rejeu : combien de temps attendre depuis l'image précédente, et quoi montrer. */
export interface Frame { delai: number; dir: SessEvt['dir']; data: string }
/**
 * Reconstruit le rejeu AU BON RYTHME à partir des horodatages : chaque image dit le temps écoulé depuis la
 * précédente. `capIdle` (ms) raccourcit les longs silences pour que le rejeu reste regardable, sans changer l'ordre.
 */
export function rejouer(s: Session, capIdle = 0): Frame[] {
  const out: Frame[] = []; let prev = 0;
  for (const e of s.events) { let d = Math.max(0, e.t - prev); if (capIdle > 0) d = Math.min(d, capIdle); out.push({ delai: d, dir: e.dir, data: e.data }); prev = e.t; }
  return out;
}

/** Le résumé d'une session : qui, d'où, combien de commandes, les plus notables, les identifiants essayés. */
export interface Resume { id: string; trap: string; ip: string; pays?: string; debut: string; duree: number; commandes: string[]; identifiants: string[]; captures: number; octets: number; notable: boolean }
/** Fabrique le résumé d'une session (liste les commandes tapées et les identifiants essayés). */
export function resume(s: Session): Resume {
  const notes = s.events.filter((e) => e.dir === 'note').map((e) => e.data);
  const ident = notes.filter((d) => /^identifiants?\s*:/i.test(d)).map((d) => d.replace(/^identifiants?\s*:\s*/i, ''));
  const cmdNotes = notes.filter((d) => /^commande\s*:/i.test(d)).map((d) => d.replace(/^commande\s*:\s*/i, ''));
  // Les commandes : d'abord les notes « commande: … », sinon les lignes tapées (pièges de terminal).
  const lignesIn = s.events.filter((e) => e.dir === 'in').flatMap((e) => e.data.split(/\r?\n/)).map((x) => x.trim()).filter(Boolean);
  const commandes = cmdNotes.length ? cmdNotes : (estTerminal(s.trapId) ? lignesIn : []);
  const captures = notes.filter((d) => /^capture\s*:/i.test(d)).length;
  const duree = s.fin ? Math.max(0, Date.parse(s.fin) - Date.parse(s.debut)) : (s.events.at(-1)?.t ?? 0);
  const notable = ident.length > 0 || commandes.length > 0 || captures > 0;
  return { id: s.id, trap: s.trap, ip: s.ip, pays: s.pays, debut: s.debut, duree, commandes: commandes.slice(0, 50), identifiants: [...new Set(ident)].slice(0, 20), captures, octets: s.octetsIn + s.octetsOut, notable };
}
/** Une ligne de résumé en français simple (pour la notification au propriétaire). */
export function phraseResume(r: Resume): string {
  const d = Math.round(r.duree / 1000);
  const bits = [`${r.trap} · ${r.ip}${r.pays ? ` (${r.pays})` : ''}`, `${r.commandes.length} commande(s)`];
  if (r.identifiants.length) bits.push(`identifiants essayés : ${r.identifiants.slice(0, 3).join(', ')}`);
  if (r.captures) bits.push(`${r.captures} fichier(s) capturé(s)`);
  bits.push(`${d} s`);
  return bits.join(' · ');
}

const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (c) => (c === '\u001b' ? '\u001b' : ' '));
/** Export texte horodaté (toujours possible, pour tous les pièges). */
export function versTexte(s: Session): string {
  const dirTxt: Record<SessEvt['dir'], string> = { in: '«', out: '»', note: '*' };
  const head = `# Rejeu ${s.trap} (${s.proto}) · ${s.ip}${s.pays ? ` (${s.pays})` : ''} · ${s.debut}${s.fin ? ` → ${s.fin}` : ''}`;
  const lignes = s.events.map((e) => `[+${(e.t / 1000).toFixed(2)}s] ${dirTxt[e.dir]} ${esc(e.data).replace(/\r?\n/g, ' ').slice(0, 500)}`);
  return [head, ...lignes].join('\n') + '\n';
}
/**
 * Export au format asciinema .cast (v2) pour les pièges de terminal : rejouable dans n'importe quel lecteur
 * asciinema. Entrée et sortie sont montrées (comme un playlog Cowrie). Honnête : ce n'est pas une vidéo, c'est
 * l'enregistrement fidèle de la session, rejouable au bon rythme.
 */
export function versCast(s: Session): string {
  const head = JSON.stringify({ version: 2, width: 80, height: 24, timestamp: Math.floor(Date.parse(s.debut) / 1000) || 0, title: `${s.trap} · ${s.ip}`, env: { TERM: 'xterm-256color', SHELL: '/bin/bash' } });
  const evts = s.events.filter((e) => e.dir !== 'note').map((e) => JSON.stringify([Number((e.t / 1000).toFixed(3)), 'o', e.data]));
  return [head, ...evts].join('\n') + '\n';
}

/**
 * Un lecteur HTML autonome (sans aucune dépendance) qui REJOUE la session au bon rythme, avec pause / avance /
 * vitesse : terminal pour les pièges de terminal, frise pour les autres. À télécharger et ouvrir : c'est le
 * « rejeu vidéo » fidèle et jouable, sans vrai fichier .mp4.
 */
export function lecteurHtml(s: Session): string {
  const data = JSON.stringify({ trap: s.trap, proto: s.proto, ip: s.ip, pays: s.pays ?? '', debut: s.debut, terminal: estTerminal(s.trapId), frames: rejouer(s) }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rejeu ${esc(s.trap)} · ${esc(s.ip)}</title>
<style>:root{color-scheme:dark}body{background:#0b0e14;color:#cdd6f4;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;margin:0;padding:16px}
h1{font-size:15px;font-weight:600;margin:0 0 4px}.meta{color:#9aa5ce;font-size:12px;margin-bottom:12px}
#ecran{white-space:pre-wrap;word-break:break-word;background:#11141c;border:1px solid #1f2430;border-radius:8px;padding:12px;min-height:200px;max-height:65vh;overflow:auto}
.in{color:#f7768e}.out{color:#9ece6a}.note{color:#e0af68}.frise{display:block;margin:2px 0;padding:4px 8px;border-left:2px solid #1f2430}
.barre{display:flex;gap:8px;align-items:center;margin:12px 0}button{background:#1f2430;color:#cdd6f4;border:1px solid #2a3040;border-radius:6px;padding:6px 12px;cursor:pointer}
button:hover{background:#2a3040}input[type=range]{flex:1}</style></head><body>
<h1>Rejeu — <span id="t"></span></h1><div class="meta" id="m"></div>
<div class="barre"><button id="pp">⏸ Pause</button><button id="rs">⟲ Rejouer</button>
<label>Vitesse <select id="sp"><option value="0.5">0,5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option><option value="999">instantané</option></select></label>
<input type="range" id="sk" min="0" value="0" step="1"></div>
<div id="ecran"></div>
<script>(function(){var D=${data};document.getElementById('t').textContent=D.trap+' · '+D.ip+(D.pays?' ('+D.pays+')':'');
document.getElementById('m').textContent=D.proto+' · '+D.debut+' · '+D.frames.length+' événements';
var ec=document.getElementById('ecran'),pp=document.getElementById('pp'),sp=document.getElementById('sp'),sk=document.getElementById('sk');
var i=0,timer=null,paused=false;sk.max=D.frames.length;
function esc(x){return x.replace(/[\\u0000-\\u0008\\u000b-\\u001f]/g,' ')}
function show(n){ec.innerHTML='';var html='';for(var k=0;k<n;k++){var f=D.frames[k];if(D.terminal){html+='<span class="'+f.dir+'">'+esc(f.data).replace(/</g,'&lt;')+'</span>'}else{html+='<span class="frise '+f.dir+'">'+esc(f.data).replace(/</g,'&lt;').replace(/\\r?\\n/g,' ').slice(0,400)+'</span>'}}ec.innerHTML=html;ec.scrollTop=ec.scrollHeight;sk.value=n}
function step(){if(paused||i>=D.frames.length){return}var f=D.frames[i];var v=parseFloat(sp.value)||1;var d=v>=999?0:Math.min(f.delai/v,8000);timer=setTimeout(function(){i++;show(i);step()},d)}
pp.onclick=function(){paused=!paused;pp.textContent=paused?'▶ Lire':'⏸ Pause';if(!paused){step()}};
document.getElementById('rs').onclick=function(){clearTimeout(timer);i=0;paused=false;pp.textContent='⏸ Pause';show(0);step()};
sk.oninput=function(){clearTimeout(timer);i=parseInt(sk.value,10)||0;show(i)};
sk.onchange=function(){if(!paused){step()}};
show(0);step();})();</script></body></html>`;
}

// ---------------------------------------------------------------- Rangement (local, privé) : un fichier par session.
const dossier = (dir: string) => join(dir, 'sessions');
/** Enregistre une session sur le disque (local à Odin). Élague au passage pour garder au plus `garder` sessions. */
export function sauver(dir: string, s: Session, garder = 500): void {
  const d = dossier(dir); mkdirSync(d, { recursive: true, mode: 0o700 });
  writeFileSync(join(d, `${sain(s.id)}.json`), JSON.stringify(s), { mode: 0o600 });
  elaguer(dir, garder);
}
/** Charge une session par son identifiant. */
export function charger(dir: string, id: string): Session | undefined {
  try { return JSON.parse(readFileSync(join(dossier(dir), `${sain(id)}.json`), 'utf8')) as Session; } catch { return undefined; }
}
/** Liste les sessions récentes (résumés seulement), les plus récentes d'abord. */
export function lister(dir: string, limite = 60): Session[] {
  const d = dossier(dir); if (!existsSync(d)) return [];
  const fichiers = readdirSync(d).filter((f) => f.endsWith('.json'));
  const sessions = fichiers.map((f) => { try { return JSON.parse(readFileSync(join(d, f), 'utf8')) as Session; } catch { return undefined; } }).filter((x): x is Session => Boolean(x));
  return sessions.sort((a, b) => b.start - a.start).slice(0, limite);
}
/** Garde au plus `garder` sessions (supprime les plus anciennes). Rétention réglable. */
export function elaguer(dir: string, garder: number): void {
  const d = dossier(dir); if (!existsSync(d) || garder <= 0) return;
  const fichiers = readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => ({ f, s: startDe(join(d, f)) })).sort((a, b) => b.s - a.s);
  for (const { f } of fichiers.slice(garder)) { try { rmSync(join(d, f)); } catch { /* déjà parti */ } }
}
const startDe = (f: string): number => { try { return (JSON.parse(readFileSync(f, 'utf8')) as Session).start || 0; } catch { return 0; } };
const sain = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'session';
