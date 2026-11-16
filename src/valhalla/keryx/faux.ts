// Les FAUX pairs : ce qui ne peut pas être essayé sans vrai matériel (un modem, une ligne SIP, un téléphone) est essayé
// contre un pair qui parle le protocole octet par octet, sur la boucle locale. Aucun vrai service, aucun vrai numéro.
// Réutilisé par le bouton ESSAYER (/api/keryx/essayer) et par les tests (keryx-sip, keryx-sms).
//
// L'honnêteté est au cœur : même quand l'essai réussit, la note reste « codé, pas essayé sur du vrai matériel ».

import { createSocket } from 'node:dgram';
import { connect, createServer, type Socket } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { CTRL_Z, commandeEnvoi, commandeLecture, INIT, LecteurModem, texteSms } from './at.ts';
import { ecrireMessage, enteteAutorisation, jeton, lireDefi, lireMessage, reponseDigest, sdpAudio } from './sip.ts';
import { type Essai, NON_ESSAYE } from './types.ts';

/** Deux sockets TCP reliés sur la boucle locale : exactement les mêmes octets qu'un lien série, sans vrai modem. */
function paireSockets(): Promise<{ client: Socket; modem: Socket; fermer: () => void }> {
  return new Promise((resolve, reject) => {
    const serveur = createServer();
    serveur.on('error', reject);
    serveur.listen(0, '127.0.0.1', () => {
      const port = (serveur.address() as { port: number }).port;
      const client = connect(port, '127.0.0.1');
      serveur.once('connection', (modem) => {
        const fermer = () => { try { client.destroy(); } catch { /* */ } try { modem.destroy(); } catch { /* */ } serveur.close(); };
        resolve({ client, modem, fermer });
      });
      client.on('error', reject);
    });
  });
}

/**
 * Faux modem GSM : il répond en mode texte à l'enchaînement d'un envoi puis pousse un SMS entrant. Prouve que notre
 * pilote AT écrit et lit les bons octets (dont le Ctrl-Z 0x1A qui termine un SMS sortant).
 */
export async function fauxModem(): Promise<Essai> {
  const etapes: Essai['etapes'] = [];
  let ok = false;
  let lien: { client: Socket; modem: Socket; fermer: () => void } | undefined;
  try {
    lien = await paireSockets();
    const { client, modem } = lien;
    // Côté FAUX modem : un petit automate qui répond aux commandes.
    let attendText = false;
    modem.on('data', (b: Buffer) => {
      const txt = b.toString('latin1');
      if (attendText) {
        if (txt.includes(String.fromCharCode(CTRL_Z))) { attendText = false; modem.write('\r\n+CMGS: 42\r\n\r\nOK\r\n'); }
        return;
      }
      for (const ligne of txt.split(/\r\n|\r|\n/).filter(Boolean)) {
        if (/^AT\+CMGS=/.test(ligne)) { modem.write('\r\n> '); attendText = true; }
        else if (/^AT\+CPIN\?/.test(ligne)) modem.write('\r\n+CPIN: READY\r\n\r\nOK\r\n');
        else if (/^AT\+CMGR=/.test(ligne)) modem.write('\r\n+CMGR: "REC UNREAD","+33123456789","","2026-11-16"\r\nBonjour Odin\r\n\r\nOK\r\n');
        else if (/^AT/.test(ligne)) modem.write('\r\nOK\r\n');
      }
    });

    const lecteur = new LecteurModem();
    const attendre = (predicat: (r: ReturnType<LecteurModem['pousser']>[number]) => boolean, delai = 2000): Promise<void> => new Promise((resolve, reject) => {
      const t = setTimeout(() => { client.off('data', onData); reject(new Error('le faux modem ne répond pas')); }, delai);
      const onData = (b: Buffer) => { for (const r of lecteur.pousser(b)) { if (predicat(r)) { clearTimeout(t); client.off('data', onData); resolve(); return; } } };
      client.on('data', onData);
    });
    const envoyer = (s: string) => { etapes.push({ sens: '→', trame: s }); client.write(s + '\r\n'); };

    // Mise en route.
    for (const c of INIT) { envoyer(c); await attendre((r) => r.type === 'ok'); etapes.push({ sens: '←', trame: 'OK' }); }
    // Envoi d'un SMS : commande → « > » → texte + Ctrl-Z → +CMGS: ref → OK.
    etapes.push({ sens: '→', trame: commandeEnvoi('+33123456789') }); client.write(commandeEnvoi('+33123456789') + '\r');
    await attendre((r) => r.type === 'invite'); etapes.push({ sens: '←', trame: '>' });
    const corps = texteSms('Message de test Odin') + String.fromCharCode(CTRL_Z);
    etapes.push({ sens: '→', trame: 'texte + Ctrl-Z (0x1A)' }); client.write(corps);
    let ref = 0;
    await attendre((r) => { if (r.type === 'envoye') { ref = r.ref; return true; } return false; });
    etapes.push({ sens: '←', trame: `+CMGS: ${ref}` });
    // Réception d'un SMS : le modem annonce, on lit, on obtient numéro + texte.
    modem.write('\r\n+CMTI: "SM",3\r\n');
    await attendre((r) => r.type === 'arrivee');
    etapes.push({ sens: '←', trame: '+CMTI: "SM",3' });
    etapes.push({ sens: '→', trame: commandeLecture(3) }); client.write(commandeLecture(3) + '\r');
    let recu = { numero: '', texte: '' };
    await attendre((r) => { if (r.type === 'message') { recu = { numero: r.numero, texte: r.texte }; return true; } return false; });
    etapes.push({ sens: '←', trame: `SMS de ${recu.numero} : « ${recu.texte} »` });
    ok = ref === 42 && recu.numero === '+33123456789' && /Bonjour Odin/.test(recu.texte);
  } catch (e) {
    etapes.push({ sens: '←', trame: `échec : ${(e as Error).message}` });
  } finally { lien?.fermer(); }
  return { quoi: 'modem', etapes, ok, note: NON_ESSAYE };
}

