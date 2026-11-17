package com.toufatech.pegase.odin

import com.toufatech.pegase.coeur.Empreinte
import com.toufatech.pegase.coeur.Empreintes
import com.toufatech.pegase.coeur.Enregistrement
import com.toufatech.pegase.coeur.Json
import com.toufatech.pegase.coeur.booleen
import com.toufatech.pegase.coeur.entier
import com.toufatech.pegase.coeur.liste
import com.toufatech.pegase.coeur.objets
import com.toufatech.pegase.coeur.texte
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URLEncoder

/** Ce que dit `GET /api/pegase/bonjour`. */
data class Bonjour(
    val base: String,
    val nom: String,
    val version: String,
    val empreinte: String?,
    val dns: Boolean,
    val comptes: Boolean,
) {
    companion object {
        fun deJson(base: String, m: Map<String, Any?>): Bonjour? {
            if (m.booleen("odin") != true) return null
            return Bonjour(
                base = base,
                nom = m.texte("nom") ?: "Odin",
                version = m.texte("version") ?: "?",
                empreinte = m.texte("empreinte"),
                dns = m.booleen("dns") == true,
                comptes = m.booleen("comptes") == true,
            )
        }
    }
}

/**
 * Les routes `/api/pegase/…` d'Odin (docs/pegase-protocole.md). Chaque appel porte le jeton de [auth] ;
 * sur « jeton_invalide », le jeton est renouvelé une fois puis l'appel refait.
 */
class ApiPegase(val client: ClientOdin, val auth: Authentification) {
    private fun entetes(jeton: String?): Map<String, String> {
        val h = HashMap<String, String>()
        if (jeton != null) h["authorization"] = "Bearer $jeton"
        val s = auth.session
        // Avec un jeton SSO, Odin crée l'appareil à partir de ce nom (protocole § 2, « Connexion unique du poste »).
        if (s != null && s.jetonPegase == null) h["x-pegase-appareil"] = s.appareilNom.take(60)
        return h
    }

    private fun appel(faire: (Map<String, String>) -> ReponseOdin): ReponseOdin {
        val jeton = auth.jeton() ?: throw ErreurOdin(401, "jeton_requis", "Connecte-toi à Odin pour synchroniser.")
        val r = faire(entetes(jeton))
        if (r.statut == 401 && (r.code == "jeton_invalide" || r.code == "jeton_requis")) {
            auth.invalider()
            val j2 = auth.jeton() ?: throw r.erreur()
            return faire(entetes(j2))
        }
        // « pas_de_droit » : le droit sur Pégase a été retiré dans Persona (la session s'arrête, message tel quel).
        // « refuse » : seulement cette action (ex. « demander » pour un membre) ; on montre le message, sans plus.
        if (r.statut == 403 && r.code == "pas_de_droit") auth.perdre(r.message)
        return r
    }

    private fun get(chemin: String, delai: Int = 30_000) = appel { client.getJson(chemin, it, delai) }

    private fun post(chemin: String, corps: Map<String, Any?>, delai: Int = 30_000) = appel { client.postJson(chemin, corps, it, delai) }

    fun moi() = get("/api/pegase/moi")

    fun reglerVoir(voir: String) = post("/api/pegase/moi", mapOf("voir" to voir))

    fun envoyer(changements: List<Enregistrement>) =
        post("/api/pegase/envoyer", mapOf("changements" to changements.map { it.versJson() }))

    fun empreintes(): Map<String, Empreinte> {
        val r = get("/api/pegase/empreintes")
        if (!r.ok) throw r.erreur()
        return Empreintes.deJson(r.corps)
    }

