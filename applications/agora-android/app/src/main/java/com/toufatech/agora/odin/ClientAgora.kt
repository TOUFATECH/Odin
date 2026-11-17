package com.toufatech.agora.odin

import com.toufatech.agora.coeur.EvenementSse
import com.toufatech.agora.coeur.Json
import com.toufatech.agora.coeur.LecteurSse
import com.toufatech.agora.coeur.entier
import com.toufatech.agora.coeur.objet
import com.toufatech.agora.coeur.texte
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/**
 * Le certificat d'Odin, épinglé (comme Pégase) : au premier contact on retient l'empreinte SHA-256 du certificat réellement
 * présenté, ensuite on refuse tout autre certificat. Odin a souvent un certificat auto-signé : l'empreinte fait foi.
 */
class Epinglage(@Volatile var attendue: String?) {
    @Volatile var vue: String? = null
        private set
    private val gardien = object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = throw CertificateException("Agora ne présente pas de certificat client.")
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            val cert = chain?.firstOrNull() ?: throw CertificateException("Odin n'a présenté aucun certificat.")
            val e = MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString("") { "%02x".format(it) }
            vue = e
            val a = attendue
            if (a != null && !a.equals(e, ignoreCase = true)) throw CertificateException("Le certificat présenté n'est pas celui d'Odin retenu par Agora.")
        }
        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }
    val contexte: SSLContext = SSLContext.getInstance("TLS").apply { init(null, arrayOf(gardien), null) }
    val nom: HostnameVerifier = HostnameVerifier { _, _ -> true }
}

/** Une erreur d'Odin ou du réseau ; [message] se montre tel quel. */
class ErreurOdin(val statut: Int, val code: String, message: String) : Exception(message) { val horsLigne: Boolean get() = statut == 0 }
class Reponse(val statut: Int, val corps: Map<String, Any?>) {
    val ok: Boolean get() = statut in 200..299 && corps["ok"] != false
    val message: String get() = corps.texte("message") ?: corps.texte("error_description") ?: "Odin a répondu $statut."
    val code: String get() = corps.texte("code") ?: corps.texte("error") ?: statut.toString()
}

/** Ce qu'il faut garder pour rouvrir la session sans mot de passe (chiffré par le téléphone, voir appli/Coffre.kt). */
data class Session(val adresse: String, val empreinte: String?, val refresh: String, val appareil: String)

/**
 * Le client du store d'Odin, sans Android : connexion unique (appli « agora »), « mon store », flux des ordres, comptes
 * rendus, téléchargement des installateurs. [garder] reçoit la session à chaque changement (jeton de renouvellement tourné).
 */
class ClientAgora(adresse: String, empreinte: String?, val appareil: String, private val garder: (Session?) -> Unit = {}) {
    val adresse: String = adresse.trimEnd('/')
    val epinglage = Epinglage(empreinte)
    @Volatile private var acces: String? = null
    @Volatile private var finAcces = 0L
    @Volatile var refresh: String? = null
        private set

    private fun ouvrir(chemin: String, methode: String, entetes: Map<String, String> = emptyMap(), delaiLecture: Int = 20_000): HttpURLConnection {
        val u = URL(if (chemin.startsWith("http")) chemin else adresse + chemin)
        val c = u.openConnection() as HttpURLConnection
        if (c is HttpsURLConnection && u.host == URL(adresse).host && u.port == URL(adresse).port) { c.sslSocketFactory = epinglage.contexte.socketFactory; c.hostnameVerifier = epinglage.nom }
        c.requestMethod = methode; c.connectTimeout = 8_000; c.readTimeout = delaiLecture; c.instanceFollowRedirects = false
        entetes.forEach { (k, v) -> c.setRequestProperty(k, v) }
        return c
    }
    private fun lire(c: HttpURLConnection): Reponse {
        val st = try { c.responseCode } catch (e: IOException) { throw ErreurOdin(0, "hors_ligne", "Odin ne répond pas (${e.message}).") }
        val t = (if (st >= 400) c.errorStream else c.inputStream)?.use { String(it.readBytes(), Charsets.UTF_8) } ?: ""
        val j = try { Json.objet(t.ifBlank { "{}" }) } catch (_: Exception) { emptyMap() }
        return Reponse(st, j)
    }
    private fun envoyer(chemin: String, corps: String, type: String, entetes: Map<String, String> = emptyMap()): Reponse {
        val c = ouvrir(chemin, "POST", entetes + mapOf("content-type" to type, "accept" to "application/json"))
        c.doOutput = true
        try { c.outputStream.use { it.write(corps.toByteArray(Charsets.UTF_8)) } } catch (e: IOException) { throw ErreurOdin(0, "hors_ligne", "Odin ne répond pas (${e.message}).") }
        return lire(c)
    }
    private fun prendre(r: Reponse) {
        acces = r.corps.texte("access_token"); refresh = r.corps.texte("refresh_token") ?: refresh
        finAcces = System.currentTimeMillis() + (r.corps.entier("expires_in") ?: 900) * 1000
        garder(refresh?.let { Session(adresse, epinglage.vue ?: epinglage.attendue, it, appareil) })
    }
    private fun appareilJson(nom: String) = mapOf("id" to appareil, "nom" to nom, "plateforme" to "android")