/**
 * Faux serveur SIP (registrar + correspondant) sur UDP/boucle locale. Déroule REGISTER → 401 → digest → 200 → INVITE →
 * 180 → 200(SDP) → ACK → BYE → 200, et PROUVE que la réponse digest calculée par le client est identique à celle
 * recalculée par le serveur (timingSafeEqual). Aucune vraie ligne.
 */
export async function fauxSip(): Promise<Essai> {
  const etapes: Essai['etapes'] = [];
  let ok = false;
  const UTIL = 'odin', REALM = 'keryx.local', MDP = 'secret-de-ligne', NONCE = jeton(16);
  const srv = createSocket('udp4');
  const cli = createSocket('udp4');
  try {
    await new Promise<void>((resolve) => srv.bind(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => cli.bind(0, '127.0.0.1', resolve));
    const portSrv = (srv.address() as { port: number }).port;
    const portCli = (cli.address() as { port: number }).port;
    let digestOk = false;
    const via = () => `SIP/2.0/UDP 127.0.0.1:${portCli};branch=z9hG4bK${jeton(8)}`;

    // Côté FAUX serveur.
    srv.on('message', (buf, rinfo) => {
      const m = lireMessage(buf.toString('utf8'));
      if (!m?.methode) return;
      const commun = { Via: m.entetes['via'] ?? via(), From: m.entetes['from'] ?? '', To: m.entetes['to'] ?? '', 'Call-ID': m.entetes['call-id'] ?? '', CSeq: m.entetes['cseq'] ?? '' };
      if (m.methode === 'REGISTER') {
        const auth = m.entetes['authorization'];
        if (!auth) { srv.send(ecrireMessage('SIP/2.0 401 Unauthorized', { ...commun, 'WWW-Authenticate': `Digest realm="${REALM}", nonce="${NONCE}", qop="auth", algorithm=MD5` }), rinfo.port, rinfo.address); return; }
        // Recalcul côté serveur et comparaison en temps constant.
        const ch = (n: string) => new RegExp(`${n}="?([^",]*)"?`).exec(auth)?.[1] ?? '';
        const attendu = reponseDigest({ username: UTIL, password: MDP, realm: REALM, nonce: NONCE, uri: ch('uri'), method: 'REGISTER', qop: ch('qop') || undefined, nc: ch('nc') || undefined, cnonce: ch('cnonce') || undefined });
        const recu = ch('response');
        digestOk = attendu.length === recu.length && timingSafeEqual(Buffer.from(attendu), Buffer.from(recu));
        srv.send(ecrireMessage(digestOk ? 'SIP/2.0 200 OK' : 'SIP/2.0 403 Forbidden', commun), rinfo.port, rinfo.address);
      } else if (m.methode === 'INVITE') {
        srv.send(ecrireMessage('SIP/2.0 100 Trying', commun), rinfo.port, rinfo.address);
        srv.send(ecrireMessage('SIP/2.0 180 Ringing', commun), rinfo.port, rinfo.address);
        setTimeout(() => srv.send(ecrireMessage('SIP/2.0 200 OK', { ...commun, 'Content-Type': 'application/sdp' }, sdpAudio('127.0.0.1', 40000)), rinfo.port, rinfo.address), 10);
      } else if (m.methode === 'BYE') {
        srv.send(ecrireMessage('SIP/2.0 200 OK', commun), rinfo.port, rinfo.address);
      }
      // ACK n'appelle pas de réponse.
    });

    // Côté client : on pilote l'enchaînement et on attend les réponses voulues.
    const callId = jeton(16);
    const envoyer = (depart: string, entetes: Record<string, string>, corps = '') => {
      etapes.push({ sens: '→', trame: depart });
      cli.send(ecrireMessage(depart, entetes, corps), portSrv, '127.0.0.1');
    };
    const attendreCode = (codes: number[], delai = 2000): Promise<ReturnType<typeof lireMessage>> => new Promise((resolve, reject) => {
      const t = setTimeout(() => { cli.off('message', onMsg); reject(new Error(`pas de réponse ${codes.join('/')}`)); }, delai);
      const onMsg = (buf: Buffer) => { const m = lireMessage(buf.toString('utf8')); if (m?.code) { etapes.push({ sens: '←', trame: `${m.code} ${m.raison}` }); if (codes.includes(m.code)) { clearTimeout(t); cli.off('message', onMsg); resolve(m); } } };
      cli.on('message', onMsg);
    });

    const uri = `sip:${UTIL}@${REALM}`;
    const base = (seq: string) => ({ Via: via(), From: `<${uri}>;tag=${jeton(6)}`, To: `<${uri}>`, 'Call-ID': callId, CSeq: seq, 'Max-Forwards': '70' });
    // REGISTER sans auth → 401.
    envoyer(`REGISTER ${uri} SIP/2.0`, base('1 REGISTER'));
    const defi401 = await attendreCode([401]);
    const defi = lireDefi(defi401!.entetes['www-authenticate'] ?? '');
    if (!defi) throw new Error('défi digest absent');
    // REGISTER avec la réponse digest → 200.
    const autor = enteteAutorisation({ username: UTIL, password: MDP, uri, method: 'REGISTER', defi });
    envoyer(`REGISTER ${uri} SIP/2.0`, { ...base('2 REGISTER'), Authorization: autor });
    await attendreCode([200]);
    etapes.push({ sens: '←', trame: `digest MD5 identique des deux côtés : ${digestOk ? 'oui' : 'non'}` });
    // INVITE → 180 → 200(SDP) → ACK.
    envoyer(`INVITE ${uri} SIP/2.0`, { ...base('3 INVITE'), 'Content-Type': 'application/sdp' }, sdpAudio('127.0.0.1', portCli));
    await attendreCode([200]);
    envoyer(`ACK ${uri} SIP/2.0`, base('3 ACK'));
    // BYE → 200.
    envoyer(`BYE ${uri} SIP/2.0`, base('4 BYE'));
    await attendreCode([200]);
    ok = digestOk;
  } catch (e) {
    etapes.push({ sens: '←', trame: `échec : ${(e as Error).message}` });
  } finally { try { srv.close(); } catch { /* */ } try { cli.close(); } catch { /* */ } }
  return { quoi: 'sip', etapes, ok, note: NON_ESSAYE };
}
