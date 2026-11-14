package com.toufatech.pegase.coeur

import java.net.URI
import java.net.URLEncoder

/** La barre d'adresse : ce qu'on tape devient une adresse ou une recherche. */
object Adresse {
    /** Moteur par défaut (réglable dans Pégase) : %s est remplacé par la recherche. */
    const val RECHERCHE_DEFAUT = "https://duckduckgo.com/?q=%s"

    private val SCHEMA = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):")
    private val IPV4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")
    private val DOMAINE = Regex("^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+[a-zA-Z][a-zA-Z0-9-]{1,62}$")
    private val SCHEMAS_PERMIS = setOf("http", "https", "about")

    fun versUrl(saisie: String, moteur: String = RECHERCHE_DEFAUT): String {
        val t = saisie.trim()
        if (t.isEmpty()) return "about:blank"
        if (t.any { it.isWhitespace() }) return recherche(t, moteur)
        val schema = SCHEMA.find(t)?.groupValues?.get(1)?.lowercase()
        if (schema != null && t.length > schema.length + 1 && !t.substring(schema.length + 1).first().isDigit()) {
            // « javascript: », « file: », « data: »… tapés dans la barre ne sont jamais ouverts : c'est une recherche.
            return if (schema in SCHEMAS_PERMIS) t else recherche(t, moteur)
        }
        val hotePort = t.substringBefore('/').substringBefore('?').substringBefore('#')
        val hote = hotePort.substringBefore(':')
        val port = hotePort.substringAfter(':', "")
        if (port.isNotEmpty() && port.toIntOrNull()?.let { it in 1..65535 } != true) return recherche(t, moteur)
        return when {
            hote.equals("localhost", ignoreCase = true) -> "http://$t"
            IPV4.matches(hote) && hote.split('.').all { it.toInt() <= 255 } -> "http://$t"
            DOMAINE.matches(hote) -> "https://$t"
            else -> recherche(t, moteur)
        }
    }

    fun recherche(q: String, moteur: String = RECHERCHE_DEFAUT): String =
        moteur.replace("%s", URLEncoder.encode(q, "UTF-8"))

    /** Ce qu'on montre dans la barre du bas : le nom du site, sans « www. » (« toufatech.com »). */
    fun pourAffichage(url: String?): String {
        if (url.isNullOrBlank() || url == "about:blank") return ""
        val hote = try {
            URI(url).host
        } catch (e: Exception) {
            null
        } ?: return url
        return hote.removePrefix("www.")
    }

    /** Le texte recherché si l'adresse est une page de résultats du moteur (sert à l'historique « tu cherchais… »). */
    fun rechercheDe(url: String, moteur: String = RECHERCHE_DEFAUT): String? {
        val prefixe = moteur.substringBefore("%s")
        if (prefixe.isEmpty() || !url.startsWith(prefixe)) return null
        val reste = url.substring(prefixe.length).substringBefore('&').substringBefore('#')
        return try {
            java.net.URLDecoder.decode(reste, "UTF-8").ifBlank { null }
        } catch (e: Exception) {
            null
        }
    }
}

/** Trouver Odin tout seul sur le réseau (protocole § 1) : la machine elle-même, puis le /24 local sur 7777 et 7443. */
object Decouverte {
    val PORTS = listOf(7777, 7443)
    const val PARALLELE = 32
    const val DELAI_MS = 1500

    data class Candidat(val hote: String, val port: Int) {
        fun base(https: Boolean) = (if (https) "https://" else "http://") + hote + ":" + port
    }

    /** Les adresses à essayer, dans l'ordre : 127.0.0.1:7777, puis les 253 voisins du /24 sur chaque port. */
    fun candidats(ipLocale: String?): List<Candidat> {
        val r = ArrayList<Candidat>()
        r += Candidat("127.0.0.1", 7777)
        val ip = ipLocale?.trim() ?: return r
        val parts = ip.split('.')
        if (parts.size != 4 || parts.any { p -> p.toIntOrNull()?.let { it in 0..255 } != true }) return r
        val prefixe = parts.take(3).joinToString(".")
        val moi = parts[3].toInt()
        for (port in PORTS) {
            for (n in 1..254) {
                if (n == moi) continue
                r += Candidat("$prefixe.$n", port)
            }
        }
        return r
    }

    /** Une adresse IPv4 privée (réseau de la maison ou du bureau). */
    fun privee(ip: String): Boolean {
        val p = ip.split('.').mapNotNull { it.toIntOrNull() }
        if (p.size != 4) return false
        return p[0] == 10 || (p[0] == 172 && p[1] in 16..31) || (p[0] == 192 && p[1] == 168) || (p[0] == 100 && p[1] in 64..127)
    }

    /** Choisit l'adresse du réseau local parmi celles du téléphone (Wi-Fi d'abord : la première privée). */
    fun choisirIp(adresses: List<String>): String? = adresses.firstOrNull { privee(it) && !it.startsWith("100.") }
        ?: adresses.firstOrNull { privee(it) }
}
