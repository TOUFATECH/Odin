package com.toufatech.pegase.coeur

/** Un évènement du flux d'Odin (`GET /api/pegase/flux`, Server-Sent Events). */
data class EvenementSse(val type: String, val data: String, val id: String?)

/**
 * Lecteur de Server-Sent Events, ligne par ligne (règles du standard HTML) :
 * `event:` donne le type, `data:` s'ajoute (plusieurs lignes jointes par "\n"), une ligne vide envoie l'évènement,
 * une ligne qui commence par « : » est un commentaire (signe de vie).
 */
class LecteurSse(private val surEvenement: (EvenementSse) -> Unit) {
    private var type = ""
    private val data = StringBuilder()
    private var aDesDonnees = false
    private var dernierId: String? = null

    fun ligne(l: String) {
        if (l.isEmpty()) {
            if (aDesDonnees) surEvenement(EvenementSse(type.ifEmpty { "message" }, data.toString(), dernierId))
            type = ""
            data.setLength(0)
            aDesDonnees = false
            return
        }
        if (l.startsWith(":")) return
        val i = l.indexOf(':')
        val champ = if (i < 0) l else l.substring(0, i)
        var valeur = if (i < 0) "" else l.substring(i + 1)
        if (valeur.startsWith(" ")) valeur = valeur.substring(1)
        when (champ) {
            "event" -> type = valeur
            "data" -> {
                if (aDesDonnees) data.append('\n')
                data.append(valeur)
                aDesDonnees = true
            }
            "id" -> if (!valeur.contains('\u0000')) dernierId = valeur
            else -> Unit // « retry » et champs inconnus : ignorés
        }
    }
}
