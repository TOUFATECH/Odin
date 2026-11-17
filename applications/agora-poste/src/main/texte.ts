// Ce qu'Agora montre à la personne : jamais un dossier interne de l'ordinateur (C:\Users\…\AppData…, /home/…, ~/…),
// et les erreurs du système dites en français simple.

const SYSTEME: Record<string, string> = {
  EACCES: 'accès refusé par le système', EPERM: 'accès refusé par le système', ENOSPC: 'plus de place sur le disque',
  ENOENT: 'fichier introuvable', EBUSY: 'fichier occupé par un autre programme', EROFS: 'disque en lecture seule',
  EMFILE: 'trop de fichiers ouverts : redémarre Agora', ENOTDIR: 'dossier introuvable', EISDIR: 'fichier introuvable',
};

/** Le message, sans chemin de dossier ; une erreur de fichier du système devient une phrase simple. */
export function pourLaPersonne(message: string): string {
  const code = /^(E[A-Z]+):/.exec(message.trim())?.[1];
  if (code && SYSTEME[code]) return SYSTEME[code];
  return message
    .replace(/'[^'\n]*[\\/][^'\n]*'/g, '…')                                  // chemin entre apostrophes (erreurs de Node)
    .replace(/"[^"\n]*[\\/][^"\n]*"/g, '…')
    .replace(/\b[A-Za-z]:\\[^\s'"),;]*/g, '…')                               // C:\Users\…
    .replace(/\\\\[\w.$-]+\\[^\s'"),;]*/g, '…')                              // \\serveur\partage\…
    .replace(/(^|[\s(=])~?\/(?:[^\s/'"),;]+\/)+[^\s'"),;]*/g, '$1…');      // /home/…, ~/…, /tmp/…
}
