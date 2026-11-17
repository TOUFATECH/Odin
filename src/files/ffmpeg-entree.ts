// Options d'ENTRÉE de FFmpeg et de ffprobe pour un fichier venu de dehors (reçu, téléchargé, déposé) : seulement le
// protocole « file », et seulement les lecteurs dont l'appel a besoin. Sans elles, un faux « .mp4 » qui commence par
// « ffconcat version 1.0 » (ou une liste HLS, « concat: », « subfile ») fait lire un AUTRE fichier local, et son contenu
// ressort (en image, en son ou en sous-titres). Un seul endroit, sans dépendance : vidéo, voix, applis l'importent.

const VIDEO = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,mpegts,avi,ogg,asf,flv,mpeg';
const SON = 'mp3,wav,flac,ogg,aac,ac3,eac3,aiff,amr,caf,w64,au,wv,ape,tta,dts,mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,asf';
const IMAGE = 'image2,png_pipe,jpeg_pipe,webp_pipe,tiff_pipe,bmp_pipe,gif,gif_pipe,jpegxl_pipe,qoi_pipe,psd_pipe,mov,mp4,m4a,3gp,3g2,mj2';
const uni = (...l: string[]) => [...new Set(l.join(',').split(','))].join(',');

/** Les lecteurs permis, par genre de fichier attendu. Jamais : concat, hls, ni lecteurs de sous-titres ou de listes. */
export const FORMATS_ENTREE = { video: VIDEO, son: SON, image: IMAGE, media: uni(VIDEO, SON, IMAGE) } as const;

/** À placer juste avant le « -i » (ou le fichier, pour ffprobe) d'un fichier venu de dehors. */
export function entreeFfmpeg(genre: keyof typeof FORMATS_ENTREE, formats: string = FORMATS_ENTREE[genre]): string[] {
  return ['-protocol_whitelist', 'file', '-format_whitelist', formats];
}
