package com.toufatech.pegase.coeur

import java.math.BigInteger
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.util.Base64

/**
 * La connexion unique d'Odin (OpenID Connect, code + PKCE), partie pure : docs/sso-protocole.md d'Odin, § 2 à 5 et 11.
 * Le réseau est dans `odin/ClientOdin.kt`, l'écran dans `ui/`.
 */
object Oidc {
    const val CLIENT = "pegase"
    const val RETOUR = "pegase://sso/retour"
    const val SCOPE = "openid profile email groups offline_access"

    private val hasard = SecureRandom()

    fun b64url(b: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(b)

    fun deB64url(s: String): ByteArray = Base64.getUrlDecoder().decode(s.trimEnd('='))

    fun aleatoire(octets: Int = 32): String = b64url(ByteArray(octets).also { hasard.nextBytes(it) })

    /** Le secret PKCE (43 caractères base64url). */
    fun verificateur(): String = aleatoire(32)

    /** Le défi PKCE S256 : BASE64URL(SHA256(verificateur)). */
    fun defi(verificateur: String): String =
        b64url(MessageDigest.getInstance("SHA-256").digest(verificateur.toByteArray(Charsets.US_ASCII)))

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    fun formulaire(params: List<Pair<String, String>>): String = params.joinToString("&") { (k, v) -> enc(k) + "=" + enc(v) }

    /** L'adresse de la page d'Odin qui demande la connexion (prompt=none : jamais d'écran, pour la connexion automatique). */
    fun adresseAutorisation(
        pointAutoriser: String,
        defi: String,
        etat: String,
        nonce: String,
        prompt: String? = null,
        indice: String? = null,
    ): String {
        val p = mutableListOf(
            "response_type" to "code",
            "client_id" to CLIENT,
            "redirect_uri" to RETOUR,
            "scope" to SCOPE,
            "state" to etat,
            "nonce" to nonce,
            "code_challenge" to defi,
            "code_challenge_method" to "S256",
        )
        if (prompt != null) p += "prompt" to prompt
        if (!indice.isNullOrBlank()) p += "login_hint" to indice
        return pointAutoriser + (if (pointAutoriser.contains('?')) "&" else "?") + formulaire(p)
    }

    fun estRetour(url: String) = url.startsWith(RETOUR)

    sealed class Retour {
        data class Code(val code: String, val iss: String?) : Retour()

        /** [message] est le texte d'Odin, à montrer tel quel. */
        data class Erreur(val code: String, val message: String) : Retour()
    }

    fun parametres(url: String): Map<String, String> {
        val requete = try {
            URI(url).rawQuery
        } catch (e: Exception) {
            url.substringAfter('?', "")
        } ?: return emptyMap()
        val r = LinkedHashMap<String, String>()
        for (morceau in requete.split('&')) {
            if (morceau.isEmpty()) continue
            val k = URLDecoder.decode(morceau.substringBefore('='), "UTF-8")
            val v = URLDecoder.decode(morceau.substringAfter('=', ""), "UTF-8")
            if (!r.containsKey(k)) r[k] = v
        }
        return r
    }

    /** Lit le retour `pegase://sso/retour?code=…&state=…&iss=…` (ou `?error=…&error_description=…`). */
    fun lireRetour(url: String, etatAttendu: String, emetteur: String?): Retour {
        val p = parametres(url)
        if (p["state"] != etatAttendu) {
            return Retour.Erreur("etat", "La réponse d'Odin ne correspond pas à ta demande : recommence la connexion.")
        }
        val iss = p["iss"]
        if (iss != null && emetteur != null && iss.trimEnd('/') != emetteur.trimEnd('/')) {
            return Retour.Erreur("emetteur", "La réponse ne vient pas de ton Odin : recommence la connexion.")
        }
        val err = p["error"]
        if (err != null) {
            val texte = p["error_description"]?.ifBlank { null } ?: when (err) {
                "login_required" -> "Connecte-toi à Odin."
                "access_denied" -> "Odin a refusé l'accès à Pégase."
                else -> "Odin n'a pas pu te connecter ($err) : recommence."
            }
            return Retour.Erreur(err, texte)
        }
        val code = p["code"] ?: return Retour.Erreur("code", "Odin n'a pas rendu de code de connexion : recommence.")
        return Retour.Code(code, iss)
    }
}

/** Les jetons d'une session SSO (réponse de `/sso/jeton` ou `/sso/connexion`). */
data class Jetons(
    val acces: String,
    /** Date d'expiration du jeton d'accès (ms). */
    val expire: Long,
    val renouvellement: String?,
    val identite: String?,
) {
    companion object {
        fun deJson(m: Map<String, Any?>, maintenant: Long): Jetons? {
            val acces = m.texte("access_token") ?: return null
            val duree = m.entier("expires_in") ?: 900L
            return Jetons(acces, maintenant + duree * 1000, m.texte("refresh_token"), m.texte("id_token"))
        }
    }
}

/** Lecture et vérification des jetons JWT d'Odin (ES256, signature brute r‖s de 64 octets). */
object Jwt {
    fun entete(jwt: String): Map<String, Any?>? = partie(jwt, 0)

