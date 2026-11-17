// Domaine « médias » : photo, son, vidéo. Les fichiers sont FABRIQUÉS par le banc (octets écrits à la main : une photo
// JPEG avec date et position GPS, un MP3 étiqueté, un MP3 nu, un fichier piégé, un son WAV). Élément 5 du lot 1.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appel, ok, ouvrir, type Scenario } from './banc.ts';

// ---------------------------------------------------------------- une photo JPEG avec EXIF (date, appareil, GPS)
function jpegExif(): Buffer {
  // TIFF petit-boutiste : IFD0 (Make, Model, DateTime, pointeur GPS), IFD GPS (lat, lon).
  const e: number[] = [];
  const u16 = (v: number) => { e.push(v & 255, (v >> 8) & 255); };
  const u32 = (v: number) => { e.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255); };
  const make = 'Fairphone\0', model = 'FP5\0', date = '2026:08:14 17:32:05\0';
  // disposition : en-tête 8 | IFD0 (2 + 4×12 + 4 = 54) | IFD GPS (2 + 4×12 + 4 = 54) | données
  const ifd0 = 8, gps = ifd0 + 54, donnees = gps + 54;
  const off = { make: donnees, model: donnees + make.length, date: donnees + make.length + model.length };
  const ratio = donnees + make.length + model.length + date.length;
  e.push(0x49, 0x49); u16(42); u32(ifd0);
  u16(4);
  u16(0x010f); u16(2); u32(make.length); u32(off.make);
  u16(0x0110); u16(2); u32(model.length); u32(off.model);
  u16(0x0132); u16(2); u32(date.length); u32(off.date);
  u16(0x8825); u16(4); u32(1); u32(gps);
  u32(0);
  u16(4);
  u16(1); u16(2); u32(2); e.push(0x53, 0, 0, 0); // GPSLatitudeRef « S »
  u16(2); u16(5); u32(3); u32(ratio);             // GPSLatitude 12° 46' 48"
  u16(3); u16(2); u32(2); e.push(0x45, 0, 0, 0); // GPSLongitudeRef « E »
  u16(4); u16(5); u32(3); u32(ratio + 24);        // GPSLongitude 45° 13' 39"
  u32(0);
  for (const ch of make + model + date) e.push(ch.charCodeAt(0));
  for (const [n, d] of [[12, 1], [46, 1], [48, 1], [45, 1], [13, 1], [39, 1]]) { u32(n); u32(d); }
  const tiff = Buffer.from(e);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const seg = Buffer.alloc(4); seg[0] = 0xff; seg[1] = 0xe1; seg.writeUInt16BE(app1.length + 2, 2);
  // Une image 1×1 minimale (SOF0 + DHT + SOS) n'est pas nécessaire aux étiquettes : la fin d'image suffit aux lecteurs d'EXIF.
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg, app1, Buffer.from([0xff, 0xd9])]);
}

// ---------------------------------------------------------------- un MP3 avec étiquettes ID3v2.3
function mp3Id3(): Buffer {
  const cadre = (id: string, texte: string) => { const corps = Buffer.concat([Buffer.from([0]), Buffer.from(texte, 'latin1')]); const h = Buffer.alloc(10); h.write(id, 0, 'latin1'); h.writeUInt32BE(corps.length, 4); return Buffer.concat([h, corps]); };
  const cadres = Buffer.concat([cadre('TIT2', 'Lagon bleu'), cadre('TPE1', 'Awa Saïd'), cadre('TALB', 'Mamoudzou Sessions'), cadre('TCOM', 'Saïd Ali'), cadre('TPUB', 'Label Ylang'), cadre('TYER', '2025'), cadre('TCON', 'Mgodro')]);
  const synch = (n: number) => Buffer.from([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]);
  const tete = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0]), synch(cadres.length)]);
  return Buffer.concat([tete, cadres, trameMp3(40)]);
}
/** Quelques trames MP3 muettes (MPEG-1 couche III, 128 kb/s, 44,1 kHz : 417 octets par trame). */
function trameMp3(n: number): Buffer { const t = Buffer.alloc(417); t[0] = 0xff; t[1] = 0xfb; t[2] = 0x90; t[3] = 0x64; return Buffer.concat(Array.from({ length: n }, () => t)); }
/** Un son WAV : 1 s de la à 440 Hz, 16 kHz mono. */
function wav(): Buffer {
  const n = 16000, d = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) d.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / 16000) * 12000), i * 2);
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + d.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(d.length, 40);
  return Buffer.concat([h, d]);
}

