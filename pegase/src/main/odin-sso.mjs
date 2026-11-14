// odin-sso.mjs — bibliothèque cliente de la connexion unique d'Odin, pour Node 18+ et Electron (processus principal).
// Un seul fichier, sans dépendance : à COPIER dans l'appli (Pégase, Vénus…). Licence MIT (comme Odin).
// Protocole : docs/sso-protocole.md d'Odin (version 1).
//
//   trouverOdin()           cherche Odin sur cette machine puis sur le réseau local
//   new OdinSSO({...})      se connecte (mot de passe, navigateur + PKCE, ou jeton du poste), renouvelle, sauvegarde
//   coffre                  range un secret dans le coffre du système (Windows, Mac, Linux)
//
// Rien n'est jamais écrit en clair dans un fichier ni dans un journal : le jeton du poste va dans le coffre du système,
// les jetons de l'appli restent en mémoire (ou passent par `garder`, que l'appli chiffre elle-même).

import { request as httpRequest, createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto';
import { spawn } from 'node:child_process';
import { networkInterfaces, userInfo, hostname, platform as osPlatform } from 'node:os';

const b64u = (b) => Buffer.from(b).toString('base64url');
const sha256 = (x) => createHash('sha256').update(x).digest();
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
export const PLATEFORME = { win32: 'windows', darwin: 'mac', linux: 'linux', android: 'android' }[osPlatform()] ?? 'autre';

// ---------------------------------------------------------------- HTTP(S) avec certificat épinglé

/** Empreinte d'un certificat comme Odin l'écrit : SHA-256 du DER, hexadécimal minuscule sans « : ». */
export const empreinteCert = (cert) => String(cert?.fingerprint256 ?? '').replace(/:/g, '').toLowerCase();

/**
 * Une requête vers Odin. `empreinte` : certificat épinglé (refusé s'il diffère, AVANT d'envoyer le corps) ;
 * `ca` : autorité d'Odin ; `premierContact` : accepte le certificat et rend son empreinte (à garder ensuite) ;
 * sinon, vérification normale du système.
 * Rend { status, headers, body (Buffer), empreinte }.
 */
export function requete(adresse, chemin, o = {}) {
  const u = new URL(chemin, adresse), https = u.protocol === 'https:';
  const corps = o.corps === undefined ? undefined : Buffer.isBuffer(o.corps) ? o.corps : Buffer.from(typeof o.corps === 'string' ? o.corps : JSON.stringify(o.corps));
  const entetes = { accept: 'application/json', ...(o.corps !== undefined && !Buffer.isBuffer(o.corps) && typeof o.corps !== 'string' ? { 'content-type': 'application/json' } : {}), ...(o.entetes ?? {}), ...(corps ? { 'content-length': String(corps.length) } : {}) };
  const pin = o.empreinte ? String(o.empreinte).replace(/:/g, '').toLowerCase() : '';
  return new Promise((resolve, reject) => {
    let vue = '';
    const opts = { method: o.methode ?? (corps ? 'POST' : 'GET'), headers: entetes, agent: false, timeout: o.delai ?? 15_000,
      ...(https ? { rejectUnauthorized: !(pin || o.premierContact), ...(o.ca ? { ca: o.ca } : {}), servername: /^[\d.]+$|^\[/.test(u.hostname) ? undefined : u.hostname } : {}) };
    const req = (https ? httpsRequest : httpRequest)(u, opts, (res) => {
      if (o.flux) { resolve({ status: res.statusCode ?? 0, headers: res.headers, flux: res, empreinte: vue }); return; }
      const parts = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (o.max && n > o.max) { req.destroy(new Error('réponse trop grosse')); return; } parts.push(c); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts), empreinte: vue }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Odin ne répond pas (délai dépassé)')));
    req.on('error', reject);
    if (!https) { req.end(corps); return; }
    req.on('socket', (sock) => {
      const verifie = () => {
        vue = empreinteCert(sock.getPeerCertificate?.());
        if (pin && vue !== pin) { req.destroy(new Error('Le certificat d\'Odin a changé : connexion refusée (quelqu\'un se fait peut-être passer pour Odin).')); return; }
        req.end(corps); // le corps (mot de passe, jetons) ne part qu'après la vérification du certificat
      };
      if (sock.encrypted && sock.authorized !== undefined && !sock.connecting) verifie(); else sock.once('secureConnect', verifie);
    });
  });
}
const lireJson = (r) => { try { return JSON.parse(r.body.toString('utf8') || '{}'); } catch { return {}; } };

// ---------------------------------------------------------------- Trouver Odin

/** Cherche Odin : la machine elle-même, puis le réseau local /24 (ports 7777 et 7443, https puis http). */
export async function trouverOdin(o = {}) {
  const ports = o.ports ?? [7777, 7443], hotes = ['127.0.0.1'];
  if (o.reseau !== false) for (const l of Object.values(networkInterfaces())) for (const i of l ?? []) if (i.family === 'IPv4' && !i.internal) { const b = i.address.split('.').slice(0, 3).join('.'); for (let k = 1; k < 255; k++) hotes.push(`${b}.${k}`); }
  const essais = [...new Set(hotes)].flatMap((h) => ports.flatMap((p) => [`https://${h}:${p}`, `http://${h}:${p}`]));
  const trouves = new Map(); let i = 0;
  const un = async () => { for (;;) { const a = essais[i++]; if (!a) return; const h = new URL(a).host; if ([...trouves.values()].some((x) => new URL(x.adresse).host === h)) continue;
    try { const r = await requete(a, '/.well-known/openid-configuration', { premierContact: true, delai: o.delai ?? 1500, max: 64 * 1024 }); const j = lireJson(r);
      if (r.status === 200 && j.odin?.protocole) trouves.set(a, { adresse: a, nom: j.odin.nom ?? 'Odin', version: j.odin.version ?? '', empreinte: r.empreinte || null }); } catch { /* rien ici */ } } };
  await Promise.all(Array.from({ length: o.parallele ?? 32 }, un));
  return [...trouves.values()].sort((a, b) => (a.adresse.includes('127.0.0.1') ? -1 : 0) - (b.adresse.includes('127.0.0.1') ? -1 : 0));
}

// ---------------------------------------------------------------- Coffre du système

function lancer(cmd, args, entree, env) {
  return new Promise((resolve) => {
    let out = '', err = ''; let p;
    try { p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: env ?? process.env }); } catch (e) { resolve({ code: -1, out: '', err: String(e) }); return; }
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    p.on('close', (code) => resolve({ code: code ?? -1, out, err }));
    p.stdin.on('error', () => undefined); // programme déjà fini (absent, refus) : son code de sortie le dira
    p.stdin.end(entree ?? '');
  });
}
const COMPTE = 'odin-sso';
// Windows : le Gestionnaire d'identification par l'API advapi32 (CredWriteW / CredReadW / CredDeleteW), depuis PowerShell.
// Le script passe en -EncodedCommand (sans secret) ; le secret passe par l'entrée standard.
const CS = `using System;using System.Runtime.InteropServices;using System.Text;
public static class OdinCred{[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]public struct C{public int Flags;public int Type;public string TargetName;public string Comment;public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;public int CredentialBlobSize;public IntPtr CredentialBlob;public int Persist;public int AttributeCount;public IntPtr Attributes;public string TargetAlias;public string UserName;}
[DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CredWriteW(ref C c,int f);
[DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CredReadW(string t,int ty,int f,out IntPtr c);
[DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CredDeleteW(string t,int ty,int f);
[DllImport("advapi32.dll")]static extern void CredFree(IntPtr p);
public static void Write(string t,string u,string s){byte[] b=Encoding.Unicode.GetBytes(s);C c=new C();c.Type=1;c.TargetName=t;c.UserName=u;c.Persist=2;c.CredentialBlobSize=b.Length;c.CredentialBlob=Marshal.AllocHGlobal(b.Length);try{Marshal.Copy(b,0,c.CredentialBlob,b.Length);if(!CredWriteW(ref c,0))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());}finally{Marshal.FreeHGlobal(c.CredentialBlob);}}
public static string Read(string t){IntPtr p;if(!CredReadW(t,1,0,out p))return null;try{C c=(C)Marshal.PtrToStructure(p,typeof(C));return Marshal.PtrToStringUni(c.CredentialBlob,c.CredentialBlobSize/2);}finally{CredFree(p);}}
public static bool Delete(string t){return CredDeleteW(t,1,0);}}`;
const ps1 = (corps) => `$ErrorActionPreference='Stop';Add-Type -TypeDefinition @'\n${CS}\n'@;${corps}`;
const psChaine = (x) => `'${String(x).replace(/'/g, "''")}'`;
const powershell = (script, entree) => lancer('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], entree);
// Mac : `security -i` lit ses commandes sur l'entrée standard (le secret n'apparaît pas dans la liste des processus).
const macCite = (x) => `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Le coffre du système de l'utilisateur. `nom` : « Odin SSO <adresse d'Odin> ». */
export const coffre = {
  systeme: PLATEFORME,
  async disponible() {
    if (PLATEFORME === 'windows') return (await powershell(ps1('[void][OdinCred]::Read(\'odin-sso-essai\');exit 0'))).code === 0;
    if (PLATEFORME === 'mac') return (await lancer('security', ['help'])).code !== -1;
    if (PLATEFORME === 'linux') { const r = await lancer('secret-tool', ['lookup', 'service', COMPTE, 'adresse', 'odin-sso-essai']); return r.code === 0 || (r.code === 1 && !/dbus|autolaunch|secret service|cannot|failed/i.test(r.err)); }
    return false;
  },
  async ranger(nom, secret) {
    if (!/^[\x20-\x7e]{1,300}$/.test(nom) || !/^[\x21-\x7e]{1,4096}$/.test(secret)) throw new Error('nom ou secret invalide pour le coffre');
    let r;
    if (PLATEFORME === 'windows') r = await powershell(ps1(`$s=[Console]::In.ReadLine();[OdinCred]::Write(${psChaine(nom)},'${COMPTE}',$s)`), `${secret}\n`);
    else if (PLATEFORME === 'mac') r = await lancer('security', ['-i'], `add-generic-password -U -s ${macCite(nom)} -a ${COMPTE} -l ${macCite(nom)} -w ${macCite(secret)}\n`);
    else if (PLATEFORME === 'linux') r = await lancer('secret-tool', ['store', `--label=${nom}`, 'service', COMPTE, 'adresse', nom], secret);
    else throw new Error('pas de coffre du système sur cette plateforme');
    if (r.code !== 0) throw new Error(`le coffre du système a refusé (${(r.err || r.out).trim().slice(0, 200) || `code ${r.code}`})`);
  },
  async lire(nom) {
    let r;
    if (PLATEFORME === 'windows') { r = await powershell(ps1(`$v=[OdinCred]::Read(${psChaine(nom)});if($v -eq $null){exit 2};[Console]::Out.Write($v)`)); return r.code === 0 ? r.out : undefined; }
    if (PLATEFORME === 'mac') { r = await lancer('security', ['find-generic-password', '-s', nom, '-a', COMPTE, '-w']); return r.code === 0 ? r.out.replace(/\n$/, '') : undefined; }
    if (PLATEFORME === 'linux') { r = await lancer('secret-tool', ['lookup', 'service', COMPTE, 'adresse', nom]); return r.code === 0 && r.out ? r.out.replace(/\n$/, '') : undefined; }
    return undefined;
  },
  async effacer(nom) {
    if (PLATEFORME === 'windows') await powershell(ps1(`[void][OdinCred]::Delete(${psChaine(nom)})`));
    else if (PLATEFORME === 'mac') await lancer('security', ['delete-generic-password', '-s', nom, '-a', COMPTE]);
    else if (PLATEFORME === 'linux') await lancer('secret-tool', ['clear', 'service', COMPTE, 'adresse', nom]);
  },
};

// ---------------------------------------------------------------- Jetons

/** Vérifie un JWT ES256 avec les clés d'Odin (JWKS). Rend la charge, ou lève une erreur en français. */
export function verifierJwt(jwt, jwks, attendu = {}) {
  const [h, p, s] = String(jwt).split('.'); if (!s) throw new Error('jeton mal formé');
  const ent = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')), ch = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  if (ent.alg !== 'ES256') throw new Error('algorithme de signature refusé');
  const k = (jwks.keys ?? []).find((x) => x.kid === ent.kid); if (!k) throw new Error('clé de signature inconnue');
  const ok = cryptoVerify('sha256', Buffer.from(`${h}.${p}`), { key: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: k.x, y: k.y }, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('signature fausse');
  const t = Math.floor(Date.now() / 1000);
  if (typeof ch.exp !== 'number' || ch.exp + 60 < t) throw new Error('jeton expiré');
  if (attendu.iss && ch.iss !== attendu.iss) throw new Error('jeton d\'un autre Odin');
  if (attendu.aud && ch.aud !== attendu.aud) throw new Error('jeton d\'une autre appli');
  if (attendu.nonce !== undefined && ch.nonce !== attendu.nonce) throw new Error('nonce différent');
  return ch;
}
const echec = (j, status) => ({ ok: false, code: j.code ?? j.error ?? `http_${status}`, message: j.message ?? j.error_description ?? `Odin a répondu ${status}.` });

export class OdinSSO {
  /**
   * @param {object} o
   * @param {string} o.adresse  ex. https://192.168.1.10:7777
   * @param {string} o.appli    identifiant de l'appli cliente (pegase, venus…)
   * @param {{id?:string, nom?:string, plateforme?:string}} [o.appareil]
   * @param {string} [o.empreinte]  certificat d'Odin épinglé ; @param {boolean} [o.premierContact] ; @param {string|Buffer} [o.ca]
   * @param {string} [o.utilisateur]  utilisateur du système (défaut : celui du processus)
   * @param {(etat:string)=>void|Promise<void>} [o.garder]  où ranger SES jetons (texte JSON) si on veut les garder (à chiffrer !)
   * @param {()=>string|undefined|Promise<string|undefined>} [o.relire]  les relire
   * @param {typeof coffre} [o.coffre]  le coffre du système (remplaçable pour les essais)
   */
  constructor(o) {
    this.adresse = String(o.adresse).replace(/\/+$/, ''); this.appli = o.appli;
    this.appareil = { id: o.appareil?.id, nom: o.appareil?.nom ?? hostname(), plateforme: o.appareil?.plateforme ?? PLATEFORME };
    this.tls = { empreinte: o.empreinte, ca: o.ca, premierContact: o.premierContact };
    this.utilisateur = o.utilisateur ?? (() => { try { return userInfo().username; } catch { return process.env.USERNAME ?? process.env.USER ?? 'utilisateur'; } })();
    this.garder = o.garder; this.relire = o.relire; this.coffre = o.coffre ?? coffre;
    this.etat = null; /** empreinte du certificat vue au premier contact (à garder par l'appli) */ this.empreinteVue = null;
  }
  get nomCoffre() { return `Odin SSO ${this.issuer ?? this.adresse}`; }
  async _req(chemin, o = {}) { const r = await requete(this.adresse, chemin, { ...this.tls, ...o }); if (r.empreinte) this.empreinteVue = r.empreinte; return r; }
  async decouverte() {
    if (this.conf) return this.conf;
    const r = await this._req('/.well-known/openid-configuration'); const j = lireJson(r);
    if (r.status !== 200 || !j.issuer) throw new Error('Ce serveur n\'est pas un Odin (pas de découverte OpenID).');
    this.conf = j; this.issuer = j.issuer; return j;
  }
  async cles(forcer = false) { if (!this.jwks || forcer) { const r = await this._req('/sso/cles'); this.jwks = lireJson(r); } return this.jwks; }
  /** L'identifiant de cet appareil : le même pour toutes les applis du poste (rangé dans le coffre du système). */
  async idAppareil() {
    if (this.appareil.id) return this.appareil.id;
    const nom = 'Odin SSO appareil';
    try { if (await this.coffre.disponible()) { let id = await this.coffre.lire(nom); if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) { id = b64u(randomBytes(18)); await this.coffre.ranger(nom, id); } return (this.appareil.id = id); } } catch { /* pas de coffre */ }
    return (this.appareil.id = b64u(randomBytes(18)));
  }
  async _recevoir(j) {
    this.etat = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in ?? 900) * 1000, personne: j.personne ?? this.etat?.personne ?? null };
    if (this.garder) await this.garder(JSON.stringify({ refresh: j.refresh_token, appareil: this.appareil.id, personne: this.etat.personne }));
    return this.etat;
  }
  /** Ouvre la session sans mot de passe : jetons gardés par l'appli, sinon jeton du poste (coffre du système). */
  async ouvrir() {
    await this.decouverte(); await this.idAppareil();
    if (this.relire) { try { const g = JSON.parse((await this.relire()) || 'null'); if (g?.refresh) { this.etat = { refresh: g.refresh, exp: 0, personne: g.personne ?? null }; const r = await this.renouveler(); if (r.ok) return { ok: true, personne: this.etat.personne, par: 'jetons de l\'appli' }; } } catch { /* rien de gardé */ } }
    let jp; try { if (await this.coffre.disponible()) jp = await this.coffre.lire(this.nomCoffre); } catch { jp = undefined; }
    if (!jp) return { ok: false, code: 'pas_de_session', message: 'Pas encore connecté à Odin sur ce poste.' };
    const r = await this._req('/sso/echange', { corps: { jeton_poste: jp, appli: this.appli, appareil: this.appareil, utilisateur: this.utilisateur } }), j = lireJson(r);
    if (r.status === 401) { await this.coffre.effacer(this.nomCoffre).catch(() => undefined); return echec(j, r.status); }
    if (r.status !== 200) return echec(j, r.status);
    await this._recevoir(j); return { ok: true, personne: j.personne, applis: j.applis, par: 'poste' };
  }
  /** Connexion par identifiant (ou e-mail) et mot de passe (+ code si `code_requis`). Ouvre aussi la session du poste. */
  async connecter({ identifiant, motdepasse, code, poste = true }) {
    await this.decouverte(); await this.idAppareil();
    const r = await this._req('/sso/connexion', { corps: { identifiant, motdepasse, ...(code ? { code } : {}), appli: this.appli, appareil: this.appareil } }), j = lireJson(r);
    if (r.status !== 200) return { ...echec(j, r.status), ...(j.attente ? { attente: j.attente } : {}) };
    await this._recevoir(j);
    let posteOk = false;
    if (poste) {
      try {
        if (await this.coffre.disponible()) {
          const p = await this._req('/sso/poste', { corps: { appareil: this.appareil, utilisateur: this.utilisateur }, entetes: { authorization: `Bearer ${this.etat.access}` } }), pj = lireJson(p);
          if (p.status === 200 && pj.jeton_poste) { await this.coffre.ranger(this.nomCoffre, pj.jeton_poste); posteOk = true; }
        }
      } catch { posteOk = false; }
    }
    return { ok: true, personne: j.personne, applis: j.applis, poste: posteOk };
  }
  /**
   * Connexion par le navigateur (code + PKCE, RFC 8252) : un petit serveur écoute sur 127.0.0.1 (port libre), `ouvrir(url)`
   * ouvre la page de connexion d'Odin (défaut : le navigateur du système). Le jeton d'identité est vérifié (signature, iss, aud, nonce).
   */
  async autoriser({ ouvrir, delai = 5 * 60_000, prompt } = {}) {
    const conf = await this.decouverte(); await this.idAppareil();
    const verifier = b64u(randomBytes(32)), state = b64u(randomBytes(16)), nonce = b64u(randomBytes(16));
    const srv = createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const redirect = `http://127.0.0.1:${srv.address().port}/sso/retour`;
    const u = new URL(conf.authorization_endpoint);
    for (const [k, v] of Object.entries({ response_type: 'code', client_id: this.appli, redirect_uri: redirect, scope: 'openid profile email groups offline_access', state, nonce, code_challenge: b64u(sha256(verifier)), code_challenge_method: 'S256', appareil: this.appareil.id, appareil_nom: this.appareil.nom, plateforme: this.appareil.plateforme, ...(prompt ? { prompt } : {}) })) u.searchParams.set(k, v);
    const retour = new Promise((resolve) => {
      const fin = setTimeout(() => resolve({ error: 'delai', error_description: 'La connexion n\'a pas été faite à temps.' }), delai);
      srv.on('request', (q, s) => { const x = new URL(q.url ?? '/', redirect); if (x.pathname !== '/sso/retour') { s.writeHead(404); s.end(); return; }
        const p = Object.fromEntries(x.searchParams); s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        s.end(`<!doctype html><meta charset="utf-8"><title>Odin</title><p style="font-family:system-ui">${p.error ? 'Connexion refusée : tu peux fermer cette page.' : 'Connecté : tu peux fermer cette page et revenir à l\'appli.'}</p>`);
        clearTimeout(fin); resolve(p); });
    });
    try {
      await (ouvrir ?? ouvrirNavigateur)(u.toString());
      const p = await retour;
      if (p.state !== state) return { ok: false, code: 'state', message: 'Réponse d\'Odin refusée : le paramètre state ne correspond pas.' };
      if (p.iss && p.iss !== this.issuer) return { ok: false, code: 'iss', message: 'Réponse d\'un autre serveur que cet Odin.' };
      if (p.error) return { ok: false, code: p.error, message: p.error_description || 'Connexion refusée.' };
      const r = await this._req('/sso/jeton', { corps: new URLSearchParams({ grant_type: 'authorization_code', code: p.code, redirect_uri: redirect, client_id: this.appli, code_verifier: verifier, appareil: this.appareil.id, appareil_nom: this.appareil.nom, plateforme: this.appareil.plateforme }).toString(), entetes: { 'content-type': 'application/x-www-form-urlencoded' } }), j = lireJson(r);
      if (r.status !== 200) return echec(j, r.status);
      let idt; try { idt = verifierJwt(j.id_token, await this.cles(), { iss: this.issuer, aud: this.appli, nonce }); } catch (e) { try { idt = verifierJwt(j.id_token, await this.cles(true), { iss: this.issuer, aud: this.appli, nonce }); } catch { return { ok: false, code: 'id_token', message: `Jeton d'identité refusé : ${e.message}` }; } }
      await this._recevoir({ ...j, personne: { sub: idt.sub, preferred_username: idt.preferred_username, name: idt.name, email: idt.email, groups: idt.groups } });
      return { ok: true, personne: this.etat.personne, idToken: idt };
    } finally { srv.close(); }
  }
  /**
   * Renouvelle les jetons (rotation). Un seul renouvellement à la fois. Si la réponse se perd (réseau coupé, délai dépassé,
   * Odin qui redémarre), on représente le MÊME jeton : Odin le tolère 60 s et rend la même réponse (§ 4).
   */
  async renouveler() {
    if (!this.etat?.refresh) return { ok: false, code: 'pas_de_session', message: 'Pas connecté à Odin.' };
    if (this._renouv) return this._renouv;
    const corps = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.etat.refresh, client_id: this.appli, appareil: this.appareil.id ?? '' }).toString();
    this._renouv = (async () => {
      let r, perdue;
      for (const pause of [0, 1000, 4000, 10_000]) {   // dernier essai parti avant 45 s : dans la tolérance de 60 s
        if (pause) await attendre(pause);
        try { r = await this._req('/sso/jeton', { corps, entetes: { 'content-type': 'application/x-www-form-urlencoded' }, delai: 10_000 }); } catch (e) { r = undefined; perdue = e; continue; }
        if (r.status < 500) break;
      }
      if (!r) return { ok: false, code: 'injoignable', message: `Odin ne répond pas (${perdue?.message ?? 'réseau'}) : la connexion sera renouvelée à la prochaine demande.` };
      const j = lireJson(r);
      if (r.status !== 200) { if (r.status === 400 || r.status === 403) { this.etat = null; if (this.garder) await this.garder('null'); } return echec(j, r.status); }
      await this._recevoir(j); return { ok: true };
    })();
    try { return await this._renouv; } finally { this._renouv = null; }
  }
  /** Un jeton d'accès valable (renouvelé une minute avant la fin). */
  async jeton() {
    if (!this.etat) throw new Error('Pas connecté à Odin.');
    if (Date.now() > this.etat.exp - 60_000) { const r = await this.renouveler(); if (!r.ok) throw Object.assign(new Error(r.message), { code: r.code }); }
    return this.etat.access;
  }
  async _api(chemin, o = {}) { return this._req(chemin, { ...o, entetes: { ...(o.entetes ?? {}), authorization: `Bearer ${await this.jeton()}` } }); }
  async infos() { const r = await this._api('/sso/infos'); const j = lireJson(r); return r.status === 200 ? { ok: true, ...j } : echec(j, r.status); }
  /** Envoie toute la base (Buffer) ; `sorte: 'changements'` avec `base` pour un envoi partiel ; `etat` : rendu tel quel (x-odin-etat). */
  async sauvegarder(octets, { raison = '', sorte = 'complete', base, nom, etat } = {}) {
    const e = { 'content-type': 'application/octet-stream', 'x-odin-empreinte': createHash('sha256').update(octets).digest('hex'), 'x-odin-sorte': sorte, ...(raison ? { 'x-odin-raison': encodeURIComponent(raison) } : {}), ...(base ? { 'x-odin-base': base } : {}), ...(nom ? { 'x-odin-nom': encodeURIComponent(nom) } : {}), ...(etat ? { 'x-odin-etat': etat } : {}) };
    const r = await this._api(`/api/sauvegardes/${this.appli}`, { corps: octets, entetes: e, delai: 10 * 60_000 }), j = lireJson(r);
    return r.status === 200 || r.status === 201 ? j : echec(j, r.status);
  }
  async versions() { const r = await this._api(`/api/sauvegardes/${this.appli}`); const j = lireJson(r); return r.status === 200 ? j : echec(j, r.status); }
  /** L'empreinte de la dernière sauvegarde (et `restaurer` si le propriétaire l'a demandé dans Odin). */
  async empreinteOdin() { const r = await this._api(`/api/sauvegardes/${this.appli}/empreinte`); const j = lireJson(r); return r.status === 200 ? j : echec(j, r.status); }
  /** Télécharge une version (Buffer), vérifie son SHA-256. */
  async telecharger(version) {
    const r = await this._api(`/api/sauvegardes/${this.appli}/${encodeURIComponent(version)}`, { delai: 10 * 60_000 });
    if (r.status !== 200) throw Object.assign(new Error(echec(lireJson(r), r.status).message), { code: r.status });
    if (createHash('sha256').update(r.body).digest('hex') !== r.headers['x-odin-empreinte']) throw new Error('La sauvegarde reçue est abîmée (empreinte différente) : réessaie.');
    return r.body;
  }
  async restauree(version) { const r = await this._api(`/api/sauvegardes/${this.appli}/restauree`, { corps: { version } }); return r.status === 200; }
  /** Se déconnecter d'Odin sur ce poste : coupe la session du poste et celles des applis ouvertes par elle, vide le coffre. */
  async deconnecter() {
    let jp; try { jp = await this.coffre.lire(this.nomCoffre); } catch { jp = undefined; }
    await this._req('/sso/revoquer', { corps: { ...(jp ? { jeton_poste: jp } : {}), ...(this.etat?.refresh ? { token: this.etat.refresh, token_type_hint: 'refresh_token' } : {}) } }).catch(() => undefined);
    await this.coffre.effacer(this.nomCoffre).catch(() => undefined);
    this.etat = null; if (this.garder) await this.garder('null');
  }
}

/** Ouvre une adresse dans le navigateur du système. */
export async function ouvrirNavigateur(url) {
  const [cmd, args] = PLATEFORME === 'windows' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : PLATEFORME === 'mac' ? ['open', [url]] : ['xdg-open', [url]];
  const p = spawn(cmd, args, { stdio: 'ignore', detached: true }); p.on('error', () => undefined); p.unref(); await attendre(10);
}
