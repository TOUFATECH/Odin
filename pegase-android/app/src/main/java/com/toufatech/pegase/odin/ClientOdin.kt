package com.toufatech.pegase.odin

import com.toufatech.pegase.coeur.Empreintes
import com.toufatech.pegase.coeur.Json
import com.toufatech.pegase.coeur.entier
import com.toufatech.pegase.coeur.texte
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.X509TrustManager

/**
 * Le certificat d'Odin, épinglé (protocole § 1 et SSO § 9) : au premier contact on retient l'empreinte SHA-256 du
 * certificat réellement présenté (forme DER, hexadécimal minuscule), ensuite on refuse tout autre certificat.
 * Odin a souvent un certificat auto-signé : c'est l'empreinte qui prouve qu'on parle au bon Odin, pas une autorité.
 */
class Epinglage(@Volatile var attendue: String?) {
    /** L'empreinte du dernier certificat présenté par Odin sur cette connexion. */
    @Volatile
    var vue: String? = null
        private set

    val gardien: X509TrustManager = object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            throw CertificateException("Pégase ne présente pas de certificat client.")
        }

        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            val cert = chain?.firstOrNull() ?: throw CertificateException("Odin n'a présenté aucun certificat.")
            val e = empreinte(cert)
            vue = e
            val a = attendue
            if (a != null && !a.equals(e, ignoreCase = true)) {
                throw CertificateException("Le certificat présenté n'est pas celui d'Odin retenu par Pégase.")
            }
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }

    val contexte: SSLContext = SSLContext.getInstance("TLS").apply { init(null, arrayOf(gardien), null) }

    /** Le nom de la machine n'est pas vérifié : Odin est joint par son adresse IP, l'empreinte fait foi. */
    val nom: HostnameVerifier = HostnameVerifier { _, _ -> true }

    companion object {
        fun empreinte(cert: X509Certificate): String = Empreintes.hex(
            java.security.MessageDigest.getInstance("SHA-256").digest(cert.encoded),
        )

        /** « 3F9A·0C12·… » : les premiers caractères, pour que l'utilisateur puisse comparer avec l'écran d'Odin. */
        fun courte(e: String?): String = e?.take(16)?.uppercase()?.chunked(4)?.joinToString("·") ?: "aucune (http)"
    }
}

/** Une erreur d'Odin ou du réseau ; [message] est à montrer tel quel (texte français d'Odin ou de Pégase). */
class ErreurOdin(val statut: Int, val code: String, message: String, val attente: Long? = null) : Exception(message) {
    /** Pas de réseau, Odin éteint ou injoignable. */
    val horsLigne: Boolean get() = statut == 0
}

class ReponseOdin(val statut: Int, val corps: Map<String, Any?>, val brut: ByteArray, val entetes: Map<String, String>) {
    val ok: Boolean get() = statut in 200..299 && corps["ok"] != false
    val code: String get() = corps.texte("code") ?: corps.texte("error") ?: statut.toString()

    /** Le texte d'Odin, tel quel : `message` (SSO), `erreur` (Pégase) ou `error_description` (OAuth). */
    val message: String
        get() = corps.texte("message") ?: corps.texte("erreur") ?: corps.texte("error_description")
            ?: when (statut) {
                401 -> "Odin ne te reconnaît plus : reconnecte-toi."
                403 -> "Odin a refusé : tu n'as pas le droit de faire ça."
                404 -> "Odin ne connaît pas cette demande (il est peut-être trop ancien)."
                413 -> "C'est trop gros pour Odin."
                429 -> "Trop d'essais : attends un peu avant de recommencer."
                in 500..599 -> "Odin a eu un problème ($statut) : réessaie dans un moment."
                else -> "Odin a répondu $statut."
            }

    fun erreur(): ErreurOdin = ErreurOdin(statut, code, message, corps.entier("attente"))

    fun texte(): String = String(brut, Charsets.UTF_8)
}

/**
 * Parler à Odin en HTTPS (ou HTTP pour un Odin d'essai), avec le certificat épinglé.
 * Uniquement la bibliothèque standard de Java : tourne tel quel dans les essais JVM et sur Android.
 */