    fun charge(jwt: String): Map<String, Any?>? = partie(jwt, 1)

    private fun partie(jwt: String, i: Int): Map<String, Any?>? {
        val p = jwt.split('.')
        if (p.size != 3) return null
        return try {
            Json.objet(String(Oidc.deB64url(p[i]), Charsets.UTF_8))
        } catch (e: Exception) {
            null
        }
    }

    /** Convertit la signature brute r‖s (64 octets) en DER, la forme qu'attend java.security. */
    fun brutVersDer(brut: ByteArray): ByteArray {
        require(brut.size == 64) { "Signature ES256 de 64 octets attendue" }
        fun entier(i: ByteArray): ByteArray {
            var b = i.dropWhile { it == 0.toByte() }.toByteArray()
            if (b.isEmpty() || b[0] < 0) b = byteArrayOf(0) + b
            return byteArrayOf(2, b.size.toByte()) + b
        }
        val seq = entier(brut.copyOfRange(0, 32)) + entier(brut.copyOfRange(32, 64))
        return byteArrayOf(0x30, seq.size.toByte()) + seq
    }

    fun signatureOk(jwt: String, jwk: Map<String, Any?>): Boolean = try {
        val p = jwt.split('.')
        val x = BigInteger(1, Oidc.deB64url(jwk.texte("x")!!))
        val y = BigInteger(1, Oidc.deB64url(jwk.texte("y")!!))
        val params = AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }
            .getParameterSpec(ECParameterSpec::class.java)
        val cle = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), params))
        Signature.getInstance("SHA256withECDSA").run {
            initVerify(cle)
            update((p[0] + "." + p[1]).toByteArray(Charsets.US_ASCII))
            verify(brutVersDer(Oidc.deB64url(p[2])))
        }
    } catch (e: Exception) {
        false
    }

    /**
     * Vérifie un jeton d'Odin dans l'ordre du protocole : alg ES256, clé `kid`, signature, iss, aud, exp (60 s de marge),
     * nonce. Rend null si tout va bien, sinon la raison.
     */
    fun verifier(
        jwt: String,
        cles: List<Map<String, Any?>>,
        emetteur: String,
        audience: String,
        maintenantS: Long,
        nonce: String? = null,
    ): String? {
        val t = entete(jwt) ?: return "jeton illisible"
        if (t.texte("alg") != "ES256") return "algorithme refusé"
        val kid = t.texte("kid")
        val cle = cles.firstOrNull { it.texte("kid") == kid } ?: return "clé inconnue"
        if (!signatureOk(jwt, cle)) return "signature fausse"
        val c = charge(jwt) ?: return "jeton illisible"
        if (c.texte("iss")?.trimEnd('/') != emetteur.trimEnd('/')) return "émetteur inattendu"
        val aud = c["aud"]
        val audOk = when (aud) {
            is String -> aud == audience
            is List<*> -> audience in aud
            else -> false
        }
        if (!audOk) return "jeton d'une autre appli"
        val exp = c.entier("exp") ?: return "jeton sans date d'expiration"
        if (exp + 60 < maintenantS) return "jeton expiré"
        if (nonce != null && c.texte("nonce") != nonce) return "nonce inattendu"
        return null
    }
}