function lire(id: string, titre: string, fichier: string, contenu: () => Buffer, outil: string, motifs: RegExp[], exig: string, attendu: string): Scenario {
  return {
    id, domaine: 'medias', partie: 'sans-modele', exigence: exig, simule: true, titre, attendu,
    async jouer() {
      const s = await ouvrir({ script: [appel(outil, { path: fichier }), { text: 'fin' }] });
      try {
        writeFileSync(join(s.o.paths.workspace, fichier), contenu());
        const t0 = performance.now();
        await s.dire(titre);
        const ms = Math.round(performance.now() - t0);
        const r = s.resultatOutil(outil) ?? '(pas de résultat)';
        const manque = motifs.filter((m) => !m.test(r));
        return ok(manque.length === 0, `${ms} ms ; ${manque.length ? `manque : ${manque.map((m) => m.source).join(', ')} ; ` : ''}${r.replace(/\s+/g, ' ').slice(0, 110)}`);
      } finally { s.fermer(); }
    },
  };
}

export const MEDIAS: Scenario[] = [
  {
    // Odin SAIT lire l'EXIF (Hélios, lireExif) ; c'est la porte media_info qui ne s'en sert pas (scénarios suivants).
    id: 'media-photo-helios', domaine: 'medias', partie: 'sans-modele', exigence: 'élément 5 (crit. 1), D-23', simule: true,
    titre: 'Hélios lit la date, l\'appareil et la position d\'une photo (lireExif)', attendu: 'date 2026:08:14, Fairphone, latitude −12,78, longitude 45,23',
    async jouer() {
      const { lireExif } = await import('../../src/valhalla/modules/sol.ts');
      const e = lireExif(jpegExif());
      const bon = /2026/.test(e.date ?? '') && /Fairphone/.test(e.marque ?? '') && Math.abs((e.lat ?? 0) + 12.78) < 0.01 && Math.abs((e.lon ?? 0) - 45.2275) < 0.01;
      return ok(bon, JSON.stringify({ date: e.date, marque: e.marque, modele: e.modele, lat: e.lat, lon: e.lon }));
    },
  },
  lire('media-photo-date', 'quand a été prise cette photo ?', 'photo.jpg', jpegExif, 'media_info', [/2026/, /Fairphone|FP5/], 'élément 5 (crit. 1), D-23', 'date de prise et appareil'),
  lire('media-photo-gps', 'où a été prise cette photo ?', 'photo.jpg', jpegExif, 'media_info', [/12[,.°]|-12\./, /45[,.°]/], 'élément 5 (crit. 1), D-23', 'coordonnées GPS'),
  lire('media-mp3-etiquettes', 'qui chante ce morceau ?', 'lagon.mp3', mp3Id3, 'media_info', [/Awa Saïd|Awa Sa/, /Mamoudzou Sessions/], 'élément 5 (crit. 2), D-24', 'artiste et album'),
  lire('media-mp3-label', 'quel est le label et le compositeur ?', 'lagon.mp3', mp3Id3, 'media_info', [/Label Ylang/, /Saïd Ali|Sa.d Ali/], 'élément 5 (crit. 2), D-24', 'compositeur et label'),
  lire('media-mp3-nu', 'quelles sont les étiquettes de ce MP3 ?', 'nu.mp3', () => trameMp3(40), 'media_info', [/aucune étiquette/i], 'élément 5 (crit. 2)', '« aucune étiquette dans le fichier »'),
  {
    id: 'media-piege', domaine: 'medias', partie: 'sans-modele', exigence: 'élément 5 (crit. 5)', simule: true,
    titre: 'un fichier tronqué ou piégé', attendu: 'pas de plantage, réponse en moins d\'une seconde',
    async jouer() {
      const s = await ouvrir({ script: [appel('media_info', { path: 'piege.mp3' }), { text: 'fin' }] });
      try {
        const faux = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f]), Buffer.from('TIT2', 'latin1'), Buffer.from([0x7f, 0xff, 0xff, 0xff, 0, 0])]);
        writeFileSync(join(s.o.paths.workspace, 'piege.mp3'), faux);
        const t0 = performance.now(); await s.dire('lis ce fichier'); const ms = performance.now() - t0;
        const r = s.resultatOutil('media_info') ?? '';
        return ok(ms < 1000 && r.length > 0, `${Math.round(ms)} ms ; ${r.slice(0, 100)}`);
      } finally { s.fermer(); }
    },
  },
  lire('media-son', 'écoute ce son et dis-moi ce que c\'est', 'la440.wav', wav, 'audio_analyze', [/s|seconde|durée|Hz|son|ton/i], 'D-13 (écouter)', 'une analyse (durée, nature du son), ou une raison honnête'),
  {
    id: 'media-cerveau-syrinx', domaine: 'medias', partie: 'sans-modele', exigence: 'D-14', titre: '« reconnais cette musique »', nature: 'discutable', // ordre des notes données au modèle
    attendu: 'Syrinx en tête des notes du Cerveau (ou fait sans IA)',
    async jouer() {
      const s = await ouvrir({ applis: true });
      try {
        const r = await s.dire('reconnais cette musique');
        if (r.appelsModele === 0) return ok(/Syrinx/.test(r.texte), `sans IA : ${r.texte.slice(0, 90)}`);
        const n = s.notesCerveau(); return ok(n[0] === 'Syrinx', `notes du Cerveau : ${n.slice(0, 3).join(', ') || '(aucune)'}`);
      } finally { s.fermer(); }
    },
  },
];
