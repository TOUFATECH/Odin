// Médias reçus : comprendre une vidéo. Sous-titres INCLUS lus (pistes texte), piste son extraite puis écoutée et
// transcrite, images clés lues (texte à l'image, description si un modèle local existe), hésitations repérées,
// sous-titres écrits (.srt et .vtt) et traduits réplique par réplique par une fonction DONNÉE. Les fichiers de travail
// (son extrait, images clés) vivent dans <dossierSortie>/travail/ et sont SUPPRIMÉS à la fin, même en cas d'erreur.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Compris, OptionsComprendre } from './comprendre.ts';
import type { Fiche } from './contrat.ts';
import { BORNES } from './contrat.ts';
import { ajouterManqueC, appeler, besoin, delai, ecouter, langueDe, nomDeBase, remarqueC, texteBorne, traduireEtEcrire, verifierArret, type Etat } from './etapes.ts';
import { versBcp47 } from './langues-codes.ts';
import { formatImage } from './champs.ts';
import { lireSousTitres } from './sous-titres.ts';

const PREMIERES_MINUTES = 600;
/** Au plus 2 000 répliques de sous-titres inclus traduites (une traduction par réplique). */
const TRADUCTION_MAX_REPLIQUES = 2000;

/** Comprend une vidéo dont la fiche est déjà lue. N'écrit que dans dossierSortie. */
export async function comprendreVideo(chemin: string, fiche: Fiche, o: OptionsComprendre, c: Compris, etat?: Etat): Promise<void> {
  const e: Etat = etat ?? { c, o, arrete: false, remarques: [] };
  const b = o.briques;
  const bornes = { ...BORNES, ...(o.bornes ?? {}) };
  // 1. Durée.
  let duree = fiche.dureeSec;
  let tropLong = false;
  if (duree === undefined || !Number.isFinite(duree) || duree <= 0) {
    ajouterManqueC(e, { quoi: 'la durée de la vidéo', raison: 'durée inconnue : seules les 10 premières minutes sont traitées', code: 'absent' });
    duree = PREMIERES_MINUTES;
  } else if (duree > bornes.dureeMaxMediaSec) {
    tropLong = true;
    ajouterManqueC(e, { quoi: 'le son de la vidéo', raison: `vidéo de plus de ${Math.round(bornes.dureeMaxMediaSec / 3600)} h : seules la fiche et les ${bornes.imagesCles} premières images clés sont lues`, code: 'trop-long' });
  }
  const travail = join(o.dossierSortie, 'travail');
  try {
    mkdirSync(travail, { recursive: true });
    // 2. Sous-titres inclus.
    let n = 0, rang = -1;
    for (const p of fiche.pistes) {
      if (p.genre !== 'sous-titres') continue;
      rang++;   // rang parmi TOUTES les pistes de sous-titres (FFmpeg « 0:s:N » compte aussi celles en images)
      if (p.texteEnImages) { ajouterManqueC(e, { quoi: `les sous-titres en images (piste ${p.index + 1})`, raison: 'sous-titres en images non lus (il faudrait les lire par OCR)', code: 'format-non-lu' }); continue; }
      if (++n > 8) break;
      if (!b.extraireSousTitresInclus) { besoin(e, 'ffmpeg'); break; }
      const srt = await appeler(e, 'extraireSousTitresInclus', (signal) => b.extraireSousTitresInclus!(chemin, p.index, { signal, rangSousTitres: rang }), delai(e, 'sousTitres'));
      if (!srt) continue;
      const lu = lireSousTitres(String(srt).slice(0, bornes.sousTitresOctets));
      const texte = texteBorne(lu.repliques.map((r) => r.texte).join('\n'));
      if (!texte) continue;
      const lg = langueDe(e, texte, 'sous-titres inclus', { declaree: p.langueDeclaree });
      (c.sousTitresInclus ??= []).push({ piste: p.index, texte, repliques: lu.repliques.length, ...(lg.code ? { langue: lg.code } : {}) });
      // « Traduis-moi la vidéo » : les sous-titres inclus sont traduits eux aussi (mêmes temps, original gardé).
      if (o.versLangues?.length) {
        const aTraduire = lu.repliques.slice(0, TRADUCTION_MAX_REPLIQUES);
        if (lu.repliques.length > aTraduire.length) remarqueC(e, `sous-titres inclus (piste ${p.index + 1}) : ${aTraduire.length} premières répliques traduites sur ${lu.repliques.length}`);
        await traduireEtEcrire(e, aTraduire, lg.code ?? versBcp47(p.langueDeclaree), `${nomDeBase(c.fichier.nom)}.piste${p.index + 1}`, { horodatageApproximatif: false, source: 'sous-titres inclus' });
      }
    }
    if (verifierArret(e)) return;
    // 3. Le son.
    const aDuSon = fiche.pistes.length === 0 || fiche.pistes.some((p) => p.genre === 'son');
    if (!aDuSon) ajouterManqueC(e, { quoi: 'la parole', raison: 'pas de piste son dans la vidéo', code: 'absent' });
    else if (!tropLong) {
      if (!b.extraireSon) { besoin(e, 'ffmpeg'); if (!b.transcrire && !b.analyserSon) besoin(e, 'transcription'); }
      else {
        const son = await appeler(e, 'extraireSon', (signal) => b.extraireSon!(chemin, travail, { signal }), delai(e, 'extraire'));
        if (son && existsSync(son)) await ecouter(e, son, { dureeSec: Math.min(duree, bornes.dureeMaxMediaSec), avecSousTitres: o.sousTitres !== false, base: nomDeBase(c.fichier.nom) });
        else if (!e.arrete && !c.manque.some((m) => m.quoi.startsWith('le résultat de extraireSon'))) ajouterManqueC(e, { quoi: 'le son de la vidéo', raison: 'piste son non extraite', code: 'echec' });
      }
    }
    if (verifierArret(e)) return;
    // 4. Les images clés.
    if (!b.imagesCles) { besoin(e, 'ffmpeg'); return; }
    if (!b.lireTexteImage) besoin(e, 'ocr');
    if (!b.decrireImage) besoin(e, 'vision');
    const images = await appeler(e, 'imagesCles', (signal) => b.imagesCles!(chemin, travail, duree!, bornes.imagesCles, { signal }), delai(e, 'extraire'));
    if (!images?.length) return;
    const vues: NonNullable<NonNullable<Compris['vu']>['images']> = [];
    const textes: Array<{ t: number; texte: string }> = [];
    let precedent = '';
    for (const im of images.slice(0, bornes.imagesCles)) {
      if (verifierArret(e)) break;
      if (!Number.isFinite(im?.t) || typeof im?.fichier !== 'string') continue;
      let octets: Buffer;
      try { if (!existsSync(im.fichier) || statSync(im.fichier).size > 32 * 1024 * 1024) continue; octets = readFileSync(im.fichier); } catch { continue; }
      const format = formatImage(octets);
      const img = { octets, format: format === 'inconnu' ? 'jpeg' : format };
      const v: { t: number; texte?: string; description?: string } = { t: im.t };
      if (b.lireTexteImage) {
        const r = await appeler(e, 'lireTexteImage', (signal) => b.lireTexteImage!(img, { signal }), delai(e, 'image'));
        const t = texteBorne(r?.texte);
        if (t) {
          v.texte = t;
          const cle = t.toLocaleLowerCase().split(/\s+/u).join(' ').trim();
          if (cle !== precedent) textes.push({ t: im.t, texte: t });
          precedent = cle;
        } else precedent = '';
      }
      if (b.decrireImage) {
        const r = await appeler(e, 'decrireImage', (signal) => b.decrireImage!(img, { signal, question: o.question }), delai(e, 'image'));
        const d = texteBorne(r?.texte);
        if (d) { v.description = d; (c.vu ??= {}).via ??= String(r?.via ?? '').slice(0, 120) || undefined; }
      }
      vues.push(v);
    }
    if (vues.length) {
      c.vu = { ...(c.vu ?? {}), images: vues };
      if (textes.length) {
        c.vu.texteALImage = textes.map((x) => `[${horloge(x.t)}] ${x.texte}`).join('\n');
        langueDe(e, textes.map((x) => x.texte).join('\n'), 'texte à l\'image');
      }
    }
    if (images.length > bornes.imagesCles) remarqueC(e, `${images.length} images clés proposées, ${bornes.imagesCles} lues`);
  } finally {
    try { rmSync(travail, { recursive: true, force: true }); } catch { /* rien à nettoyer */ }
  }
}

const horloge = (t: number) => { const s = Math.max(0, Math.round(t)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(x).padStart(2, '0')}`; };