    /** Connexion par identifiant (ou e-mail) et mot de passe ; `code_requis` si la personne a la double authentification. */
    fun connecter(identifiant: String, motdepasse: String, code: String? = null, nomAppareil: String = "Téléphone"): Reponse {
        val r = envoyer("/sso/connexion", Json.ecrire(mapOf("identifiant" to identifiant, "motdepasse" to motdepasse, "appli" to "agora", "appareil" to appareilJson(nomAppareil)) + (if (code != null) mapOf("code" to code) else emptyMap())), "application/json")
        if (r.statut == 200) { if (epinglage.attendue == null) epinglage.attendue = epinglage.vue; prendre(r) }
        return r
    }
    /** Reprend une session gardée. */
    fun reprendre(s: Session): Boolean { refresh = s.refresh; return renouveler() }
    fun renouveler(): Boolean {
        val rf = refresh ?: return false
        val corps = listOf("grant_type" to "refresh_token", "refresh_token" to rf, "client_id" to "agora", "appareil" to appareil).joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }
        val r = envoyer("/sso/jeton", corps, "application/x-www-form-urlencoded")
        if (r.statut == 200) { prendre(r); return true }
        if (r.statut == 400 || r.statut == 401 || r.statut == 403) { refresh = null; acces = null; garder(null) }
        if (r.statut == 0) throw ErreurOdin(0, "hors_ligne", r.message)
        return false
    }
    @Synchronized fun jeton(): String {
        if (acces == null || System.currentTimeMillis() > finAcces - 60_000) if (!renouveler()) throw ErreurOdin(401, "pas_de_session", "Reconnecte-toi à Odin.")
        return acces!!
    }
    /** Un appel à /api/agora/<chemin> (un renouvellement et un nouvel essai si le jeton a expiré). */
    fun api(chemin: String, corps: Map<String, Any?>? = null): Reponse {
        fun une(): Reponse { val e = mapOf("authorization" to "Bearer ${jeton()}"); return if (corps == null) lire(ouvrir("/api/agora/$chemin", "GET", e + ("accept" to "application/json"))) else envoyer("/api/agora/$chemin", Json.ecrire(corps), "application/json", e) }
        val r = une()
        if (r.statut == 401) { acces = null; return une() }
        return r
    }
    fun inscrire(nom: String, systeme: String, version: String, gere: Boolean) = api("inscrire", mapOf("nom" to nom, "plateforme" to "android", "systeme" to systeme, "version" to version, "gere" to gere))
    fun etat(element: String, etat: String, ordre: String? = null, version: String? = null, progression: Int? = null, erreur: String? = null, par: String = "impose") =
        api("etat", buildMap { put("element", element); put("etat", etat); put("par", par); ordre?.let { put("ordre", it) }; version?.let { put("version", it) }; progression?.let { put("progression", it.toLong()) }; erreur?.let { put("erreur", it.take(200)) } })

    /** Écoute le flux des ordres jusqu'à sa fermeture (à relancer : le flux se ferme à la fin de chaque jeton). */
    fun flux(arret: () -> Boolean = { false }, surEvenement: (EvenementSse) -> Unit) {
        val c = ouvrir("/api/agora/flux", "GET", mapOf("authorization" to "Bearer ${jeton()}", "accept" to "text/event-stream"), delaiLecture = 70_000)
        val st = try { c.responseCode } catch (e: IOException) { throw ErreurOdin(0, "hors_ligne", "Odin ne répond pas (${e.message}).") }
        if (st != 200) { val r = lire(c); throw ErreurOdin(st, r.code, r.message) }
        val l = LecteurSse(surEvenement)
        c.inputStream.bufferedReader(Charsets.UTF_8).use { b -> while (!arret()) { val x = b.readLine() ?: break; l.ligne(x) } }
        c.disconnect()
    }
    /** L'installateur en flux : depuis Odin (jeton et certificat épinglé) ou à son adresse d'origine (https, certificats du système). */
    fun telecharger(lien: String): Pair<InputStream, Long> {
        val chezOdin = lien.startsWith("/")
        if (!chezOdin && !lien.startsWith("https://")) throw ErreurOdin(0, "lien", "Adresse de téléchargement refusée (https seulement).")
        var u = lien; var reste = 5
        while (true) {
            val c = ouvrir(u, "GET", if (u.startsWith("/")) mapOf("authorization" to "Bearer ${jeton()}") else emptyMap(), delaiLecture = 120_000)
            val st = try { c.responseCode } catch (e: IOException) { throw ErreurOdin(0, "hors_ligne", "Téléchargement impossible (${e.message}).") }
            if (st in 300..399 && reste-- > 0) { val loc = c.getHeaderField("location") ?: break; val n = URL(URL(if (u.startsWith("/")) adresse + u else u), loc).toString(); if (!n.startsWith("https://")) throw ErreurOdin(0, "lien", "Redirection non chiffrée refusée."); u = n; continue }
            if (st != 200) { val r = lire(c); throw ErreurOdin(st, r.code, r.message) }
            return c.inputStream to c.contentLengthLong
        }
        throw ErreurOdin(0, "lien", "Trop de redirections.")
    }
    fun store() = api("store")
    fun personne(r: Reponse): Map<String, Any?>? = r.corps.objet("personne")
}
