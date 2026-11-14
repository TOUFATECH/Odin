package com.toufatech.pegase.coeur

import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OidcTest {
    @Test
    fun pkceSelonLaRfc7636() {
        // Exemple de l'annexe B de la RFC 7636.
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Oidc.defi("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
        val v = Oidc.verificateur()
        assertEquals(43, v.length)
        assertEquals(43, Oidc.defi(v).length)
        assertTrue(v.all { it.isLetterOrDigit() || it == '-' || it == '_' })
    }

    @Test
    fun adresseDeConnexion() {
        val u = Oidc.adresseAutorisation("https://192.168.1.10:7777/sso/autoriser", "DEFI", "ETAT1234", "N", prompt = "none")
        val p = Oidc.parametres(u)
        assertEquals("code", p["response_type"])
        assertEquals("pegase", p["client_id"])
        assertEquals("pegase://sso/retour", p["redirect_uri"])
        assertEquals("openid profile email groups offline_access", p["scope"])
        assertEquals("S256", p["code_challenge_method"])
        assertEquals("none", p["prompt"])
        assertTrue("redirect_uri=pegase%3A%2F%2Fsso%2Fretour" in u)
        assertTrue("scope=openid%20profile" in u)
    }

    @Test
    fun retourDOdin() {
        val ok = Oidc.lireRetour("pegase://sso/retour?code=abc&state=E1&iss=https%3A%2F%2F192.168.1.10%3A7777", "E1", "https://192.168.1.10:7777")
        assertEquals(Oidc.Retour.Code("abc", "https://192.168.1.10:7777"), ok)
        val autreEtat = Oidc.lireRetour("pegase://sso/retour?code=abc&state=E2", "E1", null)
        assertTrue(autreEtat is Oidc.Retour.Erreur)
        val refus = Oidc.lireRetour(
            "pegase://sso/retour?error=access_denied&error_description=Tu%20n%27as%20pas%20acc%C3%A8s%20%C3%A0%20P%C3%A9gase.&state=E1",
            "E1", null,
        )
        // Le message d'Odin est montré tel quel.
        assertEquals(Oidc.Retour.Erreur("access_denied", "Tu n'as pas accès à Pégase."), refus)
        val autreOdin = Oidc.lireRetour("pegase://sso/retour?code=abc&state=E1&iss=https%3A%2F%2Fpirate", "E1", "https://192.168.1.10:7777")
        assertTrue(autreOdin is Oidc.Retour.Erreur)
    }

    private fun jwt(entete: Map<String, Any?>, charge: Map<String, Any?>, signer: (ByteArray) -> ByteArray): String {
        val h = Oidc.b64url(Json.ecrire(entete).toByteArray())
        val p = Oidc.b64url(Json.ecrire(charge).toByteArray())
        return "$h.$p." + Oidc.b64url(signer("$h.$p".toByteArray()))
    }

    /** DER → r‖s brut (comme le fait Odin avec node:crypto, dsaEncoding: 'ieee-p1363'). */
    private fun derVersBrut(der: ByteArray): ByteArray {
        var i = 2
        fun entier(): ByteArray {
            val n = der[i + 1].toInt()
            val b = der.copyOfRange(i + 2, i + 2 + n)
            i += 2 + n
            val sans = b.dropWhile { it == 0.toByte() }.toByteArray()
            return ByteArray(32 - sans.size) + sans
        }
        return entier() + entier()
    }

    @Test
    fun verifieUnJetonEs256() {
        val g = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }
        val paire = g.generateKeyPair()
        val pub = paire.public as ECPublicKey
        fun coord(b: java.math.BigInteger): String {
            val o = b.toByteArray().dropWhile { it == 0.toByte() }.toByteArray()
            return Oidc.b64url(ByteArray(32 - o.size) + o)
        }
        val jwk = mapOf("kty" to "EC", "crv" to "P-256", "kid" to "k1", "x" to coord(pub.w.affineX), "y" to coord(pub.w.affineY))
        val signer = { donnees: ByteArray ->
            derVersBrut(Signature.getInstance("SHA256withECDSA").run { initSign(paire.private); update(donnees); sign() })
        }
        val maintenant = 1763125200L
        val charge = mapOf("iss" to "https://192.168.1.10:7777", "aud" to "pegase", "sub" to "a41f0c9e2b", "exp" to maintenant + 900, "nonce" to "n1")
        val bon = jwt(mapOf("alg" to "ES256", "typ" to "JWT", "kid" to "k1"), charge, signer)
        assertNull(Jwt.verifier(bon, listOf(jwk), "https://192.168.1.10:7777", "pegase", maintenant, "n1"))
        assertEquals("nonce inattendu", Jwt.verifier(bon, listOf(jwk), "https://192.168.1.10:7777", "pegase", maintenant, "n2"))
        assertEquals("jeton d'une autre appli", Jwt.verifier(bon, listOf(jwk), "https://192.168.1.10:7777", "venus", maintenant))
        assertEquals("jeton expiré", Jwt.verifier(bon, listOf(jwk), "https://192.168.1.10:7777", "pegase", maintenant + 2000))
        assertEquals("émetteur inattendu", Jwt.verifier(bon, listOf(jwk), "https://autre", "pegase", maintenant))
        val sansAlg = jwt(mapOf("alg" to "none", "kid" to "k1"), charge) { ByteArray(64) }
        assertEquals("algorithme refusé", Jwt.verifier(sansAlg, listOf(jwk), "https://192.168.1.10:7777", "pegase", maintenant))
        val p = bon.split('.')
        val falsifie = p[0] + "." + Oidc.b64url(Json.ecrire(charge + ("sub" to "pirate")).toByteArray()) + "." + p[2]
        assertEquals("signature fausse", Jwt.verifier(falsifie, listOf(jwk), "https://192.168.1.10:7777", "pegase", maintenant))
        assertFalse(Jwt.signatureOk("a.b", jwk))
    }

    @Test
    fun jetonsDeLaReponse() {
        val j = Jetons.deJson(Json.objet("""{"access_token":"eyJ.a.b","token_type":"Bearer","expires_in":900,"refresh_token":"odr1.x.y","id_token":"eyJ.c.d"}"""), 1000)!!
        assertEquals(901_000L, j.expire)
        assertEquals("odr1.x.y", j.renouvellement)
        assertNull(Jetons.deJson(Json.objet("""{"error":"invalid_grant"}"""), 0))
    }
}
