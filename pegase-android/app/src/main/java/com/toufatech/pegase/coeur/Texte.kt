package com.toufatech.pegase.coeur

/**
 * Ce que l'appli montre à la personne : jamais un dossier interne du téléphone (/data/user/0/…, /storage/…),
 * et les erreurs de fichier du système dites en français simple. Logique pure, sans Android (vérifiée dans les essais JVM).
 */
object Texte {
    private val CODE = Regex("""\b(EACCES|EPERM|ENOSPC|ENOENT|EROFS)\b""")
    private val CHEMIN = Regex("""(^|[\s(='"])/(?:[^\s/'"),;]+/)+[^\s'"),;]*""")

    /** Le message sans chemin de dossier ; « ENOSPC… » devient « plus de place sur le téléphone ». */
    fun sansChemin(message: String?): String {
        if (message.isNullOrBlank()) return "erreur inattendue"
        when (CODE.find(message)?.groupValues?.get(1)) {
            "ENOSPC" -> return "plus de place sur le téléphone"
            "ENOENT" -> return "fichier introuvable"
            "EROFS" -> return "stockage en lecture seule"
            "EACCES", "EPERM" -> return "accès refusé par le téléphone"
        }
        return CHEMIN.replace(message) { it.groupValues[1] + "…" }
    }
}