class ClientOdin(base: String, val epinglage: Epinglage = Epinglage(null)) {
    val base: String = base.trimEnd('/')

    fun ouvrir(chemin: String, methode: String, delaiLectureMs: Int = 30_000, delaiConnexionMs: Int = 8_000): HttpURLConnection {
        val c = URL(if (chemin.startsWith("http")) chemin else base + chemin).openConnection() as HttpURLConnection
        if (c is HttpsURLConnection) {
            c.sslSocketFactory = epinglage.contexte.socketFactory
            c.hostnameVerifier = epinglage.nom
        }
        c.requestMethod = methode
        c.connectTimeout = delaiConnexionMs
        c.readTimeout = delaiLectureMs
        c.instanceFollowRedirects = false
        c.useCaches = false
        c.setRequestProperty("accept", "application/json")
        c.setRequestProperty("user-agent", "Pegase-Android/1")
        return c
    }

    /**
     * Une requête ; ne lève une exception que si Odin est injoignable ([ErreurOdin] avec statut 0).
     * Les réponses d'erreur d'Odin (4xx, 5xx) sont rendues telles quelles.
     */
    fun requete(
        methode: String,
        chemin: String,
        corps: ByteArray? = null,
        type: String? = null,
        entetes: Map<String, String> = emptyMap(),
        delaiLectureMs: Int = 30_000,
        delaiConnexionMs: Int = 8_000,
    ): ReponseOdin {
        try {
            val c = ouvrir(chemin, methode, delaiLectureMs, delaiConnexionMs)
            for ((k, v) in entetes) c.setRequestProperty(k, v)
            if (corps != null) {
                c.doOutput = true
                if (type != null) c.setRequestProperty("content-type", type)
                // Petits corps : envoyés d'un bloc (en mode « flux », Java ne rend plus le corps d'une réponse 401).
                if (corps.size > 1_000_000) c.setFixedLengthStreamingMode(corps.size)
                c.outputStream.use { it.write(corps) }
            }
            val statut = c.responseCode
            val flux = if (statut >= 400) c.errorStream else c.inputStream
            val brut = flux?.use { it.readBytes() } ?: ByteArray(0)
            val h = HashMap<String, String>()
            for ((k, v) in c.headerFields) if (k != null && v.isNotEmpty()) h[k.lowercase()] = v[0]
            val m: Map<String, Any?> = if (h["content-type"]?.contains("json") == true || brut.firstOrNull() == '{'.code.toByte()) {
                try {
                    Json.objet(String(brut, Charsets.UTF_8))
                } catch (e: Json.Illisible) {
                    emptyMap()
                }
            } else {
                emptyMap()
            }
            return ReponseOdin(statut, m, brut, h)
        } catch (e: SSLHandshakeException) {
            throw ErreurOdin(0, "certificat", "Le certificat d'Odin a changé : Pégase refuse de s'y connecter. Si tu as réinstallé Odin, oublie-le dans les réglages puis reconnecte-toi.")
        } catch (e: IOException) {
            throw ErreurOdin(0, "hors_ligne", "Odin ne répond pas à $base : vérifie que ton téléphone est sur le même réseau.")
        }
    }

    fun getJson(chemin: String, entetes: Map<String, String> = emptyMap(), delaiMs: Int = 30_000) =
        requete("GET", chemin, entetes = entetes, delaiLectureMs = delaiMs)

    fun postJson(chemin: String, corps: Map<String, Any?>, entetes: Map<String, String> = emptyMap(), delaiMs: Int = 30_000) =
        requete("POST", chemin, Json.ecrire(corps).toByteArray(Charsets.UTF_8), "application/json", entetes, delaiMs)

    fun postFormulaire(chemin: String, params: List<Pair<String, String>>) = requete(
        "POST", chemin, com.toufatech.pegase.coeur.Oidc.formulaire(params).toByteArray(Charsets.UTF_8),
        "application/x-www-form-urlencoded",
    )
}