    /** Toute une collection (ou depuis une date), page après page. */
    fun tirerTout(col: String, depuis: Long? = null): List<Enregistrement> {
        val tout = ArrayList<Enregistrement>()
        var d = depuis
        var tours = 0
        while (true) {
            val corps = linkedMapOf<String, Any?>("col" to col, "limite" to 5000)
            if (d != null) corps["depuis"] = d
            val r = post("/api/pegase/tirer", corps, 60_000)
            if (!r.ok) throw r.erreur()
            tout += Enregistrement.listeDeJson(r.corps.liste("changements"))
            if (r.corps.booleen("complet") != false) break
            val suite = r.corps.entier("suite") ?: break
            if (suite == d || ++tours > 1000) break
            d = suite
        }
        return tout
    }

    fun copies() = get("/api/pegase/copies")

    fun restaurer(copie: String) = post("/api/pegase/restaurer", mapOf("copie" to copie))

    /** Demander à Odin ; la page est une donnée, jamais un ordre (Odin l'encadre comme telle). */
    fun demander(texte: String, url: String?, titre: String?, extrait: String?): ReponseOdin {
        val corps = linkedMapOf<String, Any?>("texte" to texte.take(4000))
        if (url != null) corps["page"] = mapOf("url" to url, "titre" to (titre ?: ""), "extrait" to (extrait ?: "").take(20_000))
        return post("/api/pegase/demander", corps, 150_000)
    }

    fun propositions(): List<Map<String, Any?>> {
        val r = get("/api/pegase/propositions")
        return if (r.ok) r.corps.liste("propositions")?.objets() ?: emptyList() else emptyList()
    }

    fun signatures(version: Long?): ReponseOdin = get("/api/pegase/signatures" + (if (version != null) "?version=$version" else ""))

    fun adresse(url: String) = post("/api/pegase/adresse", mapOf("url" to url), 15_000)

    fun agendaLien(nouvelle: Boolean = false) = post("/api/pegase/agenda/lien", if (nouvelle) mapOf("nouvelle" to true) else emptyMap())

    /** Envoie un fichier en quarantaine à Odin pour analyse (seulement si l'utilisateur l'a permis). */
    fun analyser(fichier: File, nom: String): ReponseOdin = appel { h ->
        val e = HashMap(h)
        e["x-nom"] = URLEncoder.encode(nom, "UTF-8").replace("+", "%20")
        // Lu en entier : 200 Mo au plus côté Odin (au-delà, Pégase ne l'envoie pas).
        val octets = FileInputStream(fichier).use { it.readBytes() }
        client.requete("POST", "/api/pegase/analyser", octets, "application/octet-stream", e, 180_000)
    }

    /** Ouvre le flux d'évènements (SSE). Délai de lecture 70 s : sans `verif` depuis 70 s, on rouvre. */
    fun ouvrirFlux(): HttpURLConnection {
        val jeton = auth.jeton() ?: throw ErreurOdin(401, "jeton_requis", "Connecte-toi à Odin pour synchroniser.")
        val c = client.ouvrir("/api/pegase/flux", "GET", delaiLectureMs = 70_000)
        for ((k, v) in entetes(jeton)) c.setRequestProperty(k, v)
        c.setRequestProperty("accept", "text/event-stream")
        return c
    }

    companion object {
        /** `GET /api/pegase/bonjour` (sans jeton) ; vérifie que le certificat présenté est bien celui qu'Odin annonce. */
        fun bonjour(client: ClientOdin, delaiMs: Int = 4000): Bonjour? {
            val r = try {
                client.requete("GET", "/api/pegase/bonjour", delaiLectureMs = delaiMs, delaiConnexionMs = delaiMs)
            } catch (e: ErreurOdin) {
                return null
            }
            if (r.statut != 200) return null
            val b = Bonjour.deJson(client.base, r.corps) ?: return null
            if (client.base.startsWith("https://")) {
                val vue = client.epinglage.vue
                if (b.empreinte != null && vue != null && !b.empreinte.equals(vue, ignoreCase = true)) return null
                return b.copy(empreinte = vue ?: b.empreinte)
            }
            return b
        }

        fun lireJson(texte: String): Map<String, Any?> = try {
            Json.objet(texte)
        } catch (e: Json.Illisible) {
            emptyMap()
        }
    }
}
